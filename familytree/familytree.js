// ============================================================
// orOS Family Tree — App logic (v1.0.0)
// Build your family tree: people, couples, children; view it
// around one person (ancestors above, descendants below), export
// it as SVG / PNG / print, back it up as JSON.
//   - several trees; partial dates ("c. 1890"); many marriages,
//     adoption, unknown parents
//   - read-only link to Contacts: fill a person from a contact,
//     build a tree from the relations Contacts already know
// Data:
//   - synced slice "familytree" (oros-familytree-data): FAMTREE v1,
//     see ft-core.js (LWW per entity + tombstones, R5, R17, R26)
//   - device-local (R10): oros-familytree-prefs ({tree, focus{},
//     view, up, down, exp{}}), oros-familytree-data-broken
// Pure logic (normalize, merge, import, layout, SVG) lives in
// ft-core.js (window.FTCore) and is unit-tested in node.
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage, prefs
//   3. Mutations (stamp at the mutation site, R27)
//   4. Tree view: render, pan + zoom
//   5. Side card (selected person)
//   6. Person editor
//   7. Trees dialog, people list, generations
//   8. Photos (canvas re-encode)
//   9. Contacts (read-only)
//  10. Export (SVG, PNG, print, Files) + JSON import / export
//  11. Menus, dialogs, toasts
//  12. Keyboard (Contract Β)
//  13. Sync slice + palette
//  14. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var FT = window.FTCore;
  var STORAGE_KEY = "oros-familytree-data";
  var PREFS_KEY   = "oros-familytree-prefs";
  var CONTACTS_KEY = "oros-contacts-data";
  var SVGNS = "http://www.w3.org/2000/svg";
  var VIEWS = ["hourglass", "ancestors", "descendants"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "view.hourglass": "Family", "view.ancestors": "Ancestors", "view.descendants": "Descendants",
      "btn.people": "People", "btn.fit": "Fit to screen", "btn.more": "More", "btn.zoomIn": "Zoom in",
      "btn.zoomOut": "Zoom out", "stage": "Family tree",
      "empty.noTree": "Start your family tree: add the first person, or build it from your Contacts.",
      "empty.noPeople": "This tree is empty. Add the first person.",
      "empty.add": "Add a person", "empty.contacts": "From Contacts", "empty.import": "Import JSON",
      "tree.default": "My family", "tree.none": "Family Tree",
      "trees.title": "Trees", "trees.new": "New tree", "trees.rename": "Rename {name}",
      "trees.del": "Delete {name}", "trees.count": "{n} people", "trees.name": "Tree name",
      "trees.newTitle": "New tree", "trees.renameTitle": "Rename tree",
      "menu.exportImg": "Export image (SVG, PNG, print)…", "menu.exportJson": "Back up this tree (JSON)",
      "menu.exportAll": "Back up all trees (JSON)", "menu.import": "Import JSON…",
      "menu.gedImport": "Import GEDCOM…", "menu.gedExport": "Export GEDCOM…",
      "menu.contacts": "Build from Contacts…", "menu.gens": "Generations…", "menu.add": "Add a person",
      "card.close": "Close", "card.edit": "Edit", "card.focus": "Centre here", "card.contact": "Open in Contacts",
      "card.refresh": "Fill in from the contact", "card.del": "Delete",
      "card.addParent": "Parent", "card.addPartner": "Partner", "card.addChild": "Child", "card.addSibling": "Sibling",
      "card.add": "Add a relative", "card.born": "Born", "card.died": "Died", "card.birthName": "Birth name",
      "card.parents": "Parents", "card.partners": "Partners", "card.children": "Children", "card.siblings": "Siblings",
      "card.note": "Note", "card.deceased": "Deceased", "card.copy": "Also shown elsewhere in this view",
      "sex.f": "Female", "sex.m": "Male", "sex.x": "Other", "sex.u": "Unknown",
      "q.": "exact", "q.abt": "about", "q.bef": "before", "q.aft": "after",
      "pk.birth": "birth", "pk.adopted": "adoptive", "pk.foster": "foster", "pk.step": "step",
      "uk.married": "Married", "uk.partner": "Partners", "uk.divorced": "Divorced", "uk.unknown": "Unknown",
      "ed.newTitle": "New person", "ed.editTitle": "Edit person", "ed.given": "First name(s)",
      "ed.family": "Surname", "ed.birthName": "Birth surname", "ed.sex": "Sex", "ed.birth": "Birth",
      "ed.death": "Death", "ed.date": "Date", "ed.place": "Place", "ed.dead": "Deceased",
      "ed.dateHint": "dd/mm/yyyy, mm/yyyy or yyyy", "ed.note": "Note", "ed.photo": "Photo",
      "ed.photoAdd": "Choose photo", "ed.photoDel": "Remove photo", "ed.photoContact": "Use the contact's photo",
      "ed.contact": "Contact", "ed.contactPick": "Fill from Contacts…", "ed.contactNone": "Not linked",
      "ed.contactUnlink": "Unlink", "ed.parents": "Parents", "ed.parentsAdd": "Add to a family…",
      "ed.parentsNone": "No parents linked.", "ed.partners": "Partnerships", "ed.from": "From", "ed.to": "To",
      "ed.partnersNone": "No partners.", "ed.save": "Save", "ed.cancel": "Cancel", "ed.remove": "Remove",
      "ed.kind": "Kind", "ed.badDate": "Check the date: {f}",
      "fam.of": "{a} & {b}", "fam.solo": "{a} (single parent)", "fam.unknown": "Unknown parents",
      "pick.child": "Child with…", "pick.nobody": "No other parent / not known",
      "people.title": "People", "people.search": "Search…", "people.empty": "Nobody matches.",
      "people.count": "{n} people",
      "gens.title": "Generations", "gens.up": "Ancestors (up)", "gens.down": "Descendants (down)",
      "ct.title": "Contacts", "ct.search": "Search contacts…", "ct.none": "No contacts found. Add people in the Contacts app first.",
      "ct.buildTitle": "Build from Contacts", "ct.start": "Start from whom?",
      "ct.found": "Family found through the relations in Contacts. Untick anyone to leave them out.",
      "ct.photos": "Copy their photos", "ct.add": "Add {n}", "ct.added": "{n} added from Contacts",
      "ct.alone": "This contact has no family relations in Contacts. Only they will be added.",
      "ct.gone": "The linked contact no longer exists",
      "exp.title": "Export image", "exp.scope": "What", "exp.view": "This view", "exp.all": "Whole family",
      "exp.theme": "Colours", "exp.light": "Light", "exp.dark": "Dark", "exp.dates": "Dates",
      "exp.photos": "Photos", "exp.living": "Hide details of the living", "exp.svg": "SVG",
      "exp.png": "PNG", "exp.print": "Print", "exp.files": "Save to Files",
      "imp.title": "Import", "imp.stats": "{t} trees · {p} people · {u} families",
      "imp.dropped": "{n} invalid entries left out", "imp.refs": "{n} broken links removed",
      "imp.cycles": "{n} impossible links (someone their own ancestor) removed",
      "imp.merge": "Entries you already have are merged: newer changes on this device are kept, deleted ones stay deleted.",
      "imp.go": "Import", "imp.err.size": "The file is too big (5 MB at most)",
      "imp.err.json": "This is not a valid JSON file", "imp.err.format": "This is not a Family Tree backup",
      "imp.err.toolarge": "The file has too many entries", "imp.done": "Imported", "imp.nothing": "Nothing new to import",
      "ged.title": "Export GEDCOM", "ged.sub": "A .ged file (GEDCOM 5.5.1) of this tree, for other genealogy programs.",
      "ged.download": "Download", "ged.newTree": "It comes in as a new tree: “{name}”.",
      "ged.err.size": "The file is too big (15 MB at most)", "ged.err.format": "This is not a GEDCOM file",
      "ged.err.empty": "There are no people in this GEDCOM file",
      "toast.undo": "Undo", "toast.deleted": "{name} deleted", "toast.treeDeleted": "Tree “{name}” deleted",
      "toast.save": "Could not save: storage is full", "toast.exported": "Exported", "toast.saved": "Saved to Files",
      "toast.noFiles": "Files is not available here", "toast.twoParents": "{name} already has two parents",
      "toast.cycle": "That would make someone their own ancestor", "toast.photoBudget": "Photo space is full (1 MB for all photos)",
      "toast.photoBad": "Could not read that image", "toast.needName": "Give the tree a name",
      "toast.noTree": "Create a tree first", "toast.maxTrees": "Up to {n} trees", "toast.maxPeople": "Up to {n} people",
      "toast.nobody": "Select a person first", "toast.pngBig": "Too big for PNG: export SVG instead",
      "unknown": "Unknown", "unnamed": "(no name)", "live.focus": "Centred on {name}",
      "toast.nothingNew": "Nothing to fill in: those fields are already set"
    },
    el: {
      "view.hourglass": "Οικογένεια", "view.ancestors": "Πρόγονοι", "view.descendants": "Απόγονοι",
      "btn.people": "Πρόσωπα", "btn.fit": "Προσαρμογή στην οθόνη", "btn.more": "Περισσότερα", "btn.zoomIn": "Μεγέθυνση",
      "btn.zoomOut": "Σμίκρυνση", "stage": "Οικογενειακό δέντρο",
      "empty.noTree": "Ξεκίνα το οικογενειακό σου δέντρο: πρόσθεσε το πρώτο πρόσωπο ή χτίσ' το από τις Επαφές.",
      "empty.noPeople": "Το δέντρο είναι άδειο. Πρόσθεσε το πρώτο πρόσωπο.",
      "empty.add": "Προσθήκη προσώπου", "empty.contacts": "Από τις Επαφές", "empty.import": "Εισαγωγή JSON",
      "tree.default": "Η οικογένειά μου", "tree.none": "Οικογενειακό δέντρο",
      "trees.title": "Δέντρα", "trees.new": "Νέο δέντρο", "trees.rename": "Μετονομασία: {name}",
      "trees.del": "Διαγραφή: {name}", "trees.count": "{n} πρόσωπα", "trees.name": "Όνομα δέντρου",
      "trees.newTitle": "Νέο δέντρο", "trees.renameTitle": "Μετονομασία δέντρου",
      "menu.exportImg": "Εξαγωγή εικόνας (SVG, PNG, εκτύπωση)…", "menu.exportJson": "Αντίγραφο αυτού του δέντρου (JSON)",
      "menu.exportAll": "Αντίγραφο όλων των δέντρων (JSON)", "menu.import": "Εισαγωγή JSON…",
      "menu.gedImport": "Εισαγωγή GEDCOM…", "menu.gedExport": "Εξαγωγή GEDCOM…",
      "menu.contacts": "Χτίσιμο από τις Επαφές…", "menu.gens": "Γενιές…", "menu.add": "Προσθήκη προσώπου",
      "card.close": "Κλείσιμο", "card.edit": "Επεξεργασία", "card.focus": "Κέντρο εδώ", "card.contact": "Άνοιγμα στις Επαφές",
      "card.refresh": "Συμπλήρωση από την επαφή", "card.del": "Διαγραφή",
      "card.addParent": "Γονέας", "card.addPartner": "Σύντροφος", "card.addChild": "Παιδί", "card.addSibling": "Αδέλφι",
      "card.add": "Προσθήκη συγγενή", "card.born": "Γέννηση", "card.died": "Θάνατος", "card.birthName": "Πατρικό επώνυμο",
      "card.parents": "Γονείς", "card.partners": "Σύντροφοι", "card.children": "Παιδιά", "card.siblings": "Αδέλφια",
      "card.note": "Σημείωση", "card.deceased": "Έχει πεθάνει", "card.copy": "Εμφανίζεται και αλλού σε αυτή την προβολή",
      "sex.f": "Γυναίκα", "sex.m": "Άνδρας", "sex.x": "Άλλο", "sex.u": "Άγνωστο",
      "q.": "ακριβώς", "q.abt": "περίπου", "q.bef": "πριν", "q.aft": "μετά",
      "pk.birth": "βιολογικός", "pk.adopted": "θετός", "pk.foster": "ανάδοχος", "pk.step": "πατριός / μητριά",
      "uk.married": "Παντρεμένοι", "uk.partner": "Σύντροφοι", "uk.divorced": "Διαζευγμένοι", "uk.unknown": "Άγνωστο",
      "ed.newTitle": "Νέο πρόσωπο", "ed.editTitle": "Επεξεργασία προσώπου", "ed.given": "Όνομα (ή ονόματα)",
      "ed.family": "Επώνυμο", "ed.birthName": "Πατρικό επώνυμο", "ed.sex": "Φύλο", "ed.birth": "Γέννηση",
      "ed.death": "Θάνατος", "ed.date": "Ημερομηνία", "ed.place": "Τόπος", "ed.dead": "Έχει πεθάνει",
      "ed.dateHint": "ηη/μμ/εεεε, μμ/εεεε ή εεεε", "ed.note": "Σημείωση", "ed.photo": "Φωτογραφία",
      "ed.photoAdd": "Επιλογή φωτογραφίας", "ed.photoDel": "Αφαίρεση φωτογραφίας", "ed.photoContact": "Φωτογραφία της επαφής",
      "ed.contact": "Επαφή", "ed.contactPick": "Συμπλήρωση από τις Επαφές…", "ed.contactNone": "Χωρίς σύνδεση",
      "ed.contactUnlink": "Αποσύνδεση", "ed.parents": "Γονείς", "ed.parentsAdd": "Προσθήκη σε οικογένεια…",
      "ed.parentsNone": "Δεν έχουν οριστεί γονείς.", "ed.partners": "Σχέσεις", "ed.from": "Από", "ed.to": "Έως",
      "ed.partnersNone": "Χωρίς συντρόφους.", "ed.save": "Αποθήκευση", "ed.cancel": "Άκυρο", "ed.remove": "Αφαίρεση",
      "ed.kind": "Είδος", "ed.badDate": "Έλεγξε την ημερομηνία: {f}",
      "fam.of": "{a} & {b}", "fam.solo": "{a} (μόνος γονέας)", "fam.unknown": "Άγνωστοι γονείς",
      "pick.child": "Παιδί με…", "pick.nobody": "Χωρίς άλλο γονέα / άγνωστο",
      "people.title": "Πρόσωπα", "people.search": "Αναζήτηση…", "people.empty": "Κανένα αποτέλεσμα.",
      "people.count": "{n} πρόσωπα",
      "gens.title": "Γενιές", "gens.up": "Πρόγονοι (πάνω)", "gens.down": "Απόγονοι (κάτω)",
      "ct.title": "Επαφές", "ct.search": "Αναζήτηση επαφών…", "ct.none": "Δεν βρέθηκαν επαφές. Πρόσθεσε πρώτα πρόσωπα στις Επαφές.",
      "ct.buildTitle": "Χτίσιμο από τις Επαφές", "ct.start": "Από ποιον να ξεκινήσουμε;",
      "ct.found": "Η οικογένεια που βρέθηκε από τις σχέσεις στις Επαφές. Ξετίκαρε όποιον δεν θέλεις.",
      "ct.photos": "Αντιγραφή των φωτογραφιών τους", "ct.add": "Προσθήκη {n}", "ct.added": "Προστέθηκαν {n} από τις Επαφές",
      "ct.alone": "Η επαφή δεν έχει οικογενειακές σχέσεις στις Επαφές. Θα προστεθεί μόνο αυτή.",
      "ct.gone": "Η συνδεδεμένη επαφή δεν υπάρχει πια",
      "exp.title": "Εξαγωγή εικόνας", "exp.scope": "Τι", "exp.view": "Αυτή η προβολή", "exp.all": "Όλη η οικογένεια",
      "exp.theme": "Χρώματα", "exp.light": "Ανοιχτά", "exp.dark": "Σκούρα", "exp.dates": "Ημερομηνίες",
      "exp.photos": "Φωτογραφίες", "exp.living": "Απόκρυψη στοιχείων όσων ζουν", "exp.svg": "SVG",
      "exp.png": "PNG", "exp.print": "Εκτύπωση", "exp.files": "Στα Αρχεία",
      "imp.title": "Εισαγωγή", "imp.stats": "{t} δέντρα · {p} πρόσωπα · {u} οικογένειες",
      "imp.dropped": "{n} άκυρες εγγραφές δεν μπήκαν", "imp.refs": "{n} σπασμένοι σύνδεσμοι αφαιρέθηκαν",
      "imp.cycles": "{n} αδύνατοι σύνδεσμοι (κάποιος πρόγονος του εαυτού του) αφαιρέθηκαν",
      "imp.merge": "Όσα υπάρχουν ήδη συγχωνεύονται: οι νεότερες αλλαγές αυτής της συσκευής μένουν, τα διαγραμμένα μένουν διαγραμμένα.",
      "imp.go": "Εισαγωγή", "imp.err.size": "Το αρχείο είναι πολύ μεγάλο (έως 5 MB)",
      "imp.err.json": "Δεν είναι έγκυρο αρχείο JSON", "imp.err.format": "Δεν είναι αντίγραφο του Οικογενειακού δέντρου",
      "imp.err.toolarge": "Το αρχείο έχει πάρα πολλές εγγραφές", "imp.done": "Η εισαγωγή έγινε", "imp.nothing": "Τίποτα νέο για εισαγωγή",
      "ged.title": "Εξαγωγή GEDCOM", "ged.sub": "Αρχείο .ged (GEDCOM 5.5.1) αυτού του δέντρου, για άλλα προγράμματα γενεαλογίας.",
      "ged.download": "Λήψη", "ged.newTree": "Θα μπει ως νέο δέντρο: «{name}».",
      "ged.err.size": "Το αρχείο είναι πολύ μεγάλο (έως 15 MB)", "ged.err.format": "Δεν είναι αρχείο GEDCOM",
      "ged.err.empty": "Το αρχείο GEDCOM δεν έχει πρόσωπα",
      "toast.undo": "Αναίρεση", "toast.deleted": "Διαγράφηκε: {name}", "toast.treeDeleted": "Το δέντρο «{name}» διαγράφηκε",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.exported": "Η εξαγωγή έγινε", "toast.saved": "Αποθηκεύτηκε στα Αρχεία",
      "toast.noFiles": "Τα Αρχεία δεν είναι διαθέσιμα εδώ", "toast.twoParents": "Ο/η {name} έχει ήδη δύο γονείς",
      "toast.cycle": "Έτσι κάποιος θα γινόταν πρόγονος του εαυτού του", "toast.photoBudget": "Ο χώρος φωτογραφιών γέμισε (1 MB για όλες)",
      "toast.photoBad": "Η εικόνα δεν διαβάστηκε", "toast.needName": "Δώσε ένα όνομα στο δέντρο",
      "toast.noTree": "Φτιάξε πρώτα ένα δέντρο", "toast.maxTrees": "Έως {n} δέντρα", "toast.maxPeople": "Έως {n} πρόσωπα",
      "toast.nobody": "Διάλεξε πρώτα ένα πρόσωπο", "toast.pngBig": "Πολύ μεγάλο για PNG: κάνε εξαγωγή SVG",
      "unknown": "Άγνωστος", "unnamed": "(χωρίς όνομα)", "live.focus": "Κέντρο: {name}",
      "toast.nothingNew": "Δεν υπάρχει κάτι να συμπληρωθεί: τα πεδία έχουν ήδη τιμή"
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

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function stamp(old) { return Math.max(Date.now(), (old || 0) + 1); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function nameOf(p) { return FT.displayName(p, t("unnamed")); }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("familytree.js v" + (m ? m[1] : "?") + " boot");
  })();

  var UI = {
    tree:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    fit:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    more:   '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    plus:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    minus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',
    edit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    x:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    trash:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>',
    contact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
    chev:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
  };
  function iconBtn(cls, svg, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;                         // static icon markup only
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function textBtn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  // ---------- 2. Storage, prefs ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.people)) {
          data = FT.merge(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] familytree: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = FT.emptyData();
  }

  var saveFailShown = false;
  function saveNow() {
    data = FT.merge(data, data);
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
    var focus = {};
    if (p.focus && typeof p.focus === "object") {
      Object.keys(p.focus).forEach(function (k) { if (FT.isId(k) && FT.isId(p.focus[k])) focus[k] = p.focus[k]; });
    }
    var exp = p.exp && typeof p.exp === "object" ? p.exp : {};
    var lim = function (v, d) { return (typeof v === "number" && v >= 0 && v <= 10) ? Math.floor(v) : d; };
    prefs = {
      tree: FT.isId(p.tree) ? p.tree : null,
      focus: focus,
      view: VIEWS.indexOf(p.view) !== -1 ? p.view : "hourglass",
      up: lim(p.up, 3),
      down: lim(p.down, 3),
      exp: {
        all: exp.all === true, dark: exp.dark === true, dates: exp.dates !== false,
        photos: exp.photos !== false, living: exp.living === true
      }
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- current tree + index ----------
  var ix = null;          // FT.index(data, tree) of the current tree
  var selected = null;    // person id shown in the side card

  function curTree() {
    for (var i = 0; i < data.trees.length; i++) if (data.trees[i].id === prefs.tree) return data.trees[i];
    return null;
  }
  function ensureTree() {
    if (!curTree()) {
      var first = data.trees.slice().sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()); })[0];
      prefs.tree = first ? first.id : null;
    }
    reindex();
  }
  function reindex() { ix = FT.index(data, prefs.tree); }
  function peopleOf(treeId) { return data.people.filter(function (p) { return p.tree === treeId; }); }
  function focusId() {
    var tr = curTree();
    if (!tr) return null;
    var f = prefs.focus[tr.id];
    if (f && ix.P[f]) return f;
    if (tr.home && ix.P[tr.home]) return tr.home;
    var list = peopleOf(tr.id).sort(function (a, b) { return a.m - b.m || cmpStr(a.id, b.id); });
    return list.length ? list[0].id : null;
  }
  function setFocus(pid, quiet) {
    var tr = curTree();
    if (!tr || !ix.P[pid]) return;
    prefs.focus[tr.id] = pid;
    savePrefs();
    centerOnFocus = true;
    renderTree();
    if (!quiet) live(t("live.focus", { name: nameOf(ix.P[pid]) }));
  }

  // ---------- 3. Mutations ----------
  // Every edit stamps m at the mutation site (R27) and lands through
  // put() → merge → save, so the canonical form is kept (R26).
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function put(kind, row) {
    var list = data[kind], i;
    for (i = 0; i < list.length; i++) if (list[i].id === row.id) { list[i] = row; break; }
    if (i === list.length) list.push(row);
    if (data.tombs[row.id] !== undefined && data.tombs[row.id] >= row.m) row.m = data.tombs[row.id] + 1;
  }
  function commit() {
    saveNow();
    reindex();
    renderAll();
  }

  function createTree(name) {
    if (data.trees.length >= FT.MAX_TREES) { showToast(t("toast.maxTrees", { n: FT.MAX_TREES })); return null; }
    var tr = FT.normTree({ id: newId(), m: Date.now(), name: name, home: "" });
    if (!tr) return null;
    put("trees", tr);
    prefs.tree = tr.id;
    savePrefs();
    commit();
    return tr;
  }
  function newPerson(fields) {
    var tr = curTree();
    if (!tr) return null;
    if (peopleOf(tr.id).length >= FT.MAX_PEOPLE) { showToast(t("toast.maxPeople", { n: FT.MAX_PEOPLE })); return null; }
    var p = FT.normPerson(Object.assign({ id: newId(), m: Date.now(), tree: tr.id, parents: [] }, fields || {}));
    put("people", p);
    if (!tr.home) {
      var nt = clone(tr);
      nt.home = p.id;
      nt.m = stamp(tr.m);
      put("trees", nt);
    }
    return p;
  }
  function newUnion(a, b, kind) {
    var u = FT.normUnion({ id: newId(), m: Date.now(), tree: prefs.tree, a: a || "", b: b || "", kind: kind || "married" });
    put("unions", u);
    return u;
  }
  function updatePerson(p, next) {
    var n = FT.normPerson(Object.assign(clone(p), next, { id: p.id, tree: p.tree, m: p.m }));
    if (JSON.stringify(n) === JSON.stringify(p)) return false;
    n.m = stamp(p.m);
    put("people", n);
    return true;
  }
  function updateUnion(u, next) {
    var n = FT.normUnion(Object.assign(clone(u), next, { id: u.id, tree: u.tree, m: u.m }));
    if (JSON.stringify(n) === JSON.stringify(u)) return false;
    n.m = stamp(u.m);
    put("unions", n);
    return true;
  }
  function tomb(id, m) { data.tombs[id] = Math.max(Date.now(), (m || 0)); }

  function deletePerson(pid) {
    var p = ix.P[pid];
    if (!p) return;
    var snap = clone(p);
    tomb(pid, p.m);
    if (selected === pid) selected = null;
    commit();
    undoToast(t("toast.deleted", { name: nameOf(snap) }), function () {
      snap.m = stamp(data.tombs[snap.id]);
      put("people", snap);
      commit();
    });
  }

  function deleteTree(treeId) {
    var tr = findIn(data.trees, treeId);
    if (!tr) return;
    var snap = { tree: clone(tr), people: [], unions: [] };
    data.people.forEach(function (p) { if (p.tree === treeId) { snap.people.push(clone(p)); tomb(p.id, p.m); } });
    data.unions.forEach(function (u) { if (u.tree === treeId) { snap.unions.push(clone(u)); tomb(u.id, u.m); } });
    tomb(treeId, tr.m);
    if (prefs.tree === treeId) { prefs.tree = null; selected = null; }
    saveNow();
    ensureTree();
    savePrefs();
    renderAll();
    undoToast(t("toast.treeDeleted", { name: tr.name }), function () {
      [["trees", [snap.tree]], ["people", snap.people], ["unions", snap.unions]].forEach(function (pair) {
        pair[1].forEach(function (row) { row.m = stamp(data.tombs[row.id]); put(pair[0], row); });
      });
      prefs.tree = snap.tree.id;
      savePrefs();
      commit();
    });
  }

  // Relatives. Each returns the new person (editor opens on it).
  function addParent(childId) {
    var c = ix.P[childId];
    if (!c) return;
    var u = FT.primaryUnion(ix, childId);
    if (u && u.a && u.b && ix.P[u.a] && ix.P[u.b]) { showToast(t("toast.twoParents", { name: nameOf(c) })); return; }
    openEditor(null, function (fields) {
      var p = newPerson(fields);
      if (!p) return null;
      if (u) {
        var slot = (!u.a || !ix.P[u.a]) ? "a" : "b";
        var next = {};
        next[slot] = p.id;
        if (slot === "a" && u.b === p.id) next.b = "";
        updateUnion(u, next);
      } else {
        var nu = newUnion(p.id, "", "unknown");
        updatePerson(c, { parents: [{ u: nu.id, kind: "birth" }].concat(c.parents) });
      }
      return p;
    });
  }
  function addPartner(pid) {
    if (!ix.P[pid]) return;
    openEditor(null, function (fields) {
      var p = newPerson(fields);
      if (!p) return null;
      newUnion(pid, p.id, "married");
      return p;
    });
  }
  function addChild(pid) {
    if (!ix.P[pid]) return;
    var us = (ix.unionsOf[pid] || []).filter(function (u) { var o = FT.partnerOf(u, pid); return o && ix.P[o]; });
    var go = function (u) {
      openEditor(null, function (fields) {
        var p = newPerson(fields);
        if (!p) return null;
        var fam = u || FT.soloUnion(ix, pid) || newUnion(pid, "", "unknown");
        updatePerson(p, { parents: [{ u: fam.id, kind: "birth" }] });
        return p;
      });
    };
    if (!us.length) { go(null); return; }
    if (us.length === 1) { go(us[0]); return; }
    var dlg = makeDialog("ft-pick", t("pick.child"));
    var list = el("div", "pick-list");
    us.forEach(function (u) {
      list.appendChild(textBtn("dlg-btn", nameOf(ix.P[FT.partnerOf(u, pid)]), function () { dlg.close(); go(u); }));
    });
    list.appendChild(textBtn("dlg-btn", t("pick.nobody"), function () { dlg.close(); go(null); }));
    dlg.appendChild(list);
    showDialog(dlg);
  }
  function addSibling(pid) {
    var c = ix.P[pid];
    if (!c) return;
    var u = FT.primaryUnion(ix, pid);
    openEditor(null, function (fields) {
      var p = newPerson(fields);
      if (!p) return null;
      var fam = u;
      if (!fam) {
        fam = newUnion("", "", "unknown");
        updatePerson(c, { parents: [{ u: fam.id, kind: "birth" }].concat(c.parents) });
      }
      updatePerson(p, { parents: [{ u: fam.id, kind: "birth" }] });
      return p;
    });
  }
  function addFirstPerson() {
    if (!curTree()) {
      var tr = createTree(t("tree.default"));
      if (!tr) return;
    }
    openEditor(null, function (fields) { return newPerson(fields); });
  }

  // ---------- 4. Tree view ----------
  var lay = null;
  var view = { s: 1, tx: 0, ty: 0 };
  var centerOnFocus = true;

  function layoutOpts() {
    var v = prefs.view;
    return {
      up: v === "descendants" ? 0 : prefs.up,
      down: v === "ancestors" ? 0 : prefs.down,
      siblings: v === "hourglass"
    };
  }

  function domItem(it) {
    if (!FT.TAGS[it.tag]) return null;
    var n = document.createElementNS(SVGNS, it.tag);
    if (it.cls) n.setAttribute("class", it.cls);
    Object.keys(it.a || {}).forEach(function (k) {
      if (!FT.ATTRS[k]) return;
      if (k === "href" && !FT.validPhoto(it.a[k])) return;
      n.setAttribute(k, String(it.a[k]));
    });
    if (it.text !== undefined) n.textContent = it.text;
    (it.kids || []).forEach(function (k) { var c = domItem(k); if (c) n.appendChild(c); });
    return n;
  }

  function renderTree() {
    var vp = $("vp"), svg = $("svg");
    while (vp.firstChild) vp.removeChild(vp.firstChild);
    var tr = curTree(), f = focusId();
    var hasPeople = !!(tr && f);
    $("empty").hidden = hasPeople;
    $("zoom").hidden = !hasPeople;
    svg.style.visibility = hasPeople ? "" : "hidden";
    $("empty-text").textContent = t(tr ? "empty.noPeople" : "empty.noTree");
    $("empty-contacts").hidden = false;
    if (!hasPeople) { lay = null; return; }
    lay = FT.layout(data, tr.id, f, layoutOpts());
    var sc = FT.scene(lay, data, tr.id, { lang: LANG, photos: true, unknown: t("unknown") });
    sc.items.forEach(function (it) {
      var n = domItem(it);
      if (!n) return;
      var pid = it.a && it.a["data-pid"];
      if (pid) {
        if (pid === selected) n.setAttribute("class", it.cls + " ft-sel");
        var p = ix.P[pid];
        var title = document.createElementNS(SVGNS, "title");
        title.textContent = nameOf(p) + (p && FT.lifeSpan(p, LANG) ? " · " + FT.lifeSpan(p, LANG) : "") +
          (/ ft-dup/.test(it.cls) ? " · " + t("card.copy") : "");
        n.insertBefore(title, n.firstChild);
      }
      vp.appendChild(n);
    });
    if (centerOnFocus) { centerOnFocus = false; centerOn(f); }
    applyView();
  }

  function stageRect() { return $("stage").getBoundingClientRect(); }
  // The part of the stage not covered by the side card (on phones
  // it is a bottom sheet over the tree).
  function openRect() {
    var r = stageRect(), side = $("side"), h = r.height;
    if (!side.hidden && getComputedStyle(side).position === "absolute") h = Math.max(120, h - side.offsetHeight);
    return { width: r.width, height: h };
  }
  // Keep the selected card in sight above the bottom sheet.
  function reveal(pid) {
    var n = nodeOf(pid), r = openRect();
    if (!n) return;
    var top = n.y * view.s + view.ty, bottom = top + FT.CH * view.s;
    var left = n.x * view.s + view.tx, right = left + FT.CW * view.s;
    if (bottom > r.height - 12 || top < 12 || left < 0 || right > r.width) {
      view.tx = r.width / 2 - (n.x + FT.CW / 2) * view.s;
      view.ty = r.height / 2 - (n.y + FT.CH / 2) * view.s;
      applyView();
    }
  }
  function applyView() {
    $("vp").setAttribute("transform", "translate(" + view.tx.toFixed(1) + " " + view.ty.toFixed(1) + ") scale(" + view.s.toFixed(4) + ")");
  }
  function nodeOf(pid) {
    if (!lay) return null;
    for (var i = 0; i < lay.nodes.length; i++) if (lay.nodes[i].pid === pid && !lay.nodes[i].dup) return lay.nodes[i];
    return null;
  }
  function centerOn(pid) {
    var n = nodeOf(pid), r = openRect();
    if (!n || !r.width) return;
    if (view.s < 0.5) view.s = Math.min(1, Math.max(0.5, view.s));
    view.tx = r.width / 2 - (n.x + FT.CW / 2) * view.s;
    view.ty = r.height / 2 - (n.y + FT.CH / 2) * view.s;
    applyView();
  }
  function fit() {
    var r = stageRect();
    if (!lay || !r.width) return;
    view.s = Math.max(0.12, Math.min(1.2, r.width / lay.w, r.height / lay.h));
    view.tx = (r.width - lay.w * view.s) / 2;
    view.ty = (r.height - lay.h * view.s) / 2;
    applyView();
  }
  function zoomAt(f, cx, cy) {
    var s = Math.max(0.12, Math.min(3, view.s * f));
    view.tx = cx - (cx - view.tx) * (s / view.s);
    view.ty = cy - (cy - view.ty) * (s / view.s);
    view.s = s;
    applyView();
  }
  function zoomCenter(f) { var r = stageRect(); zoomAt(f, r.width / 2, r.height / 2); }

  // Pointer: one finger / mouse pans, two fingers pinch; a tap
  // selects a card, a double tap (or double click) centres on it.
  function wirePanZoom() {
    var svg = $("svg"), pts = {}, start = null, pinch = null, lastTap = { t: 0, pid: null };
    function local(e) { var r = stageRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function count() { return Object.keys(pts).length; }
    svg.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button > 0) return;
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      pts[e.pointerId] = local(e);
      if (count() === 1) start = { p: local(e), tx: view.tx, ty: view.ty, moved: false, t: Date.now(), target: e.target };
      else if (count() === 2) {
        var k = Object.keys(pts), a = pts[k[0]], b = pts[k[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: view.s, tx: view.tx, ty: view.ty,
                  cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        if (start) start.moved = true;
      }
    });
    svg.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = local(e);
      if (pinch && count() >= 2) {
        var k = Object.keys(pts), a = pts[k[0]], b = pts[k[1]];
        var s = Math.max(0.12, Math.min(3, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        view.s = s;
        view.tx = cx - (pinch.cx - pinch.tx) * (s / pinch.s);
        view.ty = cy - (pinch.cy - pinch.ty) * (s / pinch.s);
        applyView();
      } else if (start) {
        var p = pts[e.pointerId], dx = p.x - start.p.x, dy = p.y - start.p.y;
        if (!start.moved && Math.hypot(dx, dy) > 6) { start.moved = true; svg.classList.add("panning"); }
        if (start.moved) { view.tx = start.tx + dx; view.ty = start.ty + dy; applyView(); }
      }
    });
    function end(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      if (count() < 2) pinch = null;
      if (count() === 0) {
        svg.classList.remove("panning");
        if (start && !start.moved && e.type === "pointerup") {
          var g = start.target && start.target.closest ? start.target.closest("g[data-pid]") : null;
          var pid = g ? g.getAttribute("data-pid") : null;
          var now = Date.now();
          if (pid && lastTap.pid === pid && now - lastTap.t < 350) { setFocus(pid); select(pid); lastTap = { t: 0, pid: null }; }
          else { lastTap = { t: now, pid: pid }; select(pid); }
        }
        start = null;
      }
    }
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = local(e);
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p.x, p.y);
      } else {
        view.tx -= e.deltaX; applyView();
      }
    }, { passive: false });
  }

  // ---------- 5. Side card ----------
  function select(pid) {
    selected = pid && ix.P[pid] ? pid : null;
    [].forEach.call($("vp").querySelectorAll("g[data-pid]"), function (g) {
      g.classList.toggle("ft-sel", g.getAttribute("data-pid") === selected);
    });
    renderSide();
    if (selected) reveal(selected);
  }

  function famLabel(u) {
    if (!u) return "";
    var a = ix.P[u.a], b = ix.P[u.b];
    if (a && b) return t("fam.of", { a: nameOf(a), b: nameOf(b) });
    if (a || b) return t("fam.solo", { a: nameOf(a || b) });
    return t("fam.unknown");
  }
  function relatives(pid) {
    var p = ix.P[pid], out = { parents: [], partners: [], children: [], siblings: [] }, seen = {};
    p.parents.forEach(function (r) {
      var u = ix.U[r.u];
      if (!u) return;
      [u.a, u.b].forEach(function (x) {
        if (x && ix.P[x] && !seen["p" + x]) { seen["p" + x] = 1; out.parents.push({ id: x, note: r.kind !== "birth" ? t("pk." + r.kind) : "" }); }
      });
      (ix.kids[u.id] || []).forEach(function (s) {
        if (s.id !== pid && !seen["s" + s.id]) { seen["s" + s.id] = 1; out.siblings.push({ id: s.id, note: "" }); }
      });
    });
    (ix.unionsOf[pid] || []).forEach(function (u) {
      var o = FT.partnerOf(u, pid);
      if (o && ix.P[o] && !seen["w" + o]) { seen["w" + o] = 1; out.partners.push({ id: o, note: u.kind === "married" ? "" : t("uk." + u.kind) }); }
      (ix.kids[u.id] || []).forEach(function (c) {
        if (!seen["c" + c.id]) { seen["c" + c.id] = 1; out.children.push({ id: c.id, note: "" }); }
      });
    });
    return out;
  }
  function contactsData() {
    try {
      var d = JSON.parse(localStorage.getItem(CONTACTS_KEY) || "null");
      return d && typeof d === "object" ? d : null;
    } catch (e) { return null; }
  }
  function contactById(cid) {
    if (!cid) return null;
    var ci = FT.contactsIndex(contactsData());
    return ci.C[cid] || null;
  }

  function renderSide() {
    var side = $("side");
    side.innerHTML = "";
    var p = selected && ix.P[selected];
    side.hidden = !p;
    document.body.classList.toggle("has-side", !!p);
    if (!p) return;
    var head = el("div", "side-head");
    if (p.photo) {
      var im = el("img", "side-photo");
      im.alt = "";
      im.src = p.photo;                         // validated data URI (FT.validPhoto)
      head.appendChild(im);
    } else {
      var av = el("div", "side-avatar sex-" + p.sex);
      av.textContent = (p.given || p.family || "?").slice(0, 1).toUpperCase();
      head.appendChild(av);
    }
    var hn = el("div", "side-names");
    hn.appendChild(el("h2", "side-name", nameOf(p)));
    var span = FT.lifeSpan(p, LANG);
    if (span) hn.appendChild(el("div", "side-span", span));
    head.appendChild(hn);
    head.appendChild(iconBtn("icon-btn side-x", UI.x, t("card.close"), function () { select(null); }));
    side.appendChild(head);

    var acts = el("div", "side-acts");
    acts.appendChild(textBtn("txt-btn", t("card.edit"), function () { openEditor(p.id); }));
    if (focusId() !== p.id) acts.appendChild(textBtn("txt-btn", t("card.focus"), function () { setFocus(p.id); }));
    if (p.contact) {
      var c = contactById(p.contact);
      if (c) {
        acts.appendChild(textBtn("txt-btn", t("card.contact"), function () { openContact(p.contact); }));
        acts.appendChild(textBtn("txt-btn", t("card.refresh"), function () { refreshFromContact(p.id); }));
      }
    }
    side.appendChild(acts);

    var add = el("div", "side-add");
    add.appendChild(el("span", "side-lbl", t("card.add")));
    var row = el("div", "chips");
    [["card.addParent", addParent], ["card.addPartner", addPartner], ["card.addChild", addChild], ["card.addSibling", addSibling]]
      .forEach(function (pair) {
        var b = textBtn("chip", "+ " + t(pair[0]), function () { pair[1](p.id); });
        row.appendChild(b);
      });
    add.appendChild(row);
    side.appendChild(add);

    var facts = el("dl", "side-facts");
    function fact(k, v) { if (!v) return; facts.appendChild(el("dt", "", t(k))); facts.appendChild(el("dd", "", v)); }
    fact("card.born", [FT.fmtDate(p.birth, LANG), p.birth.place].filter(Boolean).join(" · "));
    if (p.dead) fact("card.died", [FT.fmtDate(p.death, LANG), p.death.place].filter(Boolean).join(" · ") || t("card.deceased"));
    fact("card.birthName", p.birthName);
    if (p.sex !== "u") fact("ed.sex", t("sex." + p.sex));
    if (facts.childNodes.length) side.appendChild(facts);

    var rel = relatives(p.id);
    [["parents", "card.parents"], ["partners", "card.partners"], ["children", "card.children"], ["siblings", "card.siblings"]]
      .forEach(function (pair) {
        var list = rel[pair[0]];
        if (!list.length) return;
        var sec = el("div", "side-sec");
        sec.appendChild(el("h3", "side-lbl", t(pair[1])));
        var ul = el("ul", "rel-list");
        list.forEach(function (r) {
          var li = el("li");
          var b = textBtn("rel-btn", nameOf(ix.P[r.id]), function () { select(r.id); if (!nodeOf(r.id)) setFocus(r.id); else centerOn(r.id); });
          var s2 = FT.lifeSpan(ix.P[r.id], LANG);
          if (s2 || r.note) b.appendChild(el("span", "rel-sub", [r.note, s2].filter(Boolean).join(" · ")));
          li.appendChild(b);
          ul.appendChild(li);
        });
        sec.appendChild(ul);
        side.appendChild(sec);
      });
    if (p.note) {
      var ns = el("div", "side-sec");
      ns.appendChild(el("h3", "side-lbl", t("card.note")));
      ns.appendChild(el("p", "side-note", p.note));
      side.appendChild(ns);
    }
    var del = textBtn("txt-btn danger side-del", t("card.del"), function () { deletePerson(p.id); });
    side.appendChild(del);
  }

  // ---------- 6. Person editor ----------
  // openEditor(pid) edits; openEditor(null, create) asks for a new
  // person and hands the fields to `create` (which links it).
  function openEditor(pid, create) {
    var p = pid ? ix.P[pid] : null;
    if (pid && !p) return;
    var dlg = makeDialog("ft-edit", t(p ? "ed.editTitle" : "ed.newTitle"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    var work = { photo: p ? p.photo : "", contact: p ? p.contact : "",
                 parents: p ? clone(p.parents) : [], unions: {} };

    function field(label, input, hint) {
      var w = el("label", "fld");
      w.appendChild(el("span", "fld-lbl", label));
      w.appendChild(input);
      if (hint) w.appendChild(el("span", "fld-hint", hint));
      return w;
    }
    function inp(val, max, ph) {
      var i = el("input");
      i.value = val || "";
      i.maxLength = max;
      i.autocomplete = "off";
      if (ph) i.placeholder = ph;
      return i;
    }
    function sel(opts, val) {
      var s = el("select");
      opts.forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; s.appendChild(op); });
      s.value = val;
      return s;
    }
    function dateRow(ev, withPlace) {
      var wrap = el("div", "date-row");
      var q = sel(FT.QUALS.map(function (k) { return [k, t("q." + k)]; }), ev ? ev.q : "");
      var d = inp(ev && ev.d ? FT.fmtD(ev.d) : "", 20, t("ed.dateHint"));
      d.inputMode = "numeric";
      wrap.appendChild(field(t("ed.date"), d));
      wrap.appendChild(field(" ", q));
      var pl = null;
      if (withPlace) { pl = inp(ev ? ev.place : "", FT.PLACE_LEN); wrap.appendChild(field(t("ed.place"), pl)); }
      return { node: wrap, d: d, q: q, pl: pl };
    }

    var given = inp(p ? p.given : "", FT.NAME_LEN), family = inp(p ? p.family : "", FT.NAME_LEN);
    var birthName = inp(p ? p.birthName : "", FT.NAME_LEN);
    var sex = sel(FT.SEXES.map(function (k) { return [k, t("sex." + k)]; }), p ? p.sex : "u");
    var grid = el("div", "fld-grid");
    grid.appendChild(field(t("ed.given"), given));
    grid.appendChild(field(t("ed.family"), family));
    grid.appendChild(field(t("ed.birthName"), birthName));
    grid.appendChild(field(t("ed.sex"), sex));
    form.appendChild(grid);

    form.appendChild(el("h3", "ed-sec", t("ed.birth")));
    var birth = dateRow(p ? p.birth : null, true);
    form.appendChild(birth.node);
    var deadWrap = el("label", "chk");
    var dead = el("input");
    dead.type = "checkbox";
    dead.checked = !!(p && p.dead);
    deadWrap.appendChild(dead);
    deadWrap.appendChild(el("span", "", t("ed.dead")));
    form.appendChild(deadWrap);
    var deathBox = el("div", "death-box");
    deathBox.appendChild(el("h3", "ed-sec", t("ed.death")));
    var death = dateRow(p ? p.death : null, true);
    deathBox.appendChild(death.node);
    form.appendChild(deathBox);
    var syncDead = function () { deathBox.hidden = !dead.checked; };
    dead.addEventListener("change", syncDead);
    syncDead();

    // Photo
    form.appendChild(el("h3", "ed-sec", t("ed.photo")));
    var photoRow = el("div", "photo-row");
    var preview = el("img", "photo-prev");
    preview.alt = "";
    var photoBtns = el("div", "chips");
    function drawPhoto() {
      preview.hidden = !work.photo;
      if (work.photo) preview.src = work.photo; else preview.removeAttribute("src");
      delBtn.hidden = !work.photo;
      var c = contactById(work.contact);
      ctPhotoBtn.hidden = !(c && typeof c.photo === "string" && /^data:image\/(jpeg|png);base64,/.test(c.photo));
    }
    var addBtn = textBtn("chip", t("ed.photoAdd"), function () {
      pickPhoto().then(function (uri) {
        if (!uri) return;
        if (!photoFits(uri, p)) { showToast(t("toast.photoBudget")); return; }
        work.photo = uri;
        drawPhoto();
      });
    });
    var ctPhotoBtn = textBtn("chip", t("ed.photoContact"), function () {
      var c = contactById(work.contact);
      if (!c) return;
      reencode(c.photo).then(function (uri) {
        if (!uri) { showToast(t("toast.photoBad")); return; }
        if (!photoFits(uri, p)) { showToast(t("toast.photoBudget")); return; }
        work.photo = uri;
        drawPhoto();
      });
    });
    var delBtn = textBtn("chip", t("ed.photoDel"), function () { work.photo = ""; drawPhoto(); });
    photoBtns.appendChild(addBtn);
    photoBtns.appendChild(ctPhotoBtn);
    photoBtns.appendChild(delBtn);
    photoRow.appendChild(preview);
    photoRow.appendChild(photoBtns);
    form.appendChild(photoRow);

    // Contact link
    form.appendChild(el("h3", "ed-sec", t("ed.contact")));
    var ctRow = el("div", "ct-row");
    var ctName = el("span", "ct-name");
    var unlink = textBtn("chip", t("ed.contactUnlink"), function () { work.contact = ""; drawContact(); drawPhoto(); });
    var pickCt = textBtn("chip", t("ed.contactPick"), function () {
      pickContact(function (c) {
        work.contact = c.id;
        var nm = [FT.line(c.given, FT.NAME_LEN), FT.line(c.middle, FT.NAME_LEN)].filter(Boolean).join(" ");
        if (!given.value.trim()) given.value = nm || FT.contactName(c);
        if (!family.value.trim()) family.value = FT.line(c.family, FT.NAME_LEN);
        if (!birth.d.value.trim()) {
          var pl = FT.planFromContacts({ contacts: [c], deleted: [] }, c.id);
          if (pl[0] && pl[0].birth) birth.d.value = FT.fmtD(pl[0].birth);
        }
        drawContact();
        drawPhoto();
      });
    });
    function drawContact() {
      var c = contactById(work.contact);
      ctName.textContent = c ? FT.contactName(c) || t("unnamed") : (work.contact ? t("ct.gone") : t("ed.contactNone"));
      unlink.hidden = !work.contact;
    }
    ctRow.appendChild(ctName);
    ctRow.appendChild(pickCt);
    ctRow.appendChild(unlink);
    form.appendChild(ctRow);

    // Parents + partnerships (existing people only)
    var parentsBox = null, unionsBox = null;
    if (p) {
      form.appendChild(el("h3", "ed-sec", t("ed.parents")));
      parentsBox = el("div", "link-list");
      form.appendChild(parentsBox);
      var addFam = el("select", "add-fam");
      addFam.setAttribute("aria-label", t("ed.parentsAdd"));
      form.appendChild(addFam);
      var drawParents = function () {
        parentsBox.innerHTML = "";
        if (!work.parents.length) parentsBox.appendChild(el("p", "hint", t("ed.parentsNone")));
        work.parents.forEach(function (r, i) {
          var rowE = el("div", "link-row");
          rowE.appendChild(el("span", "link-name", famLabel(ix.U[r.u])));
          var k = sel(FT.PARENT_KINDS.map(function (x) { return [x, t("pk." + x)]; }), r.kind);
          k.setAttribute("aria-label", t("ed.kind"));
          k.addEventListener("change", function () { r.kind = k.value; });
          rowE.appendChild(k);
          rowE.appendChild(iconBtn("icon-btn", UI.x, t("ed.remove"), function () { work.parents.splice(i, 1); drawParents(); }));
          parentsBox.appendChild(rowE);
        });
        addFam.innerHTML = "";
        var head = el("option", "", t("ed.parentsAdd"));
        head.value = "";
        addFam.appendChild(head);
        Object.keys(ix.U).map(function (id) { return ix.U[id]; })
          .filter(function (u) {
            return !work.parents.some(function (r) { return r.u === u.id; }) && !FT.wouldCycle(ix, p.id, u.id);
          })
          .sort(function (a, b) { return cmpStr(famLabel(a), famLabel(b)); })
          .forEach(function (u) { var o = el("option", "", famLabel(u)); o.value = u.id; addFam.appendChild(o); });
        addFam.hidden = work.parents.length >= FT.MAX_PARENTS || addFam.options.length < 2;
      };
      addFam.addEventListener("change", function () {
        if (!addFam.value) return;
        work.parents.push({ u: addFam.value, kind: "birth" });
        drawParents();
      });
      drawParents();

      form.appendChild(el("h3", "ed-sec", t("ed.partners")));
      unionsBox = el("div", "link-list");
      form.appendChild(unionsBox);
      var mine = (ix.unionsOf[p.id] || []).filter(function (u) { var o = FT.partnerOf(u, p.id); return o && ix.P[o]; });
      if (!mine.length) unionsBox.appendChild(el("p", "hint", t("ed.partnersNone")));
      mine.forEach(function (u) {
        var w = { kind: u.kind, start: dateRow(u.start, false), end: dateRow(u.end, false), drop: false };
        work.unions[u.id] = w;
        var box = el("div", "union-box");
        var top = el("div", "link-row");
        top.appendChild(el("span", "link-name", nameOf(ix.P[FT.partnerOf(u, p.id)])));
        var k = sel(FT.UNION_KINDS.map(function (x) { return [x, t("uk." + x)]; }), u.kind);
        k.setAttribute("aria-label", t("ed.kind"));
        k.addEventListener("change", function () { w.kind = k.value; });
        top.appendChild(k);
        var rm = iconBtn("icon-btn", UI.x, t("ed.remove"), function () {
          w.drop = !w.drop;
          box.classList.toggle("dropped", w.drop);
        });
        top.appendChild(rm);
        box.appendChild(top);
        var dates = el("div", "union-dates");
        var f1 = el("div", "ud"); f1.appendChild(el("span", "fld-lbl", t("ed.from"))); f1.appendChild(w.start.node);
        var f2 = el("div", "ud"); f2.appendChild(el("span", "fld-lbl", t("ed.to"))); f2.appendChild(w.end.node);
        dates.appendChild(f1); dates.appendChild(f2);
        box.appendChild(dates);
        unionsBox.appendChild(box);
      });
    }

    form.appendChild(el("h3", "ed-sec", t("ed.note")));
    var note = el("textarea", "note");
    note.maxLength = FT.NOTE_LEN;
    note.rows = 3;
    note.value = p ? p.note : "";
    note.setAttribute("aria-label", t("ed.note"));
    form.appendChild(note);

    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("ed.cancel"), function () { dlg.close(); }));
    var ok = textBtn("dlg-btn primary", t("ed.save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    function readDate(row, label) {
      var d = FT.parseDateInput(row.d.value);
      if (d === null) { showToast(t("ed.badDate", { f: label })); row.d.focus(); return null; }
      return { d: d, q: d ? row.q.value : "", place: row.pl ? row.pl.value : "" };
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var b = readDate(birth, t("ed.birth"));
      if (!b) return;
      var dd = dead.checked ? readDate(death, t("ed.death")) : { d: "", q: "", place: "" };
      if (!dd) return;
      var uw = {}, bad = false;
      Object.keys(work.unions).forEach(function (id) {
        if (bad) return;
        var w = work.unions[id];
        var s = readDate(w.start, t("ed.from")), en = s && readDate(w.end, t("ed.to"));
        if (!s || !en) { bad = true; return; }
        uw[id] = { kind: w.kind, start: { d: s.d, q: s.q }, end: { d: en.d, q: en.q }, drop: w.drop };
      });
      if (bad) return;
      var fields = {
        given: given.value, family: family.value, birthName: birthName.value, sex: sex.value,
        birth: b, death: dd, dead: dead.checked, note: note.value, photo: work.photo, contact: work.contact
      };
      if (p) {
        // a family may have become a loop since the dialog opened (sync)
        fields.parents = work.parents.filter(function (r) { return ix.U[r.u] && !FT.wouldCycle(ix, p.id, r.u); });
        if (fields.parents.length < work.parents.length) showToast(t("toast.cycle"));
        var any = updatePerson(p, fields);
        Object.keys(uw).forEach(function (id) {
          var u = ix.U[id];
          if (!u) return;
          if (uw[id].drop) { tomb(id, u.m); any = true; return; }
          if (updateUnion(u, { kind: uw[id].kind, start: uw[id].start, end: uw[id].end })) any = true;
        });
        dlg.close();
        if (any) commit();                    // a zero-edit close stamps nothing
      } else {
        var np = create(fields);
        dlg.close();
        if (!np) return;
        commit();
        select(np.id);
        if (!nodeOf(np.id)) setFocus(np.id, true);
      }
    });
    dlg.appendChild(form);
    drawPhoto();
    drawContact();
    showDialog(dlg);
    given.focus();
  }

  // ---------- 7. Trees dialog, people list, generations ----------
  function openTrees() {
    var dlg = makeDialog("ft-trees", t("trees.title"));
    var list = el("div", "tree-list");
    data.trees.slice().sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.id, b.id); })
      .forEach(function (tr) {
        var row = el("div", "tree-row");
        var b = textBtn("tree-pick" + (tr.id === prefs.tree ? " on" : ""), tr.name, function () {
          prefs.tree = tr.id;
          selected = null;
          centerOnFocus = true;
          savePrefs();
          reindex();
          dlg.close();
          renderAll();
        });
        b.setAttribute("aria-pressed", tr.id === prefs.tree ? "true" : "false");
        b.appendChild(el("span", "tree-count", t("trees.count", { n: peopleOf(tr.id).length })));
        row.appendChild(b);
        row.appendChild(iconBtn("icon-btn", UI.edit, t("trees.rename", { name: tr.name }), function () {
          dlg.close();
          nameDialog(tr);
        }));
        row.appendChild(iconBtn("icon-btn danger", UI.trash, t("trees.del", { name: tr.name }), function () {
          dlg.close();
          deleteTree(tr.id);
        }));
        list.appendChild(row);
      });
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn primary", t("trees.new"), function () { dlg.close(); nameDialog(null); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function nameDialog(tr) {
    var dlg = makeDialog("ft-name", t(tr ? "trees.renameTitle" : "trees.newTitle"));
    var form = el("form");
    form.method = "dialog";
    var i = el("input");
    i.maxLength = FT.TREE_LEN;
    i.autocomplete = "off";
    i.value = tr ? tr.name : "";
    i.setAttribute("aria-label", t("trees.name"));
    i.placeholder = t("trees.name");
    form.appendChild(i);
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("ed.cancel"), function () { dlg.close(); }));
    var ok = textBtn("dlg-btn primary", t("ed.save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = FT.line(i.value, FT.TREE_LEN);
      if (!name) { showToast(t("toast.needName")); i.focus(); return; }
      dlg.close();
      if (tr) {
        var cur = findIn(data.trees, tr.id);
        if (cur && cur.name !== name) {
          var n = clone(cur);
          n.name = name;
          n.m = stamp(cur.m);
          put("trees", n);
          commit();
        }
      } else {
        selected = null;
        centerOnFocus = true;
        createTree(name);
      }
    });
    dlg.appendChild(form);
    showDialog(dlg);
    i.focus();
    i.select();
  }

  function openPeople() {
    if (!curTree()) { showToast(t("toast.noTree")); return; }
    var dlg = makeDialog("ft-people", t("people.title"));
    var q = el("input");
    q.type = "search";
    q.placeholder = t("people.search");
    q.setAttribute("aria-label", t("people.search"));
    q.autocomplete = "off";
    var count = el("div", "dlg-sub");
    var ul = el("ul", "people-list");
    var all = Object.keys(ix.P).map(function (id) { return ix.P[id]; })
      .sort(function (a, b) {
        return cmpStr((a.family + " " + a.given).toLowerCase(), (b.family + " " + b.given).toLowerCase()) || cmpStr(a.id, b.id);
      });
    function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    function draw() {
      ul.innerHTML = "";
      var needle = fold(q.value.trim());
      var shown = all.filter(function (p) {
        return !needle || fold([p.given, p.family, p.birthName, p.birth.place].join(" ")).indexOf(needle) !== -1;
      });
      count.textContent = t("people.count", { n: shown.length });
      if (!shown.length) ul.appendChild(el("li", "hint", t("people.empty")));
      shown.slice(0, 500).forEach(function (p) {
        var li = el("li");
        var b = textBtn("rel-btn", nameOf(p), function () { dlg.close(); setFocus(p.id); select(p.id); });
        var s = FT.lifeSpan(p, LANG);
        if (s) b.appendChild(el("span", "rel-sub", s));
        li.appendChild(b);
        ul.appendChild(li);
      });
    }
    q.addEventListener("input", draw);
    dlg.appendChild(q);
    dlg.appendChild(count);
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("card.close"), function () { dlg.close(); }));
    acts.appendChild(textBtn("dlg-btn primary", t("menu.add"), function () {
      dlg.close();
      openEditor(null, function (fields) { return newPerson(fields); });
    }));
    dlg.appendChild(acts);
    draw();
    showDialog(dlg);
    q.focus();
  }

  function openGens() {
    var dlg = makeDialog("ft-gens", t("gens.title"));
    function stepper(label, key) {
      var w = el("label", "fld");
      w.appendChild(el("span", "fld-lbl", label));
      var s = el("select");
      for (var i = 0; i <= 10; i++) { var o = el("option", "", String(i)); o.value = String(i); s.appendChild(o); }
      s.value = String(prefs[key]);
      s.addEventListener("change", function () { prefs[key] = +s.value; savePrefs(); renderTree(); });
      w.appendChild(s);
      return w;
    }
    dlg.appendChild(stepper(t("gens.up"), "up"));
    dlg.appendChild(stepper(t("gens.down"), "down"));
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn primary", t("card.close"), function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 8. Photos ----------
  // Every stored photo is pixels WE drew: the source (a file, a
  // contact photo, an imported data URI) is decoded into a canvas
  // and re-encoded as a small JPEG. ≤ PHOTO_MAX chars, or null.
  function reencode(src) {
    return new Promise(function (resolve) {
      var url = null, im = new Image();
      if (src instanceof Blob) { url = URL.createObjectURL(src); im.src = url; }
      else if (typeof src === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/]+={0,2}$/.test(src)) im.src = src;
      else { resolve(null); return; }
      im.onload = function () {
        try {
          var S = 96, cv = document.createElement("canvas");
          cv.width = cv.height = S;
          var g = cv.getContext("2d");
          var w = im.naturalWidth, h = im.naturalHeight, m = Math.min(w, h);
          if (!m) { resolve(null); return; }
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, S, S);
          g.drawImage(im, (w - m) / 2, (h - m) / 2, m, m, 0, 0, S, S);
          var out = null;
          [0.85, 0.7, 0.55, 0.4].some(function (q) { out = cv.toDataURL("image/jpeg", q); return out.length <= FT.PHOTO_MAX; });
          resolve(FT.validPhoto(out) ? out : null);
        } catch (e) { resolve(null); }
        if (url) URL.revokeObjectURL(url);
      };
      im.onerror = function () { if (url) URL.revokeObjectURL(url); resolve(null); };
    });
  }
  function pickPhoto() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile("image/*") : localPickFile("image/*");
    return pick.then(function (file) {
      if (!file) return null;                  // cancel — silent exit
      if (file.size > 15 * 1024 * 1024) { showToast(t("toast.photoBad")); return null; }
      return reencode(file).then(function (uri) { if (!uri) showToast(t("toast.photoBad")); return uri; });
    });
  }
  function photoFits(uri, p) {
    var used = FT.photoBytes(data) - (p && p.photo ? p.photo.length : 0);
    return used + uri.length <= FT.PHOTO_BUDGET;
  }

  // ---------- 9. Contacts (read-only) ----------
  function openContact(cid) {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosOpenContact === "function") {
        window.parent.__orosOpenContact(cid);
        return;
      }
    } catch (e) {}
    try { window.open("../contacts/", "_self"); } catch (e) {}
  }
  function refreshFromContact(pid) {
    var p = ix.P[pid], c = p && contactById(p.contact);
    if (!c) { showToast(t("ct.gone")); return; }
    var next = {};
    var nm = [FT.line(c.given, FT.NAME_LEN), FT.line(c.middle, FT.NAME_LEN)].filter(Boolean).join(" ");
    if (!p.given && nm) next.given = nm;
    if (!p.family && c.family) next.family = c.family;
    var pl = FT.planFromContacts({ contacts: [c], deleted: [] }, c.id);
    if (!p.birth.d && pl[0] && pl[0].birth) next.birth = { d: pl[0].birth, q: "", place: p.birth.place };
    if (updatePerson(p, next)) commit();
    else showToast(t("toast.nothingNew"));       // R28: never a silent no-op
  }

  function pickContact(onPick, title) {
    var ci = FT.contactsIndex(contactsData());
    var all = Object.keys(ci.C).map(function (id) { return ci.C[id]; })
      .map(function (c) { return { c: c, name: FT.contactName(c) || t("unnamed") }; })
      .sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.c.id, b.c.id); });
    var dlg = makeDialog("ft-contacts", title || t("ct.title"));
    if (!all.length) {
      dlg.appendChild(el("p", "hint", t("ct.none")));
    } else {
      var q = el("input");
      q.type = "search";
      q.placeholder = t("ct.search");
      q.setAttribute("aria-label", t("ct.search"));
      var ul = el("ul", "people-list");
      var draw = function () {
        ul.innerHTML = "";
        var n = q.value.trim().toLowerCase();
        all.filter(function (x) { return !n || x.name.toLowerCase().indexOf(n) !== -1; }).slice(0, 300).forEach(function (x) {
          var li = el("li");
          li.appendChild(textBtn("rel-btn", x.name, function () { dlg.close(); onPick(x.c); }));
          ul.appendChild(li);
        });
      };
      q.addEventListener("input", draw);
      dlg.appendChild(q);
      dlg.appendChild(ul);
      draw();
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("ed.cancel"), function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function buildFromContacts() { pickContact(planBuild, t("ct.start")); }
  function planBuild(start) {
    var ct = contactsData();
    var plan = FT.planFromContacts(ct, start.id, 200);
    var dlg = makeDialog("ft-build", t("ct.buildTitle"));
    dlg.appendChild(el("p", "dlg-sub", t(plan.length > 1 ? "ct.found" : "ct.alone")));
    var ul = el("ul", "check-list");
    var boxes = [];
    plan.forEach(function (x) {
      var li = el("li");
      var lab = el("label", "chk");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.value = x.cid;
      if (x.cid === start.id) cb.disabled = true;
      boxes.push(cb);
      lab.appendChild(cb);
      lab.appendChild(el("span", "", (x.name || t("unnamed")) + (x.birth ? " · " + FT.fmtD(x.birth) : "")));
      li.appendChild(lab);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    var phWrap = el("label", "chk");
    var ph = el("input");
    ph.type = "checkbox";
    ph.checked = true;
    phWrap.appendChild(ph);
    phWrap.appendChild(el("span", "", t("ct.photos")));
    dlg.appendChild(phWrap);
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("ed.cancel"), function () { dlg.close(); }));
    var go = textBtn("dlg-btn primary", "");
    var label = function () { go.textContent = t("ct.add", { n: boxes.filter(function (b) { return b.checked; }).length }); };
    boxes.forEach(function (b) { b.addEventListener("change", label); });
    label();
    go.addEventListener("click", function () {
      dlg.close();
      var ids = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
      runBuild(ct, ids, start.id, ph.checked);
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  function runBuild(ct, ids, startCid, photos) {
    if (!curTree()) { if (!createTree(t("tree.default"))) return; }
    var tr = curTree();
    if (peopleOf(tr.id).length + ids.length > FT.MAX_PEOPLE) { showToast(t("toast.maxPeople", { n: FT.MAX_PEOPLE })); return; }
    var r = FT.buildFromContacts(ct, ids, data, tr.id, Date.now(), newId);
    var before = {};
    r.people.concat(r.unions).forEach(function (x) {
      var old = findIn(data.people, x.id) || findIn(data.unions, x.id);
      before[x.id] = old ? clone(old) : null;
    });
    var added = r.people.filter(function (p) { return !before[p.id]; }).length;
    var chain = Promise.resolve(), used = FT.photoBytes(data);
    if (photos) {
      Object.keys(r.photos).sort(cmpStr).forEach(function (pid) {
        chain = chain.then(function () {
          return reencode(r.photos[pid]).then(function (uri) {
            var row = findIn(r.people, pid);
            if (!uri || !row || used + uri.length > FT.PHOTO_BUDGET) return;
            row.photo = uri;
            used += uri.length;
          });
        });
      });
    }
    chain.then(function () {
      r.people.forEach(function (p) { put("people", p); });
      r.unions.forEach(function (u) { put("unions", u); });
      if (!tr.home && r.map[startCid]) {
        var nt = clone(findIn(data.trees, tr.id));
        nt.home = r.map[startCid];
        nt.m = stamp(nt.m);
        put("trees", nt);
      }
      commit();
      if (r.map[startCid]) { setFocus(r.map[startCid], true); select(r.map[startCid]); }
      undoToast(t("ct.added", { n: added }), function () { undoRows(before); });
    });
  }
  // Undo of a batch: new rows get a tombstone, changed rows go back
  // to their old content with a fresh stamp (only what the batch
  // touched, so other devices' edits survive).
  function undoRows(before) {
    Object.keys(before).forEach(function (id) {
      var old = before[id];
      var cur = findIn(data.people, id) || findIn(data.unions, id) || findIn(data.trees, id);
      if (!old) { if (cur) tomb(id, cur.m); return; }
      var kind = old.parents ? "people" : (old.kind !== undefined ? "unions" : "trees");
      old.m = stamp(Math.max(cur ? cur.m : 0, data.tombs[id] || 0));
      put(kind, old);
    });
    commit();
  }

  // ---------- 10. Export + import ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
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
  function downloadBlob(blob, fileName, mime, types) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: fileName, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;                         // cancel (ok=false) = silent exit
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.exported"));
  }
  function fileBase(name) {
    var s = String(name || "family-tree").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
    return (s || "family-tree").slice(0, 60);
  }
  function stampDate() {
    var d = new Date(), p = function (v) { return (v < 10 ? "0" : "") + v; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function buildSvg(o) {
    var tr = curTree(), f = focusId();
    if (!tr || !f) return null;
    var l = o.all ? FT.layout(data, tr.id, f, { up: 10, down: 10, siblings: true }) : FT.layout(data, tr.id, f, layoutOpts());
    var sc = FT.scene(l, data, tr.id, { lang: LANG, photos: o.photos, dates: o.dates, hideLiving: o.living, unknown: t("unknown") });
    return { svg: FT.toSvg(sc, { theme: o.dark ? "dark" : "light", title: tr.name }), w: l.w, h: l.h, name: tr.name };
  }

  function openExport() {
    if (!curTree() || !focusId()) { showToast(t("toast.nobody")); return; }
    var o = prefs.exp;
    var dlg = makeDialog("ft-export", t("exp.title"));
    function radio(name, label, opts, val, set) {
      var fs = el("fieldset", "seg-field");
      fs.appendChild(el("legend", "fld-lbl", label));
      var seg = el("div", "seg");
      opts.forEach(function (op) {
        var b = textBtn("", op[1], function () {
          set(op[0]);
          [].forEach.call(seg.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          savePrefs();
        });
        b.setAttribute("aria-pressed", op[0] === val ? "true" : "false");
        seg.appendChild(b);
      });
      fs.appendChild(seg);
      return fs;
    }
    function check(label, key) {
      var w = el("label", "chk");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!o[key];
      cb.addEventListener("change", function () { o[key] = cb.checked; savePrefs(); });
      w.appendChild(cb);
      w.appendChild(el("span", "", label));
      return w;
    }
    dlg.appendChild(radio("scope", t("exp.scope"), [[false, t("exp.view")], [true, t("exp.all")]], o.all, function (v) { o.all = v; }));
    dlg.appendChild(radio("theme", t("exp.theme"), [[false, t("exp.light")], [true, t("exp.dark")]], o.dark, function (v) { o.dark = v; }));
    dlg.appendChild(check(t("exp.dates"), "dates"));
    dlg.appendChild(check(t("exp.photos"), "photos"));
    dlg.appendChild(check(t("exp.living"), "living"));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(textBtn("dlg-btn primary", t("exp.svg"), function () {
      var r = buildSvg(o);
      if (!r) return;
      dlg.close();
      downloadBlob(new Blob([r.svg], { type: "image/svg+xml" }), fileBase(r.name) + ".svg", "image/svg+xml",
                   [{ description: "SVG", accept: { "image/svg+xml": [".svg"] } }]);
    }));
    acts.appendChild(textBtn("dlg-btn", t("exp.png"), function () {
      var r = buildSvg(o);
      if (!r) return;
      dlg.close();
      toPng(r).then(function (blob) {
        if (!blob) return;
        downloadBlob(blob, fileBase(r.name) + ".png", "image/png", [{ description: "PNG", accept: { "image/png": [".png"] } }]);
      });
    }));
    acts.appendChild(textBtn("dlg-btn", t("exp.print"), function () {
      var r = buildSvg(Object.assign({}, o, { dark: false }));
      if (!r) return;
      dlg.close();
      printSvg(r);
    }));
    acts.appendChild(textBtn("dlg-btn", t("exp.files"), function () {
      var r = buildSvg(o);
      if (!r) return;
      dlg.close();
      saveToFiles(new Blob([r.svg], { type: "image/svg+xml" }), fileBase(r.name) + ".svg");
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function svgImage(svg) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      var im = new Image();
      im.onload = function () { resolve({ im: im, url: url }); };
      im.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }
  function toPng(r) {
    var scale = Math.min(2, 8192 / r.w, 8192 / r.h, Math.sqrt(40000000 / (r.w * r.h)));
    if (scale < 0.5) { showToast(t("toast.pngBig")); return Promise.resolve(null); }
    return svgImage(r.svg).then(function (x) {
      if (!x) { showToast(t("toast.pngBig")); return null; }
      return new Promise(function (resolve) {
        try {
          var cv = document.createElement("canvas");
          cv.width = Math.round(r.w * scale);
          cv.height = Math.round(r.h * scale);
          cv.getContext("2d").drawImage(x.im, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(x.url);
          cv.toBlob(function (b) { if (!b) showToast(t("toast.pngBig")); resolve(b); }, "image/png");
        } catch (e) { URL.revokeObjectURL(x.url); showToast(t("toast.pngBig")); resolve(null); }
      });
    });
  }
  function printSvg(r) {
    var host = $("print-host");
    host.innerHTML = "";
    var url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml;charset=utf-8" }));
    var im = el("img");
    im.alt = "";
    im.onload = function () {
      setTimeout(function () {
        try { window.print(); } catch (e) {}
        setTimeout(function () { host.innerHTML = ""; URL.revokeObjectURL(url); }, 1000);
      }, 50);
    };
    im.src = url;
    host.appendChild(im);
  }
  function saveToFiles(blob, name) {
    var fs = null;
    try { fs = window.parent && window.parent !== window ? window.parent.orosFS : null; } catch (e) {}
    if (!fs || typeof fs.writeBlob !== "function") { showToast(t("toast.noFiles")); return; }
    var dir = "/internal/Family Tree";
    Promise.resolve(typeof fs.mkdir === "function" ? fs.mkdir(dir).catch(function () {}) : null)
      .then(function () { return fs.writeBlob(dir + "/" + name, blob); })
      .then(function () { showToast(t("toast.saved")); }, function () { showToast(t("toast.noFiles")); });
  }

  function exportJson(all) {
    var tr = curTree();
    if (!all && !tr) { showToast(t("toast.noTree")); return; }
    var text = FT.exportData(data, all ? null : tr.id, new Date().toISOString());
    var name = (all ? "family-trees" : fileBase(tr.name)) + "-" + stampDate() + ".json";
    downloadBlob(new Blob([text], { type: "application/json" }), name, "application/json",
                 [{ description: "JSON", accept: { "application/json": [".json"] } }]);
  }

  function importJson() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(".json,application/json") : localPickFile(".json,application/json");
    pick.then(function (file) {
      if (!file) return;                        // cancel — silent exit
      if (file.size > FT.IMPORT_MAX) { showToast(t("imp.err.size")); return; }
      return file.text().then(function (text) {
        var r = FT.parseImport(text, data);
        if (!r.ok) { showToast(t("imp.err." + r.err)); return; }
        // Photos: only pixels we re-drew get in.
        var chain = Promise.resolve();
        r.data.people.forEach(function (p) {
          if (!p.photo) return;
          chain = chain.then(function () { return reencode(p.photo).then(function (uri) { p.photo = uri || ""; }); });
        });
        return chain.then(function () { previewImport(r); });
      });
    }).catch(function () { showToast(t("imp.err.json")); });
  }
  function previewImport(r, ged) {
    var dlg = makeDialog("ft-import", t("imp.title"));
    var s = r.stats;
    dlg.appendChild(el("p", "imp-stats", t("imp.stats", { t: s.trees, p: s.people, u: s.unions })));
    if (s.dropped) dlg.appendChild(el("p", "dlg-sub", t("imp.dropped", { n: s.dropped })));
    if (s.refs) dlg.appendChild(el("p", "dlg-sub", t("imp.refs", { n: s.refs })));
    if (s.cycles) dlg.appendChild(el("p", "dlg-sub", t("imp.cycles", { n: s.cycles })));
    dlg.appendChild(el("p", "dlg-sub", ged ? t("ged.newTree", { name: r.data.trees[0].name }) : t("imp.merge")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("ed.cancel"), function () { dlg.close(); }));
    acts.appendChild(textBtn("dlg-btn primary", t("imp.go"), function () { dlg.close(); applyImport(r.data, ged); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  function applyImport(imp, ged) {
    // Photo budget: imported photos that do not fit are left out.
    var used = FT.photoBytes(data);
    imp.people.forEach(function (p) {
      if (!p.photo) return;
      var old = findIn(data.people, p.id);
      var extra = p.photo.length - (old && old.photo ? old.photo.length : 0);
      if (used + extra > FT.PHOTO_BUDGET) p.photo = old ? old.photo : "";
      else used += extra;
    });
    var before = {};
    ["trees", "people", "unions"].forEach(function (k) {
      imp[k].forEach(function (x) { var o = findIn(data[k], x.id); before[x.id] = o ? clone(o) : null; });
    });
    var prev = JSON.stringify(data);
    data = FT.merge(data, imp);
    if (JSON.stringify(data) === prev) { showToast(t("imp.nothing")); return; }
    // keep only the rows the import actually changed in the Undo set
    Object.keys(before).forEach(function (id) {
      var now = findIn(data.trees, id) || findIn(data.people, id) || findIn(data.unions, id);
      if (JSON.stringify(now || null) === JSON.stringify(before[id])) delete before[id];
    });
    if ((ged || !curTree()) && imp.trees.length) prefs.tree = imp.trees[0].id;
    savePrefs();
    centerOnFocus = true;
    commit();
    undoToast(t("imp.done"), function () { undoRows(before); });
  }

  // GEDCOM: a file always comes in as a new tree (no photos in it).
  function importGedcom() {
    var dlg = dialogHost(), accept = ".ged,.gedcom";
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(accept) : localPickFile(accept);
    pick.then(function (file) {
      if (!file) return;
      if (file.size > FT.GED_MAX) { showToast(t("ged.err.size")); return; }
      return file.arrayBuffer().then(function (buf) {
        var name = String(file.name || "").replace(/\.(ged|gedcom)$/i, "");
        var r = FT.parseGedcom(FT.decodeGedcom(buf), data, { name: name, now: stamp(0), newId: newId });
        if (!r.ok) { showToast(t(r.err === "toolarge" ? "imp.err.toolarge" : "ged.err." + r.err)); return; }
        if (data.trees.length >= FT.MAX_TREES) { showToast(t("toast.maxTrees", { n: FT.MAX_TREES })); return; }
        if (data.people.length + r.data.people.length > FT.MAX_PEOPLE) {
          showToast(t("toast.maxPeople", { n: FT.MAX_PEOPLE }));
          return;
        }
        previewImport(r, true);
      });
    }).catch(function () { showToast(t("ged.err.format")); });
  }
  function exportGedcom() {
    var tr = curTree();
    if (!tr) { showToast(t("toast.noTree")); return; }
    var o = prefs.exp;
    var dlg = makeDialog("ft-ged", t("ged.title"));
    dlg.appendChild(el("p", "dlg-sub", t("ged.sub")));
    var w = el("label", "chk"), cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!o.living;
    cb.addEventListener("change", function () { o.living = cb.checked; savePrefs(); });
    w.appendChild(cb);
    w.appendChild(el("span", "", t("exp.living")));
    dlg.appendChild(w);
    function file() {
      return new Blob([FT.exportGedcom(data, tr.id, { living: o.living })], { type: "text/plain" });
    }
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(textBtn("dlg-btn", t("ed.cancel"), function () { dlg.close(); }));
    acts.appendChild(textBtn("dlg-btn", t("exp.files"), function () {
      dlg.close();
      saveToFiles(file(), fileBase(tr.name) + ".ged");
    }));
    acts.appendChild(textBtn("dlg-btn primary", t("ged.download"), function () {
      dlg.close();
      downloadBlob(file(), fileBase(tr.name) + ".ged", "text/plain",
                   [{ description: "GEDCOM", accept: { "text/plain": [".ged"] } }]);
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ---------- 11. Menus, dialogs, toasts ----------
  var menuCtl = null;
  function openMenu() {
    closeMenu();
    var btn = $("more-btn"), r = btn.getBoundingClientRect();
    var m = el("div", "menu");
    m.id = "ft-menu";
    m.setAttribute("role", "menu");
    var items = [
      ["menu.add", function () { if (!curTree()) addFirstPerson(); else openEditor(null, function (f) { return newPerson(f); }); }],
      ["menu.contacts", buildFromContacts],
      ["menu.gens", openGens],
      ["menu.exportImg", openExport],
      ["menu.exportJson", function () { exportJson(false); }],
      ["menu.exportAll", function () { exportJson(true); }],
      ["menu.import", importJson],
      ["menu.gedExport", exportGedcom],
      ["menu.gedImport", importGedcom]
    ];
    items.forEach(function (it) {
      var b = textBtn("menu-item", t(it[0]), function () { closeMenu(); it[1](); });
      b.setAttribute("role", "menuitem");
      m.appendChild(b);
    });
    document.body.appendChild(m);
    m.style.top = Math.round(r.bottom + 6) + "px";
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
    menuCtl = new AbortController();
    var sig = { signal: menuCtl.signal };
    setTimeout(function () {
      if (!menuCtl) return;
      document.addEventListener("pointerdown", function (e) { if (!m.contains(e.target)) closeMenu(); }, sig);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeMenu(); btn.focus(); } }, sig);
      window.addEventListener("resize", closeMenu, sig);
    }, 0);
    m.firstChild.focus();
  }
  function closeMenu() {
    if (menuCtl) { menuCtl.abort(); menuCtl = null; }
    var m = $("ft-menu");
    if (m) m.remove();
  }

  function makeDialog(id, title) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    if (title) {
      var h = el("div", "dlg-title", title);
      h.id = id + "-t";
      dlg.setAttribute("aria-labelledby", h.id);
      dlg.appendChild(h);
    }
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

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "familytree", title: String(text) })) return;
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

  // ---------- 12. Keyboard ----------
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
    // + / − zoom, 0 fits, arrows pan (not while typing or in a dialog)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]") || !lay) return;
      var k = e.key;
      if (k === "+" || k === "=") zoomCenter(1.2);
      else if (k === "-" || k === "_") zoomCenter(1 / 1.2);
      else if (k === "0") fit();
      else if (k === "ArrowLeft") { view.tx += 60; applyView(); }
      else if (k === "ArrowRight") { view.tx -= 60; applyView(); }
      else if (k === "ArrowUp") { view.ty += 60; applyView(); }
      else if (k === "ArrowDown") { view.ty -= 60; applyView(); }
      else if (k === "Escape" && selected) select(null);
      else return;
      e.preventDefault();
    });
  }

  // ---------- 13. Sync slice + palette ----------
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
    api.registerSlice("familytree", sliceGet, sliceSet, STORAGE_KEY, FT.merge);
  }

  function sliceGet() { return FT.merge(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.people)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = FT.merge(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    ensureTree();
    if (selected && !ix.P[selected]) selected = null;
    if (document.querySelector("dialog#ft-edit[open]")) { renderTree(); return; }   // keep the open form
    renderAll();
  }

  // ---------- 14. Wiring & boot ----------
  function renderToolbar() {
    var tr = curTree();
    $("tree-name").textContent = tr ? tr.name : t("tree.none");
    [].forEach.call($("view-seg").children, function (b) {
      var on = b.getAttribute("data-view") === prefs.view;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var has = !!(tr && focusId());
    $("view-seg").hidden = !has;
    $("people-btn").disabled = !tr;
    $("fit-btn").disabled = !has;
  }
  function renderAll() {
    reindex();
    renderToolbar();
    renderTree();
    renderSide();
  }

  function applyI18n() {
    [].forEach.call($("view-seg").children, function (b) {
      b.textContent = t("view." + b.getAttribute("data-view"));
    });
    var tb = $("tree-btn");
    tb.insertAdjacentHTML("afterbegin", UI.tree);           // static icon
    tb.insertAdjacentHTML("beforeend", UI.chev);
    tb.setAttribute("aria-label", t("trees.title"));
    [["people-btn", UI.people, "btn.people"], ["fit-btn", UI.fit, "btn.fit"], ["more-btn", UI.more, "btn.more"],
     ["zoom-in", UI.plus, "btn.zoomIn"], ["zoom-out", UI.minus, "btn.zoomOut"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = x[1];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    $("stage").setAttribute("aria-label", t("stage"));
    $("empty-add").textContent = t("empty.add");
    $("empty-contacts").textContent = t("empty.contacts");
    $("empty-import").textContent = t("empty.import");
    document.title = t("tree.none") + " · orOS";
  }

  function wire() {
    $("tree-btn").addEventListener("click", function () { if (data.trees.length) openTrees(); else nameDialog(null); });
    [].forEach.call($("view-seg").children, function (b) {
      b.addEventListener("click", function () {
        prefs.view = b.getAttribute("data-view");
        savePrefs();
        centerOnFocus = true;
        renderToolbar();
        renderTree();
      });
    });
    $("people-btn").addEventListener("click", openPeople);
    $("fit-btn").addEventListener("click", fit);
    $("more-btn").addEventListener("click", function () { if ($("ft-menu")) closeMenu(); else openMenu(); });
    $("zoom-in").addEventListener("click", function () { zoomCenter(1.25); });
    $("zoom-out").addEventListener("click", function () { zoomCenter(1 / 1.25); });
    $("empty-add").addEventListener("click", addFirstPerson);
    $("empty-contacts").addEventListener("click", buildFromContacts);
    $("empty-import").addEventListener("click", importJson);
    wirePanZoom();
    window.addEventListener("storage", function (e) {
      if (e.key === CONTACTS_KEY && selected) renderSide();   // contact links follow Contacts edits
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
    });
    window.addEventListener("pagehide", savePrefsNow);
    wireKeyboard();
  }

  function boot() {
    if (!FT) { console.error("[orOS] familytree: ft-core.js missing"); return; }
    if (window.innerWidth < 500) view.s = 0.72;   // phones: a couple of generations in sight
    load();
    loadPrefs();
    ensureTree();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("familytree");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
  }

  // Deep link (shell __orosOpenAt / __orosTakeTarget):
  //   { tree, person } (universal search): switches to the person's
  //     tree, centres on and selects them;
  //   { contact } (Contacts card "Family tree"): the person linked to
  //     that contact (this tree first), or — nobody linked yet — the
  //     "Build from Contacts" preview starting from that contact.
  // Unknown ids → no-op; an open dialog → no-op (unsaved edits win).
  function openSearchTarget(tg) {
    if (!tg || document.querySelector("dialog[open]")) return;
    var p = null;
    if (typeof tg.contact === "string") {
      var linked = data.people.filter(function (x) { return x.contact === tg.contact && findIn(data.trees, x.tree); });
      p = linked.filter(function (x) { return x.tree === prefs.tree; })[0] || linked[0] || null;
      if (!p) {
        var c = contactById(tg.contact);
        if (c) { closeMenu(); planBuild(c); }
        return;
      }
    } else if (typeof tg.person === "string") {
      p = findIn(data.people, tg.person);
    }
    if (!p || !findIn(data.trees, p.tree)) return;
    closeMenu();
    if (prefs.tree !== p.tree) {
      prefs.tree = p.tree;
      selected = null;
      savePrefs();
      renderAll();
    }
    setFocus(p.id, true);
    select(p.id);
  }
  window.__orosOpenAt = openSearchTarget;

  boot();
})();
