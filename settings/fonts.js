// ============================================================
// orOS Settings › Fonts (settings/fonts.js, FM-1, v1.1.0)
// The font manager: the person's font files on the orOS disk
// (/internal/Fonts, synced by Vault like any file) and the free
// Fontsource families, with a sample in their own text, which Greek,
// polytonic, Latin and Cyrillic letters a font has, and what its
// licence says. Loaded with designkit/text.js, designkit/fonts.js and
// files/files-core.js when the section first opens (Settings size
// budget). Writes the font files themselves (designkit/fonts.js
// importFile / remove), the synced slice "fonts" (collections and
// notes, designkit/fonts.js cols, FM-2) and one device-local
// convenience key (the sample text and size).
// Every name, licence text and sample comes from a font file or the
// Fontsource catalog, so all of it goes in with textContent only; a
// licence address is a link only when it is http(s).
// i18n-inline-ok: SAMPLES are specimen texts in their own script
// (Greek, polytonic Greek), the same in every language, never UI words.
// Exposes window.SettingsFonts { mount(host, ctx), refresh() }.
// ============================================================
(function () {
  "use strict";

  var DK = window.orosDK && window.orosDK.fonts;
  var KEY = "oros-settings-fonts";          // this device: { text, size, preset }
  var PAGE = 40;                            // free fonts shown per "Show more"

  var SAMPLES = {
    greek: "Ξεσκεπάζω την ψυχοφθόρα βδελυγμία. ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ αβγδεζηθικλμνξοπρσςτυφχψω άέήίόύώ ϊϋΐΰ",
    poly: "Ἄνδρα μοι ἔννεπε, μοῦσα, πολύτροπον, ὃς μάλα πολλὰ πλάγχθη, ἐπεὶ Τροίης ἱερὸν πτολίεθρον ἔπερσεν· ᾅ ῷ ῥ ὦ",
    latin: "The quick brown fox jumps over the lazy dog. ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz",
    nums: "0123456789 € $ £ % & @ « » “ ” ‘ ’ — – … ; · ! ? ( ) [ ] { } / * + = #"
  };

  var STRINGS = {
    en: {
      "fm.loading": "Reading your fonts…",
      "fm.intro": "Your font files live on the orOS disk and sync, encrypted, to all your devices. Layout and Atelier use them, and the free fonts too, which download when a document needs them.",
      "fm.tab.mine": "In orOS", "fm.tab.free": "Free fonts", "fm.tabs": "Which fonts",
      "fm.find": "Find a font",
      "fm.f.greek": "Greek", "fm.f.poly": "Polytonic",
      "fm.f.cat": "Kind", "fm.f.all": "All kinds", "fm.f.serif": "Serif", "fm.f.sans": "Sans serif", "fm.f.mono": "Monospace",
      "fm.drop": "Or drop .ttf, .otf, .woff or .woff2 files here. Up to 15 MB each.",
      "fm.dropHere": "Drop the font files to add them",
      "fm.empty": "No fonts of your own yet. Add a font file, or look through the free fonts.",
      "fm.none": "No font matches.",
      "fm.styles": "{n} styles", "fm.style1": "1 style",
      "fm.cff": "Atelier only",
      "fm.cff.hint": "PostScript outlines (CFF): Atelier uses this font, but Layout's PDF can't embed it.",
      "fm.checking": "Checking…",
      "fm.b.greek": "Greek", "fm.b.greekPart": "Greek in part", "fm.b.noGreek": "No Greek",
      "fm.b.poly": "Polytonic", "fm.b.polyPart": "Polytonic in part",
      "fm.adding": "Adding {n} files…",
      "fm.r.added": "Added: {name}", "fm.r.same": "Already in orOS: {name}",
      "fm.r.size": "{file}: too big (15 MB at most).",
      "fm.r.type": "{file}: not a font file orOS can read.",
      "fm.r.restricted": "{file}: its licence does not allow embedding it in documents, so orOS doesn't keep it.",
      "fm.r.disk": "The orOS disk isn't ready. Try again in a moment.",
      "fm.back": "All fonts",
      "fm.sample": "Sample", "fm.ownText": "Your text", "fm.size": "Size", "fm.style": "Style",
      "fm.st.r": "Regular", "fm.st.b": "Bold", "fm.st.i": "Italic", "fm.st.bi": "Bold italic",
      "fm.p": "Sample text", "fm.p.greek": "Greek", "fm.p.poly": "Polytonic", "fm.p.latin": "Latin", "fm.p.nums": "Numbers & signs", "fm.p.own": "Mine",
      "fm.cov": "Letters",
      "fm.cov.hint": "Counted from the font's own character table: each script's letters, with the accents it uses.",
      "fm.c.greek": "Greek (monotonic)", "fm.c.poly": "Polytonic Greek", "fm.c.latin": "Latin", "fm.c.latinExt": "Latin accents (é, ç, ß…)", "fm.c.cyr": "Cyrillic",
      "fm.l.full": "All {total}", "fm.l.part": "{have} of {total}", "fm.l.none": "None", "fm.l.sub": "Yes, in its own files",
      "fm.missing": "Missing: {chars}",
      "fm.cov.subsets": "From the font's subsets; the exact count comes with the files.",
      "fm.lic": "Licence",
      "fm.lic.hint": "What the font file says about itself. The licence you got with the font is what counts.",
      "fm.e.installable": "Can be embedded in PDFs and documents, and installed.",
      "fm.e.editable": "Can be embedded in documents that people may edit.",
      "fm.e.print": "Can be embedded only for viewing and printing.",
      "fm.e.restricted": "Its licence does not allow embedding.",
      "fm.e.noSubset": "Must be embedded whole, never as a part.",
      "fm.e.bitmap": "Only its bitmaps may be embedded.",
      "fm.open.ofl": "Open licence: SIL Open Font License",
      "fm.open.apache": "Open licence: Apache License",
      "fm.open.no": "Not an open licence that orOS recognises",
      "fm.copyright": "Copyright", "fm.version": "Version", "fm.designer": "Designer", "fm.maker": "Made by",
      "fm.licText": "Licence text", "fm.licUrl": "Licence page", "fm.licFs": "Fontsource lists it as {id}.",
      "fm.files": "Files",
      "fm.file.tt": "TrueType", "fm.file.cff": "PostScript (Atelier only)",
      "fm.remove": "Remove from orOS", "fm.remove.sure": "Press again to move it to the Trash",
      "fm.remove.hint": "The files go to the Trash of Files for 30 days, on every device. Documents that use this font show the built-in Noto font in its place.",
      "fm.removed": "Moved to the Trash: {name}", "fm.removeFail": "Could not move it to the Trash.",
      "fm.free.intro": "Free fonts from Fontsource (mostly SIL Open Font License). Layout and Atelier list them in their font lists; each one downloads the first time a document uses it and then works offline.",
      "fm.free.offline": "The list of free fonts needs a connection the first time.",
      "fm.free.loading": "Loading the list of free fonts…",
      "fm.free.count": "{n} fonts",
      "fm.more": "Show more",
      "fm.free.page": "Fontsource page",
      "fm.free.fail": "This font did not load. Check the connection and open it again.",
      "fm.free.wait": "Loading the font…",
      "fm.tab.cols": "Collections",
      "fm.cols.intro": "Group the fonts of a project, such as a book or a series of covers. Layout and Atelier list a document's collection first in their font lists. Collections and notes sync to all your devices.",
      "fm.cols.new": "New collection", "fm.cols.name": "Name of the collection", "fm.cols.create": "Create",
      "fm.cols.empty": "No collections yet.",
      "fm.cols.n": "{n} fonts", "fm.cols.n1": "1 font", "fm.cols.n0": "No fonts yet",
      "fm.col.empty": "No fonts in this collection yet. Open a font and tick this collection.",
      "fm.col.rename": "Name",
      "fm.col.open": "Open", "fm.col.out": "Take out",
      "fm.col.missing": "Its file is not on this device yet; it arrives with the next sync.",
      "fm.col.offline": "Keep for offline use", "fm.col.offline.hint": "Downloads every file of the free fonts in this collection now, so Layout and Atelier have them without a connection. Your own fonts are on the orOS disk already.",
      "fm.col.offline.run": "Downloading {done} of {total}…", "fm.col.offline.done": "Ready for offline use: {n} files.", "fm.col.offline.fail": "{n} files did not download. Check the connection and try again.", "fm.col.offline.none": "No free fonts in this collection: nothing to download.",
      "fm.col.delete": "Delete collection", "fm.col.delete.sure": "Press again to delete it",
      "fm.col.delete.hint": "Only the collection goes; the fonts stay in orOS.",
      "fm.col.deleted": "Deleted the collection {name}.",
      "fm.inCols": "Collections and note", "fm.inCols.hint": "Tick the collections this font belongs to.",
      "fm.note": "Your note", "fm.note.hint": "For example where you bought it and for how many computers. Syncs to all your devices.",
      "fm.back.col": "Back to the collection"
    },
    el: {
      "fm.loading": "Διαβάζω τις γραμματοσειρές σου…",
      "fm.intro": "Τα αρχεία γραμματοσειρών σου βρίσκονται στον δίσκο του orOS και συγχρονίζονται κρυπτογραφημένα σε όλες σου τις συσκευές. Το Layout και το Atelier τις χρησιμοποιούν, μαζί με τις δωρεάν γραμματοσειρές, που κατεβαίνουν όταν τις χρειαστεί ένα έγγραφο.",
      "fm.tab.mine": "Στο orOS", "fm.tab.free": "Δωρεάν", "fm.tabs": "Ποιες γραμματοσειρές",
      "fm.find": "Βρες γραμματοσειρά",
      "fm.f.greek": "Ελληνικά", "fm.f.poly": "Πολυτονικά",
      "fm.f.cat": "Είδος", "fm.f.all": "Όλα τα είδη", "fm.f.serif": "Με πατούρες", "fm.f.sans": "Χωρίς πατούρες", "fm.f.mono": "Σταθερού πλάτους",
      "fm.drop": "Ή σύρε εδώ αρχεία .ttf, .otf, .woff ή .woff2. Έως 15 MB το καθένα.",
      "fm.dropHere": "Άφησε τα αρχεία για να προστεθούν",
      "fm.empty": "Δεν έχεις ακόμη δικές σου γραμματοσειρές. Πρόσθεσε ένα αρχείο ή δες τις δωρεάν.",
      "fm.none": "Καμία γραμματοσειρά δεν ταιριάζει.",
      "fm.styles": "{n} στυλ", "fm.style1": "1 στυλ",
      "fm.cff": "Μόνο Atelier",
      "fm.cff.hint": "Περιγράμματα PostScript (CFF): τη χρησιμοποιεί το Atelier, αλλά το PDF του Layout δεν μπορεί να την ενσωματώσει.",
      "fm.checking": "Έλεγχος…",
      "fm.b.greek": "Ελληνικά", "fm.b.greekPart": "Ελληνικά εν μέρει", "fm.b.noGreek": "Χωρίς ελληνικά",
      "fm.b.poly": "Πολυτονικά", "fm.b.polyPart": "Πολυτονικά εν μέρει",
      "fm.adding": "Προσθέτω {n} αρχεία…",
      "fm.r.added": "Προστέθηκε: {name}", "fm.r.same": "Υπάρχει ήδη στο orOS: {name}",
      "fm.r.size": "{file}: πολύ μεγάλο (έως 15 MB).",
      "fm.r.type": "{file}: δεν είναι αρχείο γραμματοσειράς που διαβάζει το orOS.",
      "fm.r.restricted": "{file}: η άδειά του δεν επιτρέπει ενσωμάτωση σε έγγραφα, γι' αυτό το orOS δεν το κρατά.",
      "fm.r.disk": "Ο δίσκος του orOS δεν είναι έτοιμος. Δοκίμασε ξανά σε λίγο.",
      "fm.back": "Όλες οι γραμματοσειρές",
      "fm.sample": "Δείγμα", "fm.ownText": "Το κείμενό σου", "fm.size": "Μέγεθος", "fm.style": "Στυλ",
      "fm.st.r": "Κανονικά", "fm.st.b": "Έντονα", "fm.st.i": "Πλάγια", "fm.st.bi": "Έντονα πλάγια",
      "fm.p": "Κείμενο δείγματος", "fm.p.greek": "Ελληνικά", "fm.p.poly": "Πολυτονικά", "fm.p.latin": "Λατινικά", "fm.p.nums": "Αριθμοί και σύμβολα", "fm.p.own": "Δικό μου",
      "fm.cov": "Γράμματα",
      "fm.cov.hint": "Μετρημένα από τον πίνακα χαρακτήρων της ίδιας της γραμματοσειράς: τα γράμματα κάθε γραφής, με τους τόνους που χρησιμοποιεί.",
      "fm.c.greek": "Ελληνικά (μονοτονικά)", "fm.c.poly": "Πολυτονικά", "fm.c.latin": "Λατινικά", "fm.c.latinExt": "Λατινικά με τόνους (é, ç, ß…)", "fm.c.cyr": "Κυριλλικά",
      "fm.l.full": "Όλα τα {total}", "fm.l.part": "{have} από {total}", "fm.l.none": "Κανένα", "fm.l.sub": "Ναι, σε δικά της αρχεία",
      "fm.missing": "Λείπουν: {chars}",
      "fm.cov.subsets": "Από τα τμήματα της γραμματοσειράς· η ακριβής μέτρηση έρχεται με τα αρχεία.",
      "fm.lic": "Άδεια",
      "fm.lic.hint": "Τι λέει για τον εαυτό του το αρχείο της γραμματοσειράς. Αυτό που μετράει είναι η άδεια που πήρες μαζί με τη γραμματοσειρά.",
      "fm.e.installable": "Επιτρέπεται ενσωμάτωση σε PDF και έγγραφα, και εγκατάσταση.",
      "fm.e.editable": "Επιτρέπεται ενσωμάτωση σε έγγραφα που μπορεί να διορθώσει κάποιος.",
      "fm.e.print": "Επιτρέπεται ενσωμάτωση μόνο για προβολή και εκτύπωση.",
      "fm.e.restricted": "Η άδειά της δεν επιτρέπει ενσωμάτωση.",
      "fm.e.noSubset": "Ενσωματώνεται μόνο ολόκληρη, ποτέ ένα μέρος της.",
      "fm.e.bitmap": "Ενσωματώνονται μόνο τα bitmap της.",
      "fm.open.ofl": "Ανοιχτή άδεια: SIL Open Font License",
      "fm.open.apache": "Ανοιχτή άδεια: Apache License",
      "fm.open.no": "Όχι ανοιχτή άδεια που αναγνωρίζει το orOS",
      "fm.copyright": "Πνευματικά δικαιώματα", "fm.version": "Έκδοση", "fm.designer": "Σχεδιαστής", "fm.maker": "Κατασκευαστής",
      "fm.licText": "Κείμενο άδειας", "fm.licUrl": "Σελίδα άδειας", "fm.licFs": "Το Fontsource τη δίνει με άδεια {id}.",
      "fm.files": "Αρχεία",
      "fm.file.tt": "TrueType", "fm.file.cff": "PostScript (μόνο Atelier)",
      "fm.remove": "Αφαίρεση από το orOS", "fm.remove.sure": "Πάτα ξανά για μεταφορά στα Απορρίμματα",
      "fm.remove.hint": "Τα αρχεία πάνε στα Απορρίμματα των Αρχείων για 30 ημέρες, σε κάθε συσκευή. Τα έγγραφα που τη χρησιμοποιούν δείχνουν στη θέση της την ενσωματωμένη Noto.",
      "fm.removed": "Μεταφέρθηκε στα Απορρίμματα: {name}", "fm.removeFail": "Δεν μεταφέρθηκε στα Απορρίμματα.",
      "fm.free.intro": "Δωρεάν γραμματοσειρές από το Fontsource (κυρίως με άδεια SIL Open Font License). Το Layout και το Atelier τις δείχνουν στις λίστες γραμματοσειρών τους· η καθεμία κατεβαίνει την πρώτη φορά που τη χρησιμοποιεί ένα έγγραφο και μετά δουλεύει χωρίς σύνδεση.",
      "fm.free.offline": "Η λίστα με τις δωρεάν γραμματοσειρές θέλει σύνδεση την πρώτη φορά.",
      "fm.free.loading": "Φορτώνω τη λίστα με τις δωρεάν γραμματοσειρές…",
      "fm.free.count": "{n} γραμματοσειρές",
      "fm.more": "Δείξε περισσότερες",
      "fm.free.page": "Σελίδα στο Fontsource",
      "fm.free.fail": "Η γραμματοσειρά δεν φόρτωσε. Έλεγξε τη σύνδεση και άνοιξέ την ξανά.",
      "fm.free.wait": "Φορτώνω τη γραμματοσειρά…",
      "fm.tab.cols": "Συλλογές",
      "fm.cols.intro": "Μάζεψε τις γραμματοσειρές ενός έργου, όπως ενός βιβλίου ή μιας σειράς εξωφύλλων. Το Layout και το Atelier δείχνουν πρώτη τη συλλογή του εγγράφου στις λίστες γραμματοσειρών τους. Οι συλλογές και οι σημειώσεις συγχρονίζονται σε όλες σου τις συσκευές.",
      "fm.cols.new": "Νέα συλλογή", "fm.cols.name": "Όνομα της συλλογής", "fm.cols.create": "Δημιουργία",
      "fm.cols.empty": "Δεν έχεις ακόμη συλλογές.",
      "fm.cols.n": "{n} γραμματοσειρές", "fm.cols.n1": "1 γραμματοσειρά", "fm.cols.n0": "Χωρίς γραμματοσειρές ακόμη",
      "fm.col.empty": "Δεν υπάρχουν ακόμη γραμματοσειρές σε αυτή τη συλλογή. Άνοιξε μια γραμματοσειρά και τσέκαρε αυτή τη συλλογή.",
      "fm.col.rename": "Όνομα",
      "fm.col.open": "Άνοιγμα", "fm.col.out": "Αφαίρεση",
      "fm.col.missing": "Το αρχείο της δεν έχει έρθει ακόμη σε αυτή τη συσκευή· θα έρθει με τον επόμενο συγχρονισμό.",
      "fm.col.offline": "Κράτησέ τη για χρήση χωρίς σύνδεση", "fm.col.offline.hint": "Κατεβάζει τώρα όλα τα αρχεία των δωρεάν γραμματοσειρών της συλλογής, ώστε το Layout και το Atelier να τα έχουν χωρίς σύνδεση. Οι δικές σου γραμματοσειρές είναι ήδη στον δίσκο του orOS.",
      "fm.col.offline.run": "Κατεβάζω {done} από {total}…", "fm.col.offline.done": "Έτοιμη για χρήση χωρίς σύνδεση: {n} αρχεία.", "fm.col.offline.fail": "{n} αρχεία δεν κατέβηκαν. Έλεγξε τη σύνδεση και δοκίμασε ξανά.", "fm.col.offline.none": "Δεν υπάρχουν δωρεάν γραμματοσειρές σε αυτή τη συλλογή: δεν έχει κάτι να κατεβάσει.",
      "fm.col.delete": "Διαγραφή συλλογής", "fm.col.delete.sure": "Πάτα ξανά για διαγραφή",
      "fm.col.delete.hint": "Φεύγει μόνο η συλλογή· οι γραμματοσειρές μένουν στο orOS.",
      "fm.col.deleted": "Διαγράφηκε η συλλογή {name}.",
      "fm.inCols": "Συλλογές και σημείωση", "fm.inCols.hint": "Τσέκαρε τις συλλογές στις οποίες ανήκει αυτή η γραμματοσειρά.",
      "fm.note": "Η σημείωσή σου", "fm.note.hint": "Για παράδειγμα πού την αγόρασες και για πόσους υπολογιστές. Συγχρονίζεται σε όλες σου τις συσκευές.",
      "fm.back.col": "Πίσω στη συλλογή"
    }
  };

  var LANG = window.orosI18n ? window.orosI18n.lang() : "en";
  if (window.orosI18n) window.orosI18n.table(STRINGS, "settings", LANG);
  var L = STRINGS[LANG] || STRINGS[(LANG || "").split("-")[0]] || STRINGS.en;
  var ctxT = null;
  function t(key, vars) {
    var s = L[key] !== undefined ? L[key] : STRINGS.en[key] !== undefined ? STRINGS.en[key] : (ctxT ? ctxT(key) : key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function btn(label, cls, onClick) {
    var b = el("button", cls || "btn", label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  function card(title) {
    var c = el("section", "card");
    if (title) { var h = el("div", "card-head"); h.appendChild(el("h3", null, title)); c.appendChild(h); }
    return c;
  }
  function prefs() {
    try { var o = JSON.parse(localStorage.getItem(KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
  }
  function savePrefs(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

  // ---------- State ----------
  var S = {
    tab: "mine", q: "", greek: false, poly: false, cat: "",
    fams: null, loading: false, msgs: [],
    detail: null,                     // { kind: "mine", key } | { kind: "free", id } | { kind: "col", id }
    from: "",                         // the collection a font page was opened from
    free: null, freeErr: false, freeShown: PAGE,
    style: "r", armed: false, offline: null
  };
  var CB = null;                     // the "fonts" slice (collections, notes), bound at the first mount
  var P = prefs();
  var spec = { preset: P.preset || "greek", text: typeof P.text === "string" ? P.text.slice(0, 2000) : "", size: P.size >= 12 && P.size <= 96 ? P.size : 36 };
  var insp = {};                     // file → inspect() result (a file's name is its hash)
  var faces = {};                    // css family → Promise (FontFace loaded)
  var rootEl = el("div", "fm");
  var host = null;

  // ---------- Fonts on the disk ----------
  function famKey(r) { return (DK.squash(r.family) || r.family.toLowerCase()) + (r.cff ? "~cff" : ""); }
  function group(lib) {
    var by = {}, out = [];
    lib.forEach(function (r) {
      var k = famKey(r), f = by[k];
      if (!f) { f = by[k] = { key: k, name: r.family, fb: r.fb, cff: r.cff, files: [] }; out.push(f); }
      f.files.push(r);
    });
    out.forEach(function (f) {
      f.files.sort(function (a, b) { return (a.b - b.b) || (a.i - b.i); });
      f.main = f.files.filter(function (r) { return !r.b && !r.i; })[0] || f.files[0];
    });
    return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function refresh() {
    if (!DK) return Promise.resolve();
    S.loading = true;
    draw();
    return DK.library({ all: true }).then(function (lib) {
      S.fams = group(lib);
      S.loading = false;
      draw();
      inspectAll();
    }, function () { S.fams = []; S.loading = false; draw(); });
  }
  function fileBuf(name) {
    return DK.blob(name).then(function (b) { return b ? b.arrayBuffer() : null; }).then(function (ab) { return ab ? new Uint8Array(ab).slice().buffer : null; });
  }
  function inspectFile(name) {
    if (insp[name]) return Promise.resolve(insp[name]);
    return fileBuf(name).then(function (ab) {
      var r = ab ? DK.inspect(ab) : null;
      if (r) { r.buf = ab; insp[name] = r; }
      return r;
    }, function () { return null; });
  }
  function cssFam(file) { return "fm-" + file.slice(0, 16); }
  function loadFace(name, buf) {
    if (faces[name]) return faces[name];
    faces[name] = Promise.resolve(buf).then(function (b) {
      if (!b || typeof FontFace === "undefined") return false;
      var f = new FontFace(name, b);
      return f.load().then(function (ff) { document.fonts.add(ff); return true; });
    }).then(null, function () { return false; });
    return faces[name];
  }
  // One family at a time: read its regular file, load it for the list.
  function inspectAll() {
    var list = (S.fams || []).slice();
    (function next() {
      var f = list.shift();
      if (!f) return;
      inspectFile(f.main.file).then(function (r) {
        if (r) loadFace(cssFam(f.main.file), r.buf);
        paintBadges(f);
        next();
      });
    })();
  }

  // ---------- Adding files ----------
  function addFiles(files) {
    files = Array.prototype.slice.call(files || []).slice(0, 60);
    if (!files.length || !DK) return;
    var had = {};
    (S.fams || []).forEach(function (f) { f.files.forEach(function (r) { had[r.file] = 1; }); });
    S.msgs = [{ cls: "msg-dim", text: t("fm.adding", { n: files.length }) }];
    draw();
    var out = [];
    (function next(i) {
      if (i >= files.length) { S.msgs = out; refresh(); return; }
      var file = files[i];
      DK.importFile(file, { cff: true }).then(function (r) {
        if (r && r.err) {
          var k = r.err === "size" ? "fm.r.size" : r.err === "restricted" ? "fm.r.restricted" : r.err === "disk" ? "fm.r.disk" : "fm.r.type";
          out.push({ cls: "msg-err", text: t(k, { file: file.name }) });
        } else if (r) {
          var nm = r.family + (r.sub ? " " + r.sub : "");
          out.push({ cls: "msg-ok", text: t(had[r.file] ? "fm.r.same" : "fm.r.added", { name: nm }) });
          had[r.file] = 1;
        }
      }, function () {
        out.push({ cls: "msg-err", text: t("fm.r.type", { file: file.name }) });
      }).then(function () { next(i + 1); });
    })(0);
  }
  function picker() {
    var inp = el("input");
    inp.type = "file";
    inp.multiple = true;
    inp.accept = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
    inp.hidden = true;
    inp.addEventListener("change", function () { addFiles(inp.files); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  }

  // ---------- Badges ----------
  function badges(cov) {
    var out = [], g = DK.level(cov.greek), p = DK.level(cov.poly);
    out.push(g === "full" || g === "most" ? ["ok", t("fm.b.greek")] : g === "some" ? ["part", t("fm.b.greekPart")] : ["no", t("fm.b.noGreek")]);
    if (p === "full" || p === "most") out.push(["ok", t("fm.b.poly")]);
    else if (p === "some") out.push(["part", t("fm.b.polyPart")]);
    return out;
  }
  function badgeRow(list) {
    var w = el("span", "fm-badges");
    list.forEach(function (b) { w.appendChild(el("span", "fm-badge fm-" + b[0], b[1])); });
    return w;
  }
  var badgeHosts = {};
  function paintBadges(f) {
    var h = badgeHosts[f.key], r = insp[f.main.file];
    if (!h || !h.isConnected) return;
    h.textContent = "";
    var list = r ? badges(r.cov) : [];
    if (f.cff) list.push(["part", t("fm.cff")]);
    h.appendChild(badgeRow(list));
  }

  // ---------- Filters ----------
  function matches(name, greek, poly, cat) {
    if (S.q && name.toLowerCase().indexOf(S.q.toLowerCase()) < 0) return false;
    if (S.greek && !greek) return false;
    if (S.poly && !poly) return false;
    if (S.cat && cat !== S.cat) return false;
    return true;
  }
  function filterBar() {
    var bar = el("div", "fm-filters");
    var q = el("input", "find-in fm-q");
    q.type = "search";
    q.placeholder = t("fm.find");
    q.setAttribute("aria-label", t("fm.find"));
    q.value = S.q;
    q.addEventListener("input", function () {
      S.q = q.value.slice(0, 60); S.freeShown = PAGE;
      drawList();
    });
    bar.appendChild(q);
    var chips = el("div", "fm-chips");
    [["greek", "fm.f.greek"], ["poly", "fm.f.poly"]].forEach(function (c) {
      var b = btn(t(c[1]), "fm-chip" + (S[c[0]] ? " on" : ""), function () {
        S[c[0]] = !S[c[0]]; S.freeShown = PAGE;
        b.classList.toggle("on", S[c[0]]);
        b.setAttribute("aria-pressed", S[c[0]] ? "true" : "false");
        drawList();
      });
      b.setAttribute("aria-pressed", S[c[0]] ? "true" : "false");
      chips.appendChild(b);
    });
    var sel = el("select", "sel fm-cat");
    sel.setAttribute("aria-label", t("fm.f.cat"));
    [["", "fm.f.all"], ["serif", "fm.f.serif"], ["sans", "fm.f.sans"], ["mono", "fm.f.mono"]].forEach(function (o) {
      var op = el("option", null, t(o[1]));
      op.value = o[0];
      if (o[0] === S.cat) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", function () { S.cat = sel.value; S.freeShown = PAGE; drawList(); });
    chips.appendChild(sel);
    bar.appendChild(chips);
    return bar;
  }

  // ---------- Drawing ----------
  var listHost = null;
  function draw() {
    rootEl.textContent = "";
    if (S.detail) { drawDetail(); return; }
    rootEl.appendChild(el("p", "hint fm-intro", t("fm.intro")));
    var tabs = el("div", "seg fm-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", t("fm.tabs"));
    [["mine", "fm.tab.mine"], ["free", "fm.tab.free"], ["cols", "fm.tab.cols"]].forEach(function (x) {
      var b = btn(t(x[1]), "seg-btn fm-tab" + (S.tab === x[0] ? " on" : ""), function () {
        if (S.tab === x[0]) return;
        S.tab = x[0]; S.msgs = []; S.from = "";
        draw();
        if (S.tab === "free") loadFree();
      });
      b.setAttribute("aria-pressed", S.tab === x[0] ? "true" : "false");
      tabs.appendChild(b);
    });
    rootEl.appendChild(tabs);
    if (S.tab === "mine") drawMine(); else if (S.tab === "cols") drawCols(); else drawFree();
  }
  function drawMine() {
    var c = card(t("fm.mine"));
    c.classList.add("fm-drop");
    var add = btn(t("fm.install"), "btn primary", picker);
    var row = el("div", "actions");
    row.appendChild(add);
    c.appendChild(row);
    c.appendChild(el("p", "hint", t("fm.drop")));
    S.msgs.forEach(function (m) { c.appendChild(el("div", "msg " + m.cls, m.text)); });
    c.addEventListener("dragover", function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") < 0) return;
      e.preventDefault(); c.classList.add("fm-over");
    });
    c.addEventListener("dragleave", function () { c.classList.remove("fm-over"); });
    c.addEventListener("drop", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault(); c.classList.remove("fm-over");
      addFiles(e.dataTransfer.files);
    });
    rootEl.appendChild(c);
    rootEl.appendChild(filterBar());
    listHost = el("div", "fm-list");
    rootEl.appendChild(listHost);
    drawList();
  }
  function drawList() {
    if (!listHost) return;
    listHost.textContent = "";
    if (S.tab === "free") { drawFreeList(); return; }
    if (S.loading && !S.fams) { listHost.appendChild(el("p", "hint", t("fm.loading"))); return; }
    var fams = S.fams || [];
    if (!fams.length) { listHost.appendChild(el("p", "hint", t("fm.empty"))); return; }
    var shown = fams.filter(function (f) {
      var r = insp[f.main.file], g = r ? DK.level(r.cov.greek) : "", p = r ? DK.level(r.cov.poly) : "";
      return matches(f.name, !r || g === "full" || g === "most", !r || p === "full" || p === "most", f.fb);
    });
    if (!shown.length) { listHost.appendChild(el("p", "hint", t("fm.none"))); return; }
    shown.forEach(function (f) {
      var b = el("button", "fm-row");
      b.type = "button";
      var name = el("span", "fm-name", f.name);
      name.style.fontFamily = '"' + cssFam(f.main.file) + '", var(--fm-ui, sans-serif)';
      b.appendChild(name);
      var meta = el("span", "fm-meta");
      meta.appendChild(el("span", "fm-count", f.files.length === 1 ? t("fm.style1") : t("fm.styles", { n: f.files.length })));
      var bh = el("span", "fm-bh");
      badgeHosts[f.key] = bh;
      meta.appendChild(bh);
      b.appendChild(meta);
      b.addEventListener("click", function () { S.from = ""; S.detail = { kind: "mine", key: f.key }; S.style = "r"; S.armed = false; draw(); scrollTop(); });
      listHost.appendChild(b);
      if (insp[f.main.file]) paintBadges(f);
      else { bh.appendChild(el("span", "fm-badge fm-wait", t("fm.checking"))); }
    });
  }
  function scrollTop() {
    var p = document.getElementById("page");
    if (p) p.scrollTop = 0;
  }

  // ---------- Detail: sample, letters, licence ----------
  function variants(f) {
    var by = {};
    f.files.forEach(function (r) { var v = r.b ? (r.i ? "bi" : "b") : (r.i ? "i" : "r"); if (!by[v]) by[v] = r; });
    return by;
  }
  function specimen(c, famFor, have) {
    if (!have[S.style]) S.style = have.r ? "r" : Object.keys(have)[0] || "r";
    var bar = el("div", "fm-spec-bar");
    if (Object.keys(have).length > 1) {
      var sg = el("div", "seg fm-styles");
      sg.setAttribute("role", "group");
      sg.setAttribute("aria-label", t("fm.style"));
      ["r", "b", "i", "bi"].forEach(function (v) {
        if (!have[v]) return;
        var b = btn(t("fm.st." + v), "seg-btn" + (S.style === v ? " on" : ""), function () { S.style = v; draw(); });
        b.setAttribute("aria-pressed", S.style === v ? "true" : "false");
        sg.appendChild(b);
      });
      bar.appendChild(sg);
    }
    var pr = el("select", "sel");
    pr.setAttribute("aria-label", t("fm.p"));
    ["greek", "poly", "latin", "nums", "own"].forEach(function (k) {
      var op = el("option", null, t("fm.p." + k));
      op.value = k;
      if (spec.preset === k) op.selected = true;
      pr.appendChild(op);
    });
    bar.appendChild(pr);
    var sz = el("label", "fm-size");
    sz.appendChild(el("span", null, t("fm.size")));
    var rng = el("input");
    rng.type = "range"; rng.min = "12"; rng.max = "96"; rng.step = "1"; rng.value = String(spec.size);
    var szv = el("span", "fm-sizev", spec.size + " pt");
    sz.appendChild(rng); sz.appendChild(szv);
    bar.appendChild(sz);
    c.appendChild(bar);

    var ta = el("textarea", "fm-own");
    ta.rows = 2;
    ta.maxLength = 2000;
    ta.placeholder = t("fm.ownText");
    ta.setAttribute("aria-label", t("fm.ownText"));
    ta.value = spec.text;
    ta.hidden = spec.preset !== "own";
    c.appendChild(ta);

    var out = el("div", "fm-spec");
    out.setAttribute("dir", "auto");
    var fam = famFor(S.style);
    function paint() {
      var txt = spec.preset === "own" ? (spec.text || t("fm.ownText")) : SAMPLES[spec.preset];
      out.textContent = "";
      var big = el("div", "fm-big", txt);
      big.style.fontSize = spec.size + "px";
      out.appendChild(big);
      [12, 18, 24].forEach(function (s) {
        var line = el("div", "fm-water");
        line.appendChild(el("span", "fm-pt", s + ""));
        var tx = el("span", "fm-wtx", txt);
        tx.style.fontSize = s + "px";
        line.appendChild(tx);
        out.appendChild(line);
      });
      out.style.fontFamily = fam;
      out.style.fontWeight = /b/.test(S.style) ? "700" : "400";
      out.style.fontStyle = /i/.test(S.style) ? "italic" : "normal";
    }
    pr.addEventListener("change", function () {
      spec.preset = pr.value; ta.hidden = spec.preset !== "own";
      savePrefs(spec); paint();
      if (!ta.hidden) ta.focus();
    });
    rng.addEventListener("input", function () { spec.size = +rng.value; szv.textContent = spec.size + " pt"; savePrefs(spec); paint(); });
    ta.addEventListener("input", function () { spec.text = ta.value.slice(0, 2000); savePrefs(spec); paint(); });
    paint();
    c.appendChild(out);
  }
  // subs: Fontsource subsets of a free family (its Cyrillic files are
  // not fetched here, so that row comes from the subsets).
  function covCard(cov, approx, subs) {
    var c = card(t("fm.cov"));
    c.appendChild(el("p", "hint", approx ? t("fm.cov.subsets") : t("fm.cov.hint")));
    DK.SET_KEYS.forEach(function (k) {
      var v = cov[k], r = el("div", "row fm-cov");
      var head = el("div", "row-head");
      head.appendChild(el("div", "row-label", t("fm.c." + k)));
      if (subs && k === "cyr") {
        var yes = subs.indexOf("cyrillic") >= 0;
        head.appendChild(el("span", "fm-lv fm-" + (yes ? "ok" : "no"), yes ? t("fm.l.sub") : t("fm.l.none")));
        r.appendChild(head);
        c.appendChild(r);
        return;
      }
      var lv = approx ? v : DK.level(v);
      var val = approx ? (v === "full" ? "✓" : "–") : v.have === v.total ? t("fm.l.full", { total: v.total }) : v.have ? t("fm.l.part", { have: v.have, total: v.total }) : t("fm.l.none");
      head.appendChild(el("span", "fm-lv fm-" + (lv === "full" || lv === "most" ? "ok" : lv === "some" ? "part" : "no"), val));
      r.appendChild(head);
      if (!approx && v.missing && v.have) {
        var m = el("div", "hint fm-miss", t("fm.missing", { chars: v.missing.split("").join(" ") + (v.total - v.have > 80 ? " …" : "") }));
        r.appendChild(m);
      }
      c.appendChild(r);
    });
    return c;
  }
  function infoRow(c, label, value) {
    if (!value) return;
    var r = el("div", "fm-info");
    r.appendChild(el("div", "fm-info-k", label));
    r.appendChild(el("div", "fm-val", value));
    c.appendChild(r);
  }
  function link(label, url) {
    if (!/^https?:\/\/[^\s<>"]+$/i.test(url || "")) return null;
    var a = el("a", "fm-link", label);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function licCard(lic, fsLic, fsUrl) {
    var c = card(t("fm.lic"));
    c.appendChild(el("p", "hint", t("fm.lic.hint")));
    if (lic) {
      var e = el("div", "msg " + (lic.embed === "restricted" ? "msg-err" : "msg-dim"), t("fm.e." + lic.embed));
      c.appendChild(e);
      if (lic.noSubset) c.appendChild(el("p", "hint", t("fm.e.noSubset")));
      if (lic.bitmapOnly) c.appendChild(el("p", "hint", t("fm.e.bitmap")));
      c.appendChild(el("p", "fm-open fm-" + (lic.open ? "ok" : "no"), lic.kind ? t("fm.open." + lic.kind) : t("fm.open.no")));
    }
    if (fsLic) c.appendChild(el("p", "hint", t("fm.licFs", { id: fsLic })));
    if (lic) {
      infoRow(c, t("fm.copyright"), lic.copyright);
      infoRow(c, t("fm.designer"), lic.designer);
      infoRow(c, t("fm.maker"), lic.maker);
      infoRow(c, t("fm.version"), lic.version);
      if (lic.text) {
        var d = el("details", "fm-lictext");
        d.appendChild(el("summary", null, t("fm.licText")));
        d.appendChild(el("pre", null, lic.text));
        c.appendChild(d);
      }
      var a = link(t("fm.licUrl"), lic.url);
      if (a) { var p = el("p"); p.appendChild(a); c.appendChild(p); }
    }
    var b = fsUrl && link(t("fm.free.page"), fsUrl);
    if (b) { var p2 = el("p"); p2.appendChild(b); c.appendChild(p2); }
    return c;
  }
  function backBar(name) {
    var bar = el("div", "fm-head");
    var fromCol = S.from && CB && CB.get().cols[S.from] ? S.from : "";
    var b = btn("‹ " + t(fromCol && S.detail.kind !== "col" ? "fm.back.col" : "fm.back"), "btn fm-back", function () {
      S.detail = fromCol && S.detail.kind !== "col" ? { kind: "col", id: fromCol } : null;
      if (!S.detail) S.from = "";
      S.armed = false; draw(); scrollTop();
    });
    bar.appendChild(b);
    bar.appendChild(el("h2", "fm-title", name));
    return bar;
  }
  function drawDetail() {
    if (S.detail.kind === "free") { drawFreeDetail(); return; }
    if (S.detail.kind === "col") { drawColDetail(); return; }
    var f = (S.fams || []).filter(function (x) { return x.key === S.detail.key; })[0];
    if (!f) { S.detail = null; draw(); return; }
    rootEl.appendChild(backBar(f.name));
    var have = variants(f);
    var c = card(t("fm.sample"));
    specimen(c, function (v) { return '"' + cssFam(have[v].file) + '", var(--fm-ui, sans-serif)'; }, have);
    rootEl.appendChild(c);
    // the chosen style's face (the list loaded only the regular one)
    var cur = have[S.style] || f.main;
    inspectFile(cur.file).then(function (r) { if (r) loadFace(cssFam(cur.file), r.buf); });
    var slot = el("div", "fm-cards");
    rootEl.appendChild(slot);
    inspectFile(f.main.file).then(function (r) {
      if (!r || !slot.isConnected) return;
      slot.appendChild(covCard(r.cov, false));
      slot.appendChild(licCard(r.lic));
    });
    rootEl.appendChild(colsCard({ id: ufOf(f), name: f.name, fb: f.fb }));
    var fc = card(t("fm.files"));
    if (f.cff) fc.appendChild(el("p", "hint", t("fm.cff.hint")));
    f.files.forEach(function (r) {
      var row = el("div", "row");
      var h = el("div", "row-head");
      h.appendChild(el("div", "row-label", (r.sub || t("fm.st.r")) + " · " + (r.cff ? t("fm.file.cff") : t("fm.file.tt"))));
      h.appendChild(el("span", "fm-size-kb", Math.max(1, Math.round((r.size || 0) / 1024)) + " KB"));
      row.appendChild(h);
      fc.appendChild(row);
    });
    var rm = btn(S.armed ? t("fm.remove.sure") : t("fm.remove"), "btn danger" + (S.armed ? " armed" : ""), function () {
      if (!S.armed) { S.armed = true; draw(); return; }
      S.armed = false;
      rm.disabled = true;
      var files = f.files.map(function (r) { return r.file; });
      var chain = Promise.resolve(), ok = true;
      files.forEach(function (n) { chain = chain.then(function () { return DK.remove(n).then(function () { delete insp[n]; }, function () { ok = false; }); }); });
      chain.then(function () {
        S.detail = null;
        S.tab = "mine";
        S.msgs = [{ cls: ok ? "msg-ok" : "msg-err", text: ok ? t("fm.removed", { name: f.name }) : t("fm.removeFail") }];
        refresh();
        scrollTop();
      });
    });
    var acts = el("div", "actions");
    acts.appendChild(rm);
    fc.appendChild(acts);
    fc.appendChild(el("p", "hint", t("fm.remove.hint")));
    rootEl.appendChild(fc);
  }


  // ---------- Collections and notes (FM-2) ----------
  // A family of the disk as Layout and Atelier name it: uf_ + the
  // first 16 hex of its regular file (designkit/fonts.js families()).
  function ufOf(f) {
    var have = variants(f), r = have.r || have.b || have.i || have.bi || f.main;
    return DK.ufIdOf(r.file);
  }
  function colData() { return CB ? CB.get() : DK.cols.normalize(null); }
  function colEdit(fn) { if (CB) CB.edit(fn); }
  function nFonts(n) { return n === 0 ? t("fm.cols.n0") : n === 1 ? t("fm.cols.n1") : t("fm.cols.n", { n: n }); }
  function newColForm(onMade) {
    var f = el("form", "fm-newcol");
    var inp = el("input", "find-in");
    inp.type = "text"; inp.maxLength = DK.cols.LIM.name;
    inp.placeholder = t("fm.cols.name");
    inp.setAttribute("aria-label", t("fm.cols.name"));
    var go = el("button", "btn", t("fm.cols.create"));
    go.type = "submit";
    f.appendChild(inp); f.appendChild(go);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      var id = "";
      colEdit(function (d) { var r = DK.cols.add(d, name, Date.now(), undefined, LANG); id = r.id; return r.d; });
      if (id && onMade) onMade(id);
    });
    return f;
  }
  function colsCard(fam) {
    var c = card(t("fm.inCols"));
    if (!CB || !DK.cols) return c;
    var d = colData(), ids = DK.cols.order(d, LANG);
    if (ids.length) {
      c.appendChild(el("p", "hint", t("fm.inCols.hint")));
      var box = el("div", "fm-colchecks");
      ids.forEach(function (cid) {
        var lab = el("label", "chk-row fm-colchk");
        var cb = el("input");
        cb.type = "checkbox";
        var x = d.mem[cid + ":" + fam.id];
        cb.checked = !!(x && x.on);
        cb.addEventListener("change", function () {
          colEdit(function (dd) { return DK.cols.set(dd, cid, fam, cb.checked, Date.now()); });
        });
        lab.appendChild(cb);
        lab.appendChild(el("span", null, d.cols[cid].name));
        box.appendChild(lab);
      });
      c.appendChild(box);
    }
    c.appendChild(newColForm(function (cid) {
      colEdit(function (dd) { return DK.cols.set(dd, cid, fam, true, Date.now()); });
      draw();
    }));
    var lab2 = el("label", "fm-notel");
    lab2.appendChild(el("span", "fm-info-k", t("fm.note")));
    var ta = el("textarea", "fm-own fm-note");
    ta.rows = 3;
    ta.maxLength = DK.cols.LIM.note;
    ta.value = DK.cols.note(d, fam.id);
    var timer = 0;
    function save() { clearTimeout(timer); colEdit(function (dd) { return DK.cols.setNote(dd, fam.id, ta.value, Date.now()); }); }
    ta.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(save, 600); });
    ta.addEventListener("change", save);
    lab2.appendChild(ta);
    c.appendChild(lab2);
    c.appendChild(el("p", "hint", t("fm.note.hint")));
    return c;
  }
  function drawCols() {
    var c = card(t("fm.tab.cols"));
    c.appendChild(el("p", "hint", t("fm.cols.intro")));
    c.appendChild(newColForm(function (cid) { S.detail = { kind: "col", id: cid }; S.from = cid; S.armed = false; draw(); scrollTop(); }));
    rootEl.appendChild(c);
    listHost = null;
    var d = colData(), ids = DK.cols.order(d, LANG), list = el("div", "fm-list");
    if (!ids.length) list.appendChild(el("p", "hint", t("fm.cols.empty")));
    ids.forEach(function (cid) {
      var b = el("button", "fm-row");
      b.type = "button";
      b.appendChild(el("span", "fm-name fm-colname", d.cols[cid].name));
      b.appendChild(el("span", "fm-meta", nFonts(DK.cols.fams(d, cid, LANG).length)));
      b.addEventListener("click", function () { S.detail = { kind: "col", id: cid }; S.from = cid; S.armed = false; S.offline = null; draw(); scrollTop(); });
      list.appendChild(b);
    });
    rootEl.appendChild(list);
  }
  function openFam(fam, cid) {
    S.from = cid;
    S.style = "r"; S.armed = false;
    if (fam.id.indexOf("fs_") === 0) {
      S.detail = { kind: "free", id: fam.id };
      if (!S.free) {
        rootEl.textContent = "";
        rootEl.appendChild(el("p", "hint", t("fm.free.loading")));
        DK.catalog().then(function (list) {
          S.free = list && list.length ? list : null;
          S.freeErr = !S.free;
          if (!S.free) S.detail = { kind: "col", id: cid };
          draw(); scrollTop();
        });
        return;
      }
    } else {
      var f = (S.fams || []).filter(function (x) { return ufOf(x) === fam.id; })[0];
      if (!f) return;
      S.detail = { kind: "mine", key: f.key };
    }
    draw(); scrollTop();
  }
  function drawColDetail() {
    var d = colData(), cid = S.detail.id, col = d.cols[cid];
    if (!col) { S.detail = null; S.from = ""; S.tab = "cols"; draw(); return; }
    rootEl.appendChild(backBar(col.name));
    var c = card();
    var lab = el("label", "fm-notel");
    lab.appendChild(el("span", "fm-info-k", t("fm.col.rename")));
    var nm = el("input", "find-in");
    nm.type = "text"; nm.maxLength = DK.cols.LIM.name; nm.value = col.name;
    nm.addEventListener("change", function () {
      if (!nm.value.trim()) { nm.value = col.name; return; }
      colEdit(function (dd) { return DK.cols.rename(dd, cid, nm.value, Date.now()); });
      draw();
    });
    lab.appendChild(nm);
    c.appendChild(lab);
    rootEl.appendChild(c);
    var fams = DK.cols.fams(d, cid, LANG), list = el("div", "fm-list");
    if (!fams.length) list.appendChild(el("p", "hint", t("fm.col.empty")));
    var known = {};
    (S.fams || []).forEach(function (f) { known[ufOf(f)] = f; });
    fams.forEach(function (fam) {
      var r = el("div", "fm-row fm-colrow");
      var name = el("span", "fm-name", fam.name);
      var mineF = known[fam.id];
      if (mineF) name.style.fontFamily = '"' + cssFam(mineF.main.file) + '", var(--fm-ui, sans-serif)';
      else if (fam.id.indexOf("fs_") === 0) name.style.fontFamily = '"fs-' + fam.id.slice(3) + '", var(--fm-ui, sans-serif)';
      r.appendChild(name);
      var missing = fam.id.indexOf("uf_") === 0 && S.fams && !mineF;
      if (missing) r.appendChild(el("span", "hint", t("fm.col.missing")));
      var acts = el("div", "actions fm-colacts");
      if (!missing) acts.appendChild(btn(t("fm.col.open"), "btn", function () { openFam(fam, cid); }));
      acts.appendChild(btn(t("fm.col.out"), "btn", function () {
        colEdit(function (dd) { return DK.cols.set(dd, cid, fam, false, Date.now()); });
        draw();
      }));
      r.appendChild(acts);
      list.appendChild(r);
      if (fam.id.indexOf("fs_") === 0 && DK.fontsourceUrls) loadFace("fs-" + fam.id.slice(3), DK.fetcher(DK.fontsourceUrls(fam.id).r[0]));
    });
    rootEl.appendChild(list);
    // offline
    var oc = card(t("fm.col.offline"));
    oc.appendChild(el("p", "hint", t("fm.col.offline.hint")));
    var free = fams.filter(function (f) { return f.id.indexOf("fs_") === 0; });
    var msg = el("div", "msg msg-dim");
    function showOff() {
      var o = S.offline && S.offline.cid === cid ? S.offline : null;
      msg.hidden = !o;
      if (!o) return;
      msg.className = "msg " + (o.failed ? "msg-err" : o.end ? "msg-ok" : "msg-dim");
      msg.textContent = o.none ? t("fm.col.offline.none") : !o.end ? t("fm.col.offline.run", { done: o.done, total: o.total })
        : o.failed ? t("fm.col.offline.fail", { n: o.failed }) : t("fm.col.offline.done", { n: o.ok });
    }
    var go = btn(t("fm.col.offline"), "btn", function () {
      if (!free.length) { S.offline = { cid: cid, none: true, end: true }; showOff(); return; }
      go.disabled = true;
      var vars = {};
      (S.free || []).forEach(function (x) { vars[x.id] = x.vars; });
      S.offline = { cid: cid, done: 0, total: 0 };
      DK.cols.keepOffline(free.map(function (f) { return { id: f.id, vars: vars[f.id] }; }), function (dn, tot) {
        S.offline = { cid: cid, done: dn, total: tot }; if (msg.isConnected) showOff();
      }).then(function (res) {
        S.offline = { cid: cid, end: true, ok: res.ok, failed: res.failed };
        go.disabled = false;
        if (msg.isConnected) showOff();
      });
    });
    var ga = el("div", "actions");
    ga.appendChild(go);
    oc.appendChild(ga);
    oc.appendChild(msg);
    showOff();
    rootEl.appendChild(oc);
    // delete
    var dc = card();
    var rm = btn(S.armed ? t("fm.col.delete.sure") : t("fm.col.delete"), "btn danger" + (S.armed ? " armed" : ""), function () {
      if (!S.armed) { S.armed = true; draw(); return; }
      S.armed = false;
      var name = col.name;
      colEdit(function (dd) { return DK.cols.remove(dd, cid, Date.now()); });
      S.detail = null; S.from = ""; S.tab = "cols";
      S.msgs = [];
      draw();
      rootEl.insertBefore(el("div", "msg msg-ok", t("fm.col.deleted", { name: name })), rootEl.firstChild);
      scrollTop();
    });
    var da = el("div", "actions");
    da.appendChild(rm);
    dc.appendChild(da);
    dc.appendChild(el("p", "hint", t("fm.col.delete.hint")));
    rootEl.appendChild(dc);
  }

  // ---------- Free fonts (Fontsource) ----------
  function loadFree() {
    if (S.free || !DK) return;
    S.freeErr = false;
    DK.catalog().then(function (list) {
      S.free = list && list.length ? list : null;
      S.freeErr = !S.free;
      if (S.tab === "free") drawList();
    });
  }
  function drawFree() {
    var c = card(t("fm.free"));
    c.appendChild(el("p", "hint", t("fm.free.intro")));
    rootEl.appendChild(c);
    rootEl.appendChild(filterBar());
    listHost = el("div", "fm-list");
    rootEl.appendChild(listHost);
    drawList();
    loadFree();
  }
  var io = null;
  function previewWhenSeen(node, f) {
    if (typeof IntersectionObserver === "undefined") return;
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var id = e.target.getAttribute("data-fs");
        var urls = DK.fontsourceUrls(id).r;
        var name = "fs-" + id.slice(3);
        loadFace(name, DK.fetcher(urls[0]));   // the Latin file: enough to show the name
      });
    }, { rootMargin: "120px" });
    node.setAttribute("data-fs", f.id);
    io.observe(node);
  }
  function drawFreeList() {
    if (S.freeErr) { listHost.appendChild(el("p", "msg msg-dim", t("fm.free.offline"))); return; }
    if (!S.free) { listHost.appendChild(el("p", "hint", t("fm.free.loading"))); return; }
    var shown = S.free.filter(function (f) { return matches(f.family, f.greek, f.poly, f.cat); });
    if (!shown.length) { listHost.appendChild(el("p", "hint", t("fm.none"))); return; }
    listHost.appendChild(el("p", "hint fm-total", t("fm.free.count", { n: shown.length })));
    shown.slice(0, S.freeShown).forEach(function (f) {
      var b = el("button", "fm-row");
      b.type = "button";
      var name = el("span", "fm-name", f.family);
      name.style.fontFamily = '"fs-' + f.id.slice(3) + '", var(--fm-ui, sans-serif)';
      b.appendChild(name);
      var meta = el("span", "fm-meta");
      var list = [];
      if (f.greek) list.push(["ok", t("fm.b.greek")]); else list.push(["no", t("fm.b.noGreek")]);
      if (f.poly) list.push(["ok", t("fm.b.poly")]);
      if (f.lic) list.push(["lic", f.lic]);
      meta.appendChild(badgeRow(list));
      b.appendChild(meta);
      b.addEventListener("click", function () { S.from = ""; S.detail = { kind: "free", id: f.id }; S.style = "r"; draw(); scrollTop(); });
      listHost.appendChild(b);
      previewWhenSeen(b, f);
    });
    if (shown.length > S.freeShown) {
      var more = btn(t("fm.more"), "btn fm-more", function () { S.freeShown += PAGE; drawList(); });
      listHost.appendChild(more);
    }
  }
  // A Fontsource family's details (unicode ranges, licence), once.
  var fsInfo = {};
  function fontsourceInfo(id) {
    if (fsInfo[id]) return fsInfo[id];
    var slug = id.slice(3).replace(/_/g, "-");
    fsInfo[id] = fetch("https://api.fontsource.org/v1/fonts/" + encodeURIComponent(slug), { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" })
      .then(function (r) { if (!r.ok) throw new Error("fs " + r.status); return r.json(); })
      .then(function (j) { return j && typeof j === "object" ? j : {}; })
      .then(null, function () { delete fsInfo[id]; return {}; });
    return fsInfo[id];
  }
  var SUBS = ["latin", "latin-ext", "greek", "greek-ext"];
  var VAR_URL = { r: "r", b: "b", i: "i", bi: "bi" };
  function drawFreeDetail() {
    var f = (S.free || []).filter(function (x) { return x.id === S.detail.id; })[0];
    if (!f) { S.detail = null; draw(); return; }
    rootEl.appendChild(backBar(f.family));
    var c = card(t("fm.sample"));
    var styles = {};
    (f.vars && f.vars.length ? f.vars : ["r"]).forEach(function (v) { styles[v] = 1; });
    var famName = "fsd-" + f.id.slice(3);
    specimen(c, function (v) { return '"' + famName + "-" + v + '", var(--fm-ui, sans-serif)'; }, styles);
    var wait = el("p", "hint", t("fm.free.wait"));
    c.appendChild(wait);
    rootEl.appendChild(c);
    var slot = el("div", "fm-cards");
    rootEl.appendChild(slot);
    rootEl.appendChild(colsCard({ id: f.id, name: f.family, fb: f.cat }));
    var slug = f.id.slice(3).replace(/_/g, "-");
    var v = S.style;
    fontsourceInfo(f.id).then(function (j) {
      var ranges = (j && j.unicodeRange && typeof j.unicodeRange === "object") ? j.unicodeRange : {};
      var urls = DK.fontsourceUrls(f.id)[VAR_URL[v]] || [];
      var maps = [], lics = [], firstBuf = null;
      return Promise.all(SUBS.map(function (s, k) {
        if (f.subs && f.subs.indexOf(s) < 0) return null;
        return DK.fetcher(urls[k]).then(function (buf) {
          if (!buf) return null;
          var r = DK.inspect(buf);
          if (r) { maps.push(r.map); lics.push(r.lic); }
          if (!firstBuf && s === "latin") firstBuf = buf;
          if (typeof FontFace === "undefined") return null;
          var rng = typeof ranges[s] === "string" && /^[U+0-9A-Fa-f,\-\s?]+$/.test(ranges[s]) ? ranges[s] : undefined;
          var face = new FontFace(famName + "-" + v, buf, rng ? { unicodeRange: rng } : {});
          return face.load().then(function (ff) { document.fonts.add(ff); });
        }, function () { return null; });
      })).then(function () {
        if (!slot.isConnected) return;
        wait.remove();
        if (!maps.length) { slot.appendChild(el("p", "msg msg-dim", t("fm.free.fail"))); return; }
        var merged = {};
        maps.forEach(function (m) { Object.keys(m).forEach(function (cp) { merged[cp] = m[cp]; }); });
        slot.appendChild(covCard(DK.coverage({ map: merged }), false, f.subs || []));
        var lic = firstBuf ? DK.licence(firstBuf) : lics[0];
        slot.appendChild(licCard(lic, f.lic, "https://fontsource.org/fonts/" + encodeURIComponent(slug)));
      });
    }).then(null, function () { if (wait.isConnected) wait.textContent = t("fm.free.fail"); });
  }

  // ---------- Mount ----------
  function mount(h, ctx) {
    host = h;
    if (ctx && typeof ctx.t === "function") ctxT = ctx.t;
    // collections and notes: other devices and windows redraw the page
    // unless a field is being typed in
    if (!CB && DK && DK.cols) CB = DK.cols.bind(window, function () {
      var a = document.activeElement;
      if (!rootEl.isConnected || (a && rootEl.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      draw();
    });
    if (!rootEl.childNodes.length) {
      if (S.fams === null && !S.loading) refresh();
      else draw();
    }
    h.appendChild(rootEl);
  }

  window.SettingsFonts = { mount: mount, refresh: refresh, _state: S };
})();
