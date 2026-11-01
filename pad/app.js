// ============================================================
// orOS Pad — text and code editor (the app inside the shell frame)
// Engine: CodeMirror 6 (vendor/codemirror, MIT), core loaded by
// index.html, languages loaded when a tab needs one.
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   applyI18n → wire → inheritPalette → watchPalette → restore the
//   session → take a pending deep link.
// Data:
//   - documents are FILES: the orOS disk (/internal, synced by the
//     Vault like every disk file) or this device (orosDialog: the
//     browser's picker / download, or "This computer" on orOS USB);
//   - open tabs, unsaved text included, stay on this device only:
//     IndexedDB "oros-pad" (store "tabs"), order and active tab in
//     localStorage "oros-pad-session", settings "oros-pad-prefs".
//     Nothing registers with sync (no slice): Pad never uploads by
//     itself, a file goes up only when the person saves it.
// Save writes a file back where it came from: the orOS disk, This
// computer (orOS USB / Portable, pcdialog path API with ifmtime) or a
// file of this device with its File System Access handle (store
// "handles"). It checks first that the file is still the version Pad
// opened (size + time, then the bytes' hash, PAD-CF). When it changed
// in the meantime (another device, app or program), Pad never
// overwrites it: it offers a copy next to it, or opening the other
// version in a new tab. Recent files (disk, This computer) are in
// the session.
// A file is shown as text only. Pad never runs a file.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("pad/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "pad";
  var SESSION_KEY = "oros-pad-session";
  var PREFS_KEY = "oros-pad-prefs";
  var DB_NAME = "oros-pad";
  var DISK_ROOT = "/internal";
  var DEFAULT_DIR = "/internal/Documents";
  var MAX_BYTES = 50 * 1024 * 1024;     // larger files are not opened
  var BIG_BYTES = 10 * 1024 * 1024;     // asked first, opened as plain text
  var KEEP_RAW = 8 * 1024 * 1024;       // original bytes kept (this page only) for "Reopen with"
  var C = window.PadCore;
  var CM = window.OrosCM;

  // ---------- 1. Language ----------
  var STR = {
    en: {
      "app.name": "Pad",
      "aria.tabs": "Open files",
      "btn.new": "New", "btn.newTab": "New tab", "btn.open": "Open", "btn.save": "Save", "btn.find": "Find", "btn.more": "More",
      "btn.cancel": "Cancel", "btn.ok": "OK", "btn.close": "Close", "btn.closeTab": "Close {name}",
      "m.saveAs": "Save as…", "m.goto": "Go to line…", "m.replace": "Find and replace", "m.wrap": "Word wrap", "m.nums": "Line numbers",
      "m.ws": "Show spaces and tabs", "m.brackets": "Close brackets and quotes", "m.bigger": "Larger text", "m.smaller": "Smaller text",
      "m.closeTab": "Close tab", "m.closeOthers": "Close other saved tabs", "m.help": "Help",
      "m.recent": "Recent files…", "recent.title": "Recent files", "recent.none": "No recent files yet.",
      "recent.clear": "Clear the list", "recent.cleared": "The list of recent files is empty now.",
      "recent.gone": "{name} is no longer there.",
      "from.pc": "This computer", "from.pcSub": "A file in this computer's folders and disks",
      "pc.none": "This computer is not available here.",
      "where.pc": "This computer: {path}", "where.fsa": "On this device (saved in place)",
      "cf.title.pc": "{name} changed on this computer", "cf.title.fsa": "{name} changed on this device",
      "gone.pc": "{name} is no longer in that folder of this computer. Save it there again?",
      "gone.fsa": "{name} is no longer where it was on this device. Save it there again?",
      "perm.denied": "Pad may not write to this file. Use Save as to keep your text somewhere else.",
      "from.title": "Open from", "from.disk": "orOS disk", "from.diskSub": "Your files in orOS, synced and encrypted",
      "from.device": "This device", "from.deviceSub": "A file on this computer or phone",
      "to.title": "Save to", "to.diskSub": "Saved in orOS, follows you to your other devices",
      "to.deviceSub": "A file on this computer or phone",
      "disk.open": "Open from orOS disk", "disk.save": "Save to orOS disk", "disk.up": "Up one folder", "disk.empty": "This folder is empty.",
      "disk.name": "File name", "disk.newFolder": "New folder", "disk.folderName": "Folder name", "disk.loading": "Loading…",
      "disk.none": "The orOS disk is not available here.", "disk.fail": "The orOS disk could not be read.",
      "disk.exists": "{name} already exists in this folder. Replace it?", "disk.replace": "Replace",
      "disk.badName": "Give the file a name without / \\ : * ? \" < > |",
      "dirty.title": "Save changes to {name}?", "dirty.body": "Your changes are lost if you close without saving.",
      "dirty.save": "Save", "dirty.drop": "Don't save",
      "cf.title": "{name} changed on the orOS disk",
      "cf.body": "Since you opened it, the file was changed somewhere else (another device or another app). Pad does not overwrite it.",
      "cf.copy": "Save mine as a copy", "cf.theirs": "Open the other version in a new tab",
      "gone.body": "{name} is no longer on the orOS disk. Save it there again?",
      "big.title": "This file is large ({size})", "big.body": "Pad opens it as plain text, without colours, so it stays fast.", "big.open": "Open",
      "huge": "{name} is too large for Pad ({size}, at most 50 MB).",
      "bin.title": "{name} does not look like text", "bin.body": "It may be a picture, a program or an archive. Opened as text it shows odd characters, and saving it can damage it.",
      "bin.open": "Open anyway",
      "lang.title": "Language", "lang.auto": "Detect from the name", "lang.text": "Plain text",
      "ind.title": "Indentation", "ind.tabs": "Tabs", "ind.spaces": "Spaces", "ind.width": "Width",
      "ind.spacesN": "Spaces: {n}", "ind.tabsN": "Tab size: {n}", "ind.convert": "Change the whole file too",
      "eol.title": "Line endings", "eol.lf": "LF (Linux, macOS, web)", "eol.crlf": "CRLF (Windows)", "eol.cr": "CR (old Mac)",
      "eol.mixed": "This file had mixed line endings. Saving gives every line the same ending.",
      "enc.title": "Encoding", "enc.reopen": "Reopen with this encoding", "enc.saveWith": "Save with this encoding",
      "enc.hint": "Reopen reads the file again with another encoding, when its letters look wrong. Save with keeps the text and changes how it is written.",
      "enc.noRaw": "Reopen works for a file opened in this session and not changed yet.",
      "enc.bad": "\"{ch}\" (line {line}, column {col}) has no place in {enc}. Choose UTF-8, or remove that character.",
      "pos": "Ln {l}, Col {c}", "pos.sel": "Ln {l}, Col {c} ({n} selected)",
      "where.new": "Not saved yet", "where.device": "From this device", "where.disk": "orOS disk: {path}",
      "saved": "Saved", "saved.copy": "Saved as {name}", "saved.device": "Saved on this device",
      "save.fail": "Not saved: {why}", "open.fail": "Could not open {name}", "full": "This device is out of storage space. Your tabs could not be kept.",
      "untitled": "Untitled", "closed": "Tab closed",
      "goto.title": "Go to line", "goto.label": "Line (or line:column)", "goto.bad": "Write a line number from 1 to {n}.",
      "cm.Find": "Find", "cm.Replace": "Replace", "cm.next": "next", "cm.previous": "previous", "cm.all": "all",
      "cm.match case": "match case", "cm.regexp": "regexp", "cm.by word": "by word", "cm.replace": "replace",
      "cm.replace all": "replace all", "cm.close": "close", "cm.current match": "current match",
      "cm.replaced $ matches": "replaced $ matches", "cm.replaced match on line $": "replaced match on line $",
      "cm.on line": "on line", "cm.Go to line": "Go to line", "cm.go": "go",
      "cm.Folded lines": "Folded lines", "cm.Unfolded lines": "Unfolded lines", "cm.to": "to", "cm.folded code": "folded code",
      "cm.unfold": "unfold", "cm.Fold line": "Fold line", "cm.Unfold line": "Unfold line",
      "cm.Control character": "Control character", "cm.Selection deleted": "Selection deleted"
    },
    el: {
      "app.name": "Pad",
      "aria.tabs": "Ανοιχτά αρχεία",
      "btn.new": "Νέο", "btn.newTab": "Νέα καρτέλα", "btn.open": "Άνοιγμα", "btn.save": "Αποθήκευση", "btn.find": "Εύρεση", "btn.more": "Περισσότερα",
      "btn.cancel": "Ακύρωση", "btn.ok": "OK", "btn.close": "Κλείσιμο", "btn.closeTab": "Κλείσιμο {name}",
      "m.saveAs": "Αποθήκευση ως…", "m.goto": "Μετάβαση σε γραμμή…", "m.replace": "Εύρεση και αντικατάσταση", "m.wrap": "Αναδίπλωση γραμμών", "m.nums": "Αριθμοί γραμμών",
      "m.ws": "Εμφάνιση κενών και tab", "m.brackets": "Αυτόματο κλείσιμο αγκυλών και εισαγωγικών", "m.bigger": "Μεγαλύτερα γράμματα", "m.smaller": "Μικρότερα γράμματα",
      "m.closeTab": "Κλείσιμο καρτέλας", "m.closeOthers": "Κλείσιμο των άλλων αποθηκευμένων καρτελών", "m.help": "Βοήθεια",
      "m.recent": "Πρόσφατα αρχεία…", "recent.title": "Πρόσφατα αρχεία", "recent.none": "Δεν υπάρχουν ακόμη πρόσφατα αρχεία.",
      "recent.clear": "Καθαρισμός της λίστας", "recent.cleared": "Η λίστα με τα πρόσφατα αρχεία άδειασε.",
      "recent.gone": "Το {name} δεν υπάρχει πια εκεί.",
      "from.pc": "Αυτός ο υπολογιστής", "from.pcSub": "Ένα αρχείο στους φακέλους και τους δίσκους αυτού του υπολογιστή",
      "pc.none": "Ο υπολογιστής δεν είναι διαθέσιμος εδώ.",
      "where.pc": "Αυτός ο υπολογιστής: {path}", "where.fsa": "Σε αυτή τη συσκευή (αποθήκευση στη θέση του)",
      "cf.title.pc": "Το {name} άλλαξε σε αυτόν τον υπολογιστή", "cf.title.fsa": "Το {name} άλλαξε σε αυτή τη συσκευή",
      "gone.pc": "Το {name} δεν υπάρχει πια σε εκείνον τον φάκελο του υπολογιστή. Να αποθηκευτεί ξανά εκεί;",
      "gone.fsa": "Το {name} δεν υπάρχει πια εκεί που ήταν σε αυτή τη συσκευή. Να αποθηκευτεί ξανά εκεί;",
      "perm.denied": "Το Pad δεν έχει άδεια να γράψει σε αυτό το αρχείο. Με την Αποθήκευση ως κρατάς το κείμενό σου κάπου αλλού.",
      "from.title": "Άνοιγμα από", "from.disk": "Δίσκος orOS", "from.diskSub": "Τα αρχεία σου στο orOS, συγχρονισμένα και κρυπτογραφημένα",
      "from.device": "Αυτή η συσκευή", "from.deviceSub": "Ένα αρχείο σε αυτόν τον υπολογιστή ή το κινητό",
      "to.title": "Αποθήκευση σε", "to.diskSub": "Μένει στο orOS και σε ακολουθεί στις άλλες συσκευές σου",
      "to.deviceSub": "Ένα αρχείο σε αυτόν τον υπολογιστή ή το κινητό",
      "disk.open": "Άνοιγμα από τον δίσκο orOS", "disk.save": "Αποθήκευση στον δίσκο orOS", "disk.up": "Έναν φάκελο πάνω", "disk.empty": "Ο φάκελος είναι άδειος.",
      "disk.name": "Όνομα αρχείου", "disk.newFolder": "Νέος φάκελος", "disk.folderName": "Όνομα φακέλου", "disk.loading": "Φόρτωση…",
      "disk.none": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.", "disk.fail": "Ο δίσκος του orOS δεν διαβάστηκε.",
      "disk.exists": "Το {name} υπάρχει ήδη σε αυτόν τον φάκελο. Να αντικατασταθεί;", "disk.replace": "Αντικατάσταση",
      "disk.badName": "Δώσε στο αρχείο όνομα χωρίς / \\ : * ? \" < > |",
      "dirty.title": "Να αποθηκευτούν οι αλλαγές στο {name};", "dirty.body": "Αν κλείσεις χωρίς αποθήκευση, οι αλλαγές σου χάνονται.",
      "dirty.save": "Αποθήκευση", "dirty.drop": "Χωρίς αποθήκευση",
      "cf.title": "Το {name} άλλαξε στον δίσκο orOS",
      "cf.body": "Από τότε που το άνοιξες, το αρχείο άλλαξε κάπου αλλού (σε άλλη συσκευή ή σε άλλη εφαρμογή). Το Pad δεν το αντικαθιστά.",
      "cf.copy": "Αποθήκευση του δικού μου ως αντίγραφο", "cf.theirs": "Άνοιγμα της άλλης έκδοσης σε νέα καρτέλα",
      "gone.body": "Το {name} δεν υπάρχει πια στον δίσκο orOS. Να αποθηκευτεί ξανά εκεί;",
      "big.title": "Το αρχείο είναι μεγάλο ({size})", "big.body": "Το Pad το ανοίγει ως απλό κείμενο, χωρίς χρώματα, για να μένει γρήγορο.", "big.open": "Άνοιγμα",
      "huge": "Το {name} είναι πολύ μεγάλο για το Pad ({size}, έως 50 MB).",
      "bin.title": "Το {name} δεν μοιάζει με κείμενο", "bin.body": "Μπορεί να είναι εικόνα, πρόγραμμα ή συμπιεσμένο αρχείο. Ως κείμενο δείχνει παράξενους χαρακτήρες, και η αποθήκευση μπορεί να το χαλάσει.",
      "bin.open": "Άνοιγμα παρ' όλα αυτά",
      "lang.title": "Γλώσσα", "lang.auto": "Από το όνομα του αρχείου", "lang.text": "Απλό κείμενο",
      "ind.title": "Εσοχές", "ind.tabs": "Tab", "ind.spaces": "Κενά", "ind.width": "Πλάτος",
      "ind.spacesN": "Κενά: {n}", "ind.tabsN": "Μέγεθος tab: {n}", "ind.convert": "Αλλαγή και σε όλο το αρχείο",
      "eol.title": "Αλλαγές γραμμής", "eol.lf": "LF (Linux, macOS, web)", "eol.crlf": "CRLF (Windows)", "eol.cr": "CR (παλιό Mac)",
      "eol.mixed": "Το αρχείο είχε ανάμεικτες αλλαγές γραμμής. Με την αποθήκευση όλες οι γραμμές παίρνουν την ίδια.",
      "enc.title": "Κωδικοποίηση", "enc.reopen": "Ξανά άνοιγμα με αυτή την κωδικοποίηση", "enc.saveWith": "Αποθήκευση με αυτή την κωδικοποίηση",
      "enc.hint": "Το ξανά άνοιγμα διαβάζει το αρχείο με άλλη κωδικοποίηση, όταν τα γράμματα φαίνονται λάθος. Η αποθήκευση κρατά το κείμενο και αλλάζει τον τρόπο που γράφεται.",
      "enc.noRaw": "Το ξανά άνοιγμα γίνεται για αρχείο που άνοιξε σε αυτή τη συνεδρία και δεν έχει αλλάξει ακόμα.",
      "enc.bad": "Το «{ch}» (γραμμή {line}, στήλη {col}) δεν χωράει στην {enc}. Διάλεξε UTF-8 ή αφαίρεσε αυτόν τον χαρακτήρα.",
      "pos": "Γρ {l}, Στ {c}", "pos.sel": "Γρ {l}, Στ {c} ({n} επιλεγμένοι)",
      "where.new": "Δεν έχει αποθηκευτεί", "where.device": "Από αυτή τη συσκευή", "where.disk": "Δίσκος orOS: {path}",
      "saved": "Αποθηκεύτηκε", "saved.copy": "Αποθηκεύτηκε ως {name}", "saved.device": "Αποθηκεύτηκε σε αυτή τη συσκευή",
      "save.fail": "Δεν αποθηκεύτηκε: {why}", "open.fail": "Το {name} δεν άνοιξε", "full": "Ο χώρος της συσκευής γέμισε. Οι καρτέλες σου δεν κρατήθηκαν.",
      "untitled": "Χωρίς τίτλο", "closed": "Η καρτέλα έκλεισε",
      "goto.title": "Μετάβαση σε γραμμή", "goto.label": "Γραμμή (ή γραμμή:στήλη)", "goto.bad": "Γράψε αριθμό γραμμής από 1 έως {n}.",
      "cm.Find": "Εύρεση", "cm.Replace": "Αντικατάσταση", "cm.next": "επόμενο", "cm.previous": "προηγούμενο", "cm.all": "όλα",
      "cm.match case": "πεζά/κεφαλαία", "cm.regexp": "regex", "cm.by word": "ολόκληρη λέξη", "cm.replace": "αντικατάσταση",
      "cm.replace all": "αντικατάσταση όλων", "cm.close": "κλείσιμο", "cm.current match": "τρέχον εύρημα",
      "cm.replaced $ matches": "αντικαταστάθηκαν $", "cm.replaced match on line $": "αντικαταστάθηκε στη γραμμή $",
      "cm.on line": "στη γραμμή", "cm.Go to line": "Μετάβαση σε γραμμή", "cm.go": "μετάβαση",
      "cm.Folded lines": "Διπλωμένες γραμμές", "cm.Unfolded lines": "Ξεδιπλωμένες γραμμές", "cm.to": "έως", "cm.folded code": "διπλωμένος κώδικας",
      "cm.unfold": "ξεδίπλωμα", "cm.Fold line": "Δίπλωμα γραμμής", "cm.Unfold line": "Ξεδίπλωμα γραμμής",
      "cm.Control character": "Χαρακτήρας ελέγχου", "cm.Selection deleted": "Η επιλογή διαγράφηκε"
    }
  };

  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  if (window.orosI18n) window.orosI18n.table(STR, APP_ID, LANG);
  function t(k, vars) {
    var s = (STR[LANG] && STR[LANG][k]) || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function locale() { try { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); } catch (e) { return "en-GB"; } }
  function fmtSize(n) {
    var u = ["B", "KB", "MB", "GB"], i = 0;
    while (n >= 1024 && i < 3) { n /= 1024; i++; }
    var v = i ? n.toFixed(n < 10 ? 1 : 0) : String(n);
    try { v = Number(v).toLocaleString(locale()); } catch (e) {}
    return v + " " + u[i];
  }

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
    [].forEach.call(document.querySelectorAll(".tb"), function (b) {
      var l = b.querySelector(".lbl");
      if (l) b.title = l.textContent;
    });
    document.title = t("app.name") + " · orOS";
  }

  // CodeMirror's own words (search panel, go to line, folding).
  function phrases() {
    var out = {};
    Object.keys(STR.en).forEach(function (k) { if (k.indexOf("cm.") === 0) out[k.slice(3)] = t(k); });
    return out;
  }

  // ---------- 2. Icons (fixed markup) ----------
  var ICO = {
    "new": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/></svg>',
    open: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/></svg>',
    find: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    disk: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
    device: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>'
  };
  function paintIcons(rootEl) {
    [].forEach.call((rootEl || document).querySelectorAll("[data-ico]"), function (n) { n.innerHTML = ICO[n.getAttribute("data-ico")] || ""; });
  }

  // ---------- 3. Palette: follow the shell's theme and skin (G3) ----------
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

  // ---------- 4. Small DOM helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(label, cls, fn) {
    var b = el("button", cls || "chip", label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3200);
  }

  // A centred modal (R32). body(dlg, close) fills it; close(v) resolves.
  function modal(title, body, cls) {
    return new Promise(function (resolve) {
      var d = el("dialog", "pd-dlg" + (cls ? " " + cls : ""));
      var done = false;
      function close(v) {
        if (done) return;
        done = true;
        try { d.close(); } catch (e) {}
        d.remove();
        resolve(v);
        if (view) setTimeout(function () { view.focus(); }, 0);
      }
      var h = el("h2", "pd-title", title);
      h.id = "pd-t" + Math.random().toString(36).slice(2, 8);
      d.setAttribute("aria-labelledby", h.id);
      d.appendChild(h);
      d.addEventListener("cancel", function (e) { e.preventDefault(); close(null); });
      document.body.appendChild(d);
      body(d, close);
      d.showModal();
    });
  }
  // Buttons: [{ label, value, pri, danger }]. Resolves the value or null.
  function ask(title, text, buttons) {
    return modal(title, function (d, close) {
      if (text) d.appendChild(el("p", "pd-text", text));
      var row = el("div", "pd-btns");
      buttons.forEach(function (b) {
        row.appendChild(button(b.label, "chip" + (b.pri ? " pri" : "") + (b.danger ? " danger" : ""), function () { close(b.value); }));
      });
      row.appendChild(button(t("btn.cancel"), "chip", function () { close(null); }));
      d.appendChild(row);
    });
  }
  // A list of choices (two-line rows). Resolves the chosen value or null.
  function choose(title, rows, note) {
    return modal(title, function (d, close) {
      if (note) d.appendChild(el("p", "pd-text", note));
      var list = el("div", "pd-list");
      rows.forEach(function (r) {
        if (r.head) { list.appendChild(el("p", "pd-head", r.head)); return; }
        var b = el("button", "pd-row" + (r.on ? " on" : ""));
        b.type = "button";
        if (r.ico) { var i = el("span", "ico"); i.innerHTML = ICO[r.ico]; b.appendChild(i); }
        var txt = el("span", "pd-row-txt");
        txt.appendChild(el("span", "pd-row-main", r.label));
        if (r.sub) txt.appendChild(el("span", "pd-row-sub", r.sub));
        b.appendChild(txt);
        if (r.on) { var c = el("span", "ico on-mark"); c.innerHTML = ICO.check; b.appendChild(c); }
        b.addEventListener("click", function () { close(r.value); });
        list.appendChild(b);
      });
      d.appendChild(list);
      var row = el("div", "pd-btns");
      row.appendChild(button(t("btn.cancel"), "chip", function () { close(null); }));
      d.appendChild(row);
      var on = list.querySelector(".on") || list.querySelector(".pd-row");
      if (on) setTimeout(function () { on.focus(); }, 0);
    });
  }
  function promptText(title, label, value, validate) {
    return modal(title, function (d, close) {
      var f = el("form", "pd-form");
      var lab = el("label", "pd-lbl", label);
      var inp = el("input");
      inp.type = "text";
      inp.value = value || "";
      inp.autocomplete = "off";
      inp.spellcheck = false;
      lab.appendChild(inp);
      f.appendChild(lab);
      var err = el("p", "pd-err");
      err.setAttribute("role", "alert");
      f.appendChild(err);
      var row = el("div", "pd-btns");
      var ok = el("button", "chip pri", t("btn.ok"));
      ok.type = "submit";
      row.appendChild(ok);
      row.appendChild(button(t("btn.cancel"), "chip", function () { close(null); }));
      f.appendChild(row);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var msg = validate ? validate(inp.value) : "";
        if (msg) { err.textContent = msg; inp.focus(); return; }
        close(inp.value);
      });
      d.appendChild(f);
      setTimeout(function () { inp.focus(); inp.select(); }, 0);
    });
  }

  // ---------- 5. Shell APIs (guarded: ?standalone has none) ----------
  function shellFS() {
    try { var f = window.parent && window.parent !== window && window.parent.orosFS; return f && typeof f.write === "function" ? f : null; }
    catch (e) { return null; }
  }
  function shellDialog() {
    try { return (window.parent && window.parent !== window && window.parent.orosDialog) || null; }
    catch (e) { return null; }
  }
  // This computer on orOS USB / Portable (pcdialog.js): path reads and
  // writes with the launcher's ifmtime check.
  function pcApi() {
    try {
      var p = window.parent && window.parent !== window && window.parent.orosPcDialog;
      return p && typeof p.enabled === "function" && p.enabled() && typeof p.write === "function" ? p : null;
    } catch (e) { return null; }
  }
  // File System Access (desktop Chrome / Edge): a file chosen here keeps
  // its handle, so Save writes it again in place. Feature detection only.
  function fsaOk() { return typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function"; }
  function isHandle(h) { return !!h && typeof h === "object" && h.kind === "file" && typeof h.getFile === "function"; }
  function isAbort(e) { return !!e && e.name === "AbortError"; }
  function openDeviceFile() {
    var D = shellDialog();
    if (D && typeof D.openFile === "function") return Promise.resolve(D.openFile(""));
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] || null); });
      inp.addEventListener("cancel", function () { resolve(null); });
      inp.click();
    });
  }
  function saveDeviceFile(blob, name) {
    var D = shellDialog();
    if (D && typeof D.saveFile === "function") return Promise.resolve(D.saveFile({ blob: blob, filename: name, mime: blob.type }));
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
    return Promise.resolve({ ok: true, mode: "download" });
  }

  // ---------- 6. Preferences (this device) ----------
  var prefs = { wrap: false, nums: true, ws: false, brackets: true, size: 14, dir: DEFAULT_DIR };
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (!p || typeof p !== "object") return;
      ["wrap", "nums", "ws", "brackets"].forEach(function (k) { if (typeof p[k] === "boolean") prefs[k] = p[k]; });
      if (typeof p.size === "number" && p.size >= 10 && p.size <= 28) prefs.size = Math.round(p.size);
      if (typeof p.dir === "string" && /^\/internal(\/|$)/.test(p.dir) && p.dir.indexOf("..") < 0) prefs.dir = p.dir;
    } catch (e) {}
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  // ---------- 7. Session store (IndexedDB "oros-pad", this device) ----------
  // Store "tabs": one row per open tab (text included). Store "handles"
  // (since wave 2): { id, hdl } the File System Access handle of a tab,
  // read only when that tab saves, so a browser that cannot bring a
  // handle back never stops the tabs themselves from coming back.
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = function () {
          var names = req.result.objectStoreNames;
          if (!names.contains("tabs")) req.result.createObjectStore("tabs", { keyPath: "id" });
          if (!names.contains("handles")) req.result.createObjectStore("handles", { keyPath: "id" });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbP;
  }
  function dbAll() {
    return db().then(function (d) {
      if (!d) return [];
      return new Promise(function (resolve) {
        try {
          var r = d.transaction("tabs").objectStore("tabs").getAll();
          r.onsuccess = function () { resolve(r.result || []); };
          r.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      });
    });
  }
  function dbPut(rows, dels) {
    return db().then(function (d) {
      if (!d) return false;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction("tabs", "readwrite"), st = tx.objectStore("tabs");
          rows.forEach(function (r) { st.put(r); });
          (dels || []).forEach(function (id) { st.delete(id); });
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = tx.onabort = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    });
  }
  // A handle the browser cannot store is simply not kept (the tab
  // then saves through Save as after a restart).
  function handlePut(id, h) {
    return db().then(function (d) {
      if (!d) return false;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction("handles", "readwrite"), st = tx.objectStore("handles");
          if (h) st.put({ id: id, hdl: h }); else st.delete(id);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = tx.onabort = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    });
  }
  function handleGet(id) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        try {
          var r = d.transaction("handles").objectStore("handles").get(id);
          r.onsuccess = function () { resolve(r.result && isHandle(r.result.hdl) ? r.result.hdl : null); };
          r.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  // ---------- 8. Tabs ----------
  // tab = { id, name, lang, enc, eol, mixed, dirty, loc, state, raw, indent }
  var tabs = [];
  var active = null;
  var view = null;
  var recent = [];
  var pendingWrite = {}, pendingDel = {}, writeTimer = 0;

  function newId() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function tabById(id) { for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i]; return null; }
  function textOf(tab) { return tab.state.doc.toString(); }

  function schedulePersist(tab) {
    if (tab) pendingWrite[tab.id] = true;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushPersist, 700);
  }
  function flushPersist() {
    clearTimeout(writeTimer);
    var rows = [];
    Object.keys(pendingWrite).forEach(function (id) {
      var tab = tabById(id);
      if (!tab) return;
      var st = tab === active && view ? view.state : tab.state;
      var sel = st.selection.main;
      rows.push({ id: tab.id, name: tab.name, text: st.doc.toString(), lang: tab.lang, enc: tab.enc, eol: tab.eol,
        dirty: tab.dirty, loc: tab.loc, sel: { a: sel.anchor, h: sel.head },
        top: tab === active && view ? view.scrollDOM.scrollTop : (tab.top || 0), mtime: Date.now() });
    });
    var dels = Object.keys(pendingDel);
    pendingWrite = {}; pendingDel = {};
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ order: tabs.map(function (x) { return x.id; }), active: active ? active.id : "", recent: recent }));
    } catch (e) { toast(t("full")); }
    if (rows.length || dels.length) dbPut(rows, dels).then(function (ok) { if (!ok) toast(t("full")); });
  }

  // ---------- 9. CodeMirror setup ----------
  var comp = {};
  function compartments() {
    ["lang", "wrap", "nums", "ws", "brackets", "indent", "theme", "phrases", "ro"].forEach(function (k) { comp[k] = new CM.state.Compartment(); });
  }

  var V = CM.view, S = CM.state, L = CM.language, K = CM.commands, F = CM.search, A = CM.autocomplete;

  function langExt(tab) {
    var id = tab.big ? "text" : tab.lang;
    if (id === "text") return [];
    if (id === "eel2") return L.StreamLanguage.define(window.PadEel2);
    var f = CM.lang && CM.lang[id];
    return f ? f() : [];
  }
  function indentExt(tab) {
    var ind = tab.indent || { tabs: false, size: 4 };
    return [S.EditorState.tabSize.of(ind.size), L.indentUnit.of(ind.tabs ? "\t" : new Array(ind.size + 1).join(" "))];
  }
  function themeExt() {
    return V.EditorView.theme({ "&": { fontSize: prefs.size + "px" } });
  }

  function extensions(tab) {
    return [
      comp.nums.of(prefs.nums ? [V.lineNumbers(), L.foldGutter(), V.highlightActiveLineGutter()] : []),
      V.highlightSpecialChars(),
      K.history(),
      V.drawSelection(),
      V.dropCursor(),
      S.EditorState.allowMultipleSelections.of(true),
      L.indentOnInput(),
      L.syntaxHighlighting(CM.highlight.classHighlighter),
      L.bracketMatching(),
      comp.brackets.of(prefs.brackets ? A.closeBrackets() : []),
      V.rectangularSelection(),
      V.crosshairCursor(),
      V.highlightActiveLine(),
      F.highlightSelectionMatches(),
      F.search({ top: true }),
      S.Prec.highest(V.keymap.of(appKeys())),
      V.keymap.of([].concat(A.closeBracketsKeymap, K.defaultKeymap, F.searchKeymap, K.historyKeymap, L.foldKeymap, [K.indentWithTab])),
      comp.wrap.of(prefs.wrap ? V.EditorView.lineWrapping : []),
      comp.ws.of(prefs.ws ? [V.highlightWhitespace()] : []),
      comp.indent.of(indentExt(tab)),
      comp.lang.of(langExt(tab)),
      comp.theme.of(themeExt()),
      comp.phrases.of(S.EditorState.phrases.of(phrases())),
      comp.ro.of(S.EditorState.readOnly.of(false)),
      V.EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off", autocorrect: "off", "aria-label": tab.name }),
      V.EditorView.updateListener.of(onUpdate)
    ];
  }

  // Pad's own keys inside the editor, before CodeMirror's (Mod-g is
  // "find next" there; here it is Go to line, as in most editors).
  function appKeys() {
    function run(fn) { return function () { fn(); return true; }; }
    return [
      { key: "Mod-s", run: run(function () { save(); }), preventDefault: true },
      { key: "Mod-Shift-s", run: run(function () { saveAs(); }), preventDefault: true },
      { key: "Mod-o", run: run(onOpen), preventDefault: true },
      { key: "Mod-g", run: run(gotoLine), preventDefault: true },
      { key: "Alt-n", run: run(newTab), preventDefault: true },
      { key: "Alt-w", run: run(function () { if (active) closeTab(active); }), preventDefault: true }
    ];
  }

  function makeState(tab, text, sel) {
    var len = text.length;
    var a = Math.min(sel && sel.a || 0, len), h = Math.min(sel && sel.h || 0, len);
    return S.EditorState.create({ doc: text, selection: S.EditorSelection.single(a, h), extensions: extensions(tab) });
  }

  function onUpdate(u) {
    if (!active) return;
    if (u.docChanged) {
      if (!active.dirty) { active.dirty = true; paintTabs(); }
      schedulePersist(active);
    } else if (u.selectionSet) {
      schedulePersist(active);
    }
    if (u.docChanged || u.selectionSet) paintPos();
  }

  // Bring every pref-driven compartment of the shown state up to date.
  function refreshView() {
    if (!view || !active) return;
    view.dispatch({ effects: [
      comp.nums.reconfigure(prefs.nums ? [V.lineNumbers(), L.foldGutter(), V.highlightActiveLineGutter()] : []),
      comp.wrap.reconfigure(prefs.wrap ? V.EditorView.lineWrapping : []),
      comp.ws.reconfigure(prefs.ws ? [V.highlightWhitespace()] : []),
      comp.brackets.reconfigure(prefs.brackets ? A.closeBrackets() : []),
      comp.theme.reconfigure(themeExt()),
      comp.indent.reconfigure(indentExt(active)),
      comp.lang.reconfigure(langExt(active))
    ] });
  }

  // Language files load once, when a tab first needs them.
  var bundleP = {};
  function loadBundle(name) {
    if (!name) return Promise.resolve(true);
    if (bundleP[name]) return bundleP[name];
    bundleP[name] = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "../vendor/codemirror/cm-" + name + ".min.js" + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
      s.onload = function () { resolve(true); };
      s.onerror = function () { delete bundleP[name]; resolve(false); };
      document.head.appendChild(s);
    });
    return bundleP[name];
  }
  function ensureLang(tab) {
    var info = C.langInfo(tab.lang);
    if (!info.bundle || tab.big) return Promise.resolve();
    return loadBundle(info.bundle).then(function () {
      if (tab === active && view) view.dispatch({ effects: comp.lang.reconfigure(langExt(tab)) });
      else tab.state = tab.state.update({ effects: comp.lang.reconfigure(langExt(tab)) }).state;
    });
  }

  // ---------- 10. Tabs on screen ----------
  function paintTabs() {
    var box = $("tabs");
    box.textContent = "";
    tabs.forEach(function (tab) {
      var on = tab === active;
      var wrap = el("div", "tab" + (on ? " on" : "") + (tab.dirty ? " dirty" : ""));
      wrap.draggable = true;
      wrap.dataset.id = tab.id;
      var b = el("button", "tab-name");
      b.type = "button";
      if (on) b.setAttribute("aria-current", "true");
      b.title = whereText(tab);
      b.appendChild(el("span", "tab-dot"));
      b.appendChild(el("span", "tab-txt", tab.name));
      b.addEventListener("click", function () { activate(tab); });
      b.addEventListener("auxclick", function (e) { if (e.button === 1) { e.preventDefault(); closeTab(tab); } });
      var x = el("button", "tab-x");
      x.type = "button";
      x.innerHTML = ICO.x;
      x.setAttribute("aria-label", t("btn.closeTab", { name: tab.name }));
      x.addEventListener("click", function () { closeTab(tab); });
      wrap.appendChild(b);
      wrap.appendChild(x);
      wrap.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/x-pad-tab", tab.id); e.dataTransfer.effectAllowed = "move"; });
      wrap.addEventListener("dragover", function (e) { if ([].indexOf.call(e.dataTransfer.types, "text/x-pad-tab") >= 0) e.preventDefault(); });
      wrap.addEventListener("drop", function (e) {
        var id = e.dataTransfer.getData("text/x-pad-tab");
        var from = tabById(id);
        if (!from || from === tab) return;
        e.preventDefault();
        tabs.splice(tabs.indexOf(from), 1);
        var r = wrap.getBoundingClientRect();
        var at = tabs.indexOf(tab) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
        tabs.splice(at, 0, from);
        paintTabs();
        schedulePersist(null);
      });
      box.appendChild(wrap);
    });
    var cur = box.querySelector(".tab.on");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
    $("btn-save").classList.toggle("dirty", !!(active && active.dirty));
  }

  function whereText(tab) {
    if (!tab.loc) return t("where.new");
    if (tab.loc.kind === "disk" || tab.loc.kind === "pc") return whereOf(tab.loc);
    if (tab.loc.kind === "fsa" && (isHandle(tab.hdl) || tab.hdlStored)) return t("where.fsa");
    return t("where.device");
  }
  function whereOf(loc) {
    if (loc.kind === "pc") return t("where.pc", { path: loc.path });
    return t("where.disk", { path: loc.path.slice(DISK_ROOT.length) || "/" });
  }

  function paintPos() {
    if (!view || !active) return;
    var st = view.state, m = st.selection.main, line = st.doc.lineAt(m.head);
    var n = st.selection.ranges.reduce(function (s, r) { return s + (r.to - r.from); }, 0);
    var vars = { l: line.number.toLocaleString(locale()), c: (m.head - line.from + 1).toLocaleString(locale()), n: n.toLocaleString(locale()) };
    $("st-pos").textContent = t(n ? "pos.sel" : "pos", vars);
  }
  function paintStatus() {
    if (!active) return;
    paintPos();
    $("st-lang").textContent = langName(active.lang);
    var ind = active.indent || { tabs: false, size: 4 };
    $("st-indent").textContent = ind.tabs ? t("ind.tabsN", { n: ind.size }) : t("ind.spacesN", { n: ind.size });
    $("st-eol").textContent = active.eol.toUpperCase();
    $("st-enc").textContent = (C.encInfo(active.enc) || C.ENCODINGS[0]).name;
    $("st-where").textContent = whereText(active);
    $("st-where").title = whereText(active);
  }
  function langName(id) { return id === "text" ? t("lang.text") : C.langInfo(id).name; }

  function activate(tab) {
    if (!tab) return;
    if (active && view && active !== tab) {
      active.state = view.state;
      active.top = view.scrollDOM.scrollTop;
      schedulePersist(active);
    }
    active = tab;
    if (!view) {
      view = new V.EditorView({ state: tab.state, parent: $("editor") });
    } else {
      view.setState(tab.state);
    }
    refreshView();
    var top = tab.top || 0;
    requestAnimationFrame(function () { if (view) view.scrollDOM.scrollTop = top; });
    paintTabs();
    paintStatus();
    ensureLang(tab);
    schedulePersist(null);
    view.focus();
  }

  // A new tab. opts: { name, text, lang, enc, eol, mixed, loc, raw, dirty, big, sel, top, id }
  function addTab(opts) {
    var text = opts.text || "";
    var tab = {
      id: opts.id || newId(),
      name: C.safeName(opts.name, C.untitledName(t("untitled"), tabs.map(function (x) { return x.name; }))),
      lang: opts.lang || "text", enc: opts.enc || "utf-8", eol: opts.eol || "lf", mixed: !!opts.mixed,
      dirty: !!opts.dirty, loc: opts.loc || null, hdl: null, hdlStored: !!(opts.restored && opts.loc && opts.loc.kind === "fsa"),
      raw: opts.raw || null, big: !!opts.big,
      indent: C.detectIndent(text) || { tabs: false, size: 4 }, top: opts.top || 0, state: null
    };
    tab.state = makeState(tab, text, opts.sel);
    if (isHandle(opts.hdl)) setHandle(tab, opts.hdl);
    var at = active ? tabs.indexOf(active) + 1 : tabs.length;
    tabs.splice(at, 0, tab);
    schedulePersist(tab);
    return tab;
  }

  function newTab() { activate(addTab({})); }

  // The tab's device handle: kept in the "handles" store, read back only
  // when the tab saves (loadHandle).
  function setHandle(tab, h) {
    var had = tab.hdl || tab.hdlStored;
    tab.hdl = isHandle(h) ? h : null;
    tab.hdlStored = false;
    if (tab.hdl || had) handlePut(tab.id, tab.hdl);
  }
  function loadHandle(tab) {
    if (tab.hdl || !tab.hdlStored) return Promise.resolve(tab.hdl);
    tab.hdlStored = false;
    return handleGet(tab.id).then(function (h) {
      tab.hdl = h;
      // A handle that did not come back: the file is a plain copy now.
      if (!h && tab.loc && tab.loc.kind === "fsa") { tab.loc = { kind: "device" }; paintTabs(); paintStatus(); schedulePersist(tab); }
      return h;
    });
  }

  // An empty, never-saved tab is replaced when a file opens.
  function isBlank(tab) { return tab && !tab.loc && !tab.dirty && (tab === active && view ? view.state : tab.state).doc.length === 0; }

  function dropTab(tab) {
    var i = tabs.indexOf(tab);
    if (i < 0) return;
    tabs.splice(i, 1);
    delete pendingWrite[tab.id];
    pendingDel[tab.id] = true;
    if (tab.hdl || tab.hdlStored) handlePut(tab.id, null);
    if (tab === active) {
      active = null;
      if (!tabs.length) addTab({});
      activate(tabs[Math.min(i, tabs.length - 1)]);
    } else {
      paintTabs();
    }
    schedulePersist(null);
  }

  function closeTab(tab) {
    if (tab === active && view) tab.state = view.state;
    if (!tab.dirty) { dropTab(tab); return; }
    if (tab !== active) activate(tab);
    ask(t("dirty.title", { name: tab.name }), t("dirty.body"), [
      { label: t("dirty.save"), value: "save", pri: true },
      { label: t("dirty.drop"), value: "drop", danger: true }
    ]).then(function (v) {
      if (v === "drop") dropTab(tab);
      else if (v === "save") save(tab).then(function (ok) { if (ok) dropTab(tab); });
    });
  }

  function closeOthers() {
    tabs.slice().forEach(function (tab) { if (tab !== active && !tab.dirty) dropTab(tab); });
  }

  // ---------- 11. Opening ----------
  // bytes → a tab. src: { name, loc, hdl? }
  function openBytes(buf, src) {
    var bytes = new Uint8Array(buf);
    var size = bytes.length;
    if (size > MAX_BYTES) { toast(t("huge", { name: src.name, size: fmtSize(size) })); return Promise.resolve(null); }
    var steps = Promise.resolve(true);
    if (C.looksBinary(bytes)) {
      steps = steps.then(function () {
        return ask(t("bin.title", { name: src.name }), t("bin.body"), [{ label: t("bin.open"), value: true }]);
      });
    }
    var big = size > BIG_BYTES;
    if (big) {
      steps = steps.then(function (go) {
        if (!go) return null;
        return ask(t("big.title", { size: fmtSize(size) }), t("big.body"), [{ label: t("big.open"), value: true, pri: true }]);
      });
    }
    return steps.then(function (go) {
      if (!go) return null;
      var enc = C.detectEncoding(bytes, LANG === "el" ? "windows-1253" : "windows-1252");
      var raw = C.decode(bytes, enc);
      var eol = C.detectEol(raw);
      var text = C.toLf(raw);
      var firstLine = text.slice(0, 200).split("\n")[0];
      var replace = isBlank(active) ? active : null;
      var tab = addTab({ name: src.name, text: text, lang: C.guessLang(src.name, firstLine), enc: enc, eol: eol.eol, mixed: eol.mixed,
        loc: src.loc, hdl: src.hdl, raw: size <= KEEP_RAW ? bytes : null, big: big });
      if (replace) dropTab(replace);
      activate(tab);
      if (eol.mixed) toast(t("eol.mixed"));
      return tab;
    });
  }

  // Already open? Show that tab instead of a second copy.
  function findTab(loc) {
    for (var i = 0; i < tabs.length; i++) if (C.sameLoc(tabs[i].loc, loc)) return tabs[i];
    return null;
  }
  function locOf(kind, path, buf, mtime) {
    return { kind: kind, path: path, mtime: mtime || 0, size: buf.byteLength, h: C.hashBytes(new Uint8Array(buf)) };
  }
  function forgetRecent(loc) {
    recent = recent.filter(function (r) { return !C.sameLoc(r, loc); });
    schedulePersist(null);
  }

  function openDiskPath(path) {
    var fs = shellFS();
    if (!fs) { toast(t("disk.none")); return Promise.resolve(null); }
    var open = findTab({ kind: "disk", path: path });
    if (open) { activate(open); return Promise.resolve(open); }
    var name = C.baseName(path);
    var st = null;
    return Promise.resolve(fs.ready && fs.ready()).then(function () { return fs.stat(path); }).then(function (s) {
      st = s;
      if (s && s.size > MAX_BYTES) { toast(t("huge", { name: name, size: fmtSize(s.size) })); return null; }
      return fs.read(path);
    }).then(function (blob) {
      if (!blob) return null;
      return blob.arrayBuffer().then(function (buf) {
        return openBytes(buf, { name: name, loc: locOf("disk", path, buf, st && st.mtime) });
      });
    }).then(function (tab) {
      if (tab) { rememberDir(path.slice(0, path.lastIndexOf("/")) || DISK_ROOT); pushRecent(tab.loc); }
      return tab;
    }, function (e) {
      if (e && e.code === "ENOENT") { forgetRecent({ kind: "disk", path: path }); toast(t("recent.gone", { name: name })); }
      else toast(t("open.fail", { name: name }));
      return null;
    });
  }

  // A file of This computer (orOS USB / Portable) by its path.
  function openPcPath(path) {
    var P = pcApi();
    if (!P) { toast(t("pc.none")); return Promise.resolve(null); }
    var open = findTab({ kind: "pc", path: path });
    if (open) { activate(open); return Promise.resolve(open); }
    var name = C.baseName(path);
    return Promise.resolve(P.stat(path)).then(function (st) {
      if (st && st.size > MAX_BYTES) { toast(t("huge", { name: name, size: fmtSize(st.size) })); return null; }
      return Promise.resolve(P.read(path)).then(function (file) {
        return file.arrayBuffer().then(function (buf) {
          return openBytes(buf, { name: name, loc: locOf("pc", path, buf, file.lastModified || st && st.mtime) });
        });
      });
    }).then(function (tab) {
      if (tab) pushRecent(tab.loc);
      return tab;
    }, function (e) {
      if (e && e.code === "notfound") { forgetRecent({ kind: "pc", path: path }); toast(t("recent.gone", { name: name })); }
      else toast(t("open.fail", { name: name }));
      return null;
    });
  }

  // A file of this device with its handle (File System Access).
  function handleTab(h) {
    return tabs.reduce(function (p, x) {
      return p.then(function (hit) {
        if (hit || !isHandle(x.hdl) || typeof x.hdl.isSameEntry !== "function") return hit;
        return x.hdl.isSameEntry(h).then(function (same) { return same ? x : null; }, function () { return null; });
      });
    }, Promise.resolve(null));
  }
  function openHandle(h) {
    return handleTab(h).then(function (open) {
      if (open) { activate(open); return open; }
      return h.getFile().then(function (file) {
        if (file.size > MAX_BYTES) { toast(t("huge", { name: file.name, size: fmtSize(file.size) })); return null; }
        return file.arrayBuffer().then(function (buf) {
          return openBytes(buf, { name: file.name, hdl: h,
            loc: { kind: "fsa", mtime: file.lastModified || 0, size: buf.byteLength, h: C.hashBytes(new Uint8Array(buf)) } });
        });
      });
    }).then(null, function () { toast(t("open.fail", { name: h.name || "" })); return null; });
  }

  // A plain File (input picker, Open with, Files' copy): a copy, saved
  // again through Save as. On This computer pcdialog knows its path.
  function openFileObj(file) {
    if (!file) return Promise.resolve(null);
    if (file.size > MAX_BYTES) { toast(t("huge", { name: file.name, size: fmtSize(file.size) })); return Promise.resolve(null); }
    var P = pcApi(), o = P && typeof P.opened === "function" ? P.opened(file.name) : null;
    if (o && o.path) {
      var open = findTab({ kind: "pc", path: o.path });
      if (open) { activate(open); return Promise.resolve(open); }
    }
    return file.arrayBuffer().then(function (buf) {
      var loc = o && o.path ? locOf("pc", o.path, buf, o.mtime || file.lastModified) : { kind: "device" };
      return openBytes(buf, { name: file.name, loc: loc }).then(function (tab) {
        if (tab && loc.kind === "pc") pushRecent(loc);
        return tab;
      });
    }, function () { toast(t("open.fail", { name: file.name })); return null; });
  }

  function openDevice() {
    if (!pcApi() && fsaOk()) {
      return window.showOpenFilePicker({ multiple: false }).then(function (hs) {
        return hs && hs[0] ? openHandle(hs[0]) : null;
      }, function (e) { if (!isAbort(e)) toast(t("open.fail", { name: "" })); return null; });
    }
    return openDeviceFile().then(openFileObj);
  }

  function openRecent(r) {
    if (r.kind === "pc") return openPcPath(r.path);
    return openDiskPath(r.path);
  }
  // Recent files this page can reach now (the disk, This computer).
  function reachableRecent() {
    var fs = !!shellFS(), pc = !!pcApi();
    return recent.filter(function (r) { return r.kind === "disk" ? fs : pc; });
  }
  function recentRows(list) {
    return list.map(function (r) {
      return { value: r, label: C.baseName(r.path), sub: whereOf({ kind: r.kind, path: r.path.slice(0, r.path.lastIndexOf("/")) || "/" }), ico: "clock" };
    });
  }

  function deviceRow(save) {
    var pc = !!pcApi();
    return { value: "device", label: t(pc ? "from.pc" : "from.device"), sub: t(pc ? "from.pcSub" : (save ? "to.deviceSub" : "from.deviceSub")), ico: "device" };
  }
  function onOpen() {
    var rows = [];
    if (shellFS()) rows.push({ value: "disk", label: t("from.disk"), sub: t("from.diskSub"), ico: "disk" });
    rows.push(deviceRow(false));
    var rec = reachableRecent().filter(function (r) { return !findTab(r); }).slice(0, 5);
    if (rows.length === 1 && !rec.length) { openDevice(); return; }
    if (rec.length) rows = rows.concat([{ head: t("recent.title") }], recentRows(rec));
    choose(t("from.title"), rows).then(function (v) {
      if (v === "disk") diskBrowser("open").then(function (p) { if (p) openDiskPath(p); });
      else if (v === "device") openDevice();
      else if (v && typeof v === "object") openRecent(v);
    });
  }
  function onRecent() {
    var rec = reachableRecent();
    if (!rec.length) { toast(t("recent.none")); return; }
    choose(t("recent.title"), recentRows(rec).concat([{ value: "clear", label: t("recent.clear"), ico: "x" }])).then(function (v) {
      if (v === "clear") { recent = []; schedulePersist(null); toast(t("recent.cleared")); }
      else if (v && typeof v === "object") openRecent(v);
    });
  }

  // ---------- 12. The orOS disk browser (open / save as) ----------
  function rememberDir(dir) { prefs.dir = dir; savePrefs(); }

  function joinPath(dir, name) { return (dir === DISK_ROOT ? DISK_ROOT : dir) + "/" + name; }

  // kind "open" → resolves a file path; "save" → { path, exists }.
  function diskBrowser(kind, suggest) {
    var fs = shellFS();
    if (!fs) { toast(t("disk.none")); return Promise.resolve(null); }
    return modal(t(kind === "save" ? "disk.save" : "disk.open"), function (d, close) {
      d.classList.add("pd-disk");
      var bar = el("div", "dk-bar");
      var up = el("button", "chip icon");
      up.type = "button";
      up.innerHTML = ICO.up;
      up.setAttribute("aria-label", t("disk.up"));
      up.title = t("disk.up");
      var where = el("span", "dk-where");
      bar.appendChild(up);
      bar.appendChild(where);
      var mk = null;
      if (kind === "save") { mk = button(t("disk.newFolder"), "chip"); bar.appendChild(mk); }
      d.appendChild(bar);
      var list = el("ul", "dk-list");
      d.appendChild(list);
      var nameInp = null, err = el("p", "pd-err");
      err.setAttribute("role", "alert");
      if (kind === "save") {
        var lab = el("label", "pd-lbl", t("disk.name"));
        nameInp = el("input");
        nameInp.type = "text";
        nameInp.autocomplete = "off";
        nameInp.spellcheck = false;
        nameInp.value = suggest || "";
        lab.appendChild(nameInp);
        d.appendChild(lab);
      }
      d.appendChild(err);
      var row = el("div", "pd-btns");
      var ok = null;
      if (kind === "save") {
        ok = button(t("btn.save"), "chip pri", function () { submit(); });
        row.appendChild(ok);
        nameInp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      }
      row.appendChild(button(t("btn.cancel"), "chip", function () { close(null); }));
      d.appendChild(row);

      var cwd = DISK_ROOT, names = [], gen = 0;
      function go(path) {
        cwd = path;
        var my = ++gen;
        up.disabled = path === DISK_ROOT;
        where.textContent = path === DISK_ROOT ? "/" : path.slice(DISK_ROOT.length);
        list.textContent = "";
        list.appendChild(el("li", "hint", t("disk.loading")));
        Promise.resolve(fs.ready && fs.ready()).then(function () { return fs.ls(path); }).then(function (entries) {
          if (my !== gen) return;
          list.textContent = "";
          var items = (entries || []).filter(function (e) { return e && typeof e.name === "string" && e.name.charAt(0) !== "."; });
          names = items.map(function (e) { return e.name; });
          items.sort(function (a, b) { return (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || a.name.localeCompare(b.name, locale(), { numeric: true, sensitivity: "base" }); });
          if (!items.length) list.appendChild(el("li", "hint", t("disk.empty")));
          items.forEach(function (en) {
            var li = el("li");
            var b = el("button", "dk-item" + (en.dir ? " dir" : ""));
            b.type = "button";
            var i = el("span", "ico");
            i.innerHTML = en.dir ? ICO.folder : ICO.file;
            b.appendChild(i);
            b.appendChild(el("span", "dk-name", en.name));
            b.addEventListener("click", function () {
              var p = joinPath(path, en.name);
              if (en.dir) { go(p); return; }
              if (kind === "open") { close(p); return; }
              nameInp.value = en.name;
              nameInp.focus();
            });
            li.appendChild(b);
            list.appendChild(li);
          });
        }, function () {
          if (my !== gen) return;
          list.textContent = "";
          if (path !== DISK_ROOT && path === prefs.dir) { go(DISK_ROOT); return; }
          list.appendChild(el("li", "hint", t(path === DISK_ROOT ? "disk.empty" : "disk.fail")));
        });
      }
      up.addEventListener("click", function () { if (cwd !== DISK_ROOT) go(cwd.slice(0, cwd.lastIndexOf("/")) || DISK_ROOT); });
      if (mk) mk.addEventListener("click", function () {
        promptText(t("disk.newFolder"), t("disk.folderName"), "", function (v) {
          return C.safeName(v, "") === v.trim() && v.trim() ? "" : t("disk.badName");
        }).then(function (v) {
          if (!v) return;
          var p = joinPath(cwd, v.trim());
          fs.mkdir(p).then(function () { go(p); }, function () { toast(t("disk.fail")); });
        });
      });
      function submit() {
        var v = nameInp.value.trim();
        if (!v || C.safeName(v, "") !== v) { err.textContent = t("disk.badName"); nameInp.focus(); return; }
        var exists = names.some(function (n) { return n.toLowerCase() === v.toLowerCase(); });
        var path = joinPath(cwd, v);
        if (!exists) { rememberDir(cwd); close({ path: path, exists: false }); return; }
        ask(t("disk.exists", { name: v }), "", [{ label: t("disk.replace"), value: true, danger: true }]).then(function (yes) {
          if (yes) { rememberDir(cwd); close({ path: path, exists: true }); }
        });
      }
      var startDir = prefs.dir || DISK_ROOT;
      if (startDir === DEFAULT_DIR && kind === "save") {
        // The default folder may not exist yet: make it for a save.
        Promise.resolve(fs.ready && fs.ready()).then(function () { return fs.mkdir(DEFAULT_DIR); }).then(function () { go(DEFAULT_DIR); }, function () { go(DISK_ROOT); });
      } else {
        go(startDir);
      }
      if (nameInp) setTimeout(function () {
        nameInp.focus();
        var dot = nameInp.value.lastIndexOf(".");
        nameInp.setSelectionRange(0, dot > 0 ? dot : nameInp.value.length);
      }, 0);
    });
  }

  // ---------- 13. Saving ----------
  // text of the tab as the file wants it: its line endings and encoding.
  function fileBytes(tab) {
    var st = tab === active && view ? view.state : tab.state;
    var r = C.encode(C.withEol(st.doc.toString(), tab.eol), tab.enc);
    if (r.bad) {
      var ch = r.bad.ch;
      toast(t("enc.bad", { ch: /[\u0000-\u001F]/.test(ch) ? "U+" + ch.charCodeAt(0).toString(16).toUpperCase() : ch, line: r.bad.line, col: r.bad.col, enc: C.encInfo(tab.enc).name }));
      return null;
    }
    return r.bytes;
  }
  function mimeOf(tab) {
    var m = { json: "application/json", html: "text/html", css: "text/css", javascript: "text/javascript", xml: "application/xml", markdown: "text/markdown" };
    return (m[tab.lang] || "text/plain") + (/^utf-8/.test(tab.enc) ? ";charset=utf-8" : "");
  }

  function markSaved(tab, loc, bytes) {
    tab.dirty = false;
    tab.mixed = false;
    tab.raw = bytes && bytes.length <= KEEP_RAW ? bytes : null;
    if (loc) tab.loc = loc;
    if (tab.loc && tab.loc.kind !== "fsa" && (tab.hdl || tab.hdlStored)) setHandle(tab, null);
    pushRecent(tab.loc);
    paintTabs();
    paintStatus();
    schedulePersist(tab);
  }
  function pushRecent(loc) {
    if (loc && (loc.kind === "disk" || loc.kind === "pc")) recent = C.addRecent(recent, loc);
  }
  // A new name after a save: the language follows a telling extension.
  function renameTo(tab, name) {
    if (!name || name === tab.name) return;
    tab.name = C.safeName(name, tab.name);
    var g = C.guessLang(tab.name, "");
    if (g !== "text" && g !== tab.lang) { tab.lang = g; ensureLang(tab); }
  }
  function dirOf(path) { return path.slice(0, path.lastIndexOf("/")) || "/"; }

  // Write to the orOS disk and read back its size and time.
  function diskWrite(fs, path, bytes, tab) {
    var dir = path.slice(0, path.lastIndexOf("/"));
    var mk = dir && dir !== DISK_ROOT ? fs.mkdir(dir).catch(function () {}) : Promise.resolve();
    return mk.then(function () { return fs.write(path, new Blob([bytes], { type: mimeOf(tab) })); })
      .then(function () { return fs.stat(path).catch(function () { return null; }); })
      .then(function (st) {
        return { loc: { kind: "disk", path: path, mtime: st && st.mtime || Date.now(), size: st && st.size || bytes.length, h: C.hashBytes(bytes) }, name: C.baseName(path) };
      });
  }
  // This computer: the launcher refuses ("changed") when the file's time
  // is no longer ifm, so a change between the check and the write is
  // never overwritten either. ifm 0: refuses a file that is there.
  function pcWrite(path, bytes, tab, ifm) {
    return Promise.resolve(pcApi().write(path, new Blob([bytes], { type: mimeOf(tab) }), ifm || 0, false)).then(function (st) {
      return { loc: { kind: "pc", path: path, mtime: st && st.mtime || 0, size: st && st.size || bytes.length, h: C.hashBytes(bytes) }, name: C.baseName(path) };
    });
  }
  // File System Access: the person allows writing once per file and
  // session (asked on the first save, which is a click or Ctrl+S).
  function fsaPerm(h) {
    var o = { mode: "readwrite" };
    return Promise.resolve(typeof h.queryPermission === "function" ? h.queryPermission(o) : "granted").then(function (p) {
      if (p === "granted") return true;
      return typeof h.requestPermission === "function" ? h.requestPermission(o).then(function (q) { return q === "granted"; }) : false;
    }).then(function (ok) {
      if (!ok) { var e = new Error(t("perm.denied")); e.code = "denied"; throw e; }
    });
  }
  function fsaWrite(h, bytes, tab) {
    return fsaPerm(h).then(function () { return h.createWritable(); }).then(function (w) {
      return w.write(new Blob([bytes], { type: mimeOf(tab) })).then(function () { return w.close(); }, function (e) {
        try { w.abort(); } catch (x) { /* already closed */ }
        throw e;
      });
    }).then(function () { return h.getFile(); }).then(function (f) {
      return { loc: { kind: "fsa", mtime: f.lastModified || Date.now(), size: f.size, h: C.hashBytes(bytes) }, name: h.name, hdl: h };
    });
  }

  // Where a file lives decides how it is checked and written. PAD-CF:
  // Pad never overwrites a file that changed since it read it.
  //   stat(tab)            -> { size, mtime } | null (no longer there)
  //   read(tab)            -> ArrayBuffer of what is there now
  //   write(tab, bytes, m) -> { loc, name, hdl? } (m: the time just checked, 0 = gone)
  //   copy(tab, bytes)     -> { loc, name, hdl? } of a copy beside it, or null
  //   other(src)           -> opens what is there now in a new tab
  var DISK = {
    stat: function (tab) {
      return shellFS().stat(tab.loc.path).then(function (st) { return st && !st.dir ? { size: st.size, mtime: st.mtime } : null; },
        function (e) { if (e && e.code === "ENOENT") return null; throw e; });
    },
    read: function (tab) { return shellFS().read(tab.loc.path).then(function (b) { return b.arrayBuffer(); }); },
    write: function (tab, bytes) { return diskWrite(shellFS(), tab.loc.path, bytes, tab); },
    copy: function (tab, bytes) {
      var fs = shellFS(), dir = dirOf(tab.loc.path);
      return fs.ls(dir).then(function (entries) {
        return diskWrite(fs, joinPath(dir, C.copyName(tab.name, (entries || []).map(function (e) { return e.name; }))), bytes, tab);
      });
    },
    other: function (src) { return openDiskPath(src.path); }
  };
  var PC = {
    stat: function (tab) {
      return Promise.resolve(pcApi().stat(tab.loc.path)).then(function (st) { return st && !st.dir ? { size: st.size, mtime: st.mtime } : null; },
        function (e) { if (e && e.code === "notfound") return null; throw e; });
    },
    read: function (tab) { return Promise.resolve(pcApi().read(tab.loc.path)).then(function (f) { return f.arrayBuffer(); }); },
    write: function (tab, bytes, m) { return pcWrite(tab.loc.path, bytes, tab, m); },
    copy: function (tab, bytes) {
      var dir = dirOf(tab.loc.path);
      return Promise.resolve(pcApi().list(dir)).then(function (entries) {
        return pcWrite(dir.replace(/\/$/, "") + "/" + C.copyName(tab.name, (entries || []).map(function (e) { return e.name; })), bytes, tab, 0);
      });
    },
    other: function (src) { return openPcPath(src.path); }
  };
  var FSA = {
    stat: function (tab) {
      return fsaPerm(tab.hdl).then(function () { return tab.hdl.getFile(); }).then(function (f) { return { size: f.size, mtime: f.lastModified }; },
        function (e) { if (e && e.name === "NotFoundError") return null; throw e; });
    },
    read: function (tab) { return tab.hdl.getFile().then(function (f) { return f.arrayBuffer(); }); },
    write: function (tab, bytes) { return fsaWrite(tab.hdl, bytes, tab); },
    // No folder handle: the browser's own save window, beside the file.
    copy: function (tab, bytes) {
      return window.showSaveFilePicker({ suggestedName: C.copyName(tab.name, [tab.name]), startIn: tab.hdl }).then(function (h) {
        return fsaWrite(h, bytes, tab);
      }, function (e) { if (isAbort(e)) return null; throw e; });
    },
    other: function (src) { return openHandle(src.hdl); }
  };
  function backend(tab) {
    var k = tab.loc && tab.loc.kind;
    if (k === "disk" && shellFS()) return DISK;
    if (k === "pc" && pcApi()) return PC;
    if (k === "fsa" && isHandle(tab.hdl)) return FSA;
    return null;
  }

  // Changed since Pad read it? Same bytes with a new time (a sync that
  // wrote the same text) is not a change. { state: same|changed|gone, mtime }
  function changed(B, tab) {
    var loc = tab.loc;
    return B.stat(tab).then(function (st) {
      if (!st) return { state: "gone" };
      if (st.size === loc.size && (!loc.mtime || !st.mtime || st.mtime === loc.mtime)) return { state: "same", mtime: st.mtime };
      if (!loc.h) return { state: "changed" };
      return B.read(tab).then(function (buf) {
        return { state: C.hashBytes(new Uint8Array(buf)) === loc.h ? "same" : "changed", mtime: st.mtime };
      });
    }, function (e) {
      if (e && e.code === "denied") throw e;
      return { state: "changed" };
    });
  }
  function cfTitle(tab) { return t(tab.loc.kind === "disk" ? "cf.title" : "cf.title." + tab.loc.kind, { name: tab.name }); }
  function goneText(tab) { return t(tab.loc.kind === "disk" ? "gone.body" : "gone." + tab.loc.kind, { name: tab.name }); }

  function save(tab) {
    tab = tab || active;
    if (!tab) return Promise.resolve(false);
    if (!tab.loc) return saveAs(tab);
    if (tab.loc.kind === "fsa" && !tab.hdl && tab.hdlStored) return loadHandle(tab).then(function () { return save(tab); });
    var B = backend(tab);
    if (!B) return saveToDevice(tab);
    var bytes = fileBytes(tab);
    if (!bytes) return Promise.resolve(false);
    function put(m) {
      return B.write(tab, bytes, m).then(null, function (e) {
        // This computer: changed or created again between the check and the write.
        if (e && (e.code === "changed" || e.code === "exists")) return conflict(B, tab, bytes);
        throw e;
      });
    }
    return changed(B, tab).then(function (c) {
      if (c.state === "gone") {
        return ask(cfTitle(tab), goneText(tab), [{ label: t("btn.save"), value: true, pri: true }])
          .then(function (yes) { return yes ? put(0) : null; });
      }
      if (c.state === "changed") return conflict(B, tab, bytes);
      return put(c.mtime);
    }).then(function (r) {
      if (!r) return false;
      var asCopy = !!r.name && r.name !== tab.name;
      if (r.hdl && r.hdl !== tab.hdl) setHandle(tab, r.hdl);
      if (asCopy) renameTo(tab, r.name);
      markSaved(tab, r.loc, bytes);
      toast(asCopy ? t("saved.copy", { name: tab.name }) : t("saved"));
      return true;
    }, function (e) {
      toast(t("save.fail", { why: (e && (e.message || e.code)) || "?" }));
      return false;
    });
  }

  // Never overwrite a file that changed elsewhere (sync rule): a copy
  // next to it, or the other version in a new tab. Resolves a result or null.
  function conflict(B, tab, bytes) {
    return ask(cfTitle(tab), t("cf.body"), [
      { label: t("cf.copy"), value: "copy", pri: true },
      { label: t("cf.theirs"), value: "theirs" }
    ]).then(function (v) {
      if (v === "copy") return B.copy(tab, bytes);
      if (v === "theirs") {
        var src = { path: tab.loc.path, hdl: tab.hdl };
        // The other version opens beside it; this tab keeps the text, unsaved.
        tab.loc = null;
        setHandle(tab, null);
        tab.name = C.copyName(tab.name, tabs.map(function (x) { return x.name; }).concat([tab.name]));
        paintTabs();
        paintStatus();
        schedulePersist(tab);
        B.other(src);
        return null;
      }
      return null;
    });
  }

  // Save as on this device: This computer (pcdialog), the browser's save
  // window with a handle (File System Access), or a download.
  function saveToDevice(tab) {
    var bytes = fileBytes(tab);
    if (!bytes) return Promise.resolve(false);
    var P = pcApi();
    if (!P && fsaOk()) {
      return window.showSaveFilePicker({ suggestedName: tab.name }).then(function (h) {
        return fsaWrite(h, bytes, tab).then(function (r) {
          setHandle(tab, r.hdl);
          renameTo(tab, r.name);
          markSaved(tab, r.loc, bytes);
          toast(t("saved"));
          return true;
        });
      }).then(null, function (e) {
        if (!isAbort(e)) toast(t("save.fail", { why: (e && (e.message || e.code)) || "?" }));
        return false;
      });
    }
    return saveDeviceFile(new Blob([bytes], { type: mimeOf(tab) }), tab.name).then(function (r) {
      if (!r || !r.ok) return false;
      if (r.mode === "computer" && r.path) {
        renameTo(tab, C.baseName(r.path));
        return Promise.resolve(P && P.stat(r.path)).then(function (st) {
          markSaved(tab, { kind: "pc", path: r.path, mtime: st && st.mtime || 0, size: st && st.size || bytes.length, h: C.hashBytes(bytes) }, bytes);
          toast(t("saved"));
          return true;
        }, function () {
          markSaved(tab, { kind: "device" }, bytes);
          toast(t("saved"));
          return true;
        });
      }
      markSaved(tab, { kind: "device" }, bytes);
      toast(t("saved.device"));
      return true;
    }, function () { return false; });
  }

  function saveAs(tab) {
    tab = tab || active;
    if (!tab) return Promise.resolve(false);
    if (!shellFS()) return saveToDevice(tab);
    return choose(t("to.title"), [
      { value: "disk", label: t("from.disk"), sub: t("to.diskSub"), ico: "disk" },
      deviceRow(true)
    ]).then(function (v) {
      if (v === "device") return saveToDevice(tab);
      if (v !== "disk") return false;
      return diskBrowser("save", tab.name).then(function (pick) {
        if (!pick) return false;
        var bytes = fileBytes(tab);
        if (!bytes) return false;
        var other = findTab({ kind: "disk", path: pick.path });
        if (other && other !== tab) dropTab(other);
        return diskWrite(shellFS(), pick.path, bytes, tab).then(function (r) {
          renameTo(tab, r.name);
          markSaved(tab, r.loc, bytes);
          toast(t("saved"));
          return true;
        }, function (e) { toast(t("save.fail", { why: (e && (e.message || e.code)) || "?" })); return false; });
      });
    });
  }

  // ---------- 14. Status bar choices ----------
  function pickLang() {
    if (!active) return;
    var tab = active;
    var rows = [{ value: "auto", label: t("lang.auto"), sub: C.langInfo(C.guessLang(tab.name, view.state.doc.line(1).text)).name }];
    C.LANGS.forEach(function (l) { rows.push({ value: l.id, label: langName(l.id), on: l.id === tab.lang }); });
    choose(t("lang.title"), rows).then(function (v) {
      if (!v) return;
      tab.lang = v === "auto" ? C.guessLang(tab.name, view.state.doc.line(1).text) : v;
      if (tab.big) tab.big = false;
      view.dispatch({ effects: comp.lang.reconfigure(langExt(tab)) });
      ensureLang(tab);
      paintStatus();
      schedulePersist(tab);
    });
  }

  function pickIndent() {
    if (!active) return;
    var tab = active, cur = tab.indent || { tabs: false, size: 4 };
    var rows = [];
    [2, 4, 8].forEach(function (n) { rows.push({ value: "s" + n, label: t("ind.spacesN", { n: n }), on: !cur.tabs && cur.size === n }); });
    [4, 8, 2].forEach(function (n) { rows.push({ value: "t" + n, label: t("ind.tabsN", { n: n }), on: cur.tabs && cur.size === n }); });
    rows.push({ value: "conv", label: t("ind.convert"), sub: cur.tabs ? t("ind.spaces") : t("ind.tabs") });
    choose(t("ind.title"), rows).then(function (v) {
      if (!v) return;
      if (v === "conv") { convertIndent(tab, !cur.tabs, cur.size); return; }
      tab.indent = { tabs: v[0] === "t", size: Number(v.slice(1)) };
      view.dispatch({ effects: comp.indent.reconfigure(indentExt(tab)) });
      paintStatus();
    });
  }
  // Leading tabs ↔ spaces for the whole file (one undo step).
  function convertIndent(tab, toTabs, size) {
    var doc = view.state.doc, changes = [];
    for (var i = 1; i <= doc.lines; i++) {
      var line = doc.line(i), m = /^[ \t]+/.exec(line.text);
      if (!m) continue;
      var cols = 0;
      for (var j = 0; j < m[0].length; j++) cols = m[0][j] === "\t" ? (Math.floor(cols / size) + 1) * size : cols + 1;
      var rep = toTabs ? new Array(Math.floor(cols / size) + 1).join("\t") + new Array(cols % size + 1).join(" ") : new Array(cols + 1).join(" ");
      if (rep !== m[0]) changes.push({ from: line.from, to: line.from + m[0].length, insert: rep });
    }
    tab.indent = { tabs: toTabs, size: size };
    view.dispatch({ changes: changes, effects: comp.indent.reconfigure(indentExt(tab)) });
    paintStatus();
  }

  function pickEol() {
    if (!active) return;
    var tab = active;
    choose(t("eol.title"), ["lf", "crlf", "cr"].map(function (k) { return { value: k, label: t("eol." + k), on: tab.eol === k }; }),
      tab.mixed ? t("eol.mixed") : "").then(function (v) {
      if (!v || v === tab.eol) return;
      tab.eol = v;
      tab.dirty = true;
      paintTabs();
      paintStatus();
      schedulePersist(tab);
    });
  }

  function pickEnc() {
    if (!active) return;
    var tab = active;
    var canReopen = !!tab.raw && !tab.dirty;
    modal(t("enc.title"), function (d, close) {
      d.appendChild(el("p", "pd-text", t("enc.hint")));
      var list = el("div", "pd-radios");
      var chosen = tab.enc;
      C.ENCODINGS.forEach(function (e) {
        var lab = el("label", "pd-radio");
        var r = el("input");
        r.type = "radio";
        r.name = "pad-enc";
        r.value = e.id;
        r.checked = e.id === tab.enc;
        r.addEventListener("change", function () { chosen = e.id; });
        lab.appendChild(r);
        lab.appendChild(el("span", "", e.name));
        list.appendChild(lab);
      });
      d.appendChild(list);
      if (!canReopen) d.appendChild(el("p", "hint", t("enc.noRaw")));
      var row = el("div", "pd-btns");
      var re = button(t("enc.reopen"), "chip", function () { close({ how: "reopen", enc: chosen }); });
      re.disabled = !canReopen;
      row.appendChild(re);
      row.appendChild(button(t("enc.saveWith"), "chip pri", function () { close({ how: "save", enc: chosen }); }));
      row.appendChild(button(t("btn.cancel"), "chip", function () { close(null); }));
      d.appendChild(row);
    }).then(function (v) {
      if (!v) return;
      if (v.how === "reopen" && tab.raw) {
        var text = C.toLf(C.decode(tab.raw, v.enc));
        tab.enc = v.enc;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
        tab.dirty = false;
        paintTabs();
        paintStatus();
        schedulePersist(tab);
        return;
      }
      if (v.enc !== tab.enc) {
        tab.enc = v.enc;
        tab.dirty = true;
        paintTabs();
        paintStatus();
        schedulePersist(tab);
      }
    });
  }

  function gotoLine() {
    if (!active) return;
    var n = view.state.doc.lines;
    promptText(t("goto.title"), t("goto.label"), String(view.state.doc.lineAt(view.state.selection.main.head).number), function (v) {
      var m = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(v);
      return m && Number(m[1]) >= 1 && Number(m[1]) <= n ? "" : t("goto.bad", { n: n });
    }).then(function (v) {
      if (!v) return;
      var m = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?/.exec(v);
      var line = view.state.doc.line(Number(m[1]));
      var pos = Math.min(line.to, line.from + Math.max(0, (Number(m[2]) || 1) - 1));
      view.dispatch({ selection: { anchor: pos }, effects: V.EditorView.scrollIntoView(pos, { y: "center" }) });
      view.focus();
    });
  }

  // ---------- 15. Menu ----------
  function toggle(k) { prefs[k] = !prefs[k]; savePrefs(); refreshView(); }
  function fontSize(d) { prefs.size = Math.max(10, Math.min(28, prefs.size + d)); savePrefs(); refreshView(); }

  function menuItems() {
    return [
      { label: t("m.saveAs"), fn: function () { saveAs(); } },
      { label: t("m.recent"), fn: onRecent },
      { label: t("m.replace"), fn: function () { F.openSearchPanel(view); } },
      { label: t("m.goto"), fn: gotoLine },
      null,
      { label: t("m.wrap"), on: prefs.wrap, fn: function () { toggle("wrap"); } },
      { label: t("m.nums"), on: prefs.nums, fn: function () { toggle("nums"); } },
      { label: t("m.ws"), on: prefs.ws, fn: function () { toggle("ws"); } },
      { label: t("m.brackets"), on: prefs.brackets, fn: function () { toggle("brackets"); } },
      { label: t("m.bigger"), fn: function () { fontSize(1); }, keep: true },
      { label: t("m.smaller"), fn: function () { fontSize(-1); }, keep: true },
      null,
      { label: t("m.closeTab"), fn: function () { closeTab(active); } },
      { label: t("m.closeOthers"), fn: closeOthers },
      { label: t("m.help"), fn: openHelp }
    ];
  }
  function openHelp() {
    try { if (window.parent && window.parent !== window && typeof window.parent.__orosOpenAt === "function") { window.parent.__orosOpenAt("help", { app: APP_ID }); return; } } catch (e) {}
  }
  function closeMenu() {
    var m = $("menu");
    if (m.hidden) return;
    m.hidden = true;
    $("btn-menu").setAttribute("aria-expanded", "false");
  }
  function openMenu() {
    var m = $("menu");
    if (!m.hidden) { closeMenu(); return; }
    m.textContent = "";
    menuItems().forEach(function (it) {
      if (!it) { m.appendChild(el("div", "sep")); return; }
      var b = el("button", "mi");
      b.type = "button";
      b.setAttribute("role", it.on === undefined ? "menuitem" : "menuitemcheckbox");
      if (it.on !== undefined) b.setAttribute("aria-checked", it.on ? "true" : "false");
      var c = el("span", "mi-check");
      if (it.on) c.innerHTML = ICO.check;
      b.appendChild(c);
      b.appendChild(el("span", "", it.label));
      b.addEventListener("click", function () {
        if (!it.keep) closeMenu();
        it.fn();
        if (it.on !== undefined) { it.on = !it.on; b.setAttribute("aria-checked", it.on ? "true" : "false"); c.innerHTML = it.on ? ICO.check : ""; }
      });
      m.appendChild(b);
    });
    m.hidden = false;
    $("btn-menu").setAttribute("aria-expanded", "true");
    var first = m.querySelector(".mi");
    if (first) first.focus();
  }

  // ---------- 16. Wiring ----------
  function wire() {
    paintIcons();
    $("btn-new").addEventListener("click", newTab);
    $("btn-add").addEventListener("click", newTab);
    $("btn-open").addEventListener("click", onOpen);
    $("btn-save").addEventListener("click", function () { save(); });
    $("btn-find").addEventListener("click", function () { if (view) F.openSearchPanel(view); });
    $("btn-menu").addEventListener("click", function (e) { e.stopPropagation(); openMenu(); });
    $("st-lang").addEventListener("click", pickLang);
    $("st-indent").addEventListener("click", pickIndent);
    $("st-eol").addEventListener("click", pickEol);
    $("st-enc").addEventListener("click", pickEnc);
    document.addEventListener("click", function (e) { if (!$("menu").contains(e.target)) closeMenu(); });
    $("menu").addEventListener("keydown", function (e) {
      var items = [].slice.call($("menu").querySelectorAll(".mi")), i = items.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); $("btn-menu").focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });

    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // App keys (e.code, never e.key). Ctrl+N / Ctrl+W / Ctrl+T belong to
    // the browser, so new and close tab are Alt+N and Alt+W.
    document.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.altKey && e.shiftKey) return;
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (mod && !e.altKey && e.code === "KeyS") { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); return; }
      if (mod && !e.altKey && !e.shiftKey && e.code === "KeyO") { e.preventDefault(); onOpen(); return; }
      if (mod && !e.altKey && !e.shiftKey && e.code === "KeyG") { e.preventDefault(); gotoLine(); return; }
      if (e.altKey && !mod && !e.shiftKey && e.code === "KeyN") { e.preventDefault(); newTab(); return; }
      if (e.altKey && !mod && !e.shiftKey && e.code === "KeyW") { e.preventDefault(); if (active) closeTab(active); return; }
      if (e.altKey && !mod && (e.code === "PageDown" || e.code === "PageUp")) {
        e.preventDefault();
        var i = tabs.indexOf(active), n = tabs.length;
        activate(tabs[(i + (e.code === "PageDown" ? 1 : n - 1)) % n]);
      }
    });
    window.addEventListener("pagehide", flushPersist);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushPersist(); });
  }

  // ---------- 17. Deep links ----------
  // { newText: { text, name?, lang? } }  a new tab with that text (other
  //   apps, the Assistant); nothing is saved until the person saves.
  // { openPath: "/internal/…" }            open a file of the orOS disk
  //   (Files' "Open with Pad"; saved again in place).
  // { openFile: { token, name, size } }    a File handed over by the shell
  //   (BR-FO-4): a copy, saved through Save as.
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object") return;
    if (target.newText && typeof target.newText === "object" && typeof target.newText.text === "string") {
      var nt = target.newText;
      var text = C.toLf(nt.text.slice(0, MAX_BYTES));
      var name = typeof nt.name === "string" ? C.safeName(nt.name) : "";
      var lang = typeof nt.lang === "string" && C.langInfo(nt.lang).id === nt.lang ? nt.lang : C.guessLang(name, text.split("\n", 1)[0]);
      var replace = isBlank(active) ? active : null;
      var tab = addTab({ name: name, text: text, lang: lang, dirty: true });
      if (replace) dropTab(replace);
      activate(tab);
      return;
    }
    if (typeof target.openPath === "string" && /^\/internal\/./.test(target.openPath) && target.openPath.indexOf("..") < 0) {
      openDiskPath(target.openPath);
      return;
    }
    // "Open with" from the system or Files (BR-FO-4): a one-shot File.
    if (target.openFile && typeof target.openFile === "object" && typeof target.openFile.token === "string") {
      var file = null;
      try { file = window.parent.__orosTakeFile(target.openFile.token); } catch (e) { file = null; }
      if (file) openFileObj(file);
    }
  };

  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget("pad");
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 18. Restore the session ----------
  function restore() {
    var sess = { order: [], active: "", recent: [] };
    try { sess = C.cleanSession(JSON.parse(localStorage.getItem(SESSION_KEY) || "null")); } catch (e) {}
    recent = sess.recent;
    return dbAll().then(function (rows) {
      var byId = {};
      rows.forEach(function (raw) {
        var r = C.cleanTab(raw);
        if (r) byId[r.id] = r;
      });
      var order = sess.order.filter(function (id) { return byId[id]; });
      // Tabs in the store but not in the order (a crash between writes) come last.
      Object.keys(byId).sort().forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
      order.forEach(function (id) {
        var r = byId[id];
        var tab = addTab({ id: r.id, name: r.name, text: r.text, lang: r.lang, enc: r.enc, eol: r.eol, dirty: r.dirty, loc: r.loc, restored: true, sel: r.sel, top: r.top, big: r.text.length > BIG_BYTES });
        tabs.splice(tabs.indexOf(tab), 1);
        tabs.push(tab);
      });
      pendingWrite = {};
      if (!tabs.length) addTab({});
      activate(tabById(sess.active) || tabs[0]);
    });
  }

  // ---------- 19. Boot (last, after every declaration) ----------
  function boot() {
    if (!CM || !C) { document.body.textContent = "Pad: the editor files did not load."; return; }
    compartments();
    loadPrefs();
    applyI18n();
    wire();
    inheritPalette();
    watchPalette();
    restore().then(takePending);
  }
  boot();
})();
