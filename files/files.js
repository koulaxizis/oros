// ============================================================
// orOS Files — App logic (v0.5, Wave 2 + Wave 3 fixes)
// ------------------------------------------------------------
// ALL file operations go through window.parent.orosFS (fs.js).
// View preferences + Recents journal live in localStorage:
//   • "oros-files-data"      (view prefs — device-local)
//   • "oros-files-recents"   (recents journal — device-local)
// Both oros- prefixed → factory-reset sweep catches them.
//
// Wave 2 additions:
//   • Drag & drop import (text + binary, overwrite dialog)
//   • Multi-select (Ctrl/Cmd click, Shift click) + bulk delete
//   • Move / Copy between folders (drag-to-tree + dialogs)
//   • Single file export (Blob download)
//   • Recursive search (current folder + subfolders, 100 cap)
//   • Copy name/path/content to clipboard
//   • Recents section on root (last 10)
// All new UI is JS-injected (search box, context menu, action
// bar) — files/index.html stays untouched from Wave 1.
// Sections:
//   1. Constants, i18n, helpers
//   2. View state + persistence (+ recents journal)
//   3. FS bridge (orosFS access + availability guard)
//   4. Navigation + render orchestration
//   5. Folder tree render (lazy, expanded set, DROP TARGETS)
//   6. Entry list render (+ MULTI selection)
//   7. Breadcrumbs + status bar
//   8. Dialogs (create / rename / delete / overwrite / move-copy)
//   9. Drag & drop IMPORT (desktop drop + file picker)
//  10. Download / clipboard helpers
//  11. Search
//  12. Recents
//  13. Context menu
//  14. Mobile tree drawer
//  15. Toast
//  16. Palette + shell shortcut forwarding
//  17. Wiring & boot
// Coding style: ES5 + promises, matching shell.js/fs.js/todo.js.
// ============================================================
(function () {
  "use strict";

  var APP_VER = "0.5";                              // #14 FIX: align with URL params
  var STORAGE_KEY = "oros-files-data";
  var RECENTS_KEY = "oros-files-recents";
  var DATA_VER = 1;
  var ROOT = "/internal";
  var RECENTS_MAX = 10;
  var SEARCH_CAP = 100;
  var STORAGE_CACHE_KEY = "oros-files-storage-cache";
  var STORAGE_TTL = 5 * 60 * 1000; // 5 minutes TTL
  // Disk-sync meta (device-local, oros- prefixed → factory-reset sweep)
  var SYNC_META_KEY = "oros-files-disk-meta";
  var SYNC_SLICE_KEY = "files-disk";

  // ---------- 1. Constants, i18n, helpers ----------

  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "tree.root":    "Files",
      "tree.toggle":  "Show folders",
      "nav.up":       "Go to parent folder",
      "act.newFolder":"New folder",
      "act.newFile":  "New file",
      "act.rename":   "Rename",
      "act.delete":   "Delete",
      "act.search":   "Search files and folders",
      "act.more":     "More actions",
      "empty.title":  "This folder is empty",
      "empty.hint":   "Create a file or folder with the buttons above.",
      "dlg.createFolder": "New folder",
      "dlg.createFile":   "New file",
      "dlg.rename":       "Rename",
      "dlg.nameLabel":    "Name",
      "dlg.cancel":   "Cancel",
      "dlg.ok":       "Create",
      "dlg.save":     "Save",
      "dlg.deleteTitle":    "Delete",
      "dlg.deleteConfirm":  "Delete",
      "dlg.deleteFileMsg":   "Delete \"{name}\"?",
      "dlg.deleteFolderMsg": "Delete \"{name}\" and everything inside it?",
      "dlg.deleteMultiMsg":  "Delete {n} selected items permanently?",
      "dlg.overwriteTitle": "Already exists",
      "dlg.overwriteMsg":   "\"{name}\" already exists in this folder. Overwrite it?",
      "dlg.overwriteOk":    "Overwrite",
      "dlg.keepBoth":       "Keep both",
      "dlg.moveTitle":      "Move items",
      "dlg.copyTitle":      "Copy items",
      "dlg.pickerLabel":    "Choose destination folder",
      "dlg.move":     "Move",
      "dlg.copy":     "Copy",
      "err.required": "Please enter a name.",
      "err.chars":    "The name can't contain: / \\ : * ? \" < > |",
      "err.exists":   "Something with this name already exists here.",
      "err.nameTaken":"A file or folder with this name already exists at the destination.",
      "err.readBin":  "This file couldn't be read.",
      "toast.createdFolder": "Folder created",
      "toast.createdFile":   "File created",
      "toast.renamed":       "Renamed",
      "toast.deleted":       "Deleted",
      "toast.deletedMulti":  "{n} items deleted",
      "toast.movedMulti":    "{n} items moved",
      "toast.copiedMulti":   "{n} items copied",
      "toast.movedSingle":   "Moved to \"{dst}\"",
      "toast.copiedSingle":  "Copied to \"{dst}\"",
      "toast.imported":      "Imported {n} file(s)",
      "toast.importFail":    "Import failed",
      "toast.skippedDupes":  "{n} skipped (kept both)",
      "toast.downloaded":    "Download started",
      "toast.downloadFail":  "Download failed",
      "toast.copiedClip":    "Copied to clipboard",
      "toast.clipFail":      "Clipboard unavailable",
      "toast.opFail":        "Operation failed",
      "toast.sameFolder":    "Destination is the same folder",
      "toast.intoItself":    "Can't move a folder into itself",
      "toast.fsMissing":     "The orOS file system is not available.",
      "status.loading": "Loading…",
      "status.items":   "{n} items",
      "status.oneItem": "1 item",
      "status.selItems":"{n} of {t} selected",
      "search.placeholder": "Search in this folder…",
      "search.clear":  "Clear search",
      "search.results": "Results",
      "search.none":   "No matches found",
      "search.where":  "in {path}",
      "recents.title": "Recent files",
      "recents.empty": "No recent activity yet",
      "status.justNow":    "just now",                      // #12 FIX: was Greek in EN
	  "ago.minutes": "{n}m ago",
      "ago.hours":   "{n}h ago",
      "ago.days":    "{n}d ago",
      "sort.name":         "Sort by name",
      "sort.size":         "Sort by size",
      "sort.date":         "Sort by date",
      "sort.asc":          "Ascending",
      "sort.desc":         "Descending",
      "storage.title":     "Storage",
      "storage.used":      "{n} KB used",
      "storage.calc":      "Calculating…",
      "col.name":          "Name",
      "col.size":          "Size",
      "col.date":          "Modified",
      "ui.hint":           "Tip",
      "sync.state.off":     "Disk sync unavailable",
      "sync.state.synced":  "Disk synced",
      "sync.state.pending": "Changes pending sync",
      "sync.conflictTitle": "Sync conflict",
      "sync.conflictLocal": "Keep local",
      "sync.conflictRemote":"Take cloud version",
      "sync.conflictMsg":   "Your disk changed locally and in the cloud since the last sync. Keep the local version or take the cloud one?",
      "sync.restored":      "Disk restored from cloud",
      "sync.restoreFail":   "Could not restore disk from cloud",
      "sync.snapshotFail":  "Could not build disk snapshot",
      "pv.title":        "Preview",
      "pv.edit":         "Edit",
      "pv.previewMd":    "Live preview",
      "pv.editSource":   "Source",
      "pv.save":         "Save",
      "pv.saved":        "Saved",
      "pv.close":        "Close preview",
      "pv.editHint":     "Editing text file — changes apply directly to the virtual disk.",
      "pv.binary":       "Binary file — no text preview available.",
      "pv.imageFail":    "Image couldn't be loaded.",
      "pv.notFound":     "File not found.",
      "pv.bigFile":      "File is too large to preview ({n} KB). Use Edit instead.",
      "menu.open":     "Open / Enter folder",
      "menu.download": "Download",
      "menu.moveTo":   "Move to…",
      "menu.copyTo":  "Copy to…",
      "menu.copyName": "Copy name",
      "menu.copyPath": "Copy path",
      "menu.copyContent": "Copy content",
      "menu.delete":   "Delete",
      "menu.rename":   "Rename",
      "name.newFolder": "New folder",
      "name.newFile":   "New file.txt",
	  "act.import": "Import files"
    },
    el: {
      "tree.root":    "Αρχεία",
      "tree.toggle":  "Εμφάνιση φακέλων",
      "nav.up":       "Μετάβαση στον γονικό φάκελο",
      "act.newFolder":"Νέος φάκελος",
      "act.newFile":  "Νέο αρχείο",
      "act.rename":   "Μετονομασία",
      "act.delete":   "Διαγραφή",
      "act.search":   "Αναζήτηση αρχείων και φακέλων",
      "act.more":     "Περισσότερες ενέργειες",
      "empty.title":  "Αυτός ο φάκελος είναι κενός",
      "empty.hint":   "Δημιούργησε αρχείο ή φάκελο με τα κουμπιά παραπάνω.",
      "dlg.createFolder": "Νέος φάκελος",
      "dlg.createFile":   "Νέο αρχείο",
      "dlg.rename":       "Μετονομασία",
      "dlg.nameLabel":    "Όνομα",
      "dlg.cancel":   "Άκυρο",
      "dlg.ok":       "Δημιουργία",
      "dlg.save":     "Αποθήκευση",
      "dlg.deleteTitle":    "Διαγραφή",
      "dlg.deleteConfirm":  "Διαγραφή",
      "dlg.deleteFileMsg":   "Διαγραφή «{name}»;",
      "dlg.deleteFolderMsg": "Διαγραφή «{name}» και όλων των περιεχομένων;",
      "dlg.deleteMultiMsg":  "Οριστική διαγραφή {n} επιλεγμένων στοιχείων;",
      "dlg.overwriteTitle": "Υπάρχει ήδη",
      "dlg.overwriteMsg":   "Το «{name}» υπάρχει ήδη σε αυτόν τον φάκελο. Να αντικατασταθεί;",
      "dlg.overwriteOk":    "Αντικατάσταση",
      "dlg.keepBoth":       "Διατήρηση και των δύο",
      "dlg.moveTitle":      "Μετακίνηση στοιχείων",
      "dlg.copyTitle":      "Αντιγραφή στοιχείων",
      "dlg.pickerLabel":    "Επίλεξε φάκελο προορισμού",
      "dlg.move":     "Μετακίνηση",
      "dlg.copy":     "Αντιγραφή",
      "err.required": "Δώσε ένα όνομα.",
      "err.chars":    "Το όνομα δεν μπορεί να περιέχει: / \\ : * ? \" < > |",
      "err.exists":   "Υπάρχει ήδη κάτι με αυτό το όνομα εδώ.",
      "err.nameTaken":"Υπάρχει ήδη αρχείο ή φάκελος με αυτό το όνομα στον προορισμό.",
      "err.readBin":  "Το αρχείο δεν μπόρεσε να διαβαστεί.",
      "toast.createdFolder": "Ο φάκελος δημιουργήθηκε",
      "toast.createdFile":   "Το αρχείο δημιουργήθηκε",
      "toast.renamed":       "Έγινε μετονομασία",
      "toast.deleted":       "Διαγράφηκε",
      "toast.deletedMulti":  "Διαγράφηκαν {n} στοιχεία",
      "toast.movedMulti":    "Μετακινήθηκαν {n} στοιχεία",
      "toast.copiedMulti":   "Αντιγράφηκαν {n} στοιχεία",
      "toast.movedSingle":   "Μετακινήθηκε στο «{dst}»",
      "toast.copiedSingle":  "Αντιγράφηκε στο «{dst}»",
      "toast.imported":      "Εισήχθησαν {n} αρχεία",
      "toast.importFail":    "Η εισαγωγή απέτυχε",
      "toast.skippedDupes":  "{n} παραλείφθηκαν (διατηρήθηκαν και τα δύο)",
      "toast.downloaded":    "Ξεκίνησε η λήψη",
      "toast.downloadFail":  "Η λήψη απέτυχε",
      "toast.copiedClip":    "Αντιγράφηκε στο πρόχειρο",
      "toast.clipFail":      "Το πρόχειρο δεν είναι διαθέσιμο",
      "toast.opFail":        "Η ενέργεια απέτυχε",
      "toast.sameFolder":    "Ο προορισμός είναι ο ίδιος φάκελος",
      "toast.intoItself":    "Ένας φάκελος δεν μετακινείται μέσα στον εαυτό του",
      "toast.fsMissing":     "Το σύστημα αρχείων του orOS δεν είναι διαθέσιμο.",
      "status.loading": "Φόρτωση…",
      "status.items":   "{n} στοιχεία",
      "status.oneItem": "1 στοιχείο",
      "status.selItems":"{n} από {t} επιλεγμένα",
      "search.placeholder": "Αναζήτηση σε αυτόν τον φάκελο…",
      "search.clear":  "Καθαρισμός αναζήτησης",
      "search.results": "Αποτελέσματα",
      "search.none":   "Δεν βρέθηκαν αντιστοιχίσεις",
      "search.where":  "στο {path}",
      "recents.title": "Πρόσφατα αρχεία",
      "recents.empty": "Καμία πρόσφατη δραστηριότητα ακόμα",
      "status.justNow":  "μόλις τώρα",
	  "ago.minutes": "πριν {n}λ",
      "ago.hours":   "πριν {n}ω",
      "ago.days":    "πριν {n}μ",
      "sort.name":         "Ταξινόμηση κατά όνομα",
      "sort.size":         "Ταξινόμηση κατά μέγεθος",
      "sort.date":         "Ταξινόμηση κατά ημερομηνία",
      "sort.asc":          "Αύξουσα",
      "sort.desc":         "Φθίνουσα",
      "storage.title":     "Χώρος δίσκου",
      "storage.used":      "Χρησιμοποιούνται {n} KB",
      "storage.calc":      "Υπολογισμός…",
      "col.name":          "Όνομα",
      "col.size":          "Μέγεθος",
      "col.date":          "Τροποποίηση",
      "ui.hint":           "Συμβουλή",
      "sync.state.off":     "Ο συγχρονισμός δίσκου δεν είναι διαθέσιμος",
      "sync.state.synced":  "Ο δίσκος συγχρονίστηκε",
      "sync.state.pending": "Αλλαγές σε αναμονή συγχρονισμού",
      "sync.conflictTitle": "Σύγκρουση συγχρονισμού",
      "sync.conflictLocal": "Διατήρηση τοπικού",
      "sync.conflictRemote":"Λήψη εκδοσίας cloud",
      "sync.conflictMsg":   "Ο δίσκος σου άλλαξε τοπικά και στο cloud από τον τελευταίο συγχρονισμό. Να διατηρηθεί η τοπική εκδοχή ή να ληφθεί αυτή του cloud;",
      "sync.restored":      "Ο δίσκος επαναφέρθηκε από το cloud",
      "sync.restoreFail":   "Αποτυχία επαναφοράς δίσκου από το cloud",
      "sync.snapshotFail":  "Αποτυχία δημιουργίας snapshot δίσκου",
      "pv.title":        "Προεπισκόπηση",
      "pv.edit":         "Επεξεργασία",
      "pv.previewMd":    "Ζωντανή προεπισκόπηση",
      "pv.editSource":   "Πηγή",
      "pv.save":         "Αποθήκευση",
      "pv.saved":        "Αποθηκεύτηκε",
      "pv.close":        "Κλείσιμο προεπισκόπησης",
      "pv.editHint":     "Επεξεργασία αρχείου κειμένου — οι αλλαγές γράφονται απευθείας στον εικονικό δίσκο.",
      "pv.binary":       "Δυαδικό αρχείο — δεν υπάρχει προεπισκόπηση κειμένου.",
      "pv.imageFail":    "Η εικόνα δεν φορτώθηκε.",
      "pv.notFound":     "Το αρχείο δεν βρέθηκε.",
      "pv.bigFile":      "Το αρχείο είναι πολύ μεγάλο για προεπισκόπηση ({n} KB). Χρησιμοποίησε την Επεξεργασία.",
      "menu.open":     "Άνοιγμα / είσοδος στον φάκελο",
      "menu.download": "Λήψη",
      "menu.moveTo":   "Μετακίνηση σε…",
      "menu.copyTo":   "Αντιγραφή σε…",
      "menu.copyName": "Αντιγραφή ονόματος",
      "menu.copyPath": "Αντιγραφή διαδρομής",
      "menu.copyContent": "Αντιγραφή περιεχομένου",
      "menu.delete":   "Διαγραφή",
      "menu.rename":   "Μετονομασία",
      "name.newFolder": "Νέος φάκελος",
      "name.newFile":   "Νέο αρχείο.txt",
	  "act.import": "Εισαγωγή αρχείων"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }
  function tfmt(key, vars) {
    var s = t(key);
    Object.keys(vars || {}).forEach(function (k) {
      s = s.split("{" + k + "}").join(String(vars[k]));
    });
    return s;
  }

  function $(id) { return document.getElementById(id); }

  var BAD_CHARS = /[\\/:*?"<>|]/;

  // Extension → category for entry-type badges
  var TEXT_EXTS = ["txt","md","json","js","css","html","htm","xml","csv",
                   "yml","yaml","svg","ini","cfg","conf","log","ts","py"];

  var FOLDER_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  var FILE_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var CARET_SVG =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  var MENU_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
  var SEARCH_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var X_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var DL_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  var MV_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><polyline points="13 6 19 12 13 18"/></svg>';
  var CP_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var IMPORT_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>';
  var EDIT_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  var MD_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 15v-6l2.5 3 2.5-3v6"/><line x1="15" y1="15" x2="15" y2="9"/><path d="M18 9l1.5 3 1.5-3"/></svg>';

  var IMG_EXTS = ["png","jpg","jpeg","gif","webp","bmp","ico","avif"];
  var PV_TEXT_LIMIT = 512 * 1024;      // 512 KB text preview cap

  function isImageExt(name) {
    var dot = name.lastIndexOf(".");
    if (dot <= 0) return false;
    return IMG_EXTS.indexOf(name.slice(dot + 1).toLowerCase()) !== -1;
  }

  function isTextExt(name) {
    var dot = name.lastIndexOf(".");
    if (dot <= 0) return true;                 // no extension → treat as text
    return TEXT_EXTS.indexOf(name.slice(dot + 1).toLowerCase()) !== -1;
  }
  function extOf(name) {
    var dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) return "file";
    return name.slice(dot + 1).toLowerCase();
  }

  // ---------- 2. View state + persistence + recents journal ----------

  // prefs = { ver: 1, expanded: {"/internal/a": true, …}, last: "/internal" }
  var prefs = null;
  var cwd = ROOT;
  var renderToken = 0;          // stale-listing guard

  // Selection model (Wave 2): SET of paths, not a single object.
  // Single click = exclusive select; Ctrl/Cmd+click = toggle; Shift
  // = anchor-range (desktop list convention). Everything downstream
  // (rename/delete/move/copy/menu) reads selectionPaths().
  var selectedPaths = {};        // path → true
  var anchorIndex = -1;

  // Last listing snapshot — powers range selection + status count
  var lastEntries = [];

  // Drag state: entry path being dragged (list row) — null = none
  var draggingEntryPath = null;

  // Search state: null = off; string = active query
  var searchQuery = null;
  var searchDir = null;

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.ver === DATA_VER && p.expanded && typeof p.last === "string") {
          prefs = p;
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
    prefs = {
      ver: DATA_VER,
      expanded: {},
      last: ROOT,
      sortField: "name",      // "name" | "size" | "date"
      sortAsc: true           // ascending by default
    };
    prefs.expanded[ROOT] = true;
    savePrefs();
  }

  function savePrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); }
    catch (e) { /* quota — view prefs are expendable */ }
  }

  // Recents journal — entries { p: path, at: epoch-ms }. Written on
  // create/rename/import/download/open-location. Trimmed to
  // RECENTS_MAX, deduped by path (fresh timestamp wins). Device-
  // local by design: a recents list that traveled in the cloud
  // would leak activity between devices — not view *preference*.
  function recentsRead() {
    try {
      var r = JSON.parse(localStorage.getItem(RECENTS_KEY));
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }

  function recentsTouch(path) {
    var r = recentsRead().filter(function (e) { return e.p !== path; });
    r.unshift({ p: path, at: Date.now() });
    while (r.length > RECENTS_MAX) r.pop();
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(r)); } catch (e) {}
  }

  function recentsPruneExisting() {
    // Drop journal entries whose path no longer exists (deleted
    // elsewhere). Runs lazily when the recents section renders.
    var r = recentsRead();
    if (!r.length) return Promise.resolve();
    return Promise.all(r.map(function (e) {
      return FS().stat(e.p).then(function () { return true; })
        .catch(function () { return false; });
    })).then(function (alive) {
      var keep = r.filter(function (_, i) { return alive[i]; });
      if (keep.length !== r.length) {
        try { localStorage.setItem(RECENTS_KEY, JSON.stringify(keep)); } catch (e2) {}
      }
    });
  }

  function selectionCount() {
    var n = 0;
    for (var k in selectedPaths) if (selectedPaths[k]) n++;
    return n;
  }
  function selectionPaths() {
    var out = [];
    for (var k in selectedPaths) if (selectedPaths[k]) out.push(k);
    return out;
  }
  function selectionPrimary() {
    // For dialogs that need ONE entry (rename, open, download).
    // Deterministic: first in last-listing order.
    var ordered = lastEntries;
    for (var i = 0; i < ordered.length; i++) {
      if (selectedPaths[join(cwd, ordered[i].name)]) {
        return { name: ordered[i].name,
                 dir: !!ordered[i].dir,
                 path: join(cwd, ordered[i].name) };
      }
    }
    // Selection might live in search results (different snapshot)
    var paths = selectionPaths();
    if (paths.length) return { name: baseName(paths[0]), dir: false, path: paths[0] };
    return null;
  }
  function baseName(p) {
    return p.slice(p.lastIndexOf("/") + 1);
  }

  // ---------- 3. FS bridge ----------

  function FS() {
    return (window.parent && window.parent.orosFS) || window.orosFS;
  }

  function join(parent, name) {
    return parent === "/" ? "/" + name : parent + "/" + name;
  }

  function isAvailable() {
    var fs = FS();
    return !!(fs && typeof fs.ls === "function");
  }

  function fsList(path) {
    return FS().ls(path).then(function (list) {
      var dirs = [], files = [];
      (list || []).forEach(function (e) {
        (e.dir ? dirs : files).push(e);
      });
      var byName = function (a, b) { return a.name < b.name ? -1 : 1; };
      dirs.sort(byName);
      files.sort(byName);
      return dirs.concat(files);
    });
  }

  // ---------- 4. Navigation + render orchestration ----------

  function refresh() {
    // Active search → re-run search render instead of a plain list
    if (searchQuery !== null) { runSearch(searchQuery); return; }

    var token = ++renderToken;
    setStatusLoading();
    fsList(cwd).then(function (entries) {
      if (token !== renderToken) return;      // superseded mid-flight
      var sorted = applySort(entries);
      lastEntries = sorted;
      renderEntries(sorted);
      renderStatus(sorted.length);
      renderRecentsMaybe();
    }).catch(function (e) {
      if (token !== renderToken) return;
      lastEntries = [];
      renderEntries([]);
      renderStatus(0);
      if (e && e.code === "ENOENT") {
        prefs.last = ROOT;
        // #11 FIX: do NOT reset sortField/sortAsc here (ghost folder protection)
        cwd = ROOT;
        clearSelection();
        refresh();
      }
    });
    renderTree();
    renderCrumbs();
    updateActionButtons();
  }

  function navigate(path) {
    cwd = path;
    clearSelection();
    // FB2: exactly ONE listing fetch per navigation. When a search
    // is active, clearSearch() re-fetches the real listing itself;
    // otherwise this refresh() is the only one. (Previously BOTH
    // ran: clearSearch's unconditional refresh + this one.)
    var hadSearch = (searchQuery !== null);
    if (hadSearch) clearSearch();
    prefs.last = path;
    savePrefs();
    if (!hadSearch) refresh();
  }

  function clearSelection() {
    selectedPaths = {};
    anchorIndex = -1;
    var rows = $("entries") ? $("entries").querySelectorAll(".entry") : [];
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove("selected");
    updateActionButtons();
  }

  function updateActionButtons() {
    var n = selectionCount();
    $("up").disabled = (cwd === ROOT);
    $("rename").disabled = (n !== 1);
    $("delete").disabled = (n === 0);
    $("delete").classList.toggle("danger-arm", n > 0);
  }

  // ---------- 5. Folder tree render (lazy, expanded, DROP TARGETS) ----------

  function renderTree() {
    var host = $("tree-root");
    var token = renderToken;
    host.innerHTML = "";
    host.appendChild(makeTreeNode(ROOT, t("tree.root"), 0, token));
  }

  function makeTreeNode(path, label, depth, token) {
    var wrap = document.createElement("div");

    var node = document.createElement("div");
    node.className = "tnode" + (path === cwd ? " selected" : "");
    node.style.paddingLeft = (6 + depth * 14) + "px";
    node.dataset.path = path;

    var caret = document.createElement("span");
    caret.className = "caret";
    caret.innerHTML = CARET_SVG;
    node.appendChild(caret);

    var glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.innerHTML = FOLDER_SVG;
    node.appendChild(glyph);

    var name = document.createElement("span");
    name.className = "tname";
    name.textContent = label;
    node.appendChild(name);

    caret.addEventListener("click", function (e) {
      e.stopPropagation();
      if (caret.classList.contains("empty")) return;
      toggleExpanded(path);
    });
    node.addEventListener("click", function () {
      closeTreeDrawer();
      navigate(path);
    });

    // DROP TARGET (Wave 2): entries dragged from the list highlight
    // the folder; drop = MOVE. DataTransfer payload is never trusted
    // beyond our own paths — files from OUTSIDE orOS route through
    // the same import logic as the dropzone/list (section 9).
    node.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      node.classList.add("drop-target");
    });
    node.addEventListener("dragleave", function () {
      node.classList.remove("drop-target");
    });
    node.addEventListener("drop", function (e) {
      e.preventDefault();
      node.classList.remove("drop-target");
      handleDrop(e, path);
    });

    wrap.appendChild(node);

    var kids = document.createElement("div");
    kids.className = "tchildren";
    wrap.appendChild(kids);

    if (isExpanded(path)) {
      node.classList.add("open");
      fsList(path).then(function (entries) {
        if (token !== renderToken) return;
        var dirs = entries.filter(function (e) { return e.dir; });
        if (dirs.length === 0) {
          caret.classList.add("empty");
          return;
        }
        dirs.forEach(function (d) {
          kids.appendChild(makeTreeNode(join(path, d.name), d.name, depth + 1, token));
        });
      }).catch(function () { /* stale branch — node stays leaf */ });
    } else {
      fsList(path).then(function (entries) {
        if (token !== renderToken) return;
        var hasDirs = entries.some(function (e) { return e.dir; });
        if (!hasDirs) caret.classList.add("empty");
      }).catch(function () {});
    }

    return wrap;
  }

  function isExpanded(path) {
    return !!prefs.expanded[path];
  }
  function toggleExpanded(path) {
    if (prefs.expanded[path]) delete prefs.expanded[path];
    else prefs.expanded[path] = true;
    savePrefs();
    renderTree();
  }

  function renameExpandedPrefix(oldPath, newPath) {
    var updated = false;
    Object.keys(prefs.expanded).forEach(function (k) {
      if (k === oldPath || k.indexOf(oldPath + "/") === 0) {
        delete prefs.expanded[k];
        prefs.expanded[newPath + k.slice(oldPath.length)] = true;
        updated = true;
      }
    });
    if (updated) savePrefs();
  }

  function dropExpandedPrefix(path) {
    var changed = false;
    Object.keys(prefs.expanded).forEach(function (k) {
      if (k === path || k.indexOf(path + "/") === 0) {
        delete prefs.expanded[k];
        changed = true;
      }
    });
    if (changed) savePrefs();
  }
  
  // ---------- 5b. Sorting helpers ----------

  function applySort(entries) {
    var field = prefs.sortField || "name";
    var asc = prefs.sortAsc !== false;

    return entries.slice().sort(function (a, b) {
      var cmp = 0;
      if (field === "name") {
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase(), LANG === "el" ? "el" : "en");
      } else if (field === "size") {
        var sa = a.size || 0, sb = b.size || 0;
        cmp = sa === sb ? 0 : sa < sb ? -1 : 1;
      } else if (field === "date") {
        var da = a.mtime || a.modified || 0, db = b.mtime || b.modified || 0;
        cmp = da === db ? 0 : da < db ? -1 : 1;
      }
      return asc ? cmp : -cmp;
    });
  }

  function toggleSort(field) {
    if (prefs.sortField === field) {
      prefs.sortAsc = !prefs.sortAsc;
    } else {
      prefs.sortField = field;
      prefs.sortAsc = true;
    }
    savePrefs();
    refresh();
    updateSortIndicators();
  }

  // ---------- 6. Entry list render + MULTI selection ----------

  function renderEntries(entries) {
    var ul = $("entries");
    ul.innerHTML = "";

    // FD/FE4: single branch — the old first case (root + empty) was
    // fully covered by the second: entries.length > 0 === false →
    // hidden = false. Identical outcome, half the code.
    if (searchQuery === null) {
      $("empty").hidden = entries.length > 0;
    }

    // #4 FIX: ensure recents section DOM element exists (JS-injected)
    ensureRecentsSection();

    entries.forEach(function (e, idx) {
      var path = join(cwd, e.name);
      var li = document.createElement("li");
      
      // #7 FIX: grid layout — 4 columns: icon(20px) | name(1fr) | size(90px) | date(80px)
      // The .ext badge is removed from desktop rows (mobile hides it anyway)
      li.className = "entry" + (selectedPaths[path] ? " selected" : "");
      li.dataset.path = path;
      li.dataset.index = String(idx);
      li.tabIndex = 0;
      li.draggable = true;

      var glyph = document.createElement("span");
      glyph.className = "glyph " + (e.dir ? "folder" : "file");
      glyph.innerHTML = e.dir ? FOLDER_SVG : FILE_SVG;
      li.appendChild(glyph);

      var name = document.createElement("span");
      name.className = "ename col-name";
      name.textContent = e.name;
      li.appendChild(name);

      // Size column — fs.js ls() only returns {name, dir}; no size/mtime.
      // Show "-" until fs.js expands its contract (or we stat each entry).
      var sizeSpan = document.createElement("span");
      sizeSpan.className = "col-size";
      sizeSpan.textContent = "-";                        // #FA4: fs.js limitation
      li.appendChild(sizeSpan);

      // Modified column — same limitation as size
      var dateSpan = document.createElement("span");
      dateSpan.className = "col-date";
      dateSpan.textContent = "-";                        // #FA4: fs.js limitation
      li.appendChild(dateSpan);

      // Click: single / Ctrl+toggle / Shift+range (desktop
      // convention). Plain single click clears everything first.
      li.addEventListener("click", function (ev) {
        handleClickSelect(ev, li, idx, e);
      });
      li.addEventListener("dblclick", function () {
        if (e.dir) {
          clearSelection();
          navigate(path);
        } else {
          recentsTouch(path);
          openPreview(path);
        }
      });

      // DRAG SOURCE (internal move). Payload: our private MIME type.
      // The dragstart flag lets handleDrop() distinguish internal
      // moves from OS-imported files (which carry Files/* types).
      li.addEventListener("dragstart", function (ev) {
        draggingEntryPath = path;
        // If the dragged row isn't selected, drag only IT:
        // dragging implies a fresh single selection.
        if (!selectedPaths[path]) {
          clearSelection();
          selectedPaths[path] = true;
          li.classList.add("selected");
          updateActionButtons();
        }
        try {
          ev.dataTransfer.setData("application/x-oros-paths",
            JSON.stringify(selectionPaths()));
          ev.dataTransfer.effectAllowed = "copyMove";
        } catch (e2) { /* legacy engines — internal flag still works */ }
      });
      li.addEventListener("dragend", function () {
        draggingEntryPath = null;
      });

      // CONTEXT MENU (right-click) — desktop
      li.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        if (!selectedPaths[path]) {
          clearSelection();
          selectedPaths[path] = true;
          var rows = $("entries").querySelectorAll(".entry");
          for (var i = 0; i < rows.length; i++) {
            rows[i].classList.toggle("selected",
              rows[i].dataset.path === path);
          }
          updateActionButtons();
        }
        openContextMenu(ev.clientX, ev.clientY);
      });

      // Keyboard: Enter = activate (navigate/open), Space = toggle
      li.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          if (e.dir) { clearSelection(); navigate(path); }
          else { recentsTouch(path); openPreview(path); }
        } else if (ev.key === " ") {
          ev.preventDefault();
          selectedPaths[path] = !selectedPaths[path];
          li.classList.toggle("selected", !!selectedPaths[path]);
          updateActionButtons();
        } else if (ev.key === "Delete") {
          ev.preventDefault();
          if (selectionCount() > 0) openDeleteDialog();
        }
      });

      ul.appendChild(li);
    });
  }

  // #4 FIX: ensure recents-section DOM element exists
  function ensureRecentsSection() {
    var sec = $("recents-section");
    if (sec) {
      sec.style.display = "block";
      return;
    }
    sec = document.createElement("section");
    sec.id = "recents-section";
    sec.className = "recents-section";
    sec.style.display = "none";
    
    var title = document.createElement("h4");
    title.className = "sec-title";
    title.textContent = t("recents.title");
    sec.appendChild(title);
    
    var list = document.createElement("ul");
    list.className = "recents-list";
    sec.appendChild(list);
    
    // DOM order in #list-wrap: column header FIRST, then recents
    // section, then entries. Previously the recents went before
    // host.firstChild — but the header had already claimed that
    // spot, so recents landed ABOVE the header on the root view.
    var host = $("list-wrap");
    if (!host) return;
    var hdr = $("list-header");
    host.insertBefore(sec, hdr ? hdr.nextSibling : host.firstChild);
  }

  function handleClickSelect(ev, li, idx, e) {
    var path = li.dataset.path;

    if (ev.shiftKey && anchorIndex >= 0) {
      // Range: anchor → clicked, inclusive, within current listing
      var from = Math.min(anchorIndex, idx);
      var to = Math.max(anchorIndex, idx);
      for (var i = from; i <= to; i++) {
        var pe = join(cwd, lastEntries[i].name);
        selectedPaths[pe] = true;
      }
      paintSelection();
      updateActionButtons();
      return;
    }

    if (ev.ctrlKey || ev.metaKey) {
      // Toggle this one, keep the rest
      selectedPaths[path] = !selectedPaths[path];
      if (selectedPaths[path]) { anchorIndex = idx; }
      paintSelection();
      updateActionButtons();
      return;
    }

    // Plain click: exclusive select
    clearSelection();
    selectedPaths[path] = true;
    anchorIndex = idx;
    paintSelection();
    updateActionButtons();
  }

  function paintSelection() {
    var rows = $("entries").querySelectorAll(".entry");
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("selected",
        !!selectedPaths[rows[i].dataset.path]);
    }
    renderStatus(lastEntries.length);
  }

  // ---------- 7. Breadcrumbs + status bar ----------

  function renderCrumbs() {
    var host = $("crumbs");
    host.innerHTML = "";

    var home = document.createElement("button");
    home.type = "button";
    home.className = "crumb" + (cwd === ROOT ? " current" : "");
    home.textContent = t("tree.root");
    home.addEventListener("click", function () { navigate(ROOT); });
    host.appendChild(home);

    if (cwd === ROOT) return;

    var rest = cwd.slice(ROOT.length + 1).split("/");
    var acc = ROOT;
    rest.forEach(function (seg, i) {
      acc = join(acc, seg);
      var sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "/";
      host.appendChild(sep);

      var crumb = document.createElement("button");
      crumb.type = "button";
      var last = (i === rest.length - 1);
      crumb.className = "crumb" + (last ? " current" : "");
      crumb.textContent = seg;
      if (!last) crumb.addEventListener("click", function () { navigate(acc); });
      host.appendChild(crumb);
    });
  }

  function setStatusLoading() {
    var sel = selectionCount();
    $("st-count").textContent = sel
      ? tfmt("status.selItems", { n: sel, t: lastEntries.length })
      : t("status.loading");
    $("st-path").textContent = searchQuery !== null
      ? tfmt("search.where", { path: searchDir })
      : (cwd === ROOT ? ROOT : cwd);
  }

  function renderStatus(count) {
    var sel = selectionCount();
    $("st-count").textContent = sel
      ? tfmt("status.selItems", { n: sel, t: count })
      : (count === 1 ? t("status.oneItem") : tfmt("status.items", { n: count }));
    $("st-path").textContent = searchQuery !== null
      ? tfmt("search.where", { path: searchDir })
      : (cwd === ROOT ? ROOT : cwd);
  }
  
    // ---------- 8. Dialogs: create / rename / delete / overwrite /
  //               move-copy picker ----------

  var DIALOG_MODE = null;

  function validateName(raw, existingNames) {
    var name = raw.trim();
    if (!name) return { ok: false, err: t("err.required") };
    if (BAD_CHARS.test(name)) return { ok: false, err: t("err.chars") };
    if (name === "." || name === "..") return { ok: false, err: t("err.required") };
    for (var i = 0; i < existingNames.length; i++) {
      if (existingNames[i] === name) return { ok: false, err: t("err.exists") };
    }
    return { ok: true, name: name };
  }

  function openNameDialog(mode) {
    DIALOG_MODE = mode;
    var primary = selectionPrimary();
    if (mode === "rename" && !primary) return;

    var title = $("name-title");
    var submitBtn = $("name-form").querySelector('button[type="submit"]');
    if (mode === "folder") {
      title.textContent = t("dlg.createFolder");
      submitBtn.textContent = t("dlg.ok");
      $("name-input").value = t("name.newFolder");
    } else if (mode === "file") {
      title.textContent = t("dlg.createFile");
      submitBtn.textContent = t("dlg.ok");
      $("name-input").value = t("name.newFile");
    } else {
      title.textContent = t("dlg.rename");
      submitBtn.textContent = t("dlg.save");
      $("name-input").value = primary ? primary.name : "";
    }
    var v = $("name-input").value;
    var dot = v.lastIndexOf(".");
    try {
      $("name-input").setSelectionRange(0,
        (dot > 0 && mode === "rename") ? dot : v.length);
    } catch (e2) {}

    $("name-error").hidden = true;
    origListChain = fsList(cwd).catch(function () { return []; });
    $("dlg-name").showModal();
    setTimeout(function () { $("name-input").focus(); }, 50);
  }

  var origListChain = null;

  function submitNameDialog() {
    var raw = $("name-input").value;
    origListChain.then(function (entries) {
      var names = entries.map(function (e) { return e.name; });
      var check = validateName(raw, names);
      if (!check.ok) {
        var err = $("name-error");
        err.textContent = check.err;
        err.hidden = false;
        $("name-input").focus();
        return;
      }
      var name = check.name;
      var op = null;
      if (DIALOG_MODE === "folder") {
        op = FS().mkdir(join(cwd, name)).then(function () {
          showToast(t("toast.createdFolder"));
        });
      } else if (DIALOG_MODE === "file") {
        op = FS().writeText(join(cwd, name), "").then(function () {
          recentsTouch(join(cwd, name));
          showToast(t("toast.createdFile"));
        });
      } else if (DIALOG_MODE === "rename" && selectionPrimary()) {
        var prim = selectionPrimary();
        op = FS().mv(prim.path, join(cwd, name)).then(function () {
          if (prim.dir) renameExpandedPrefix(prim.path, join(cwd, name));
          recentsTouch(join(cwd, name));
          showToast(t("toast.renamed"));
        });
      }
      if (!op) { $("dlg-name").close(); return; }
      op.then(function () {
        markDirty();
        clearSelection();
        $("dlg-name").close();
        refresh();
      }).catch(function () {
        showToast(t("toast.opFail"));
        $("dlg-name").close();
        refresh();
      });
    });
    return false;
  }

  // Delete — single or bulk, same guarded dialog
  function openDeleteDialog() {
    var n = selectionCount();
    if (n === 0) return;
    var msg;
    if (n === 1) {
      var p = selectionPrimary();
      msg = p.dir ? t("dlg.deleteFolderMsg") : t("dlg.deleteFileMsg");
      msg = msg.split("{name}").join(p.name);
    } else {
      msg = t("dlg.deleteMultiMsg").split("{n}").join(String(n));
    }
    $("delete-msg").textContent = msg;
    $("dlg-delete").showModal();
  }

  function performDelete() {
    var paths = selectionPaths();
    if (!paths.length) return;
    Promise.all(paths.map(function (p) {
      return FS().rm(p).then(function () {
        dropExpandedPrefix(p);
        return true;
      }).catch(function () { return false; });
    })).then(function (results) {
      var ok = results.filter(Boolean).length;
      if (ok === paths.length) {
        showToast(ok === 1 ? t("toast.deleted")
                          : tfmt("toast.deletedMulti", { n: ok }));
      } else {
        showToast(t("toast.opFail"));
      }
      clearSelection();
      if (ok > 0) { forceStorageRecalc(); markDirty(); }
      refresh();
    });
  }

  // Overwrite / keep-both resolver for imports — JS-built dialog
  // (files/index.html untouched). Returns a promise:
  //   true  = overwrite
  //   false = keep both (caller renames)
  //   null  = cancel whole import (used for the FIRST conflict only)
  function askOverwrite(name) {
    return new Promise(function (resolve) {
      var stale = $("dlg-overwrite");
      if (stale) stale.remove();

      var dlg = document.createElement("dialog");
      dlg.id = "dlg-overwrite";
      dlg.className = "f-dialog";

      var title = document.createElement("h3");
      title.textContent = t("dlg.overwriteTitle");
      var body = document.createElement("p");
      body.textContent = t("dlg.overwriteMsg").split("{name}").join(name);

      var row = document.createElement("div");
      row.className = "dlg-row";

      function done(v) { dlg.close(); resolve(v); }

      var mk = function (labelKey, val, accent) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = t(labelKey);
        if (accent) b.className = "danger";
        b.addEventListener("click", function () { done(val); });
        return b;
      };
      row.appendChild(mk("dlg.overwriteOk", true, true));
      row.appendChild(mk("dlg.keepBoth", false, false));
      row.appendChild(mk("dlg.cancel", null, false));

      dlg.appendChild(title);
      dlg.appendChild(body);
      dlg.appendChild(row);
      dlg.addEventListener("cancel", function (e) {
        e.preventDefault(); done(null);
      });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  // Folder picker for Move/Copy — tree chooser inside a dialog.
  // Same lazy pattern as the sidebar tree; pick = resolve(path).
  function openPickerDialog(mode) {
    var paths = selectionPaths();
    if (!paths.length) return;

    return new Promise(function (resolve) {
      var stale = $("dlg-picker");
      if (stale) stale.remove();

      var dlg = document.createElement("dialog");
      dlg.id = "dlg-picker";
      dlg.className = "f-dialog";

      var title = document.createElement("h3");
      title.textContent = t(mode === "move" ? "dlg.moveTitle" : "dlg.copyTitle");
      var label = document.createElement("p");
      label.className = "picker-label";
      label.textContent = t("dlg.pickerLabel");

      var treeHost = document.createElement("div");
      treeHost.className = "picker-tree";

      var chosen = ROOT;
      var chosenEl = null;

      function buildNode(path, lbl, depth) {
        var node = document.createElement("div");
        node.className = "pnode";
        node.style.paddingLeft = (6 + depth * 14) + "px";
        node.textContent = lbl;
        node.dataset.path = path;
        node.addEventListener("click", function () {
          if (chosenEl) chosenEl.classList.remove("chosen");
          chosenEl = node;
          node.classList.add("chosen");
          chosen = path;
        });
        var kids = document.createElement("div");
        node.appendChild(kids);
        // Expand on click, children lazily below
        node.addEventListener("click", function () {
          if (kids.childElementCount > 0 || node.dataset.loaded) return;
          node.dataset.loaded = "1";
          FS().ls(path).then(function (list) {
            list.filter(function (e) { return e.dir; }).forEach(function (d) {
              kids.appendChild(buildNode(join(path, d.name), d.name, depth + 1));
            });
          }).catch(function () {});
        });
        return node;
      }
      treeHost.appendChild(buildNode(ROOT, t("tree.root"), 0));

      var row = document.createElement("div");
      row.className = "dlg-row";
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = t("dlg.cancel");
      cancelBtn.addEventListener("click", function () { dlg.close(); resolve(null); });
      var okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "primary";
      okBtn.textContent = t(mode === "move" ? "dlg.move" : "dlg.copy");
      okBtn.addEventListener("click", function () { dlg.close(); resolve(chosen); });
      row.appendChild(cancelBtn);
      row.appendChild(okBtn);

      dlg.appendChild(title);
      dlg.appendChild(label);
      dlg.appendChild(treeHost);
      dlg.appendChild(row);
      document.body.appendChild(dlg);
      dlg.showModal();
    }).then(function (dst) {
      if (!dst) return;
      if (mode === "move") performMove(paths, dst);
      else performCopy(paths, dst);
    });
  }

  // Move/copy engine — shared by picker dialog AND tree drops.
  // Guards: same-folder, folder-into-itself, name collisions.
  function performMove(paths, dst) {
    // #19 FIX: removed dead "var srcDir = dst;"
    var parent = function (p) {
      return p.slice(0, p.lastIndexOf("/")) || "/";
    };
    // FA1 (critical): the picker shows ALL folders INCLUDING the
    // items being moved — selecting the SAME folder or ONE OF ITS
    // CHILDREN as destination would cause opfsMv to copy then
    // delete, wiping the source WITH the copy inside it. Two
    // additional guards are required:
    //   1) source == destination
    //   2) destination starts with source/ (child containment)
    var warned = false;    // FB4: one toast per guard pass, not a stack
    var moves = paths.filter(function (p) {
      if (p === dst) {
        if (!warned) { showToast(t("toast.sameFolder")); warned = true; }
        return false;
      }
      if (dst.indexOf(p + "/") === 0) {
        if (!warned) { showToast(t("toast.intoItself")); warned = true; }
        return false;
      }
      if (parent(p) === dst) return false;   // same folder — silent noop
      return true;
    });
    if (!moves.length) {
      // FB4: previously the filter's own toast PLUS this fallback
      // stacked (an into-itself case showed BOTH intoItself and
      // sameFolder). Show the fallback only when the filter was
      // completely silent (pure same-folder noops).
      if (paths.length && !warned) showToast(t("toast.sameFolder"));
      return;
    }
    dstListChain(dst).then(function (dstNames) {
      var chain = Promise.resolve();
      var moved = 0, skipped = 0;
      moves.forEach(function (p) {
        chain = chain.then(function () {
          var name = baseName(p);
          if (dstNames.indexOf(name) !== -1) {
            skipped++;
            return null;
          }
          return FS().mv(p, join(dst, name)).then(function () {
            // FD4: rename alone — it relocates the folder AND all
            // descendant expanded keys. The preceding drop wiped
            // the very keys rename needed, so every moved folder
            // arrived COLLAPSED (expansion state silently lost).
            renameExpandedPrefix(p, join(dst, name));
            moved++;
            dstNames.push(name);
          }).catch(function () { skipped++; });
        });
      });
      return chain.then(function () {
        if (moved) {
          showToast(moves.length === 1
            ? tfmt("toast.movedSingle", { dst: dst === ROOT ? t("tree.root") : baseName(dst) })
            : tfmt("toast.movedMulti", { n: moved }));
        }
        if (skipped) showToast(tfmt("toast.skippedDupes", { n: skipped }));
        if (moved > 0) markDirty();
        clearSelection();
        refresh();
      });
    });
  }

  function performCopy(paths, dst) {
    // FA2 (critical): same guards as performMove — copying a folder
    // into itself or into one of its children causes infinite
    // recursion in copyEntry (mkdir → ls → find newly created
    // child → recurse forever until quota/stack exhaustion).
    // The picker must NOT prevent this — we guard here.
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      if (p === dst) {
        showToast(t("toast.sameFolder"));
        return;
      }
      if (dst.indexOf(p + "/") === 0) {
        showToast(t("toast.intoItself"));
        return;
      }
    }
    if (dst === cwd && paths.length) {
      showToast(t("toast.sameFolder"));
      return;
    }
    dstListChain(dst).then(function (dstNames) {
      var chain = Promise.resolve();
      var copied = 0, skipped = 0;
      paths.forEach(function (p) {
        chain = chain.then(function () {
          var name = uniqueName(baseName(p), dstNames);
          return copyEntry(p, join(dst, name)).then(function (ok) {
            if (ok) { copied++; dstNames.push(name); }
          }).catch(function () { skipped++; });
        });
      });
      return chain.then(function () {
        if (copied) {
          showToast(copied === 1
            ? tfmt("toast.copiedSingle", { dst: dst === ROOT ? t("tree.root") : baseName(dst) })
            : tfmt("toast.copiedMulti", { n: copied }));
        }
        if (skipped) showToast(tfmt("toast.skippedDupes", { n: skipped }));
        if (copied > 0) { forceStorageRecalc(); markDirty(); }
        refresh();
      });
    });
  }

  // Recursive copy — mkdir + replay files. Binary-aware via
  // readFileBlob (Blob path — fidelity preserved for images etc).
  function copyEntry(src, dst) {
    return FS().stat(src).then(function (st) {
      if (!st || !st.dir) {
        return copyFileContent(src, dst);
      }
      return FS().mkdir(dst).then(function () {
        return FS().ls(src).then(function (list) {
          var chain = Promise.resolve();
          (list || []).forEach(function (e) {
            chain = chain.then(function () {
              return copyEntry(join(src, e.name), join(dst, e.name));
            });
          });
          return chain;
        });
      });
    });
  }

  function copyFileContent(src, dst) {
    // #9/#22 FIX: binary-faithful copy — read the raw Blob, write
    // the raw Blob. Images/düαδικά keep their bytes verbatim.
    return FS().read(src).then(function (blob) {
      return FS().write(dst, blob || new Blob([""]));
    });
  }

  // "(1)" suffix generator — matches desktop file-manager behavior
  function uniqueName(name, taken) {
    if (taken.indexOf(name) === -1) return name;
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext  = dot > 0 ? name.slice(dot) : "";
    var i = 1;
    while (taken.indexOf(base + " (" + i + ")" + ext) !== -1) i++;
    return base + " (" + i + ")" + ext;
  }

  function dstListChain(path) {
    return FS().ls(path).then(function (list) {
      return (list || []).map(function (e) { return e.name; });
    }).catch(function () { return []; });
  }

  // ---------- 9. Drag & Drop IMPORT (external files) ----------

  // Drop zone: entire list area. When an external file is dropped,
  // the dragstart from the browser carries Files/* MIME types, not
  // our private application/x-oros-paths — that distinction lets us
  // differentiate internal moves (handled in tree drop) from import.
  function initDropZone() {
    var zone = $("entries");
    zone.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      handleDrop(e, cwd);
    });
  }

  function handleDrop(e, dstPath) {
    // Internal move (from list row to tree node or same-zone):
    // we carry application/x-oros-paths. If present, dispatch to
    // move logic (selectionPaths()).
    var orosPathsRaw;
    try { orosPathsRaw = e.dataTransfer.getData("application/x-oros-paths"); }
    catch (ex) {}

    if (orosPathsRaw && draggingEntryPath) {
      // #3 FIX: no "dstPath === cwd" requirement anymore — the tree
      // drop target passes a DIFFERENT folder than cwd, that's the
      // whole point of drag-to-move. Same-folder drops fall through
      // to performMove's own guards.
      // Same-folder re-order: nothing to do (desktop doesn't move)
      if (parentOf(draggingEntryPath) === dstPath && dstPath === cwd) {
        draggingEntryPath = null;
        return;
      }
      // Internal move: selection holds the paths to relocate
      var paths = selectionPaths();
      if (paths.length > 0) {
        performMove(paths, dstPath);
        draggingEntryPath = null;
        return;
      }
    }

    // External files (desktop drop or iOS file picker): Files/* mime
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;

    importFilesList(files, dstPath);
  }

  function parentOf(p) {
    return p.slice(0, p.lastIndexOf("/")) || "/";
  }

  // Shared import pipeline for drag-drop AND file picker.
  // Sequence: stat destination → ENOENT = clean write (normal
  // case for new files), exists-as-file = ask overwrite/keep-both.
  var importCancelled = false;

  function importFilesList(files, dstPath) {
    var imported = 0, skipped = 0;
    importCancelled = false;          // FC4: fresh batch, fresh flag
    // FD1: SERIAL chain, not Promise.all. Two birds:
    //  1) FC4's importCancelled flag now actually works — with
    //     Promise.all every importFile() had already been CALLED
    //     (guard already passed) before any dialog got answered.
    //  2) Multiple conflicting files fired askOverwrite()
    //     concurrently → the second showModal() threw
    //     InvalidStateError while the first dialog was open.
    var chain = Promise.resolve();
    for (var i = 0; i < files.length; i++) {
      (function (f) {
        chain = chain.then(function () {
          return importFile(f, dstPath).then(function (ok) {
            if (ok === true) imported++;
            else if (ok === false) skipped++;
            // ok == null means cancelled whole import
          });
        });
      })(files[i]);
    }
    return chain.then(function () {
      if (imported) {
        showToast(tfmt("toast.imported", { n: imported }));
        if (skipped) showToast(t("toast.skippedDupes").split("{n}").join(String(skipped)));
        forceStorageRecalc();
        markDirty();
      } else if (skipped) {
        // FA6: honest feedback — "skipped (kept both)" refers to
        // keep-both decisions, NOT FS failures. Failures should
        // report "import failed" not "kept both".
        showToast(t("toast.importFail"));
      }
      refresh();
    });
  }

  // #2 FIX: stat() REJECTS with ENOENT when nothing exists — that
  // is the NORMAL path for a brand-new file. Catch ENOENT → write
  // directly; only existing FILE destinations ask overwrite/
  // keep-both, and keep-both now consults the REAL destination
  // listing (was: empty array → same name → silent overwrite).
  function importFile(file, dstPath) {
    if (importCancelled) return Promise.resolve(null);   // FC4: batch was cancelled
    var name = sanitizeFileName(file.name);
    var dst = join(dstPath, name);
    return FS().stat(dst).then(function (st) {
      if (!st) {
        // No record → fresh write
        return writeFileDst(file, dst).then(function () { return true; });
      }
      if (st.dir) {
        // Destination is a folder → write INSIDE it, uniquified
        // FC3: list the KNOWN path `dst` — never rely on st.path
        // being part of the fs.js stat contract
        return dstListChain(dst).then(function (innerNames) {
          var inner = uniqueName(name, innerNames);
          return writeFileDst(file, join(dst, inner)).then(function () { return true; });
        });
      }
      // Destination exists as file → ask
      return askOverwrite(name).then(function (decision) {
        if (decision === null) {                         // FC4: cancel REST of batch
          importCancelled = true;
          return null;
        }
        if (decision === false) {
          // Keep both → rename against the REAL listing
          return dstListChain(dstPath).then(function (dstNames) {
            var both = uniqueName(name, dstNames);
            return writeFileDst(file, join(dstPath, both)).then(function () { return true; });
          });
        }
        // Overwrite
        return writeFileDst(file, dst).then(function () { return true; });
      });
    }).catch(function (e) {
      if (e && e.code === "ENOENT") {
        // Nothing at the destination — the everyday NEW-file case
        return writeFileDst(file, dst).then(function () { return true; });
      }
      return false;                                     // real FS error
    });
  }

  function sanitizeFileName(name) {
    return name.replace(/[\/\\:*?"<>|]/g, "_");
  }

  // #22 FIX: no dead base64 computation — Blob flows straight into
  // FS().write() (fs.js toBlob handles Blob/ArrayBuffer/string).
  // Text files still route via readAsText for encoding sanity.
  function writeFileDst(file, path) {
    return new Promise(function (resolve) {
      if (isTextExt(file.name)) {
        var reader = new FileReader();
        reader.onload = function (e) {
          var text = String(e.target.result);
          FS().writeText(path, text).then(function () {
            recentsTouch(path);
            resolve(true);
          }).catch(function () { resolve(false); });
        };
        reader.onerror = function () { resolve(false); };
        reader.readAsText(file);
      } else {
        var rb = new FileReader();
        rb.onload = function (e) {
          // Raw bytes → FS().write (Blob path, byte-faithful)
          FS().write(path, e.target.result).then(function () {
            recentsTouch(path);
            resolve(true);
          }).catch(function () { resolve(false); });
        };
        rb.onerror = function () { resolve(false); };
        rb.readAsArrayBuffer(file);
      }
    });
  }

  // ---------- Storage calculator (recursive, cached) ----------

  function readStorageCache() {
    try {
      var raw = localStorage.getItem(STORAGE_CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && obj.ts && Date.now() - obj.ts < STORAGE_TTL) {
        return { used: obj.used, ts: obj.ts };
      }
    } catch (e) {}
    return null;
  }

  function writeStorageCache(used) {
    try {
      localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify({
        used: used,
        ts: Date.now()
      }));
    } catch (e) {}
  }

  function calcStorageRecursive(dir) {
    var total = 0;
    return fsList(dir).then(function (entries) {
      var chain = Promise.resolve();
      entries.forEach(function (e) {
        var path = join(dir, e.name);
        chain = chain.then(function () {
          if (e.dir) {
            return calcStorageRecursive(path).then(function (size) {
              total += size;
            });
          } else {
            return FS().stat(path).then(function (st) {
              if (st && (st.size || st.bytes)) {
                total += (st.size || st.bytes) || 0;
              }
            }).catch(function () {});
          }
        });
      });
      return chain.then(function () { return total; });
    });
  }

  function ensureStorageBar() {
    var host = $("storage-bar");
    if (!host) return;

    var cached = readStorageCache();
    if (cached) {
      host.textContent = tfmt("storage.used", { n: Math.round(cached.used / 1024) });
      return;
    }

    host.textContent = t("storage.calc");
    calcStorageRecursive(ROOT).then(function (totalBytes) {
      writeStorageCache(totalBytes);
      host.textContent = tfmt("storage.used", { n: Math.round(totalBytes / 1024) });
    }).catch(function () {
      host.textContent = "-";
    });
  }

  // Force recalc (e.g., after bulk delete/import)
  function forceStorageRecalc() {
    localStorage.removeItem(STORAGE_CACHE_KEY);
    ensureStorageBar();
  }

  // File picker fallback for mobile / non-drag environments
  // #6 FIX: button injected (ensureToolbarExtras) — reachable now
  function openFilePicker() {
    var input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", function () {
      var files = input.files;
      if (!files || !files.length) return;
      importFilesList(files, cwd);
    });
    input.click();
  }

  // ---------- 10. Download / Clipboard ----------

  // #9 FIX: binary-faithful downloads. Text files keep readText;
  // everything else streams the raw Blob with a reasonable MIME.
  function downloadEntry(primary) {
    if (!primary || primary.dir) return;
    var path = primary.path;
    var name = primary.name;
    var doDownload = function (data, mime) {
      var blob = (data instanceof Blob)
        ? data
        : new Blob([data !== undefined ? data : ""],
            { type: mime || "text/plain" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      recentsTouch(path);
      showToast(t("toast.downloaded"));
    };
    if (isTextExt(name)) {
      FS().readText(path).then(function (content) {
        doDownload(content, "text/plain");
      }).catch(function () {
        showToast(t("toast.downloadFail"));
      });
    } else {
      FS().read(path).then(function (blob) {
        doDownload(blob, mimeForExt(extOf(name)));
      }).catch(function () {
        showToast(t("toast.downloadFail"));
      });
    }
  }

  function mimeForExt(ext) {
    var map = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
      ico: "image/x-icon", avif: "image/avif",
      pdf: "application/pdf", zip: "application/zip"
    };
    return map[ext] || "application/octet-stream";
  }

  function copyToClipboard(entry, mode) {
    // mode: "name" | "path" | "content"
    if (!entry) return Promise.reject();
    if (mode === "content" && entry.dir) return Promise.reject();

    var text = "";
    if (mode === "name") text = entry.name;
    else if (mode === "path") text = entry.path;
    else {
      return FS().readText(entry.path).then(function (c) {
        return navigator.clipboard.writeText(c !== undefined ? c : "")
          .then(function () { showToast(t("toast.copiedClip")); })
          .catch(function () { showToast(t("toast.clipFail")); });
      }).catch(function () { showToast(t("toast.clipFail")); });
    }
    return navigator.clipboard.writeText(text)
      .then(function () { showToast(t("toast.copiedClip")); })
      .catch(function () { showToast(t("toast.clipFail")); });
  }

  // ---------- 11. Search (recursive within folder + subfolders) ----------

  // #23 FIX: 250ms debounce on input — no full-disk walk per
  // keystroke — and a token captured per query pass, checked
  // inside findMatchingRecursively so superseded queries drop.
  var searchDebounce = null;

  function runSearch(query) {
    if (!query.trim()) { clearSearch(); return; }
    searchQuery = query.trim();
    searchDir = cwd;
    // FD3: entering search mode — drop stale root views. Otherwise
    // the Recents section and/or #empty from the last plain
    // listing stay visible alongside the search results.
    hideRecents();
    var em = $("empty");
    if (em) em.hidden = true;
    setStatusLoading();

    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
      var token = ++renderToken;
      findMatchingRecursively(cwd, searchQuery, token).then(function (matches) {
        if (token !== renderToken) return;
        lastEntries = [];  // no list
        renderSearchResults(matches);
        renderStatus(matches.length);   // FB6: was hardcoded 0 — "0 items" over a full result list
      });
    }, 250);
  }

    function findMatchingRecursively(dir, q, token) {
    return fsList(dir).then(function (entries) {
      if (token !== renderToken) return [];
      var matches = [];
      var qLower = q.toLowerCase();
      var dirsToScan = [];
      entries.forEach(function (e) {
        var name = e.name;
        var path = join(dir, name);
        if (name.toLowerCase().indexOf(qLower) !== -1) {
          matches.push({ name: name, dir: !!e.dir, path: path });
        }
        if (e.dir) {
          dirsToScan.push(path);                       // collect for chain
        }
      });
      var chain = Promise.resolve();
      dirsToScan.forEach(function (d) {
        chain = chain.then(function () {
          return findMatchingRecursively(d, q, token).then(function (more) {
            matches = matches.concat(more);
          });
        });
      });
      return chain.then(function () { return matches.slice(0, SEARCH_CAP); });
    }).catch(function () {
      return (token !== renderToken) ? [] : [];
    });
  }

  function clearSearch() {
    if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
    var wasSearching = (searchQuery !== null);   // capture BEFORE nulling
    searchQuery = null;
    searchDir = null;
    // FA4 + FB2: runSearch() sets lastEntries=[] (no list), so
    // clearing must re-fetch the real listing. BUT only when a
    // search was actually ACTIVE: clearSearch() is called on EVERY
    // navigation and on every empty-keyup — an unconditional
    // refresh() meant double and triple fetches per navigation.
    // renderRecentsMaybe() is called inside refresh() already; the
    // explicit call here was a second, redundant prune walk.
    if (wasSearching) refresh();
  }

  function renderSearchResults(matches) {
    var host = $("entries");
    host.innerHTML = "";
    if (matches.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty-msg";
      empty.innerHTML = '<span>' + t("search.none") + '</span>';
      host.appendChild(empty);
      return;
    }
    matches.forEach(function (m) {
      var li = document.createElement("li");
      li.className = "entry search-result";
      li.dataset.path = m.path;
      var glyph = document.createElement("span");
      glyph.className = "glyph " + (m.dir ? "folder" : "file");
      glyph.innerHTML = m.dir ? FOLDER_SVG : FILE_SVG;
      li.appendChild(glyph);
      var name = document.createElement("span");
      name.className = "ename";
      name.textContent = m.name;
      li.appendChild(name);
      var sub = document.createElement("span");
      sub.className = "subpath";
      sub.textContent = shortenPath(m.path);
      li.appendChild(sub);
      li.addEventListener("click", function () {
        navigate(parentOf(m.path));
        clearSearch();
      });
      host.appendChild(li);
    });
  }

  function shortenPath(p) {
    var rel = p.slice(ROOT.length);
    return rel.split("/").slice(0, 2).join(" / ") +
           (rel.split("/").length > 2 ? " …" : "");
  }

  // ---------- 12. Recents section (root only) ----------

  function renderRecentsMaybe() {
    if (cwd !== ROOT || searchQuery !== null) {
      hideRecents();
      return;
    }
    recentsPruneExisting().then(function () {
      var r = recentsRead();
      if (!r.length) {
        hideRecents();
        return;
      }
      showRecents(r);
    });
  }

  function showRecents(journal) {
    // #4 FIX: section guaranteed by ensureRecentsSection() before
    // any render touches it — but stay defensive anyway.
    var host = $("recents-section");
    if (!host) return;
    host.style.display = "";
    var title = host.querySelector(".sec-title");
    if (title) title.textContent = t("recents.title");
    var list = host.querySelector(".recents-list");
    if (!list) return;
    list.innerHTML = "";
    journal.slice(0, RECENTS_MAX).forEach(function (e) {
      var li = document.createElement("li");
      li.dataset.path = e.p;
      var name = document.createElement("span");
      name.className = "rname";
      name.textContent = baseName(e.p);
      var meta = document.createElement("span");
      meta.className = "rmeta";
      meta.textContent = humanWhen(e.at);
      var path = document.createElement("span");
      path.className = "rpath";
      path.textContent = parentOf(e.p);
      li.appendChild(name);
      li.appendChild(meta);
      li.appendChild(path);
      li.addEventListener("click", function () {
        var pr = parentOf(e.p);
        navigate(pr);
        // Select the file after navigating
        setTimeout(function () {
          var rows = $("entries").querySelectorAll(".entry");
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].dataset.path === e.p) {
              selectedPaths[e.p] = true;
              rows[i].classList.add("selected");
              break;
            }
          }
          updateActionButtons();
        }, 150);
      });
      list.appendChild(li);
    });
  }

  function hideRecents() {
    var sec = $("recents-section");
    if (sec) sec.style.display = "none";
  }

  // #29 FIX: localized relative times (was hardcoded "5m ago").
  function humanWhen(ts) {
    var d = Date.now() - ts;
    if (d < 60 * 1000) return t("status.justNow");
    if (d < 60 * 60 * 1000) return tfmt("ago.minutes", { n: Math.floor(d / 60000) });
    if (d < 24 * 60 * 60 * 1000) return tfmt("ago.hours", { n: Math.floor(d / 3600000) });
    return tfmt("ago.days", { n: Math.floor(d / 86400000) });
  }
  
    // ---------- 13. Context menu ----------

  var ctxMenu = null;

  // #10 FIX: max-height instead of fixed height — a 3-item menu
  // no longer occupies 300px. #20 FIX: the SVG icons (DL/MV/CP)
  // finally earn their keep in front of the labels.
  function openContextMenu(x, y) {
    if (ctxMenu) ctxMenu.remove();
    var p = selectionPrimary();
    if (!p) return;

    ctxMenu = document.createElement("div");
    ctxMenu.id = "context-menu";

    function mkItem(svg, labelKey, action) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = svg + '<span class="cm-label"></span>';
      btn.querySelector(".cm-label").textContent = t(labelKey);
      btn.addEventListener("click", function () {
        it_remove();
        action();
      });
      return btn;
    }
    var it_remove = function () {
      if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
      document.removeEventListener("click", onOutside);
    };

    if (p.dir) {
      ctxMenu.appendChild(mkItem(FOLDER_SVG, "menu.open", function () {
        clearSelection();
        navigate(p.path);
      }));
    } else {
      ctxMenu.appendChild(mkItem(FILE_SVG, "pv.title", function () {
        recentsTouch(p.path);
        openPreview(p.path);
      }));
    }
    ctxMenu.appendChild(hr());
    ctxMenu.appendChild(mkItem(DL_SVG, "menu.download", function () {
      downloadEntry(p);
    }));
    ctxMenu.appendChild(mkItem(MV_SVG, "menu.moveTo", function () {
      openPickerDialog("move");
    }));
    ctxMenu.appendChild(mkItem(CP_SVG, "menu.copyTo", function () {
      openPickerDialog("copy");
    }));
    ctxMenu.appendChild(hr());
    ctxMenu.appendChild(mkItem("", "menu.copyName", function () {
      copyToClipboard(p, "name");
    }));
    ctxMenu.appendChild(mkItem("", "menu.copyPath", function () {
      copyToClipboard(p, "path");
    }));
    if (!p.dir) {
      ctxMenu.appendChild(mkItem("", "menu.copyContent", function () {
        copyToClipboard(p, "content");
      }));
    }
    ctxMenu.appendChild(hr());
    ctxMenu.appendChild(mkItem(EDIT_SVG, "menu.rename", function () {
      openNameDialog("rename");
    }));
    ctxMenu.appendChild(mkItem(X_SVG, "menu.delete", function () {
      openDeleteDialog();
    }));

    function hr() {
      var h = document.createElement("hr");
      return h;
    }

    document.body.appendChild(ctxMenu);
    // Position within viewport — measure REAL size after append
    ctxMenu.style.visibility = "hidden";
    ctxMenu.style.left = "0px";
    ctxMenu.style.top = "0px";
    var mw = ctxMenu.offsetWidth || 200;
    var mh = ctxMenu.offsetHeight || 100;
    ctxMenu.style.visibility = "";
    ctxMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - mw - 8)) + "px";
    ctxMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + "px";

    // Click outside closes
    var onOutside = function (e) {
      if (!ctxMenu.contains(e.target)) it_remove();
    };
    setTimeout(function () {
      document.addEventListener("click", onOutside);
    }, 0);
  }

  // ---------- 14. Mobile tree drawer ----------

  var drawerBackdrop = null;

  function ensureTreeToggle() {
    if ($("tree-toggle")) return;
    var bar = $("bar");
    var tog = document.createElement("button");
    tog.type = "button";
    tog.id = "tree-toggle";
    tog.setAttribute("aria-label", t("tree.toggle"));
    tog.title = t("tree.toggle");
    tog.innerHTML = MENU_SVG;
    tog.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleTreeDrawer();
    });
    bar.insertBefore(tog, bar.firstChild);
  }

  function toggleTreeDrawer() {
    var wrap = $("tree-wrap");
    var open = !wrap.classList.contains("open");
    wrap.classList.toggle("open", open);
    $("tree-toggle").classList.toggle("open", open);
    if (open && !drawerBackdrop) {
      drawerBackdrop = document.createElement("div");
      drawerBackdrop.id = "tree-backdrop";
      drawerBackdrop.addEventListener("click", closeTreeDrawer);
      $("split").appendChild(drawerBackdrop);
    } else if (!open) {
      closeTreeDrawer();
    }
  }

  function closeTreeDrawer() {
    var wrap = $("tree-wrap");
    if (!wrap.classList.contains("open")) return;
    wrap.classList.remove("open");
    var tog = $("tree-toggle");
    if (tog) tog.classList.remove("open");
    if (drawerBackdrop && drawerBackdrop.parentNode) {
      drawerBackdrop.parentNode.removeChild(drawerBackdrop);
    }
    drawerBackdrop = null;
  }

  // ---------- 15. Toast ----------

  var toastTimer = null;

  function showToast(text) {
    var el = $("toast");
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 4000);
  }

  // ---------- 15b. Disk sync — blob bridge to oros-sync (Wave 3) ----------
  // Contract consumed by the shell glue (shell.js §9f):
  //   orosFilesDisk.snapshot()     -> Promise<string>  (JSON, plaintext;
  //                                   ENGINE encrypts before upload)
  //   orosFilesDisk.applyRemote(x) -> Promise         (string or object)
  //   orosFilesDisk.markClean(ts)  — shell calls after clean reconcile
  // The pill shows state only; transport is 100% engine-owned.

  var syncMeta = { ts: 0, dirty: false };  // ts = last successful sync

  function loadSyncMeta() {
    try {
      var raw = localStorage.getItem(SYNC_META_KEY);
      if (raw) {
        var m = JSON.parse(raw);
        if (m && typeof m.ts === "number" && typeof m.dirty === "boolean") {
          syncMeta = m;
          return;
        }
      }
    } catch (e) { /* fresh */ }
    saveSyncMeta();
  }

  function saveSyncMeta() {
    try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta)); }
    catch (e) {}
  }

  function markDirty() {
    if (!syncMeta.dirty) {
      syncMeta.dirty = true;
      saveSyncMeta();
      renderSyncPill();
    }
    // ALWAYS notify the host: engine markDirty + transport-cache
    // refresh. No early return — a second edit after the first
    // must still re-arm the refresh (the cache was snapshotted
    // BEFORE it). Bursts coalesce at both levels.
    try {
      var host = window.parent || window;
      if (host && typeof host.__orosFilesDiskTouched === "function") {
        host.__orosFilesDiskTouched();
      }
    } catch (e) {}
  }

  function markClean(ts) {
    syncMeta.ts = ts || Date.now();
    syncMeta.dirty = false;
    saveSyncMeta();
    renderSyncPill();
  }

  function diskSnapshot() {
    return FS().exportDisk(ROOT).then(function (disk) {
      // Pass-through: whatever exportDisk returns travels untouched
      return JSON.stringify({
        kind: "oros-files-disk",
        ver: 1,
        ts: Date.now(),
        disk: disk
      });
    });
  }

  function parseSnap(x) {
    var snap = (typeof x === "string") ? JSON.parse(x) : x;
    if (!snap || snap.kind !== "oros-files-disk" || snap.disk === undefined) {
      throw new Error("bad snapshot");
    }
    return snap;
  }

  function applyRemote(x, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var snap;
      try { snap = parseSnap(x); }
      catch (e) { reject(e); return; }

      // Conflict: local changes exist AND remote is newer than the
      // last sync. Blob model → explicit user decision.
      if (syncMeta.dirty && snap.ts && snap.ts > syncMeta.ts && !opts.force) {
        askConflict().then(function (takeRemote) {
          if (takeRemote) { reallyApply(snap, resolve, reject); }
          else { resolve(false); }         // keep local — next push wins
        });
        return;
      }
      reallyApply(snap, resolve, reject);
    });
  }

  // #8 FIX: wipe:true — "Take cloud version" now MEANS replace.
  // Without it, importDisk MERGES (zero-loss contract of fs.js)
  // and files deleted on the remote would survive the restore,
  // making "take cloud" a lie. Data-loss window: ONLY after the
  // user explicitly chose the remote over the local in the
  // conflict dialog (or when local is clean).
  //
  // FA3 (high): importDisk now returns {applied, failed} per F7.
  // Partial failure (quota, transient FS errors) means some entries
  // DIDN'T make it to disk. If we markClean() and toast "restored",
  // the next push will overwrite the cloud with this PARTIAL state
  // — the failed entries are lost from cloud FOREVER. Honor the
  // contract: only markClean/toast when applied===total, and report
  // failures honestly so the user can retry before the next sync.
  function reallyApply(snap, resolve, reject) {
    FS().importDisk(snap.disk, { wipe: true }).then(function (result) {
      // FB3: an EMPTY remote disk is a VALID, successfully-restored
      // state (fresh cloud, or everything deliberately deleted).
      // applied===0 with failed===0 is SUCCESS — the earlier
      // `total > 0` guard turned it into a permanent "failure":
      // never markClean → the remote re-applied on every cycle,
      // sync pill stuck pending. Failure is defined purely as
      // failed > 0.
      var failed = (result && result.failed) || 0;
      if (failed > 0) {
        // Partial success — report failure but DO NOT mark clean.
        // Baseline stays old, so the next reconcile re-attempts
        // this remote. Users see honest diagnostics. Resolve
        // false (not reject): not fatal, just "not fully restored".
        showToast(t("sync.snapshotFail") + ": " + failed);
        resolve(false);
        return;
      }
      markClean(snap.ts || Date.now());
      forceStorageRecalc();
      clearSelection();
      // If the current folder vanished in the remote state, the
      // refresh() ENOENT guard falls back to ROOT.
      refresh();
      showToast(t("sync.restored"));
      resolve(true);
    }).catch(function (e) {
      showToast(t("sync.restoreFail"));
      reject(e);
    });
  }

  function askConflict() {
    return new Promise(function (resolve) {
      var stale = $("dlg-conflict");
      if (stale) stale.remove();
      var dlg = document.createElement("dialog");
      dlg.id = "dlg-conflict";
      dlg.className = "f-dialog";
      var title = document.createElement("h3");
      title.textContent = t("sync.conflictTitle");
      var body = document.createElement("p");
      body.textContent = t("sync.conflictMsg");
      var row = document.createElement("div");
      row.className = "dlg-row";
      function done(v) { dlg.close(); resolve(v); }
      var mk = function (labelKey, val, primary) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = t(labelKey);
        if (primary) b.className = "primary";
        b.addEventListener("click", function () { done(val); });
        return b;
      };
      row.appendChild(mk("sync.conflictLocal", false, false));
      row.appendChild(mk("sync.conflictRemote", true, true));
      dlg.appendChild(title); dlg.appendChild(body); dlg.appendChild(row);
      dlg.addEventListener("cancel", function (e) {
        e.preventDefault(); done(false);   // Esc = keep local (safe side)
      });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  // Sync pill (status bar, JS-built) — visibility of state only.
  // #5 FIX: the footer is <footer id="status"> — was looking for a
  // nonexistent ".status-bar" class → the pill never appeared.
  function ensureSyncPill() {
    var st = $("st-sync");
    if (st) return st;
    var host = document.getElementById("status");
    if (!host) return null;
    var pill = document.createElement("span");
    pill.id = "st-sync";
    pill.className = "sync-pill";
    host.appendChild(pill);
    return pill;
  }

  function renderSyncPill() {
    var pill = ensureSyncPill();
    if (!pill) return;
    var state = !enginePresent() ? "off"
              : syncMeta.dirty ? "pending" : "synced";
    pill.dataset.state = state;
    pill.title = t("sync.state." + state);
    pill.textContent = "";
    var dot = document.createElement("span");
    dot.className = "sync-dot";
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(t("sync.state." + state)));
  }

  function enginePresent() {
    try {
      var p = window.parent;
      return !!(p && p.orosSync && typeof p.orosSync.push === "function");
    } catch (e) { return false; }
  }

  // Public contract — shell.js §9f consumes snapshot/applyRemote/
  // markClean/isDirty directly. #21 FIX: the unused onSyncStart/
  // onSyncDone/registerWith ceremony is gone; the object is lean.
  var orosFilesDisk = {
    sliceKey: SYNC_SLICE_KEY,
    snapshot: function () {
      return diskSnapshot().catch(function (e) {
        showToast(t("sync.snapshotFail"));
        throw e;
      });
    },
    applyRemote: applyRemote,
    isDirty: function () { return !!syncMeta.dirty; },
    markClean: markClean
  };

  try {
    var host = window.parent || window;
    host.orosFilesDisk = orosFilesDisk;
  } catch (e) { window.orosFilesDisk = orosFilesDisk; }

  // ---------- 16. Palette + shell shortcut forwarding ----------

  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone (direct) open */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  // ---------- 16b. Preview overlay + Quick Edit (Wave 3) ----------

  var pvOverlay = null;

  // FG5: registry of live preview object URLs — revoked on EVERY
  // close path (Esc / X button / overlay click / new preview),
  // replacing the old closePreview-reassignment hack that only
  // intercepted Esc. Closing always removes the overlay, so no
  // <img> can outlive its URL.
  var pvActiveUrls = [];

  function pvRevokeAll() {
    for (var i = 0; i < pvActiveUrls.length; i++) {
      try { URL.revokeObjectURL(pvActiveUrls[i]); } catch (e) {}
    }
    pvActiveUrls = [];
  }

  function closePreview() {
    if (!pvOverlay) return;
    pvRevokeAll();
    pvOverlay.remove();
    pvOverlay = null;
    document.removeEventListener("keydown", pvOnKey);
  }

  function pvOnKey(e) {
    if (e.key === "Escape") { e.preventDefault(); closePreview(); }
  }

  function openPreview(path) {
    var name = baseName(path);

    FS().stat(path).then(function (st) {
      var size = (st && (st.size || st.bytes)) || 0;
      var mtime = (st && (st.mtime || st.modified)) || null;
      buildPreviewShell(path, name, size, mtime);

      if (isImageExt(name)) {
        renderImagePreview(path);
      } else {
        renderTextPreview(path);
      }
    }).catch(function () {
      buildPreviewShell(path, name, 0, null);
      pvBodySet('<div class="pv-msg">' + escapeHtml(t("pv.notFound")) + '</div>');
    });
  }

  function buildPreviewShell(path, name, size, mtime) {
    closePreview();
    pvOverlay = document.createElement("div");
    pvOverlay.id = "pv-overlay";
    pvOverlay.setAttribute("role", "dialog");

    var head = document.createElement("div");
    head.className = "pv-head";

    var hinfo = document.createElement("div");
    hinfo.className = "pv-info";
    hinfo.innerHTML =
      "<strong>" + escapeHtml(name) + "</strong>" +
      '<span class="pv-meta">' + escapeHtml(parentOf(path)) +
      (size ? " · " + fmtKB(size) : "") +
      (mtime ? " · " + new Date(mtime).toLocaleString(
        LANG === "el" ? "el-GR" : "en-GB",
        { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "") +
      "</span>";
    head.appendChild(hinfo);

    var acts = document.createElement("div");
    acts.className = "pv-actions";
    acts.id = "pv-actions";
    head.appendChild(acts);

    var x = document.createElement("button");
    x.type = "button";
    x.className = "pv-x";
    x.title = t("pv.close");
    x.innerHTML = X_SVG;
    x.addEventListener("click", closePreview);
    head.appendChild(x);

    var body = document.createElement("div");
    body.className = "pv-body";
    body.id = "pv-body";

    pvOverlay.appendChild(head);
    pvOverlay.appendChild(body);
    pvOverlay.addEventListener("click", function (e) {
      if (e.target === pvOverlay) closePreview();
    });
    document.body.appendChild(pvOverlay);
    document.addEventListener("keydown", pvOnKey);
  }

  function pvBodySet(html) {
    var b = $("pv-body");
    if (b) b.innerHTML = html;
  }

  function fmtKB(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderTextPreview(path) {
    pvBodySet('<div class="pv-loading">' + escapeHtml(t("status.loading")) + "</div>");
    FS().readText(path).then(function (text) {
      var str = String(text !== undefined ? text : "");
      var name = baseName(path);

      if (str.length > PV_TEXT_LIMIT) {
        pvBodySet('<div class="pv-msg">' +
          escapeHtml(tfmt("pv.bigFile", { n: Math.round(str.length / 1024) })) +
          "</div>");
        injectEditButton(path, name);
        return;
      }

      var ext = extOf(name);
      var html;
      if (ext === "json") {
        html = renderJsonPretty(str);
      } else if (ext === "md" || ext === "markdown") {
        html = mdToHtml(str);
        injectMdToggle(path, name, str);
      } else {
        html = "<pre>" + escapeHtml(str) + "</pre>";
      }
      pvBodySet(html);
      injectEditButton(path, name);
    }).catch(function () {
      pvBodySet('<div class="pv-msg">' + escapeHtml(t("pv.binary")) + "</div>");
    });
  }

  function renderJsonPretty(str) {
    var pretty;
    try { pretty = JSON.stringify(JSON.parse(str), null, 2); }
    catch (e) { pretty = str; }
    var esc = escapeHtml(pretty);
    return '<pre class="lang-json">' +
      esc.replace(/&quot;(\\.|[^&\\])*?&quot;(\s*:)/g, '<span class="j-key">$&</span>')
         .replace(/(&quot;(\\.|[^&\\])*?&quot;)(?!<\/span>)/g, '<span class="j-str">$1</span>')
         .replace(/\b(true|false|null)\b/g, '<span class="j-bool">$&</span>')
         .replace(/(:\s*)(-?\d+(\.\d+)?([eE][+-]?\d+)?)/g, '$1<span class="j-num">$2</span>') +
      "</pre>";
  }

  function mdToHtml(md) {
    var src = String(md).replace(/\r\n/g, "\n");
    var out = [];
    var inCode = false, inList = false;
    var codeBuf = [];

    function flushList() {
      if (inList) { out.push("</ul>"); inList = false; }
    }

    src.split("\n").forEach(function (line) {
      if (line.indexOf("```") === 0) {
        if (inCode) {
          out.push("<pre>" + escapeHtml(codeBuf.join("\n")) + "</pre>");
          codeBuf = []; inCode = false;
        } else {
          flushList();
          inCode = true;
        }
        return;
      }
      if (inCode) { codeBuf.push(line); return; }

      if (/^#{1,6}\s/.test(line)) {
        flushList();
        var lvl = line.match(/^#+/)[0].length;
        out.push("<h" + lvl + ">" + mdInline(line.replace(/^#+\s*/, "")) + "</h" + lvl + ">");
        return;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + mdInline(line.replace(/^\s*[-*]\s+/, "")) + "</li>");
        return;
      }
      if (line.trim() === "") { flushList(); return; }
      flushList();
      out.push("<p>" + mdInline(line) + "</p>");
    });
    if (inCode) out.push("<pre>" + escapeHtml(codeBuf.join("\n")) + "</pre>");
    flushList();
    return '<div class="md-view">' + out.join("\n") + "</div>";
  }

  function mdInline(s) {
    // FA5 + FB1 (security + regression fix): escape FIRST, then
    // linkify the ESCAPED string. The prior delivery linkified raw
    // text and THEN ran escapeHtml over the result — the injected
    // <a> tags were themselves escaped, so every markdown link
    // rendered as literal HTML source text. Matching after escape
    // is safe: the URL substring can no longer contain quotes,
    // brackets or angle brackets, and the scheme test still works
    // verbatim on unescaped scheme characters.
    return escapeHtml(s)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, txt, url) {
        var clean = url.trim();
        if (/^[a-z]+:/i.test(clean)) {
          var scheme = clean.split(":")[0].toLowerCase();
          if (scheme === "javascript" || scheme === "data") {
            return txt;   // dangerous link — keep text, drop the href
          }
        }
        return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>";
      })
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1<em>$2</em>");
  }

  function injectEditButton(path, name) {
    var acts = $("pv-actions");
    if (!acts || acts.dataset.hasEdit) return;
    acts.dataset.hasEdit = "1";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pv-btn";
    b.innerHTML = EDIT_SVG + "<span>" + escapeHtml(t("pv.edit")) + "</span>";
    b.addEventListener("click", function () { openQuickEdit(path, name); });
    acts.appendChild(b);
  }

  function injectMdToggle(path, name, rawSrc) {
    var acts = $("pv-actions");
    if (!acts || acts.dataset.hasMd) return;
    acts.dataset.hasMd = "1";
    var raw = false;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pv-btn";
    b.innerHTML = MD_SVG + "<span>" + escapeHtml(t("pv.editSource")) + "</span>";
    b.addEventListener("click", function () {
      raw = !raw;
      pvBodySet(raw ? "<pre>" + escapeHtml(rawSrc) + "</pre>"
                    : mdToHtml(rawSrc));
      b.querySelector("span").textContent =
        raw ? t("pv.previewMd") : t("pv.editSource");
    });
    acts.appendChild(b);
  }

  function openQuickEdit(path, name) {
    var b = $("pv-body");
    if (!b) return;
    b.innerHTML = "";

    var hint = document.createElement("div");
    hint.className = "pv-hint";
    hint.textContent = t("pv.editHint");

    var ta = document.createElement("textarea");
    ta.className = "pv-editor";
    ta.spellcheck = false;
    ta.value = t("status.loading");

    var isMd = (function () {
      var e = extOf(name);
      return e === "md" || e === "markdown";
    })();

    var rightPane = document.createElement("div");
    rightPane.className = "pv-md-pane";
    rightPane.innerHTML = "";

    function paintMd() {
      if (isMd) rightPane.innerHTML = mdToHtml(ta.value);
    }

    FS().readText(path).then(function (text) {
      ta.value = String(text !== undefined ? text : "");
      paintMd();
    }).catch(function () {
      showToast(t("toast.opFail"));
      closePreview();
    });

    ta.addEventListener("input", paintMd);

    var row = document.createElement("div");
    row.className = "pv-save-row";
    var save = document.createElement("button");
    save.type = "button";
    save.className = "pv-btn primary";
    save.textContent = t("pv.save");
    save.addEventListener("click", function () {
      FS().writeText(path, ta.value).then(function () {
        recentsTouch(path);
        showToast(t("pv.saved"));
        forceStorageRecalc();
        markDirty();
        renderTextPreview(path);          // back to view mode
        $("pv-actions").dataset.hasEdit = "";   // allow Edit again
      }).catch(function () { showToast(t("toast.opFail")); });
    });
    row.appendChild(save);

    var wrap = document.createElement("div");
    wrap.className = "pv-edit-wrap" + (isMd ? " split" : "");
    var left = document.createElement("div");
    left.className = "pv-edit-left";
    left.appendChild(ta);
    wrap.appendChild(left);
    if (isMd) wrap.appendChild(rightPane);

    b.appendChild(hint);
    b.appendChild(wrap);
    b.appendChild(row);
    setTimeout(function () { ta.focus(); }, 50);
  }

  function renderImagePreview(path) {
    pvBodySet('<div class="pv-loading">' + escapeHtml(t("status.loading")) + "</div>");
    FS().read(path).then(function (data) {
      var blob;
      if (data instanceof Blob) {                    // #FA2 FIX: fs.js returns Blob
        blob = data;
      } else if (data instanceof ArrayBuffer) {
        blob = new Blob([data]);
      } else if (data && typeof data.length === "number" && !(typeof data === "string")) {
        blob = new Blob([new Uint8Array(data)]);
      } else if (typeof data === "string") {
        blob = bs64ToBlob(data);
      }
      if (!blob) throw new Error("unreadable");
      var url = URL.createObjectURL(blob);
      pvActiveUrls.push(url);              // FG5: revoked in pvRevokeAll()
      pvBodySet('<img class="pv-img" alt="" src="' + url + '">');
    }).catch(function () {
      pvBodySet('<div class="pv-msg">' + escapeHtml(t("pv.imageFail")) + "</div>");
    });
  }

  function bs64ToBlob(b64) {
    try {
      var bin = window.atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes]);
    } catch (e) { return null; }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- 17. Wiring & boot ----------

  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var ti = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < ti.length; j++) {
      ti[j].setAttribute("title", t(ti[j].getAttribute("data-i18n-title")));
      ti[j].setAttribute("aria-label", ti[j].getAttribute("title"));
    }
  }

  // #6 FIX: the three missing Wave 2 UI elements — search bar and
  // import button — are injected here (recents section lives in
  // ensureRecentsSection(), section 6). Doctrine: index.html
  // untouched, everything JS-built.
  function ensureToolbarExtras() {
    // --- Search bar (below the toolbar, above the split) ---
    if (!$("search-bar")) {
      var bar = document.createElement("div");
      bar.className = "search-bar";
      bar.id = "search-bar";

      var icon = document.createElement("span");
      icon.className = "search-ic";
      icon.innerHTML = SEARCH_SVG;
      bar.appendChild(icon);

      var inp = document.createElement("input");
      inp.type = "text";
      inp.id = "search-input";
      inp.placeholder = t("search.placeholder");
      inp.setAttribute("aria-label", t("act.search"));
      inp.autocomplete = "off";
      inp.spellcheck = false;
      bar.appendChild(inp);

      var clr = document.createElement("button");
      clr.type = "button";
      clr.id = "search-clear";
      clr.title = t("search.clear");
      clr.setAttribute("aria-label", t("search.clear"));
      clr.innerHTML = X_SVG;
      bar.appendChild(clr);

      var split = $("split");
      if (split) split.parentNode.insertBefore(bar, split);
    }

    // --- Import (file picker) button — in the toolbar actions ---
    if (!$("pick-files")) {
      var pick = document.createElement("button");
      pick.type = "button";
      pick.className = "tool";          // FD2: match toolbar button chrome
      pick.id = "pick-files";
      pick.title = t("act.import");
      pick.setAttribute("aria-label", t("act.import"));
      pick.innerHTML = IMPORT_SVG;
      pick.addEventListener("click", openFilePicker);
      var actions = $("actions");
      if (actions) actions.insertBefore(pick, actions.firstChild);
    }
  }

  function wire() {
    $("up").addEventListener("click", function () {
      if (cwd === ROOT) return;
      navigate(cwd.slice(0, cwd.lastIndexOf("/")) || ROOT);
    });

    $("new-folder").addEventListener("click", function () { openNameDialog("folder"); });
    $("new-file").addEventListener("click", function () { openNameDialog("file"); });
    $("rename").addEventListener("click", function () { openNameDialog("rename"); });
    $("delete").addEventListener("click", openDeleteDialog);

    // Name dialog
    $("name-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitNameDialog();
    });
    $("name-cancel").addEventListener("click", function () {
      $("dlg-name").close();
    });

    // Delete dialog
    $("delete-form").addEventListener("submit", function (e) {
      e.preventDefault();
      $("dlg-delete").close();
      performDelete();
    });
    $("delete-cancel").addEventListener("click", function () {
      $("dlg-delete").close();
    });

    // Drop zone
    initDropZone();

    // Clicking empty space deselects
    $("list-wrap").addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".entry")) return;
      clearSelection();
    });

    // Search input (exists now — ensureToolbarExtras injected it)
    var searchInput = $("search-input");
    if (searchInput) {
      searchInput.addEventListener("keyup", function () {
        var q = searchInput.value.trim();
        if (q === "") clearSearch();
        else runSearch(q);
      });
      searchInput.addEventListener("keypress", function (e) {
        if (e.key === "Enter") runSearch(searchInput.value);
      });
    }

    // Clear search button
    var clearBtn = $("search-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var si = $("search-input");
        if (si) si.value = "";
        clearSearch();
      });
    }
  }

  // #1 FIX: the stray "}" and orphaned calls are GONE — everything
  // lives inside boot(), in the right order. #13 FIX: the pending-
  // remote consumption moved to the END of boot (after cwd is set
  // and the first refresh is underway) so a remote restore renders
  // against the REAL current folder, not a default.
  function boot() {
    loadPrefs();
    applyI18n();
    ensureTreeToggle();
    ensureToolbarExtras();
    wire();
    inheritPalette();
    watchPalette();

    if (!isAvailable()) {
      $("empty").hidden = false;
      $("empty").querySelector("span").textContent = t("toast.fsMissing");
      $("empty").querySelector("small").textContent = "";
      $("new-folder").disabled = true;
      $("new-file").disabled = true;
      $("up").disabled = true;
      ensureHeaderAndStorage();
      ensureColumnHeaders();
      ensureStorageBar();
      console.warn("[orOS] files.js v" + APP_VER + " booted (NO orosFS)");
      return;
    }

    loadSyncMeta();
    renderSyncPill();
    cwd = prefs.last && prefs.last.indexOf(ROOT) === 0 ? prefs.last : ROOT;
    clearSelection();

    // Ensure header + storage bar + column headers BEFORE the
    // first render paints (they were orphaned outside boot —
    // the fatal #1 regression).
    ensureHeaderAndStorage();
    ensureColumnHeaders();
    refresh();
    updateSortIndicators();
    ensureStorageBar();
    setTimeout(ensureStorageBar, 1500); // delayed recalc if first boot

    // #13 FIX: remote that arrived while the app was closed —
    // consume LAST, through our own conflict-aware applyRemote.
    // It calls refresh() itself on success; the fallback path
    // re-checks cwd in case the restore removed it.
    setTimeout(function () {
      try {
        var host2 = window.parent || window;
        if (host2 && typeof host2.__orosFilesTakePending === "function") {
          var pendingSnap = host2.__orosFilesTakePending();
          if (pendingSnap && pendingSnap.kind === "oros-files-disk") {
            applyRemote(pendingSnap).then(function (ok) {
              if (ok === false) {
                // User kept local — cache must mirror the local disk
                try {
                  var host3 = window.parent || window;
                  if (host3 && typeof host3.__orosFilesDiskTouched === "function") {
                    host3.__orosFilesDiskTouched();
                  }
                } catch (e3) {}
              }
            }).catch(function () {});
          }
        }
      } catch (e) {}
    }, 400);

    console.log("[orOS] files.js v" + APP_VER + " booted (backend: " +
      (FS().mode ? FS().mode() : "unknown") + ")");
  }

  function ensureHeaderAndStorage() {
    var bar = $("bar");
    if (!bar) return;
    if ($("storage-bar")) return;               // already injected

    // Storage bar (after the Up button)
    var stor = document.createElement("div");
    stor.className = "storage-bar";
    stor.id = "storage-bar";
    stor.textContent = "-";
    var ref = $("up");
    if (ref) bar.insertBefore(stor, ref.nextSibling);
    else bar.appendChild(stor);
  }

  function ensureColumnHeaders() {
    var host = $("list-header");
    if (host) return; // already exists

    var hdr = document.createElement("div");
    hdr.id = "list-header";
    hdr.className = "entry-list-header";

    var mkCol = function (labelKey, field) {
      var th = document.createElement("button");
      th.type = "button";
      th.className = "col-th";
      th.dataset.field = field;
      th.innerHTML = '<span class="col-th-label"></span><span class="sort-ind"></span>';
      th.querySelector(".col-th-label").textContent = t(labelKey);
      th.addEventListener("click", function () { toggleSort(field); });
      return th;
    };

    // #7 FIX: 4 grid tracks to mirror the rows: icon-gap | name | size | date
    // (FG4: the gridCol param was dead — placement comes from the
    // .col-th:nth-child rules in files.css)
    hdr.appendChild(mkCol("col.name", "name"));
    hdr.appendChild(mkCol("col.size", "size"));
    hdr.appendChild(mkCol("col.date", "date"));

    var wrap = $("list-wrap");
    if (wrap) wrap.insertBefore(hdr, wrap.firstChild);
  }

  function updateSortIndicators() {
    var hdr = $("list-header");
    if (!hdr) return;
    var fields = ["name", "size", "date"];
    fields.forEach(function (f) {
      var th = hdr.querySelector('.col-th[data-field="' + f + '"]');
      if (th) {
        var ind = th.querySelector(".sort-ind");
        if (ind) {
          if (prefs.sortField === f) {
            ind.textContent = prefs.sortAsc ? " ▲" : " ▼";
            th.classList.add("sorted");
          } else {
            ind.textContent = "";
            th.classList.remove("sorted");
          }
        }
      }
    });
  }

  boot();
})();