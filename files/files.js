// ============================================================
// orOS Files — App logic
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
//
// Wave 3 (Explorer / Nautilus / Google Files parity):
//   • Trash: Delete moves items to /internal/.trash (one record per
//     item, files-core.js); Restore, Delete forever, Empty Trash,
//     auto-empty after 30 days. Vault Drive carries it as moves.
//   • Search inside text files and PDFs (snippets, progress, paging)
//   • ZIP: compress a selection, preview / extract a .zip
//   • Grid view with thumbnails (images, first page of PDFs)
//   • Favourites (synced slice "files", key oros-files-favs) and a
//     Recent view at the top of the tree; recents stay device-local
//   • Select mode for touch screens (check boxes + bottom bar)
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

  // FL-3: shell.js owns the version (?v=) — derive, never hardcode.
  var SCRIPT_V = null;
  (function extractVersion() {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) {
        var m = src.match(/[?&]v=([^&]+)/);
        if (m) SCRIPT_V = decodeURIComponent(m[1]);
      }
    } catch (e) {}
    if (!SCRIPT_V) SCRIPT_V = "0.5";
  })();
  var APP_VER = SCRIPT_V;
  var STORAGE_KEY = "oros-files-data";
  var RECENTS_KEY = "oros-files-recents";
  var DATA_VER = 1;
  var ROOT = "/internal";
  var RECENTS_MAX = 30;          // journal length (Recent view)
  var ROOT_RECENTS = 10;         // shown on the main folder
  var SEARCH_PAGE = 100;         // results per "Show more"
  var FAVS_KEY = "oros-files-favs";   // synced slice "files" (Favourites)
  var SWEEP_KEY = "oros-files-trash-swept";
  var CORE = window.OrosFilesCore;
  var TRASH = CORE.TRASH;
  var STORAGE_CACHE_KEY = "oros-files-storage-cache";
  var STORAGE_TTL = 5 * 60 * 1000; // 5 minutes TTL

  // ---------- 1. Constants, i18n, helpers ----------

  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "aria.path": "Path",
      "aria.folders": "Folders",
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
      "dlg.deleteConfirm":  "Move to Trash",
      "dlg.deleteFileMsg":   "Move \"{name}\" to Trash? You can restore it for 30 days.",
      "dlg.deleteFolderMsg": "Move \"{name}\" and everything inside it to Trash? You can restore it for 30 days.",
      "dlg.deleteMultiMsg":  "Move {n} selected items to Trash? You can restore them for 30 days.",
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
      "toast.importPartial": "{n} imported, {m} failed",
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
      "sync.conflictKept":  "A file was changed on two devices — both versions were kept",
      "disk.down":       "The disk is not available right now.",
      "disk.downHint":   "Nothing was changed. Reload orOS and try again.",
      "pv.unsaved":      "Unsaved changes — close again to discard them",
      "pv.notUtf8":      "This file is not UTF-8 text. Editing it here would damage it — download it instead.",
      "pv.title":        "Preview",
      "pv.openIn":       "Open in {app}",
      "pv.openWith":     "Open with…",
      "menu.openWith":   "Open with…",
      "menu.sendApp":    "Send to an app…",
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
      "menu.toDropbox": "Send to Dropbox…",
      "menu.copyName": "Copy name",
      "menu.copyPath": "Copy path",
      "menu.copyContent": "Copy content",
      "menu.delete":   "Delete",
      "menu.rename":   "Rename",
      "dlg.deleteForeverTitle": "Delete forever",
      "tree.recent":   "Recent",
      "tree.favs":     "Favourites",
      "tree.trash":    "Trash",
      "fav.add":       "Add to Favourites",
      "fav.remove":    "Remove from Favourites",
      "fav.added":     "Added to Favourites",
      "fav.removed":   "Removed from Favourites",
      "fav.missing":   "Not on this device yet. It may still be syncing.",
      "recent.empty":  "No recent files yet",
      "trash.note":    "Items in Trash are deleted for good after 30 days.",
      "trash.empty":   "Trash is empty",
      "trash.emptyAll":"Empty Trash",
      "trash.restore": "Restore",
      "trash.deleteForever": "Delete forever",
      "trash.moved":   "Moved to Trash",
      "trash.movedMulti": "{n} items moved to Trash",
      "trash.restored":"Restored",
      "trash.restoredAs": "Restored as \"{name}\"",
      "trash.restoredMulti": "{n} items restored",
      "trash.gone":    "Deleted forever",
      "trash.goneMulti": "{n} items deleted forever",
      "trash.emptied": "Trash emptied",
      "trash.notHere": "This item hasn't reached this device yet. Try again after sync.",
      "trash.from":    "from {path}",
      "trash.unknown": "original folder unknown",
      "trash.emptyConfirm": "Delete everything in Trash forever? This can't be undone.",
      "trash.foreverMsg":   "Delete \"{name}\" forever? This can't be undone.",
      "trash.foreverMulti": "Delete {n} items forever? This can't be undone.",
      "search.contents":      "Contents",
      "search.contentsTitle": "Also search inside files (text and PDF)",
      "search.scanning":      "Searching inside files… {n} of {t}",
      "search.walking":       "Searching… {n} items checked",
      "search.more":          "Show more ({n})",
      "search.matchCount":    "{n} matches",
      "search.skipped":       "{n} files were too big or unreadable and were skipped",
      "menu.zip":      "Compress to ZIP",
      "menu.extract":  "Extract here",
      "menu.convert":  "Convert to orOS",
      "zip.archive":   "Archive",
      "zip.working":   "Compressing… {n} of {t}",
      "zip.done":      "Created \"{name}\"",
      "zip.fail":      "The ZIP file couldn't be created",
      "zip.tooBig":    "Too much for one ZIP: up to {n} files and {mb} MB.",
      "zip.extracting":"Extracting… {n} of {t}",
      "zip.extracted": "Extracted {n} files into \"{name}\"",
      "zip.partial":   "{n} files couldn't be extracted",
      "zip.bad":       "This ZIP file can't be read.",
      "zip.big":       "This ZIP is too big to open here (up to {mb} MB).",
      "zip.entries":   "{n} files, {size} unpacked",
      "zip.extract":   "Extract",
      "zip.empty":     "There are no files to extract.",
      "zip.busy":      "Wait for the current ZIP job to finish.",
      "view.grid":     "Grid view",
      "view.list":     "List view",
      "sel.mode":      "Select",
      "sel.done":      "Done",
      "sel.all":       "Select all",
      "sel.count":     "{n} selected",
      "sel.one":       "1 selected",
      "sel.none":      "Tap items to select them",
      "err.reserved":  "This name is reserved for the Trash.",
      "name.newFolder": "New folder",
      "name.newFile":   "New file.txt",
	  "act.import": "Import files",
      "gi.device":     "From this device",
      "gi.drive":      "From Google Drive",
      "gi.photos":     "From Google Photos",
      "gi.titleDrive": "Import from Google Drive",
      "gi.titlePhotos":"Import from Google Photos",
      "gi.signin":     "Sign in to Google in the window that opened. orOS only reads what you pick, once, and lets go of the sign-in right after.",
      "gi.pickPhotos": "Signed in. Open Google Photos and pick the photos and videos to bring in.",
      "gi.openPhotos": "Open Google Photos",
      "gi.waitPhotos": "Waiting for your choice in Google Photos… Press Done there when you have picked.",
      "gi.pickDrive":  "Pick the files in Google Drive's window.",
      "gi.list":       "Reading what you picked…",
      "gi.get":        "Downloading {n} of {m}…",
      "gi.none":       "Nothing was picked.",
      "gi.nothingNew": "Nothing new: everything you picked is already in \"{f}\".",
      "gi.sum":        "{n} files, {s} in all, into \"{f}\".",
      "gi.dupSum":     "{n} already there (same name and size): left out.",
      "gi.skipSum":    "{n} not brought in:",
      "gi.why.big":    "too big (over {s})",
      "gi.why.total":  "over the {s} limit for one import",
      "gi.why.count":  "over {n} files for one import",
      "gi.why.fail":   "could not be downloaded",
      "gi.why.unsupported": "a Google file with nothing to download (folder, form, site or map)",
      "gi.why.notready": "Google is still processing this video",
      "gi.why.bad":    "unreadable answer from Google",
      "gi.dup":        "already there",
      "gi.go":         "Import {n}",
      "gi.close":      "Close",
      "gi.cancel":     "Cancel",
      "gi.writing":    "Saving {n} of {m}…",
      "gi.done":       "{n} files imported into \"{f}\"",
      "gi.doneFail":   "{n} imported, {m} could not be saved",
      "gi.undo":       "Undo",
      "gi.undone":     "Import undone",
      "gi.hintPhotos": "The Google Photos Picker API has to be turned on in the Google Cloud project of the app id in use. See Help.",
      "gi.hintDrive":  "The Google Drive API and the Google Picker API have to be turned on in the Google Cloud project of the app id in use. See Help.",
      "gi.noPicker":   "Google's file picker could not be loaded. Check the connection, or allow apis.google.com.",
      "gi.popup":      "The window was blocked. Allow pop-ups for orOS and press the button again."
    },
    el: {
      "aria.path": "Διαδρομή",
      "aria.folders": "Φάκελοι",
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
      "dlg.deleteConfirm":  "Μεταφορά στον Κάδο",
      "dlg.deleteFileMsg":   "Μεταφορά του «{name}» στον Κάδο; Η επαναφορά είναι δυνατή για 30 ημέρες.",
      "dlg.deleteFolderMsg": "Μεταφορά του «{name}» και όλων των περιεχομένων του στον Κάδο; Η επαναφορά είναι δυνατή για 30 ημέρες.",
      "dlg.deleteMultiMsg":  "Μεταφορά {n} επιλεγμένων στοιχείων στον Κάδο; Η επαναφορά είναι δυνατή για 30 ημέρες.",
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
      "toast.importPartial": "{n} εισήχθησαν, {m} απέτυχαν",
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
      "sync.conflictKept":  "Ένα αρχείο άλλαξε σε δύο συσκευές — κρατήθηκαν και οι δύο εκδοχές",
      "disk.down":       "Ο δίσκος δεν είναι διαθέσιμος αυτή τη στιγμή.",
      "disk.downHint":   "Δεν άλλαξε τίποτα. Φόρτωσε ξανά το orOS και δοκίμασε πάλι.",
      "pv.unsaved":      "Υπάρχουν μη αποθηκευμένες αλλαγές — κλείσε ξανά για απόρριψη",
      "pv.notUtf8":      "Το αρχείο δεν είναι κείμενο UTF-8. Η επεξεργασία εδώ θα το αλλοίωνε — κατέβασέ το.",
      "pv.title":        "Προεπισκόπηση",
      "pv.openIn":       "Άνοιγμα στο {app}",
      "pv.openWith":     "Άνοιγμα με…",
      "menu.openWith":   "Άνοιγμα με…",
      "menu.sendApp":    "Στείλε σε εφαρμογή…",
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
      "menu.toDropbox": "Αποστολή στο Dropbox…",
      "menu.copyName": "Αντιγραφή ονόματος",
      "menu.copyPath": "Αντιγραφή διαδρομής",
      "menu.copyContent": "Αντιγραφή περιεχομένου",
      "menu.delete":   "Διαγραφή",
      "menu.rename":   "Μετονομασία",
      "dlg.deleteForeverTitle": "Οριστική διαγραφή",
      "tree.recent":   "Πρόσφατα",
      "tree.favs":     "Αγαπημένα",
      "tree.trash":    "Κάδος",
      "fav.add":       "Προσθήκη στα Αγαπημένα",
      "fav.remove":    "Αφαίρεση από τα Αγαπημένα",
      "fav.added":     "Προστέθηκε στα Αγαπημένα",
      "fav.removed":   "Αφαιρέθηκε από τα Αγαπημένα",
      "fav.missing":   "Δεν έχει έρθει ακόμα σε αυτή τη συσκευή. Ίσως συγχρονίζεται ακόμα.",
      "recent.empty":  "Δεν υπάρχουν ακόμα πρόσφατα αρχεία",
      "trash.note":    "Ό,τι μπαίνει στον Κάδο διαγράφεται οριστικά μετά από 30 ημέρες.",
      "trash.empty":   "Ο Κάδος είναι άδειος",
      "trash.emptyAll":"Άδειασμα Κάδου",
      "trash.restore": "Επαναφορά",
      "trash.deleteForever": "Οριστική διαγραφή",
      "trash.moved":   "Μεταφέρθηκε στον Κάδο",
      "trash.movedMulti": "Μεταφέρθηκαν {n} στοιχεία στον Κάδο",
      "trash.restored":"Έγινε επαναφορά",
      "trash.restoredAs": "Έγινε επαναφορά ως «{name}»",
      "trash.restoredMulti": "Έγινε επαναφορά {n} στοιχείων",
      "trash.gone":    "Διαγράφηκε οριστικά",
      "trash.goneMulti": "Διαγράφηκαν οριστικά {n} στοιχεία",
      "trash.emptied": "Ο Κάδος άδειασε",
      "trash.notHere": "Αυτό το στοιχείο δεν έχει φτάσει ακόμα σε αυτή τη συσκευή. Δοκίμασε ξανά μετά τον συγχρονισμό.",
      "trash.from":    "από {path}",
      "trash.unknown": "άγνωστος αρχικός φάκελος",
      "trash.emptyConfirm": "Να διαγραφούν οριστικά όλα όσα είναι στον Κάδο; Δεν αναιρείται.",
      "trash.foreverMsg":   "Οριστική διαγραφή του «{name}»; Δεν αναιρείται.",
      "trash.foreverMulti": "Οριστική διαγραφή {n} στοιχείων; Δεν αναιρείται.",
      "search.contents":      "Περιεχόμενο",
      "search.contentsTitle": "Αναζήτηση και μέσα στα αρχεία (κείμενο και PDF)",
      "search.scanning":      "Αναζήτηση μέσα στα αρχεία… {n} από {t}",
      "search.walking":       "Αναζήτηση… ελέγχθηκαν {n} στοιχεία",
      "search.more":          "Περισσότερα ({n})",
      "search.matchCount":    "{n} εμφανίσεις",
      "search.skipped":       "{n} αρχεία ήταν πολύ μεγάλα ή δεν διαβάστηκαν και παραλείφθηκαν",
      "menu.zip":      "Συμπίεση σε ZIP",
      "menu.extract":  "Αποσυμπίεση εδώ",
      "menu.convert":  "Μετατροπή σε orOS",
      "zip.archive":   "Συμπιεσμένο",
      "zip.working":   "Συμπίεση… {n} από {t}",
      "zip.done":      "Δημιουργήθηκε το «{name}»",
      "zip.fail":      "Το αρχείο ZIP δεν δημιουργήθηκε",
      "zip.tooBig":    "Πάρα πολλά για ένα ZIP: έως {n} αρχεία και {mb} MB.",
      "zip.extracting":"Αποσυμπίεση… {n} από {t}",
      "zip.extracted": "Αποσυμπιέστηκαν {n} αρχεία στον φάκελο «{name}»",
      "zip.partial":   "{n} αρχεία δεν αποσυμπιέστηκαν",
      "zip.bad":       "Αυτό το αρχείο ZIP δεν διαβάζεται.",
      "zip.big":       "Το ZIP είναι πολύ μεγάλο για να ανοίξει εδώ (έως {mb} MB).",
      "zip.entries":   "{n} αρχεία, {size} μετά την αποσυμπίεση",
      "zip.extract":   "Αποσυμπίεση",
      "zip.empty":     "Δεν υπάρχουν αρχεία για αποσυμπίεση.",
      "zip.busy":      "Περίμενε να τελειώσει η τρέχουσα εργασία ZIP.",
      "view.grid":     "Προβολή πλέγματος",
      "view.list":     "Προβολή λίστας",
      "sel.mode":      "Επιλογή",
      "sel.done":      "Τέλος",
      "sel.all":       "Επιλογή όλων",
      "sel.count":     "{n} επιλεγμένα",
      "sel.one":       "1 επιλεγμένο",
      "sel.none":      "Πάτα στοιχεία για να τα επιλέξεις",
      "err.reserved":  "Αυτό το όνομα είναι δεσμευμένο για τον Κάδο.",
      "name.newFolder": "Νέος φάκελος",
      "name.newFile":   "Νέο αρχείο.txt",
	  "act.import": "Εισαγωγή αρχείων",
      "gi.device":     "Από αυτή τη συσκευή",
      "gi.drive":      "Από το Google Drive",
      "gi.photos":     "Από το Google Photos",
      "gi.titleDrive": "Εισαγωγή από το Google Drive",
      "gi.titlePhotos":"Εισαγωγή από το Google Photos",
      "gi.signin":     "Συνδέσου στη Google στο παράθυρο που άνοιξε. Το orOS διαβάζει μόνο ό,τι διαλέξεις, μία φορά, και αφήνει τη σύνδεση αμέσως μετά.",
      "gi.pickPhotos": "Συνδέθηκες. Άνοιξε το Google Photos και διάλεξε τις φωτογραφίες και τα βίντεο που θέλεις να φέρεις.",
      "gi.openPhotos": "Άνοιγμα Google Photos",
      "gi.waitPhotos": "Περιμένω την επιλογή σου στο Google Photos… Πάτα «Τέλος» εκεί όταν διαλέξεις.",
      "gi.pickDrive":  "Διάλεξε τα αρχεία στο παράθυρο του Google Drive.",
      "gi.list":       "Διαβάζω ό,τι διάλεξες…",
      "gi.get":        "Λήψη {n} από {m}…",
      "gi.none":       "Δεν διάλεξες τίποτα.",
      "gi.nothingNew": "Τίποτα νέο: ό,τι διάλεξες υπάρχει ήδη στο «{f}».",
      "gi.sum":        "{n} αρχεία, {s} συνολικά, στον φάκελο «{f}».",
      "gi.dupSum":     "{n} υπάρχουν ήδη (ίδιο όνομα και μέγεθος): παραλείπονται.",
      "gi.skipSum":    "{n} δεν θα έρθουν:",
      "gi.why.big":    "πολύ μεγάλο (πάνω από {s})",
      "gi.why.total":  "πάνω από το όριο των {s} ανά εισαγωγή",
      "gi.why.count":  "πάνω από {n} αρχεία ανά εισαγωγή",
      "gi.why.fail":   "η λήψη απέτυχε",
      "gi.why.unsupported": "αρχείο Google χωρίς περιεχόμενο για λήψη (φάκελος, φόρμα, ιστότοπος ή χάρτης)",
      "gi.why.notready": "η Google επεξεργάζεται ακόμα αυτό το βίντεο",
      "gi.why.bad":    "ακατανόητη απάντηση από τη Google",
      "gi.dup":        "υπάρχει ήδη",
      "gi.go":         "Εισαγωγή {n}",
      "gi.close":      "Κλείσιμο",
      "gi.cancel":     "Ακύρωση",
      "gi.writing":    "Αποθήκευση {n} από {m}…",
      "gi.done":       "{n} αρχεία μπήκαν στο «{f}»",
      "gi.doneFail":   "Μπήκαν {n}, {m} δεν αποθηκεύτηκαν",
      "gi.undo":       "Αναίρεση",
      "gi.undone":     "Η εισαγωγή αναιρέθηκε",
      "gi.hintPhotos": "Πρέπει να ενεργοποιηθεί το Google Photos Picker API στο έργο Google Cloud του αναγνωριστικού εφαρμογής που χρησιμοποιείται. Δες τη Βοήθεια.",
      "gi.hintDrive":  "Πρέπει να ενεργοποιηθούν το Google Drive API και το Google Picker API στο έργο Google Cloud του αναγνωριστικού εφαρμογής που χρησιμοποιείται. Δες τη Βοήθεια.",
      "gi.noPicker":   "Δεν φορτώθηκε το παράθυρο επιλογής αρχείων της Google. Έλεγξε τη σύνδεση ή επίτρεψε το apis.google.com.",
      "gi.popup":      "Το παράθυρο μπλοκαρίστηκε. Επίτρεψε τα αναδυόμενα για το orOS και πάτα ξανά το κουμπί."
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

  var MORE_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  var TRASH_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  var CLOCK_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>';
  var STAR_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/></svg>';
  var STAR_FILLED_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/></svg>';
  var RESTORE_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/></svg>';
  var ZIP_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M10 4h2M10 7h2M10 10h2M10 13h2"/><rect x="9" y="15" width="4" height="4" rx="1"/></svg>';
  var CONVERT_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>';
  var UNZIP_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 10v6M9 13l3 3 3-3"/></svg>';
  var GRID_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  var LIST_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>';
  var CHECK_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="8 12 11 15 16 9"/></svg>';
  var CHECK_ALL_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 6 16 13 8"/><polyline points="11 15 12 16 21 7"/></svg>';
  var TEXT_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
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

  // What the list shows (wave 3): "files" = the folder cwd, "recent" =
  // the Recent list, "trash" = the Trash. Session-only (R10).
  var view = "files";
  var selectMode = false;        // touch-friendly Select mode (checkboxes + bottom bar)

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.ver === DATA_VER && p.expanded && typeof p.last === "string") {
          prefs = p;
          if (prefs.layout !== "grid") prefs.layout = "list";
          prefs.contents = prefs.contents === true;
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
    prefs = {
      ver: DATA_VER,
      expanded: {},
      last: ROOT,
      sortField: "name",      // "name" | "size" | "date"
      sortAsc: true,          // ascending by default
      layout: "list",         // "list" | "grid" (wave 3, this device)
      contents: false         // search inside files too (wave 3, this device)
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

  // A rename / move inside Files: the journal follows the item.
  function recentsMove(from, to) {
    var r = recentsRead(), changed = false;
    r.forEach(function (e) {
      if (e.p === from || e.p.indexOf(from + "/") === 0) { e.p = to + e.p.slice(from.length); changed = true; }
    });
    if (changed) { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(r)); } catch (e2) {} }
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
      if (selectedPaths[entryPath(ordered[i])]) {
        return { name: ordered[i].name,
                 dir: !!ordered[i].dir,
                 path: entryPath(ordered[i]) };
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
  // "Convert to orOS": the selected files the orOS Converter takes
  // (converter/registry.js), only when that app is installed.
  function convertiblePaths() {
    var reg = window.OrosConvertRegistry, env = null;
    try { env = window.parent && window.parent !== window ? window.parent.orosTodayEnv : null; } catch (e) {}
    if (!reg || !env || typeof env.apps !== "function" ||
        !env.apps().some(function (a) { return a && a.id === "converter"; })) return [];
    var dirs = {};
    lastEntries.forEach(function (e) { if (e.dir) dirs[entryPath(e)] = true; });
    return selectionPaths().filter(function (p) {
      return !dirs[p] && !CORE.isTrashPath(p) && !!reg.forName(baseName(p));
    });
  }
  function convertSelection() {
    var paths = convertiblePaths();
    if (!paths.length) return;
    try { window.parent.__orosOpenAt("converter", { paths: paths }); } catch (e) {}
  }
  // ---------- Open in an app / send to an app (app interop wave 2) ----------
  // A file of the orOS disk opens in the app that reads its type
  // (shell fileopen.js: the person's choice for the type, the only app,
  // or the chooser; BR-FO-9). A song already under Music plays there.
  var APP_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>';
  var MUSIC_ROOT = "/internal/Music/";
  var AUDIO_RE = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav|wave|weba)$/i;
  function fileOpenApi() {
    try {
      var o = window.parent && window.parent !== window ? window.parent.orosFileOpen : null;
      return o && typeof o.openInside === "function" && typeof o.insideFor === "function" ? o : null;
    } catch (e) { return null; }
  }
  function appsForFile(name) {
    var o = fileOpenApi(), m = /\.([a-z0-9]{1,24})$/i.exec(String(name || ""));
    return o && m ? o.insideFor("." + m[1].toLowerCase()) : [];
  }
  function shellAppName(id) {
    try {
      var k = "app." + id, v = window.parent.t(k);
      return v && v !== k ? v : id;
    } catch (e) { return id; }
  }
  // Only what the preview cannot show well opens in an app on a double
  // click / tap: text, pictures and zips keep the preview.
  function opensInApp(name) {
    return !isTextExt(name) && !isImageExt(name) && CORE.extOf(name) !== "zip" && appsForFile(name).length > 0;
  }
  function openInApp(path, ask) {
    var o = fileOpenApi(), name = baseName(path);
    if (!o) return;
    var apps = appsForFile(name);
    if (!apps.length) return;
    recentsTouch(path);
    if (AUDIO_RE.test(name) && path.indexOf(MUSIC_ROOT) === 0 && (!ask || apps.length === 1) && apps.indexOf("music") !== -1) {
      try { window.parent.__orosOpenAt("music", { playPath: path }); } catch (e) {}
      return;
    }
    FS().read(path).then(function (blob) {
      if (!blob) { transientNote(t("pv.notFound")); return; }
      var file = blob instanceof File && blob.name === name ? blob : new File([blob], name, { type: blob.type || mimeForExt(extOf(name)) });
      o.openInside(file, !!ask);
    }, function () { transientNote(t("pv.notFound")); });
  }
  function sendApi() {
    try { return window.parent !== window && window.parent.orosSend ? window.parent.orosSend : null; }
    catch (e) { return null; }
  }
  // Selected files to another app (today Mail, as attachments).
  function sendSelection() {
    var api = sendApi();
    if (!api) return;
    var dirs = {};
    lastEntries.forEach(function (e) { if (e.dir) dirs[entryPath(e)] = true; });
    var items = selectionPaths().filter(function (p) { return !dirs[p]; }).slice(0, 10)
      .map(function (p) { return { path: p, name: baseName(p) }; });
    if (items.length) api.open({ kind: "files", data: { items: items } });
  }

  // Rows of the Recent and Trash views carry their own full path.
  function entryPath(e) { return e.path || join(cwd, e.name); }

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

  // raw === true keeps the hidden Trash folder (/internal/.trash);
  // every view, chooser and search of this app leaves it out.
  function fsList(path, raw) {
    return FS().ls(path).then(function (list) {
      var dirs = [], files = [];
      (list || []).forEach(function (e) {
        if (!raw && path === ROOT && e.name === ".trash") return;
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
    applyViewChrome();
    if (view === "trash") { renderTrashView(); return; }
    if (view === "recent") { renderRecentView(); return; }
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
      fillStats(sorted, token);
    }).catch(function (e) {
      if (token !== renderToken) return;
      lastEntries = [];
      renderEntries([]);
      renderStatus(0);
      // FL-7: any failure that is NOT "this folder does not exist"
      // means the disk itself did not answer (fs.js EIO: the pinned
      // backend could not be opened). An empty list under the words
      // "This folder is empty" would be a lie — and an invitation to
      // start over on top of files that are still there.
      if (!e || e.code !== "ENOENT") {
        showDiskDown();
        return;
      }
      if (e && e.code === "ENOENT") {
        prefs.last = ROOT;
        savePrefs();   // FL-8: persist the fallback — no ghost-folder loop after reboot
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

  function showDiskDown() {
    var em = $("empty");
    if (em) {
      em.hidden = false;
      var a = em.querySelector("span"), b = em.querySelector("small");
      if (a) a.textContent = t("disk.down");
      if (b) b.textContent = t("disk.downHint");
    }
    hideRecents();
    ["new-folder", "new-file", "pick-files"].forEach(function (id) {
      var el = $(id);
      if (el) { el.disabled = true; el.dataset.down = "1"; }
    });
  }

  function navigate(path) {
    var d = dbx();
    if (d && d.isActive()) d.leave();
    var dv = drv();
    if (dv && dv.isActive()) dv.leave();
    view = "files";
    cwd = path;
    if (selectMode) setSelectMode(false);
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
    var special = view !== "files";
    $("up").disabled = (cwd === ROOT && !special);
    $("rename").disabled = (n !== 1 || view === "trash");
    $("delete").disabled = (n === 0);
    $("delete").classList.toggle("danger-arm", n > 0);
    var more = $("more-actions");
    if (more) more.disabled = (n === 0);
    ["new-folder", "new-file", "pick-files"].forEach(function (id) {
      var el = $(id);
      if (el && special) el.disabled = true;
      else if (el && el.dataset.down !== "1") el.disabled = false;
    });
    renderSelBar();
  }

  // ---------- 5. Folder tree render (lazy, expanded, DROP TARGETS) ----------

  function renderTree() {
    var host = $("tree-root");
    var token = renderToken;
    host.innerHTML = "";
    host.appendChild(makeQuickSection());
    host.appendChild(makeTreeNode(ROOT, t("tree.root"), 0, token));
    var dv = drv();
    if (dv) host.appendChild(dv.treeNode());
    host.appendChild(makeSpecialNode("trash", t("tree.trash"), TRASH_SVG));
    var d = dbx();
    if (d) host.appendChild(d.treeNode());
  }

  // The whole Dropbox (files/dropbox.js): a second place in the tree,
  // read-only, outside the disk. Absent script = no Dropbox node.
  function dbx() {
    var d = window.OrosFilesDropbox;
    return (d && typeof d.treeNode === "function") ? d : null;
  }
  function dbxActive() { var d = dbx(); return !!(d && d.isActive()); }

  // orOS Drive folders, on demand (files/drive.js, vault.js VD-OD).
  function drv() {
    var d = window.OrosFilesDrive;
    return (d && typeof d.treeNode === "function") ? d : null;
  }
  // Another place (Dropbox, orOS Drive) is shown instead of the disk.
  function placeActive() { var dv = drv(); return dbxActive() || !!(dv && dv.isActive()); }

  function initDrive() {
    var dv = drv();
    if (!dv) return;
    dv.init({
      toast: transientNote,
      closeDrawer: closeTreeDrawer,
      onEnter: function () {
        var d = dbx();
        if (d && d.isActive()) d.leave();
        view = "files"; setSelectMode(false); clearSelection();
      },
      afterEnter: renderTree,
      fs: FS,
      vault: vaultApi,
      fmtKB: fmtKB,
      openFile: openFileAt,
      onDiskChanged: forceStorageRecalc
    });
  }

  // Wave 3: plain copies of the selection into a Dropbox folder.
  function sendToDropbox() {
    var d = dbx(), paths = selectionPaths();
    if (!d || !d.exportFrom || !paths.length || view === "trash") return;
    d.exportFrom(paths);
  }

  function initDropbox() {
    var d = dbx();
    if (!d) return;
    d.init({
      toast: transientNote,
      dialogHost: dialogHost,
      closeDrawer: closeTreeDrawer,
      onEnter: function () {
        var dv = drv();
        if (dv && dv.isActive()) dv.leave();
        view = "files"; setSelectMode(false); clearSelection(); renderTree();
      },
      fmtKB: fmtKB,
      fs: FS,
      vault: vaultApi,
      pickFolder: pickFolderDialog,
      diskRoot: ROOT,
      trash: TRASH,
      isImageExt: isImageExt,
      isTextExt: isTextExt,
      mimeFor: function (name) { return isTextExt(name) ? "text/plain" : mimeForExt(extOf(name)); }
    });
  }

  function makeTreeNode(path, label, depth, token) {
    var wrap = document.createElement("div");

    var node = document.createElement("div");
    node.className = "tnode" + (path === cwd && view === "files" && !placeActive() ? " selected" : "");
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
  
  // FL-12 (A64a): ls() returns only {name, dir}; stat each file in
  // the background (read-only) and fill the size/date columns. A
  // newer render (renderToken) wins; a size/date sort re-sorts once.
  var STAT_CAP = 400;
  function fillStats(entries, token) {
    var fs = FS();
    if (!fs || typeof fs.stat !== "function") return;
    var dir = cwd;
    var todo = entries.filter(function (e) { return !e.dir && e.size === undefined && !e.missing; }).slice(0, STAT_CAP);
    if (!todo.length) return;
    Promise.all(todo.map(function (e) {
      return fs.stat(e.path || join(dir, e.name)).then(function (st) {
        e.size = st && typeof st.size === "number" ? st.size : null;
        if (!e.keepDate) e.mtime = st && st.mtime ? st.mtime : null;
      }, function () { e.size = null; });
    })).then(function () {
      if (token !== renderToken || dir !== cwd) return;
      var field = prefs.sortField || "name";
      if (field !== "name") {
        lastEntries = applySort(lastEntries);
        renderEntries(lastEntries);
        return;
      }
      todo.forEach(function (e) {
        var li = document.querySelector('#entries .entry[data-path="' + cssEsc(e.path || join(dir, e.name)) + '"]');
        if (!li) return;
        li.querySelector(".col-size").textContent = fmtSizeCol(e);
        if (!e.keepDate) li.querySelector(".col-date").textContent = fmtDateCol(e);
      });
    });
  }

  function cssEsc(v) {
    return (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&");
  }

  function fmtSizeCol(e) {
    return (!e.dir && typeof e.size === "number") ? fmtKB(e.size) : "-";
  }

  function fmtDateCol(e) {
    if (e.dir || !e.mtime) return "-";
    try {
      return new Date(e.mtime).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "2-digit", month: "2-digit", year: "2-digit" });
    } catch (x) { return "-"; }
  }

  // ---------- 5b. Sorting helpers ----------

  function applySort(entries) {
    var field = prefs.sortField || "name";
    var asc = prefs.sortAsc !== false;

    return entries.slice().sort(function (a, b) {
      // FL-Q2: dirs always first, matching fsList()'s contract —
      // size/date sorts were silently interleaving folders/files.
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
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
    ul.classList.toggle("grid", prefs.layout === "grid");
    thumbReset();

    // FD/FE4: single branch — the old first case (root + empty) was
    // fully covered by the second: entries.length > 0 === false →
    // hidden = false. Identical outcome, half the code.
    if (searchQuery === null) {
      $("empty").hidden = entries.length > 0;
    }

    // #4 FIX: ensure recents section DOM element exists (JS-injected)
    ensureRecentsSection();

    entries.forEach(function (e, idx) {
      var path = entryPath(e);
      var li = document.createElement("li");

      // #7 FIX: grid layout — 4 columns: icon(20px) | name(1fr) | size(90px) | date(80px)
      // The .ext badge is removed from desktop rows (mobile hides it anyway)
      li.className = "entry" + (selectedPaths[path] ? " selected" : "") +
        (e.missing ? " missing" : "");
      li.dataset.path = path;
      li.dataset.index = String(idx);
      li.tabIndex = 0;
      li.draggable = view !== "trash";

      // Select mode: a check box takes the icon's place (CSS).
      var check = document.createElement("span");
      check.className = "sel-check";
      check.setAttribute("aria-hidden", "true");
      li.appendChild(check);

      var glyph = document.createElement("span");
      glyph.className = "glyph " + (e.dir ? "folder" : "file");
      glyph.innerHTML = e.dir ? FOLDER_SVG : FILE_SVG;
      li.appendChild(glyph);

      var name = document.createElement("span");
      name.className = "ename col-name";
      if (e.sub) {
        name.classList.add("two");
        var nm = document.createElement("span");
        nm.className = "en";
        nm.textContent = e.name;
        var sb = document.createElement("span");
        sb.className = "esub";
        sb.textContent = e.sub;
        name.appendChild(nm);
        name.appendChild(sb);
      } else {
        name.textContent = e.name;
      }
      li.title = e.name;
      li.appendChild(name);

      // Size / modified columns — filled by fillStats() (FL-12).
      var sizeSpan = document.createElement("span");
      sizeSpan.className = "col-size";
      sizeSpan.textContent = fmtSizeCol(e);
      li.appendChild(sizeSpan);

      var dateSpan = document.createElement("span");
      dateSpan.className = "col-date";
      dateSpan.textContent = fmtDateCol(e);
      li.appendChild(dateSpan);

      if (prefs.layout === "grid" && !e.dir && !e.missing) thumbWatch(li, path, e.name);

      // Click: single / Ctrl+toggle / Shift+range (desktop
      // convention). Plain single click clears everything first.
      li.addEventListener("click", function (ev) {
        if (swallowClick) { swallowClick = false; return; }
        handleClickSelect(ev, li, idx, e);
      });
      li.addEventListener("dblclick", function () {
        if (selectMode) return;
        activateEntry(e, path);
      });
      attachLongPress(li, path);

      // DRAG SOURCE (internal move). Payload: our private MIME type.
      // The dragstart flag lets handleDrop() distinguish internal
      // moves from OS-imported files (which carry Files/* types).
      li.addEventListener("dragstart", function (ev) {
        if (view === "trash") { ev.preventDefault(); return; }
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

      // CONTEXT MENU (right-click) — desktop. A finger's long press
      // opens Select mode instead (attachLongPress).
      li.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        if (lastPointerTouch) return;
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

      // Keyboard: Enter = activate (navigate/open), Space = toggle,
      // Delete = Trash, Shift+Delete = delete forever
      li.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          activateEntry(e, path);
        } else if (ev.key === " ") {
          ev.preventDefault();
          selectedPaths[path] = !selectedPaths[path];
          li.classList.toggle("selected", !!selectedPaths[path]);
          updateActionButtons();
        } else if (ev.key === "Delete") {
          ev.preventDefault();
          if (selectionCount() > 0) openDeleteDialog(ev.shiftKey || view === "trash" ? "forever" : "trash");
        }
      });

      ul.appendChild(li);
    });
  }

  // #4 FIX: ensure recents-section DOM element exists
  function ensureRecentsSection() {
    var sec = $("recents-section");
    if (sec) return;   // FL-10: visibility owned by showRecents/hideRecents
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

  // Open a folder / preview a file (double click, Enter, second tap).
  function activateEntry(e, path) {
    if (view === "trash") return;       // Restore / Delete forever live in the menus
    if (e.missing) { transientNote(t("fav.missing")); return; }
    if (e.dir) {
      clearSelection();
      navigate(path);
    } else if (opensInApp(e.name || baseName(path))) {
      openInApp(path, false);
    } else {
      recentsTouch(path);
      openPreview(path);
    }
  }

  function coarsePointer() {
    try { return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); }
    catch (e) { return false; }
  }

  function handleClickSelect(ev, li, idx, e) {
    var path = li.dataset.path;
    if (selectMode) {
      selectedPaths[path] = !selectedPaths[path];
      if (selectedPaths[path]) anchorIndex = idx;
      paintSelection();
      updateActionButtons();
      return;
    }
    // FL-6: on touch screens a double tap is not a reliable event
    // (iOS never sends dblclick) — a folder could not be entered and
    // a file could not be opened. First tap selects, a second tap on
    // the SAME, only-selected row activates it.
    if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey && coarsePointer() &&
        selectedPaths[path] && selectionCount() === 1) {
      activateEntry(e, path);
      return;
    }

    if (ev.shiftKey && anchorIndex >= 0) {
      // Range: anchor → clicked, inclusive, within current listing
      var from = Math.min(anchorIndex, idx);
      var to = Math.max(anchorIndex, idx);
      for (var i = from; i <= to; i++) {
        var pe = entryPath(lastEntries[i]);
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
    home.className = "crumb" + (cwd === ROOT || view !== "files" ? " current" : "");
    home.textContent = view === "files" ? t("tree.root") : t("tree." + view);
    home.addEventListener("click", function () { if (view === "files") navigate(ROOT); });
    host.appendChild(home);

    if (cwd === ROOT || view !== "files") return;

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

  function statusPath() {
    if (view !== "files") return t("tree." + view);
    return searchQuery !== null ? tfmt("search.where", { path: searchDir }) : cwd;
  }

  function setStatusLoading() {
    var sel = selectionCount();
    $("st-count").textContent = jobText || (sel
      ? tfmt("status.selItems", { n: sel, t: lastEntries.length })
      : t("status.loading"));
    $("st-path").textContent = statusPath();
  }

  var lastCount = 0;
  function renderStatus(count) {
    var sel = selectionCount();
    lastCount = count;
    $("st-count").textContent = jobText || (sel
      ? tfmt("status.selItems", { n: sel, t: count })
      : (count === 1 ? t("status.oneItem") : tfmt("status.items", { n: count })));
    $("st-path").textContent = statusPath();
  }

  // A long job (ZIP) owns the left of the status bar while it runs.
  var jobText = "";
  function setJob(text) {
    jobText = text || "";
    renderStatus(lastCount);
  }
  
    // ---------- 8. Dialogs: create / rename / delete / overwrite /
  //               move-copy picker ----------

  var DIALOG_MODE = null;

  function validateName(raw, existingNames) {
    var name = raw.trim();
    if (!name) return { ok: false, err: t("err.required") };
    if (BAD_CHARS.test(name)) return { ok: false, err: t("err.chars") };
    if (dialogDir === ROOT && name === ".trash") return { ok: false, err: t("err.reserved") };
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
    // Rename works where the item is (the Recent view shows items of
    // many folders); new items go into the open folder.
    dialogDir = (mode === "rename" && primary) ? parentOf(primary.path) : cwd;
    if (dialogDir === "/") dialogDir = ROOT;
    origListChain = fsList(dialogDir, true).catch(function () { return []; });
    $("dlg-name").showModal();
    setTimeout(function () { $("name-input").focus(); }, 50);
  }

  var origListChain = null;
  var dialogDir = ROOT;

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
      var dir = dialogDir;
      if (DIALOG_MODE === "folder") {
        op = FS().mkdir(join(dir, name)).then(function () {
          transientNote(t("toast.createdFolder"));
        });
      } else if (DIALOG_MODE === "file") {
        op = FS().writeText(join(dir, name), "").then(function () {
          recentsTouch(join(dir, name));
          transientNote(t("toast.createdFile"));
        });
      } else if (DIALOG_MODE === "rename" && selectionPrimary()) {
        var prim = selectionPrimary();
        op = FS().mv(prim.path, join(dir, name)).then(function () {
          if (prim.dir) renameExpandedPrefix(prim.path, join(dir, name));
          recentsMove(prim.path, join(dir, name));
          recentsTouch(join(dir, name));
          favCarry(prim.path, join(dir, name));
          transientNote(t("toast.renamed"));
        });
      }
      if (!op) { $("dlg-name").close(); return; }
      op.then(function () {
        markDirty();
        clearSelection();
        $("dlg-name").close();
        refresh();
      }).catch(function () {
        transientNote(t("toast.opFail"));
        $("dlg-name").close();
        refresh();
      });
    });
    return false;
  }

  // Delete — single or bulk, same guarded dialog. mode: "trash" (the
  // default: Files moves items into its Trash), "forever" (Shift+Delete,
  // or inside the Trash) or "empty" (Empty Trash).
  var deleteMode = "trash";
  function openDeleteDialog(mode) {
    deleteMode = mode === "forever" || mode === "empty" ? mode : (view === "trash" ? "forever" : "trash");
    var n = selectionCount();
    if (n === 0 && deleteMode !== "empty") return;
    var msg;
    if (deleteMode === "empty") {
      msg = t("trash.emptyConfirm");
    } else if (n === 1) {
      var p = selectionPrimary();
      if (deleteMode === "forever") msg = tfmt("trash.foreverMsg", { name: p.name });
      else msg = (p.dir ? t("dlg.deleteFolderMsg") : t("dlg.deleteFileMsg")).split("{name}").join(p.name);
    } else {
      msg = tfmt(deleteMode === "forever" ? "trash.foreverMulti" : "dlg.deleteMultiMsg", { n: n });
    }
    $("delete-title").textContent = deleteMode === "trash" ? t("dlg.deleteTitle")
      : deleteMode === "empty" ? t("trash.emptyAll") : t("dlg.deleteForeverTitle");
    var ok = $("delete-form").querySelector('button[type="submit"]');
    if (ok) ok.textContent = deleteMode === "trash" ? t("dlg.deleteConfirm")
      : deleteMode === "empty" ? t("trash.emptyAll") : t("trash.deleteForever");
    $("delete-msg").textContent = msg;
    $("dlg-delete").showModal();
  }

  function confirmDelete() {
    if (deleteMode === "empty") emptyTrash();
    else if (view === "trash") trashForever(selectionPaths());
    else if (deleteMode === "forever") performDeleteForever(selectionPaths());
    else performDelete(selectionPaths());
  }

  // Files' own Delete: into the Trash (other apps that call
  // orosFS.rm still delete at once — this is the Files app's bin).
  function performDelete(paths) {
    if (!paths || !paths.length) return Promise.resolve();
    var ok = 0, fail = 0, chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        return moveToTrash(p).then(function () {
          dropExpandedPrefix(p);
          favDropPath(p);
          ok++;
        }, function () { fail++; });
      });
    });
    return chain.then(function () {
      if (!fail) {
        transientNote(ok === 1 ? t("trash.moved") : tfmt("trash.movedMulti", { n: ok }));
      } else {
        transientNote(t("toast.opFail"));
      }
      clearSelection();
      if (ok > 0) markDirty();
      refresh();
    });
  }

  function performDeleteForever(paths) {
    if (!paths || !paths.length) return;
    Promise.all(paths.map(function (p) {
      return FS().rm(p).then(function () {
        dropExpandedPrefix(p);
        favDropPath(p);
        return true;
      }).catch(function () { return false; });
    })).then(function (results) {
      var ok = results.filter(Boolean).length;
      if (ok === paths.length) {
        transientNote(ok === 1 ? t("trash.gone") : tfmt("trash.goneMulti", { n: ok }));
      } else {
        transientNote(t("toast.opFail"));
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

    return pickFolderDialog(t(mode === "move" ? "dlg.moveTitle" : "dlg.copyTitle"),
                            t(mode === "move" ? "dlg.move" : "dlg.copy")).then(function (dst) {
      if (!dst) return;
      if (mode === "move") performMove(paths, dst);
      else performCopy(paths, dst);
    });
  }

  // A disk folder chooser: resolves the chosen path, or null on cancel.
  // Also used by the Dropbox view (copy / move into the disk).
  function pickFolderDialog(titleText, okText) {
    return new Promise(function (resolve) {
      var stale = $("dlg-picker");
      if (stale) stale.remove();

      var dlg = document.createElement("dialog");
      dlg.id = "dlg-picker";
      dlg.className = "f-dialog";

      var title = document.createElement("h3");
      title.textContent = titleText;
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
          fsList(path).then(function (list) {
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
      okBtn.textContent = okText;
      okBtn.addEventListener("click", function () { dlg.close(); resolve(chosen); });
      row.appendChild(cancelBtn);
      row.appendChild(okBtn);

      dlg.appendChild(title);
      dlg.appendChild(label);
      dlg.appendChild(treeHost);
      dlg.appendChild(row);
      document.body.appendChild(dlg);
      dlg.addEventListener("cancel", function () { resolve(null); });
      dlg.showModal();
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
        if (!warned) { transientNote(t("toast.sameFolder")); warned = true; }
        return false;
      }
      if (dst.indexOf(p + "/") === 0) {
        if (!warned) { transientNote(t("toast.intoItself")); warned = true; }
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
      if (paths.length && !warned) transientNote(t("toast.sameFolder"));
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
            recentsMove(p, join(dst, name));
            favCarry(p, join(dst, name));
            moved++;
            dstNames.push(name);
          }).catch(function () { skipped++; });
        });
      });
      return chain.then(function () {
        if (moved) {
          transientNote(moved === 1
            ? tfmt("toast.movedSingle", { dst: dst === ROOT ? t("tree.root") : baseName(dst) })
            : tfmt("toast.movedMulti", { n: moved }));
        }
        if (skipped) transientNote(tfmt("toast.skippedDupes", { n: skipped }));
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
        transientNote(t("toast.sameFolder"));
        return;
      }
      if (dst.indexOf(p + "/") === 0) {
        transientNote(t("toast.intoItself"));
        return;
      }
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
          transientNote(copied === 1
            ? tfmt("toast.copiedSingle", { dst: dst === ROOT ? t("tree.root") : baseName(dst) })
            : tfmt("toast.copiedMulti", { n: copied }));
        }
        if (skipped) transientNote(tfmt("toast.skippedDupes", { n: skipped }));
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
      return FS().write(dst, blob || new Blob([""])).then(function () {
        return true;
      });
    });
  }

  // "(1)" suffix generator — matches desktop file-manager behavior
  function uniqueName(name, taken) { return CORE.uniqueName(name, taken); }

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

    if (view !== "files" && dstPath === cwd && !(orosPathsRaw && draggingEntryPath)) return;
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
        transientNote(tfmt("toast.imported", { n: imported }));
        // FL-1: skipped counts REAL write failures (post FL-1c),
        // never keep-both decisions — keep-both returns true.
        if (skipped) transientNote(tfmt("toast.importPartial", { n: imported, m: skipped }));
        forceStorageRecalc();
        markDirty();
      } else if (skipped) {
        transientNote(t("toast.importFail"));
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
        return writeFileDst(file, dst).then(function (ok) { return ok; });
      }
      if (st.dir) {
        // Destination is a folder → write INSIDE it, uniquified
        // FC3: list the KNOWN path `dst` — never rely on st.path
        // being part of the fs.js stat contract
        return dstListChain(dst).then(function (innerNames) {
          var inner = uniqueName(name, innerNames);
          return writeFileDst(file, join(dst, inner)).then(function (ok) { return ok; });
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
            return writeFileDst(file, join(dstPath, both)).then(function (ok) { return ok; });
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
    var n = name.replace(/[\/\\:*?"<>|]/g, "_");
    return n === ".trash" ? "_trash" : n;
  }

  // #22 FIX: no dead base64 computation — Blob flows straight into
  // FS().write() (fs.js toBlob handles Blob/ArrayBuffer/string).
  // Text files still route via readAsText for encoding sanity.
  function writeFileDst(file, path) {
    // Direct pass-through: file is already a Blob, fs.toBlob handles it
    return FS().write(path, file).then(function () {
      recentsTouch(path);
      return true;
    }).catch(function () {
      return false;
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
    return fsList(dir, true).then(function (entries) {
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
    var dlg = dialogHost();
    // FL-5: several files at once, like the standalone fallback below
    // (the shell picker was asked for ONE file).
    if (dlg && typeof dlg.openFiles === "function") {
      dlg.openFiles("*/*").then(function (files) {
        if (files && files.length) importFilesList(files, cwd);
      });
      return;                     // cancel (null) = silent exit
    }
    if (dlg && typeof dlg.openFile === "function") {
      dlg.openFile("*/*").then(function (file) {
        if (file) importFilesList([file], cwd);
      });
      return;
    }
    // Standalone fallback — legacy hidden input (no shell present).
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

  // ---------- 9b. One-time import from Google Drive / Google Photos ----------
  // The Import button opens a small menu when this orOS can sign in to
  // Google (../google-import.js: a client id; Drive also needs the
  // person's own browser API key). The reading is files/gmedia.js's:
  // the person picks in Google's own picker, orOS downloads exactly
  // that while the one-scope token lives, then revokes it. The
  // preview lists names, sizes, the total and what is left out; then
  // ONE write pass into "Imported from Google Drive / Photos" (the
  // same fs.js write as any import, so Vault Drive syncs it file by
  // file), and a toast whose Undo removes exactly the files added.
  // Files keeps no metadata of its own: a file is "already there"
  // when the folder has the same name (or it made unique) and size.

  var GI_IMAGE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

  function recentsDrop(path) {
    var r = recentsRead(), keep = r.filter(function (e) { return e.p !== path; });
    if (keep.length !== r.length) { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(keep)); } catch (e) {} }
  }

  function gImp() { return window.OrosGoogleImport || null; }
  function gMedia() { return window.OrosGoogleMedia || null; }
  function googleOffer() {
    var GI = gImp();
    if (!GI || !gMedia() || typeof GI.ready !== "function") return { drive: false, photos: false };
    return { photos: GI.ready(), drive: typeof GI.driveReady === "function" && GI.driveReady() };
  }

  function openImportMenu(ev) {
    var g = googleOffer();
    if (!g.drive && !g.photos) { openFilePicker(); return; }
    if (ev) ev.stopPropagation();
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; return; }
    ctxMenu = document.createElement("div");
    ctxMenu.id = "context-menu";
    ctxMenu.className = "gi-menu";
    function item(svg, key, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.id = "gi-m-" + key.split(".")[1];
      b.innerHTML = svg + '<span class="cm-label"></span>';
      b.querySelector(".cm-label").textContent = t(key);
      b.addEventListener("click", function () { close(); fn(); });
      ctxMenu.appendChild(b);
    }
    function close() {
      if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
      document.removeEventListener("click", outside);
    }
    function outside(e) { if (ctxMenu && !ctxMenu.contains(e.target)) close(); }
    item(IMPORT_SVG, "gi.device", openFilePicker);
    if (g.drive) item(FILE_SVG, "gi.drive", function () { startGoogle("drive"); });
    if (g.photos) item(GI_IMAGE_SVG, "gi.photos", function () { startGoogle("photos"); });
    document.body.appendChild(ctxMenu);
    var r = $("pick-files").getBoundingClientRect();
    var mw = ctxMenu.offsetWidth || 200;
    ctxMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + "px";
    ctxMenu.style.top = (r.bottom + 4) + "px";
    setTimeout(function () { document.addEventListener("click", outside); }, 0);
  }

  var gi = null;            // the import under way: { kind, stopped, … }

  function giDialog() {
    var d = $("dlg-gimport");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "dlg-gimport";
    d.className = "gi-dlg";
    d.innerHTML = '<h3 id="gi-title"></h3><p id="gi-stat" aria-live="polite"></p>' +
      '<p id="gi-hint" class="hint" hidden></p><ul id="gi-list" class="gi-list" hidden></ul>' +
      '<menu><button type="button" id="gi-cancel"></button><span class="spacer"></span>' +
      '<button type="submit" id="gi-act" hidden></button></menu>';
    document.body.appendChild(d);
    $("gi-cancel").addEventListener("click", function () { d.close(); });
    $("gi-act").addEventListener("click", function () { if (gi && gi.act) gi.act(); });
    d.addEventListener("cancel", function (e) { if (gi && gi.writing) e.preventDefault(); });
    d.addEventListener("close", function () {
      if (!gi || gi.hidden) return;
      var g = gi;
      if (g.writing) return;
      gi = null;
      g.stopped = true;
      if (g.reject) g.reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
      var GI = gImp();
      if (GI && !g.read) GI.cancel();
    });
    return d;
  }
  function giStat(text) { $("gi-stat").textContent = text || ""; }
  function giHint(text) { var h = $("gi-hint"); h.textContent = text || ""; h.hidden = !text; }
  function giAct(label, fn) {
    var b = $("gi-act");
    b.hidden = !label;
    b.textContent = label || "";
    if (gi) gi.act = fn || null;
  }

  // Must run inside the click: the sign-in window opens synchronously.
  function startGoogle(kind) {
    var GI = gImp(), GM = gMedia();
    if (!GI || !GM) return;
    var d = giDialog();
    if (gi) { var old = gi; gi = null; old.stopped = true; }
    var me = { kind: kind, stopped: false, read: false };
    if (kind === "drive") GM.loadPicker().catch(function () {});   // Google's script: on this click, not before
    var hooks = {
      stopped: function () { return me.stopped; },
      progress: function (phase, n, m) {
        if (gi !== me) return;
        if (phase === "list") giStat(t("gi.list"));
        else if (phase === "get") giStat(tfmt("gi.get", { n: n, m: m }));
      },
      open: function (uri) {
        return new Promise(function (resolve, reject) {
          me.reject = reject;
          giStat(t("gi.pickPhotos"));
          giAct(t("gi.openPhotos"), function () {
            var w = null;
            try { w = window.open(uri, "oros-gphotos-" + Date.now(), "popup,width=1000,height=760"); } catch (e) { w = null; }
            if (!w) { giStat(t("gi.popup")); return; }
            try { w.opener = null; } catch (e) {}
            me.reject = null;
            giAct(null);
            giStat(t("gi.waitPhotos"));
            resolve();
          });
        });
      },
      // Google's picker is a layer of this page: our modal dialog
      // would sit above it, so it steps aside meanwhile.
      pick: function (token) {
        me.hidden = true;
        if (d.open) d.close();
        function back() {
          me.hidden = false;
          if (gi === me && !d.open) d.showModal();
        }
        giStat(t("gi.pickDrive"));
        return GM.showPicker(token, { key: GI.apiKey(), appId: GI.appId(), lang: LANG, max: GM.CAPS.count })
          .then(function (docs) { back(); return docs; }, function (e) { back(); throw e; });
      }
    };
    var run = GI.run({
      scope: GI.SCOPES[kind],
      read: function (token, api) {
        me.read = true;
        return kind === "photos" ? GM.readPhotos(api, hooks, GM.CAPS) : GM.readDrive(api, token, hooks, GM.CAPS);
      }
    });
    gi = me;
    $("gi-title").textContent = t(kind === "drive" ? "gi.titleDrive" : "gi.titlePhotos");
    $("gi-cancel").textContent = t("gi.cancel");
    $("gi-list").hidden = true;
    giHint("");
    giAct(null);
    giStat(t("gi.signin"));
    if (!d.open) d.showModal();
    run.then(function (res) {
      if (gi !== me) return;
      return giPreview(me, res.data);
    }).catch(function (e) {
      if (gi !== me) return;
      console.warn("files: Google import failed:", e);
      $("gi-cancel").textContent = t("gi.close");
      giAct(null);
      if (e && e.code === "network" && e.detail === "picker") giStat(t("gi.noPicker"));
      else giStat(GI.message(e, LANG));
      giHint(e && e.code === "notenabled" ? t(kind === "drive" ? "gi.hintDrive" : "gi.hintPhotos") : "");
    });
  }

  // Sizes of what the folder holds now (names + sizes).
  function giExisting(dir) {
    return fsList(dir, true).then(function (list) {
      var out = [];
      return list.slice(0, 3000).reduce(function (p, e) {
        return p.then(function () {
          if (e.dir) { out.push({ name: e.name, dir: true }); return; }
          return FS().stat(join(dir, e.name)).then(function (st) {
            out.push({ name: e.name, size: st ? (st.size || st.bytes || 0) : 0 });
          }, function () { out.push({ name: e.name, size: -1 }); });
        });
      }, Promise.resolve()).then(function () { return out; });
    }, function () { return []; });
  }
  function giWhy(s) {
    var C = gMedia().CAPS;
    if (s.why === "big") return tfmt("gi.why.big", { s: fmtKB(C.file) });
    if (s.why === "total") return tfmt("gi.why.total", { s: fmtKB(C.total) });
    if (s.why === "count") return tfmt("gi.why.count", { n: C.count });
    return t("gi.why." + s.why) || s.why;
  }
  function giRow(name, right, cls) {
    var li = document.createElement("li");
    li.className = "gi-row" + (cls ? " " + cls : "");
    var n = document.createElement("span");
    n.className = "gi-name";
    n.textContent = name;
    var r = document.createElement("span");
    r.className = "gi-size";
    r.textContent = right;
    li.appendChild(n);
    li.appendChild(r);
    return li;
  }

  function giPreview(me, data) {
    var GM = gMedia();
    data = data || { items: [], skipped: [] };
    $("gi-cancel").textContent = t("gi.cancel");
    if (!data.items.length && !data.skipped.length) {
      giStat(t("gi.none"));
      $("gi-cancel").textContent = t("gi.close");
      return;
    }
    return fsList(ROOT).then(function (rootList) {
      var folder = GM.folderFor(me.kind, rootList.map(function (e) { return e.name; }), LANG);
      var dir = join(ROOT, folder);
      var existed = rootList.some(function (e) { return e.name === folder && e.dir; });
      return (existed ? giExisting(dir) : Promise.resolve([])).then(function (have) {
        if (gi !== me) return;
        var pl = GM.plan(data.items, have);
        me.dir = dir; me.folder = folder; me.existed = existed; me.data = data;
        var ul = $("gi-list");
        ul.textContent = "";
        var total = 0;
        pl.add.forEach(function (a) {
          total += a.item.size;
          ul.appendChild(giRow(a.name, fmtKB(a.item.size)));
        });
        pl.dup.forEach(function (it) { ul.appendChild(giRow(it.name, t("gi.dup"), "gi-dup")); });
        data.skipped.slice(0, 200).forEach(function (s) { ul.appendChild(giRow(s.name, giWhy(s), "gi-skip")); });
        ul.hidden = false;
        var lines = [];
        if (pl.add.length) lines.push(tfmt("gi.sum", { n: pl.add.length, s: fmtKB(total), f: folder }));
        else if (pl.dup.length) lines.push(tfmt("gi.nothingNew", { f: folder }));
        else lines.push(t("gi.none"));
        if (pl.add.length && pl.dup.length) lines.push(tfmt("gi.dupSum", { n: pl.dup.length }));
        if (data.skipped.length) lines.push(tfmt("gi.skipSum", { n: data.skipped.length }));
        giStat(lines.join(" "));
        giHint("");
        if (!pl.add.length) { $("gi-cancel").textContent = t("gi.close"); giAct(null); return; }
        giAct(tfmt("gi.go", { n: pl.add.length }), function () { giWrite(me); });
      });
    });
  }

  // ONE pass of writes, names made unique against the folder as it is
  // now; then the toast with Undo.
  function giWrite(me) {
    var GM = gMedia();
    if (me.writing) return;
    me.writing = true;
    giAct(null);
    $("gi-cancel").disabled = true;
    var added = [];
    var existed = false;
    fsList(ROOT).then(function (rootList) {
      existed = rootList.some(function (e) { return e.name === me.folder && e.dir; });
      return existed ? giExisting(me.dir) : [];
    }).then(function (have) {
      var pl = GM.plan(me.data.items, have);
      var fail = 0;
      return pl.add.reduce(function (p, a, i) {
        return p.then(function () {
          giStat(tfmt("gi.writing", { n: i + 1, m: pl.add.length }));
          var path = join(me.dir, a.name);
          return writeFileDst(a.item.blob, path).then(function (ok) {
            if (ok) added.push(path); else fail++;
          });
        });
      }, Promise.resolve()).then(function () { return fail; });
    }).then(function (fail) {
      me.writing = false;
      $("gi-cancel").disabled = false;
      gi = null;
      var d = $("dlg-gimport");
      if (d.open) d.close();
      if (added.length) {
        forceStorageRecalc();
        markDirty();
        var paths = added.slice(), dir = me.dir, made = !existed;
        var text = fail ? tfmt("gi.doneFail", { n: added.length, m: fail }) : tfmt("gi.done", { n: added.length, f: me.folder });
        undoToast(text, function () { giUndo(paths, dir, made); });
        navigate(dir);
      } else {
        transientNote(t("toast.importFail"));
        refresh();
      }
    });
  }

  // Exactly the files this import added; the folder too when the
  // import made it and nothing else came into it meanwhile.
  function giUndo(paths, dir, made) {
    paths.slice().reverse().reduce(function (p, path) {
      return p.then(function () {
        return FS().rm(path).catch(function () {});
      });
    }, Promise.resolve()).then(function () {
      if (!made) return;
      return FS().ls(dir).then(function (left) {
        if (!left || !left.length) return FS().rm(dir).catch(function () {});
      }, function () {});
    }).then(function () {
      paths.forEach(function (p) { recentsDrop(p); });
      forceStorageRecalc();
      markDirty();
      if (made && cwd === dir) navigate(ROOT); else refresh();
      transientNote(t("gi.undone"));
    });
  }

  // A toast with one action (the shell's, or this page's own).
  function undoToast(text, fn) {
    var api = null;
    try { api = window.parent.orosNotifs; } catch (e) {}
    if (!api && window.orosNotifs) api = window.orosNotifs;
    if (api && typeof api.transient === "function" &&
        api.transient({ ns: "files", title: text, body: "", action: { label: t("gi.undo"), fn: fn } })) return;
    var el = $("toast");
    el.textContent = text + " ";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "toast-btn";
    b.textContent = t("gi.undo");
    b.addEventListener("click", function () { el.classList.remove("show"); fn(); });
    el.appendChild(b);
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 8000);
  }

  // ---------- 10. Download / Clipboard ----------

    // #9 FIX: binary-faithful downloads. Text files keep readText;
  // everything else streams the raw Blob with a reasonable MIME.
  function downloadEntry(primary) {
    if (!primary || primary.dir) return;
    var path = primary.path;
    var name = primary.name;
    var doDownload = function (blob, mime) {
      var m = mime || "text/plain";
      var done = function () {
        recentsTouch(path);
        transientNote(t("toast.downloaded"));
      };
      var dlg = dialogHost();
      if (dlg && typeof dlg.saveFile === "function") {
        var opts = { blob: blob, filename: name, mime: m };
        var ext = extOf(name);
        if (ext && ext !== "file") {
          // ES5: dynamic key via bracket assignment, no computed literal.
          // Omitted entirely when the file has no real extension —
          // same optional-types convention as Bookmarks/Calendar.
          var accept = {};
          accept[m] = ["." + ext];
          opts.types = [{ description: ext.toUpperCase() + " file",
                          accept: accept }];
        }
        dlg.saveFile(opts).then(function (r) { if (r && r.ok) done(); });
        return;                     // cancel (ok=false) = silent exit
      }
      // Standalone fallback — classic download (no shell present).
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Late revoke (same reason as dialogs.js DLG-1): a download that
      // starts after a browser prompt must still find the URL.
      setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
      done();
    };

    // FL-2: a download is the STORED BYTES, whatever the extension.
    // Text files used to go through readText() → a new UTF-8 Blob:
    // a file in any other encoding (a Windows-1253 Greek .txt, a
    // UTF-16 export) came back with every non-ASCII character
    // replaced, and a UTF-8 BOM was dropped.
    FS().read(path).then(function (blob) {
      doDownload(blob, isTextExt(name) ? "text/plain" : mimeForExt(extOf(name)));
    }).catch(function () {
      transientNote(t("toast.downloadFail"));
    });
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
          .then(function () { transientNote(t("toast.copiedClip")); })
          .catch(function () { transientNote(t("toast.clipFail")); });
      }).catch(function () { transientNote(t("toast.clipFail")); });
    }
    return navigator.clipboard.writeText(text)
      .then(function () { transientNote(t("toast.copiedClip")); })
      .catch(function () { transientNote(t("toast.clipFail")); });
  }

  // ---------- 11. Search (recursive within folder + subfolders) ----------
  // Names everywhere under the open folder (accent- and case-blind),
  // and — with "Contents" on — inside text files and PDFs too, with a
  // snippet. No result cap: 100 are shown, "Show more" adds 100.

  // #23 FIX: 250ms debounce on input — no full-disk walk per
  // keystroke — and a token captured per query pass (renderToken),
  // checked at every step so a superseded query stops.
  var searchDebounce = null;
  var search = null;           // { token, q, fq, names[], content[], byPath{}, shown, phase, n, t, skipped }

  function runSearch(query) {
    if (!query.trim()) { clearSearch(); return; }
    searchQuery = query.trim();
    searchDir = cwd;
    if (selectMode) setSelectMode(false);
    clearSelection();   // FL-4: selection survives into search results invisibly
    // FD3: entering search mode — drop stale root views. Otherwise
    // the Recents section and/or #empty from the last plain
    // listing stay visible alongside the search results.
    hideRecents();
    var em = $("empty");
    if (em) em.hidden = true;
    setStatusLoading();

    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
      startSearch(searchQuery, searchDir);
    }, 250);
  }

  function startSearch(q, dir) {
    var token = ++renderToken;
    var st = search = { token: token, q: q, fq: CORE.fold(q), names: [], content: [], byPath: {},
                        shown: SEARCH_PAGE, phase: "walk", n: 0, t: 0, skipped: 0 };
    var files = [];
    lastEntries = [];  // no list
    paintSearchSoon(st);
    function live() { return search === st && token === renderToken; }

    // 1. Walk the folder and its subfolders (never the Trash).
    var stack = [dir];
    function step() {
      if (!live()) return Promise.resolve(false);
      if (!stack.length) return Promise.resolve(true);
      var d = stack.pop();
      return fsList(d).then(function (entries) {
        entries.forEach(function (e) {
          var p = join(d, e.name);
          st.n++;
          if (CORE.fold(e.name).indexOf(st.fq) !== -1) addHit(st, { name: e.name, dir: !!e.dir, path: p });
          if (e.dir) stack.push(p);
          else files.push(p);
        });
      }, function () {}).then(function () {
        paintSearchSoon(st);
        return step();
      });
    }
    step().then(function (done) {
      if (!done || !live()) return;
      if (!prefs.contents) { st.phase = "done"; paintSearch(st); return; }
      // 2. Inside the files, one at a time.
      var todo = files.filter(function (p) { return CORE.contentKind(baseName(p), null); });
      st.phase = "content"; st.n = 0; st.t = todo.length;
      paintSearch(st);
      var chain = Promise.resolve();
      todo.forEach(function (p) {
        chain = chain.then(function () {
          if (!live()) return null;
          return searchInFile(p, st.fq).then(function (sn) {
            if (sn === false) st.skipped++;
            else if (sn) addHit(st, { name: baseName(p), dir: false, path: p, snippet: sn });
          }, function () { st.skipped++; }).then(function () {
            st.n++;
            paintSearchSoon(st);
          });
        });
      });
      return chain.then(function () {
        if (!live()) return;
        st.phase = "done";
        paintSearch(st);
      });
    });
  }

  function addHit(st, hit) {
    var old = st.byPath[hit.path];
    if (old) { if (hit.snippet && !old.snippet) old.snippet = hit.snippet; return; }
    st.byPath[hit.path] = hit;
    (hit.snippet ? st.content : st.names).push(hit);
  }

  // → snippet, null (no match) or false (skipped: too big / unreadable)
  function searchInFile(path, fq) {
    var name = baseName(path);
    return FS().stat(path).then(function (st) {
      var kind = CORE.contentKind(name, st && typeof st.size === "number" ? st.size : 0);
      if (!kind) return false;
      return FS().read(path).then(function (blob) {
        if (kind === "pdf") return pdfFind(blob, fq);
        return blob.arrayBuffer().then(function (buf) {
          var text = new TextDecoder("utf-8").decode(buf);
          if (CORE.looksBinary(text)) return null;
          return CORE.findSnippet(CORE.plainText(text, CORE.extOf(name)), fq);
        });
      });
    }).catch(function () { return false; });
  }

  // A PDF's text, page by page (PDF.js, no scripts, no XFA); stops at
  // the first page that matches.
  function pdfFind(blob, fq) {
    return blob.arrayBuffer().then(function (buf) {
      return pdfOpen(new Uint8Array(buf));
    }).then(function (pdf) {
      var n = Math.min(pdf.numPages, CORE.PDF_PAGES), k = 0;
      function page() {
        if (++k > n) return Promise.resolve(null);
        return pdf.getPage(k).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          var text = (tc.items || []).map(function (it) { return it.str || ""; }).join(" ");
          var sn = CORE.findSnippet(text, fq);
          if (sn) { sn.page = k; return sn; }
          return page();
        });
      }
      return page().then(function (r) { try { pdf.destroy(); } catch (e) {} return r; },
        function () { try { pdf.destroy(); } catch (e) {} return false; });
    }, function () { return false; });
  }

  var paintTimer = null;
  function paintSearchSoon(st) {
    if (paintTimer) return;
    paintTimer = setTimeout(function () { paintTimer = null; if (search) paintSearch(search); }, 300);
  }

  function clearSearch() {
    if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
    var wasSearching = (searchQuery !== null);   // capture BEFORE nulling
    searchQuery = null;
    searchDir = null;
    search = null;
    // FA4 + FB2: runSearch() sets lastEntries=[] (no list), so
    // clearing must re-fetch the real listing. BUT only when a
    // search was actually ACTIVE: clearSearch() is called on EVERY
    // navigation and on every empty-keyup — an unconditional
    // refresh() meant double and triple fetches per navigation.
    // renderRecentsMaybe() is called inside refresh() already; the
    // explicit call here was a second, redundant prune walk.
    if (wasSearching) refresh();
  }

  function paintSearch(st) {
    if (search !== st || searchQuery === null) return;
    var host = $("entries");
    host.innerHTML = "";
    host.classList.remove("grid");
    var all = st.names.concat(st.content);
    if (st.phase !== "done") {
      var prog = document.createElement("li");
      prog.className = "search-progress";
      prog.textContent = st.phase === "walk" ? tfmt("search.walking", { n: st.n })
        : tfmt("search.scanning", { n: st.n, t: st.t });
      host.appendChild(prog);
    }
    if (st.phase === "done" && all.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty-msg";
      var sp = document.createElement("span");
      sp.textContent = t("search.none");
      empty.appendChild(sp);
      host.appendChild(empty);
    }
    all.slice(0, st.shown).forEach(function (m) { host.appendChild(searchRow(m)); });
    if (all.length > st.shown) {
      var more = document.createElement("li");
      more.className = "search-more";
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = tfmt("search.more", { n: all.length - st.shown });
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        st.shown += SEARCH_PAGE;
        paintSearch(st);
      });
      more.appendChild(b);
      host.appendChild(more);
    }
    if (st.phase === "done" && st.skipped) {
      var sk = document.createElement("li");
      sk.className = "search-progress";
      sk.textContent = tfmt("search.skipped", { n: st.skipped });
      host.appendChild(sk);
    }
    renderStatus(all.length);   // FB6: was hardcoded 0 — "0 items" over a full result list
  }

  function searchRow(m) {
    var li = document.createElement("li");
    li.className = "entry search-result" + (m.snippet ? " has-snippet" : "");
    li.dataset.path = m.path;
    li.tabIndex = 0;
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
    if (m.snippet) {
      var snip = document.createElement("span");
      snip.className = "snippet";
      snip.appendChild(document.createTextNode(m.snippet.before));
      var mark = document.createElement("mark");
      mark.textContent = m.snippet.match;
      snip.appendChild(mark);
      snip.appendChild(document.createTextNode(m.snippet.after));
      if (m.snippet.count > 1) {
        var c = document.createElement("span");
        c.className = "snip-count";
        c.textContent = " · " + tfmt("search.matchCount", { n: m.snippet.count });
        snip.appendChild(c);
      }
      li.appendChild(snip);
    }
    function open() {
      if (m.dir) { navigate(m.path); return; }
      openFileAt(m.path);
    }
    li.addEventListener("click", open);
    li.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); open(); } });
    return li;
  }

  // Open a file's folder, select the file and preview it.
  function openFileAt(path) {
    var si = $("search-input");
    if (si) si.value = "";
    navigate(parentOf(path) === "/" ? ROOT : parentOf(path));
    selectedPaths[path] = true;
    recentsTouch(path);
    openPreview(path);
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
    journal.slice(0, ROOT_RECENTS).forEach(function (e) {
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
    var many = selectionCount() > 1;

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
    function it_remove() {
      if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
      document.removeEventListener("click", onOutside);
    }

    if (view === "trash") {
      ctxMenu.appendChild(mkItem(RESTORE_SVG, "trash.restore", function () {
        trashRestore(selectionPaths());
      }));
      ctxMenu.appendChild(mkItem(X_SVG, "trash.deleteForever", function () {
        openDeleteDialog("forever");
      }));
      placeMenu();
      return;
    }

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
      if (!many && appsForFile(p.name).length) {
        ctxMenu.appendChild(mkItem(APP_SVG, "menu.openWith", function () { openInApp(p.path, true); }));
      }
    }
    if (!many) {
      var faved = CORE.favIs(favs, p.path);
      ctxMenu.appendChild(mkItem(STAR_SVG, faved ? "fav.remove" : "fav.add", function () {
        favToggle(p.path, p.dir);
      }));
    }
    ctxMenu.appendChild(hr());
    if (!p.dir && !many) {
      ctxMenu.appendChild(mkItem(DL_SVG, "menu.download", function () {
        downloadEntry(p);
      }));
    }
    ctxMenu.appendChild(mkItem(MV_SVG, "menu.moveTo", function () {
      openPickerDialog("move");
    }));
    ctxMenu.appendChild(mkItem(CP_SVG, "menu.copyTo", function () {
      openPickerDialog("copy");
    }));
    if (!p.dir && sendApi()) {
      ctxMenu.appendChild(mkItem(APP_SVG, "menu.sendApp", sendSelection));
    }
    if (dbx() && dbx().exportFrom) {
      ctxMenu.appendChild(mkItem(dbx().icon || "", "menu.toDropbox", function () {
        sendToDropbox();
      }));
    }
    ctxMenu.appendChild(mkItem(ZIP_SVG, "menu.zip", function () {
      zipCreate(selectionPaths());
    }));
    if (!p.dir && !many && CORE.extOf(p.name) === "zip") {
      ctxMenu.appendChild(mkItem(UNZIP_SVG, "menu.extract", function () {
        zipExtract(p.path);
      }));
    }
    if (convertiblePaths().length) {
      ctxMenu.appendChild(mkItem(CONVERT_SVG, "menu.convert", convertSelection));
    }
    ctxMenu.appendChild(hr());
    ctxMenu.appendChild(mkItem("", "menu.copyName", function () {
      copyToClipboard(p, "name");
    }));
    ctxMenu.appendChild(mkItem("", "menu.copyPath", function () {
      copyToClipboard(p, "path");
    }));
    if (!p.dir && isTextExt(p.name)) {
      ctxMenu.appendChild(mkItem("", "menu.copyContent", function () {
        copyToClipboard(p, "content");
      }));
    }
    ctxMenu.appendChild(hr());
    ctxMenu.appendChild(mkItem(EDIT_SVG, "menu.rename", function () {
      openNameDialog("rename");
    }));
    ctxMenu.appendChild(mkItem(X_SVG, "menu.delete", function () {
      openDeleteDialog("trash");
    }));
    placeMenu();

    function hr() {
      var h = document.createElement("hr");
      return h;
    }

    function placeMenu() {
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
      setTimeout(function () {
        document.addEventListener("click", onOutside);
      }, 0);
    }

    // Click outside closes
    function onOutside(e) {
      if (ctxMenu && !ctxMenu.contains(e.target)) it_remove();
    }
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

  // orosDialog lives in the parent shell (same-origin iframe).
  // Standalone PWA mode -> null -> caller uses local fallback.
  function dialogHost() {
    try {
      return window.orosDialog || window.parent.orosDialog || null;
    } catch (e) { return null; }
  }

  // Unified notifications (orOS compliance): informational toasts
  // route through the shell's orosNotifs.transient() — click
  // feedback, no inbox, no toggle needed. Falls back to the local
  // toast when the app runs standalone (no shell present).
  // Files has NO undo-bearing toasts — everything is routable.
  function transientNote(text) {
    var api = null;
    try { api = window.parent.orosNotifs; } catch (e) {}
    if (!api && window.orosNotifs) api = window.orosNotifs;
    if (api && typeof api.transient === "function") {
      api.transient({ ns: "files", title: text, body: "" });
    } else {
      showToast(text);
    }
  }

  // ---------- 15b. Disk sync — Vault Drive (FILES-V) ----------
  // The disk syncs PER FILE through the shell's Vault Drive. This app
  // reports nothing: fs.js tells the vault about every write, delete
  // and move, whoever makes them. What lives here is the view of it:
  // the status pill, and a refresh when the vault changed the disk
  // under an open app (a file arrived, was removed, or a conflict
  // copy was written).
  // (Before FILES-V the whole disk travelled as ONE snapshot in the
  // sync blob, bridged through window.orosFilesDisk — gone.)

  function vaultApi() {
    try {
      var v = window.parent && window.parent.orosVault;
      return (v && typeof v.status === "function") ? v : null;
    } catch (e) { return null; }
  }

  // Kept as the single "the disk changed here" call of this file.
  function markDirty() { renderSyncPill(); }

  // Sync pill (status bar, JS-built) — visibility of state only.
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
    var v = vaultApi();
    var s = null;
    try { s = v ? v.status() : null; } catch (e) { s = null; }
    var state = (!s || !s.usable) ? "off"
              : (s.queued > 0 || s.busy) ? "pending" : "synced";
    if (pill.dataset.state === state && pill.textContent) return;
    pill.dataset.state = state;
    pill.title = t("sync.state." + state);
    pill.textContent = "";
    var dot = document.createElement("span");
    dot.className = "sync-dot";
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(t("sync.state." + state)));
  }

  var vaultUnsub = null;
  function watchVault() {
    var v = vaultApi();
    if (!v || typeof v.onStatus !== "function") return;
    vaultUnsub = v.onStatus(function (kind, detail) {
      renderSyncPill();
      if (kind !== "stats" || !detail) return;
      if (detail.conflicts > 0) transientNote(t("sync.conflictKept"));
      if (detail.downloaded > 0 || detail.deleted > 0 || detail.conflicts > 0) {
        forceStorageRecalc();
        // Never repaint the list under an open editor.
        if (!pvDirty) refresh();
      }
    });
    // The listener lives in the SHELL: take it back when this frame goes.
    window.addEventListener("pagehide", function () {
      if (typeof vaultUnsub === "function") { vaultUnsub(); vaultUnsub = null; }
    });
  }

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

  var pvDirty = false;          // Quick Edit holds unsaved text
  var pvDiscardUntil = 0;       // second close within this window discards
  function closePreview(force) {
    if (!pvOverlay) return;
    // FL-3: Esc, the X and a click on the backdrop all landed here and
    // threw the typed text away without a word.
    if (pvDirty && force !== true && Date.now() > pvDiscardUntil) {
      pvDiscardUntil = Date.now() + 4000;
      transientNote(t("pv.unsaved"));
      return;
    }
    pvDirty = false;
    pvDiscardUntil = 0;
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
      // Pre-gate: reject extremely large images before loading blob
      if (size > 10 * 1024 * 1024 && CORE.extOf(name) !== "zip") { // 10 MB threshold
        buildPreviewShell(path, name, size, mtime);
        pvBodySet('<div class="pv-msg">' +
          escapeHtml(tfmt("pv.bigFile", { n: Math.round(size / 1024) })) +
          "</div>");
        injectEditButton(path, name);
        return;
      }
      buildPreviewShell(path, name, size, mtime);
      injectOpenButton(path, name);

      if (CORE.extOf(name) === "zip") {
        renderZipPreview(path);
      } else if (isImageExt(name)) {
        renderImagePreview(path);
      } else {
        // Gate: do not read text files larger than the preview cap
        if (size > PV_TEXT_LIMIT) {
          pvBodySet('<div class="pv-msg">' +
            escapeHtml(tfmt("pv.bigFile", { n: Math.round(size / 1024) })) +
            "</div>");
          injectEditButton(path, name);
          return;
        }
        renderTextPreview(path);
      }
    }).catch(function () {
      buildPreviewShell(path, name, 0, null);
      pvBodySet('<div class="pv-msg">' + escapeHtml(t("pv.notFound")) + '</div>');
    });
  }

  function buildPreviewShell(path, name, size, mtime) {
    closePreview(true);
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
    x.addEventListener("click", function () { closePreview(); });
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
        // FL-11: the URL parser drops TAB/LF/CR anywhere and C0
        // controls + spaces at the ends, so "jav<TAB>ascript:" slipped
        // past the scheme test below as a "relative" link and became a
        // live javascript: href. Strip them all before the test and use
        // the same stripped value as the href.
        var clean = url.replace(/[\u0000-\u0020\u007F]+/g, "");
        // FL-4: allowlist, not blocklist. A markdown file is content
        // from anywhere (imports, the other device); only web and
        // mail links become clickable, every other scheme stays text.
        var sm = clean.match(/^([a-z][a-z0-9+.\-]*):/i);
        if (sm) {
          var scheme = sm[1].toLowerCase();
          if (scheme !== "http" && scheme !== "https" && scheme !== "mailto") {
            return txt;
          }
        }
        return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>";
      })
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1<em>$2</em>");
  }

  // "Open in Writer" (one app) / "Open with…" (several) in the preview.
  function injectOpenButton(path, name) {
    var acts = $("pv-actions"), apps = appsForFile(name);
    if (!acts || acts.dataset.hasOpen || !apps.length) return;
    acts.dataset.hasOpen = "1";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pv-btn";
    b.id = "pv-open";
    b.innerHTML = APP_SVG + "<span></span>";
    b.querySelector("span").textContent = apps.length === 1 ? tfmt("pv.openIn", { app: shellAppName(apps[0]) }) : t("pv.openWith");
    b.addEventListener("click", function () { closePreview(); openInApp(path, apps.length > 1); });
    acts.insertBefore(b, acts.firstChild);
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

    // FL-3: decode STRICTLY. readText() replaces every byte sequence
    // that is not UTF-8 with U+FFFD, and Save would then write those
    // replacement characters over the real file. A file that is not
    // UTF-8 text is not editable here. A UTF-8 BOM is remembered and
    // written back.
    var hadBom = false;
    FS().read(path).then(function (blob) {
      return blob.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      hadBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
      var text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (eDec) {
        b.innerHTML = "";
        var msg = document.createElement("div");
        msg.className = "pv-msg";
        msg.textContent = t("pv.notUtf8");
        b.appendChild(msg);
        return;
      }
      ta.value = text;
      paintMd();
    }).catch(function () {
      transientNote(t("toast.opFail"));
      closePreview(true);
    });
    ta.addEventListener("input", function () { pvDirty = true; paintMd(); });

    var row = document.createElement("div");
    row.className = "pv-save-row";
    var save = document.createElement("button");
    save.type = "button";
    save.className = "pv-btn primary";
    save.textContent = t("pv.save");
    save.addEventListener("click", function () {
      FS().writeText(path, (hadBom ? "\uFEFF" : "") + ta.value).then(function () {
        pvDirty = false;
        recentsTouch(path);
        transientNote(t("pv.saved"));
        forceStorageRecalc();
        markDirty();
        renderTextPreview(path);          // back to view mode
        $("pv-actions").dataset.hasEdit = "";   // allow Edit again
      }).catch(function () { transientNote(t("toast.opFail")); });
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

  // ---------- 16c. Wave 3: Favourites, Recent, Trash, Grid, Select, ZIP ----------

  function displayPath(p) {
    if (!p || p === "/" || p === ROOT) return t("tree.root");
    return t("tree.root") + p.slice(ROOT.length);
  }

  function setEmptyText(key) {
    var em = $("empty");
    if (!em) return;
    var a = em.querySelector("span"), b = em.querySelector("small");
    if (a) a.textContent = t(key || "empty.title");
    if (b) b.textContent = key ? "" : t("empty.hint");
  }

  // Body classes + the Trash bar for the special views.
  function applyViewChrome() {
    document.body.classList.toggle("v-trash", view === "trash");
    document.body.classList.toggle("v-recent", view === "recent");
    setEmptyText(view === "trash" ? "trash.empty" : view === "recent" ? "recent.empty" : null);
    var vb = ensureViewBar();
    if (vb) vb.hidden = view !== "trash";
  }

  function openView(kind) {
    var d = dbx();
    if (d && d.isActive()) d.leave();
    var dv = drv();
    if (dv && dv.isActive()) dv.leave();
    if (searchQuery !== null) {
      if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
      searchQuery = null; searchDir = null; search = null;
    }
    var si = $("search-input");
    if (si) si.value = "";
    view = kind;
    if (selectMode) setSelectMode(false);
    clearSelection();
    refresh();
  }

  // ===== Favourites: synced slice "files" (key oros-files-favs) =====
  // Pinned folders and files, per item with a time stamp and
  // tombstones (files-core.js mergeFavs), so two devices converge.
  var favs = CORE.normFavs(null);

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || null; } catch (e) { return null; }
  }
  function favLoad() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(FAVS_KEY)); } catch (e) { raw = null; }
    favs = CORE.normFavs(raw);
  }
  // R27: only a real change stamps, stores and marks sync dirty.
  function favCommit(next) {
    if (JSON.stringify(next) === JSON.stringify(favs)) return false;
    favs = next;
    try { localStorage.setItem(FAVS_KEY, JSON.stringify(favs)); }
    catch (e) { transientNote(t("toast.opFail")); }
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    renderTree();
    return true;
  }
  function favToggle(path, dir) {
    var on = !CORE.favIs(favs, path);
    favCommit(CORE.favSet(favs, path, dir, on, Date.now()));
    transientNote(t(on ? "fav.added" : "fav.removed"));
    renderSelBar();
  }
  function favCarry(from, to) { favCommit(CORE.favMove(favs, from, to, Date.now())); }
  function favDropPath(p) { favCommit(CORE.favDrop(favs, p, Date.now())); }

  function registerFavSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("files", function () {
      return CORE.normFavs(favs);
    }, function (incoming) {
      // R6: a pull never marks dirty.
      var next = CORE.normFavs(incoming);
      if (JSON.stringify(next) === JSON.stringify(favs)) return;
      favs = next;
      try { localStorage.setItem(FAVS_KEY, JSON.stringify(favs)); } catch (e) {}
      renderTree();
    }, FAVS_KEY, CORE.mergeFavs);
  }

  // ===== Tree: Recent + Favourites on top, Trash under the disk =====
  function makeQuickSection() {
    var sec = document.createElement("div");
    sec.className = "quick";
    sec.appendChild(makeSpecialNode("recent", t("tree.recent"), CLOCK_SVG));
    var live = CORE.favLive(favs).slice().sort(function (a, b) {
      return baseName(a.p).toLowerCase().localeCompare(baseName(b.p).toLowerCase(), LANG === "el" ? "el" : "en");
    });
    if (live.length) {
      var h = document.createElement("div");
      h.className = "tsec";
      h.textContent = t("tree.favs");
      sec.appendChild(h);
      live.forEach(function (f) { sec.appendChild(makeFavNode(f)); });
    }
    return sec;
  }

  function makeSpecialNode(kind, label, svg) {
    var node = document.createElement("div");
    node.className = "tnode special" + (view === kind && !placeActive() ? " selected" : "");
    node.style.paddingLeft = "6px";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.dataset.view = kind;
    var caret = document.createElement("span");
    caret.className = "caret empty";
    node.appendChild(caret);
    var g = document.createElement("span");
    g.className = "glyph";
    g.innerHTML = svg;
    node.appendChild(g);
    var nm = document.createElement("span");
    nm.className = "tname";
    nm.textContent = label;
    node.appendChild(nm);
    function go() { closeTreeDrawer(); openView(kind); }
    node.addEventListener("click", go);
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
    if (kind === "trash") {
      // Rows dragged onto the Trash go there (no question: it can be undone).
      node.addEventListener("dragover", function (e) {
        if (!draggingEntryPath) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        node.classList.add("drop-target");
      });
      node.addEventListener("dragleave", function () { node.classList.remove("drop-target"); });
      node.addEventListener("drop", function (e) {
        e.preventDefault();
        node.classList.remove("drop-target");
        if (!draggingEntryPath) return;
        draggingEntryPath = null;
        performDelete(selectionPaths());
      });
    }
    return node;
  }

  function makeFavNode(f) {
    var node = document.createElement("div");
    node.className = "tnode fav" + (f.dir && view === "files" && cwd === f.p && !placeActive() ? " selected" : "");
    node.style.paddingLeft = "6px";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.title = displayPath(f.p);
    var caret = document.createElement("span");
    caret.className = "caret empty";
    node.appendChild(caret);
    var g = document.createElement("span");
    g.className = "glyph";
    g.innerHTML = f.dir ? FOLDER_SVG : FILE_SVG;
    node.appendChild(g);
    var nm = document.createElement("span");
    nm.className = "tname";
    nm.textContent = baseName(f.p);
    node.appendChild(nm);
    var x = document.createElement("button");
    x.type = "button";
    x.className = "fav-x";
    x.title = t("fav.remove");
    x.setAttribute("aria-label", t("fav.remove") + ": " + baseName(f.p));
    x.innerHTML = STAR_FILLED_SVG;
    x.addEventListener("click", function (e) {
      e.stopPropagation();
      favToggle(f.p, f.dir);
    });
    node.appendChild(x);
    FS().stat(f.p).catch(function () { node.classList.add("missing"); });
    function go() {
      FS().stat(f.p).then(function (st) {
        closeTreeDrawer();
        if (st && st.dir) navigate(f.p);
        else openFileAt(f.p);
      }, function () { transientNote(t("fav.missing")); });
    }
    node.addEventListener("click", go);
    node.addEventListener("keydown", function (e) {
      if (e.target !== node) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
    return node;
  }

  // ===== Recent view (device-local journal, newest first) =====
  function renderRecentView() {
    var token = ++renderToken;
    setStatusLoading();
    renderTree();
    renderCrumbs();
    updateActionButtons();
    hideRecents();
    recentsPruneExisting().then(function () {
      return Promise.all(recentsRead().map(function (e) {
        return FS().stat(e.p).then(function (st) {
          return {
            name: baseName(e.p), path: e.p, dir: !!(st && st.dir),
            size: st && typeof st.size === "number" ? st.size : null,
            mtime: st && st.mtime ? st.mtime : null,
            sub: displayPath(parentOf(e.p)) + " · " + humanWhen(e.at)
          };
        }, function () { return null; });
      }));
    }).then(function (rows) {
      if (token !== renderToken) return;
      rows = rows.filter(Boolean);
      lastEntries = rows;
      renderEntries(rows);
      renderStatus(rows.length);
    });
  }

  // ===== Trash =====
  // Files' Delete moves an item to /internal/.trash/<id>/<name> and
  // writes /internal/.trash/<id>.json (files-core.js). Both are plain
  // disk changes, so Vault Drive carries them to the other devices:
  // there the item disappears from its folder and shows in their
  // Trash; Restore moves it back the same way.
  var trashRows = {};          // shown item path → { id, meta, item }

  function moveToTrash(path) {
    var fs = FS(), now = Date.now();
    var id = CORE.trashId(now, Math.random().toString(36).slice(2, 10));
    return fs.stat(path).then(function (st) {
      var meta = CORE.makeMeta(path, !!(st && st.dir), now);
      // The record first: when the move fails it is taken back.
      return fs.writeText(CORE.trashMetaPath(id), JSON.stringify(meta)).then(function () {
        return fs.mv(path, CORE.trashItemDir(id) + "/" + baseName(path));
      }).catch(function (e) {
        return fs.rm(CORE.trashMetaPath(id)).catch(function () {}).then(function () { throw e; });
      });
    });
  }

  function trashLoad() {
    return FS().ls(TRASH).catch(function () { return []; }).then(function (list) {
      var l = CORE.trashListing(list);
      return Promise.all(l.ids.map(function (id) {
        var metaP = l.metas[id]
          ? FS().readText(CORE.trashMetaPath(id)).then(function (txt) { return JSON.parse(txt); }).catch(function () { return null; })
          : Promise.resolve(null);
        var itemP = FS().ls(CORE.trashItemDir(id)).catch(function () { return []; });
        return Promise.all([metaP, itemP]).then(function (r) {
          var meta = CORE.normMeta(r[0], id);
          var items = r[1] || [], item = null;
          for (var i = 0; i < items.length; i++) if (items[i].name === meta.name) item = items[i];
          if (!item && items.length) item = items[0];
          return { id: id, meta: meta, item: item, hasMeta: !!(l.metas[id] && r[0]) };
        });
      }));
    });
  }

  // Load the Trash and remove what is older than 30 days, and the
  // empty folders a restore or a removal on another device leaves
  // behind (Vault Drive syncs files, not empty folders).
  function trashSweepLoad() {
    var now = Date.now();
    return trashLoad().then(function (recs) {
      var keep = [], chain = Promise.resolve();
      recs.forEach(function (r) {
        if (CORE.expired(r.meta.at, now) || (!r.item && !r.hasMeta)) {
          chain = chain.then(function () { return trashDiscard(r.id); });
        } else keep.push(r);
      });
      return chain.then(function () {
        try { localStorage.setItem(SWEEP_KEY, String(now)); } catch (e) {}
        return keep;
      });
    });
  }
  function trashSweepMaybe() {
    var last = 0;
    try { last = Number(localStorage.getItem(SWEEP_KEY)) || 0; } catch (e) {}
    if (Date.now() - last < 12 * 3600000) return;
    trashSweepLoad().then(function () {}, function () {});
  }

  // Whatever is left of one record: its folder and its .json.
  function trashDiscard(id) {
    return FS().rm(CORE.trashItemDir(id)).catch(function () {}).then(function () {
      return FS().rm(CORE.trashMetaPath(id)).catch(function () {});
    });
  }

  function renderTrashView() {
    var token = ++renderToken;
    setStatusLoading();
    renderTree();
    renderCrumbs();
    updateActionButtons();
    hideRecents();
    trashSweepLoad().then(function (recs) {
      if (token !== renderToken) return null;
      trashRows = {};
      var rows = recs.map(function (rec) {
        var name = rec.item ? rec.item.name : (rec.meta.name || rec.id);
        var path = CORE.trashItemDir(rec.id) + "/" + name;
        trashRows[path] = rec;
        return {
          name: name, path: path,
          dir: rec.item ? !!rec.item.dir : rec.meta.dir,
          mtime: rec.meta.at || null, keepDate: true,
          sub: rec.meta.path ? tfmt("trash.from", { path: displayPath(parentOf(rec.meta.path)) }) : t("trash.unknown"),
          missing: !rec.item && !rec.meta.dir, size: null
        };
      });
      return Promise.all(rows.map(function (r) {
        if (r.dir || r.missing) return null;
        return FS().stat(r.path).then(function (st) {
          r.size = st && typeof st.size === "number" ? st.size : null;
        }, function () {});
      })).then(function () {
        if (token !== renderToken) return;
        rows.sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
        lastEntries = rows;
        renderEntries(rows);
        renderStatus(rows.length);
        var eb = $("vb-empty");
        if (eb) eb.disabled = rows.length === 0;
      });
    }).catch(function () {
      if (token !== renderToken) return;
      lastEntries = [];
      renderEntries([]);
      showDiskDown();
    });
  }

  function trashRestore(paths) {
    var done = 0, fail = 0, notHere = 0, lastName = null, renamed = false;
    var chain = Promise.resolve();
    paths.forEach(function (p) {
      var rec = trashRows[p];
      if (!rec) return;
      // A file that has not arrived yet cannot come back; an empty
      // folder never travels, so it is simply made again.
      if (!rec.item && !rec.meta.dir) { notHere++; return; }
      var item = rec.item || { name: rec.meta.name || "folder", dir: true, made: true };
      chain = chain.then(function () {
        var parent = CORE.restoreParent(rec.meta);
        var ready = parent === ROOT ? Promise.resolve()
          : FS().mkdir(parent).catch(function () { parent = ROOT; });
        return ready.then(function () {
          return fsList(parent, true).catch(function () { return []; });
        }).then(function (list) {
          var names = list.map(function (e) { return e.name; });
          var name = uniqueName(item.name, names);
          if (parent === ROOT && name === ".trash") name = uniqueName("_trash", names);
          var op = item.made ? FS().mkdir(join(parent, name)) : FS().mv(p, join(parent, name));
          return op.then(function () {
            done++;
            lastName = name;
            renamed = renamed || name !== item.name;
            if (!item.dir) recentsTouch(join(parent, name));
            return trashDiscard(rec.id);
          });
        }).catch(function () { fail++; });
      });
    });
    return chain.then(function () {
      if (notHere) transientNote(t("trash.notHere"));
      if (fail) transientNote(t("toast.opFail"));
      if (done === 1) transientNote(renamed ? tfmt("trash.restoredAs", { name: lastName }) : t("trash.restored"));
      else if (done > 1) transientNote(tfmt("trash.restoredMulti", { n: done }));
      clearSelection();
      if (done) markDirty();
      refresh();
    });
  }

  function trashForever(paths) {
    var n = 0, chain = Promise.resolve();
    paths.forEach(function (p) {
      var rec = trashRows[p];
      if (!rec) return;
      chain = chain.then(function () { return trashDiscard(rec.id).then(function () { n++; }); });
    });
    return chain.then(function () {
      transientNote(n === 1 ? t("trash.gone") : tfmt("trash.goneMulti", { n: n }));
      clearSelection();
      forceStorageRecalc();
      markDirty();
      refresh();
    });
  }

  function emptyTrash() {
    FS().rm(TRASH).catch(function (e) {
      if (!e || e.code !== "ENOENT") throw e;
    }).then(function () {
      transientNote(t("trash.emptied"));
    }, function () {
      transientNote(t("toast.opFail"));
    }).then(function () {
      clearSelection();
      forceStorageRecalc();
      markDirty();
      refresh();
    });
  }

  function ensureViewBar() {
    var vb = $("view-bar");
    if (vb) return vb;
    var wrap = $("list-wrap");
    if (!wrap) return null;
    vb = document.createElement("div");
    vb.id = "view-bar";
    vb.className = "view-bar";
    vb.hidden = true;
    var note = document.createElement("span");
    note.className = "vb-note";
    note.textContent = t("trash.note");
    var b = document.createElement("button");
    b.type = "button";
    b.id = "vb-empty";
    b.className = "vb-btn danger";
    b.textContent = t("trash.emptyAll");
    b.addEventListener("click", function () { openDeleteDialog("empty"); });
    vb.appendChild(note);
    vb.appendChild(b);
    wrap.insertBefore(vb, wrap.firstChild);
    return vb;
  }

  // ===== Grid view thumbnails (memory only, this session) =====
  var thumbCache = {}, thumbKeys = [], THUMB_KEEP = 150, THUMB_PX = 192;
  var thumbQueue = [], thumbRunning = 0, thumbObs = null, thumbGen = 0;

  function thumbReset() {
    thumbGen++;
    thumbQueue = [];
    if (thumbObs) { thumbObs.disconnect(); thumbObs = null; }
  }

  function thumbWatch(li, path, name) {
    if (!CORE.thumbKind(name, null)) return;
    var box = document.createElement("span");
    box.className = "thumb";
    li.insertBefore(box, li.querySelector(".ename"));
    li._thumb = { path: path, name: name, box: box, gen: thumbGen };
    if (typeof IntersectionObserver !== "function") { thumbEnqueue(li); return; }
    if (!thumbObs) {
      thumbObs = new IntersectionObserver(function (list) {
        list.forEach(function (en) {
          if (!en.isIntersecting) return;
          if (thumbObs) thumbObs.unobserve(en.target);
          thumbEnqueue(en.target);
        });
      }, { root: $("entries"), rootMargin: "200px" });
    }
    thumbObs.observe(li);
  }

  function thumbEnqueue(li) {
    thumbQueue.push(li);
    thumbPump();
  }

  function thumbPump() {
    while (thumbRunning < 2 && thumbQueue.length) {
      var li = thumbQueue.shift();
      var job = li._thumb;
      if (!job || job.gen !== thumbGen || !li.isConnected) continue;
      thumbRunning++;
      (function (li, job) {
        makeThumb(job.path, job.name).then(function (url) {
          if (!url || job.gen !== thumbGen || !li.isConnected) return;
          var img = document.createElement("img");
          img.alt = "";
          img.src = url;
          job.box.appendChild(img);
          li.classList.add("has-thumb");
        }, function () {}).then(function () {
          thumbRunning--;
          thumbPump();
        });
      })(li, job);
    }
  }

  function makeThumb(path, name) {
    return FS().stat(path).then(function (st) {
      var size = st && typeof st.size === "number" ? st.size : 0;
      var kind = CORE.thumbKind(name, size);
      if (!kind) return null;
      var key = path + "|" + (st.mtime || "") + "|" + size;
      if (Object.prototype.hasOwnProperty.call(thumbCache, key)) return thumbCache[key];
      return FS().read(path).then(function (blob) {
        return kind === "pdf" ? pdfThumb(blob) : imageThumb(blob);
      }).then(canvasUrl).then(function (url) {
        if (!url) return null;
        thumbCache[key] = url;
        thumbKeys.push(key);
        while (thumbKeys.length > THUMB_KEEP) {
          var old = thumbKeys.shift();
          try { URL.revokeObjectURL(thumbCache[old]); } catch (e) {}
          delete thumbCache[old];
        }
        return url;
      });
    });
  }

  function drawThumb(src, w, h) {
    var sc = Math.min(1, THUMB_PX / Math.max(1, w, h));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * sc));
    c.height = Math.max(1, Math.round(h * sc));
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function imageThumb(blob) {
    function viaImg() {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          try { res(drawThumb(img, img.naturalWidth, img.naturalHeight)); } catch (e) { rej(e); }
          URL.revokeObjectURL(url);
        };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("img")); };
        img.src = url;
      });
    }
    if (typeof createImageBitmap !== "function") return viaImg();
    return createImageBitmap(blob).then(function (bmp) {
      var c = drawThumb(bmp, bmp.width, bmp.height);
      try { bmp.close(); } catch (e) {}
      return c;
    }, viaImg);
  }

  function pdfThumb(blob) {
    return blob.arrayBuffer().then(function (buf) {
      return pdfOpen(new Uint8Array(buf));
    }).then(function (pdf) {
      return pdf.getPage(1).then(function (page) {
        var v1 = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: THUMB_PX / Math.max(1, v1.width, v1.height) });
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(vp.width));
        c.height = Math.max(1, Math.round(vp.height));
        return page.render({ canvasContext: c.getContext("2d"), viewport: vp, background: "#ffffff" }).promise
          .then(function () { return c; });
      }).then(function (c) { try { pdf.destroy(); } catch (e) {} return c; },
        function (e) { try { pdf.destroy(); } catch (e2) {} throw e; });
    });
  }

  function canvasUrl(c) {
    return new Promise(function (res) {
      try {
        c.toBlob(function (b) { res(b ? URL.createObjectURL(b) : null); }, "image/webp", 0.82);
      } catch (e) { res(null); }
    });
  }

  // PDF.js (vendor/pdfjs, Apache-2.0), loaded on first use; eval and
  // XFA off: a PDF's scripts and forms never run.
  var PDF_LIB = "../vendor/pdfjs/pdf.min.js", PDF_WORKER = "../vendor/pdfjs/pdf.worker.min.js";
  var pdfLibP = null;
  function pdfLib() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      return Promise.resolve(window.pdfjsLib);
    }
    if (pdfLibP) return pdfLibP;
    pdfLibP = new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.type = "module";
      sc.src = PDF_LIB;
      sc.onload = function () {
        if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; res(window.pdfjsLib); }
        else rej(new Error("pdfjs"));
      };
      sc.onerror = function () { rej(new Error("pdfjs")); };
      document.head.appendChild(sc);
    });
    pdfLibP.catch(function () { pdfLibP = null; });
    return pdfLibP;
  }
  function pdfOpen(bytes) {
    return pdfLib().then(function (lib) {
      return lib.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false,
                               disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise;
    });
  }

  function setLayout(layout) {
    prefs.layout = layout === "grid" ? "grid" : "list";
    savePrefs();
    paintToggles();
    if (searchQuery === null) refresh();
  }

  // ===== Select mode (touch screens, any screen) =====
  var swallowClick = false, lastPointerTouch = false;
  document.addEventListener("pointerdown", function (e) {
    lastPointerTouch = e.pointerType === "touch" || e.pointerType === "pen";
    swallowClick = false;
  }, true);

  // A finger held on a row for half a second: Select mode with it.
  function attachLongPress(li, path) {
    var timer = null, x0 = 0, y0 = 0;
    function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
    li.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch") return;
      x0 = e.clientX; y0 = e.clientY;
      cancel();
      timer = setTimeout(function () {
        timer = null;
        swallowClick = true;
        if (!selectMode) { clearSelection(); setSelectMode(true); }
        selectedPaths[path] = true;
        paintSelection();
        updateActionButtons();
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (e2) {}
      }, 500);
    });
    li.addEventListener("pointermove", function (e) {
      if (timer && (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10)) cancel();
    });
    li.addEventListener("pointerup", cancel);
    li.addEventListener("pointercancel", cancel);
  }

  function setSelectMode(on) {
    selectMode = !!on;
    document.body.classList.toggle("select-mode", selectMode);
    var tg = $("sel-toggle");
    if (tg) tg.setAttribute("aria-pressed", selectMode ? "true" : "false");
    if (!selectMode) clearSelection();
    else updateActionButtons();
  }

  function selBtn(id, svg, labelKey, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.className = "sb-btn";
    b.title = t(labelKey);
    b.setAttribute("aria-label", t(labelKey));
    b.innerHTML = svg + '<span class="sb-l"></span>';
    b.querySelector(".sb-l").textContent = t(labelKey);
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(b); });
    return b;
  }

  function ensureSelBar() {
    var bar = $("sel-bar");
    if (bar) return bar;
    var wrap = $("list-wrap");
    if (!wrap) return null;
    bar = document.createElement("div");
    bar.id = "sel-bar";
    bar.className = "sel-bar";
    bar.setAttribute("role", "toolbar");
    bar.hidden = true;
    bar.appendChild(selBtn("sb-done", X_SVG, "sel.done", function () { setSelectMode(false); }));
    var cnt = document.createElement("span");
    cnt.id = "sel-count";
    cnt.className = "sel-count";
    bar.appendChild(cnt);
    var sp = document.createElement("span");
    sp.className = "spacer";
    bar.appendChild(sp);
    bar.appendChild(selBtn("sb-all", CHECK_ALL_SVG, "sel.all", function () {
      lastEntries.forEach(function (e) { selectedPaths[entryPath(e)] = true; });
      paintSelection();
      updateActionButtons();
    }));
    bar.appendChild(selBtn("sb-restore", RESTORE_SVG, "trash.restore", function () { trashRestore(selectionPaths()); }));
    bar.appendChild(selBtn("sb-fav", STAR_SVG, "fav.add", function () {
      var p = selectionPrimary();
      if (p) favToggle(p.path, p.dir);
    }));
    bar.appendChild(selBtn("sb-zip", ZIP_SVG, "menu.zip", function () { zipCreate(selectionPaths()); }));
    bar.appendChild(selBtn("sb-conv", CONVERT_SVG, "menu.convert", convertSelection));
    bar.appendChild(selBtn("sb-move", MV_SVG, "menu.moveTo", function () { openPickerDialog("move"); }));
    bar.appendChild(selBtn("sb-copy", CP_SVG, "menu.copyTo", function () { openPickerDialog("copy"); }));
    if (dbx() && dbx().exportFrom) {
      bar.appendChild(selBtn("sb-dbx", dbx().icon || "", "menu.toDropbox", function () { sendToDropbox(); }));
    }
    bar.appendChild(selBtn("sb-del", TRASH_SVG, "act.delete", function () {
      openDeleteDialog(view === "trash" ? "forever" : "trash");
    }));
    wrap.appendChild(bar);
    return bar;
  }

  function renderSelBar() {
    var bar = ensureSelBar();
    if (!bar) return;
    bar.hidden = !selectMode || placeActive();
    if (bar.hidden) return;
    var n = selectionCount();
    $("sel-count").textContent = n === 1 ? t("sel.one") : n ? tfmt("sel.count", { n: n }) : t("sel.none");
    var trash = view === "trash";
    function show(id, on, enabled) {
      var b = $(id);
      if (!b) return;
      b.hidden = !on;
      b.disabled = !enabled;
    }
    show("sb-restore", trash, n > 0);
    show("sb-fav", !trash && n === 1, n === 1);
    show("sb-zip", !trash, n > 0);
    var conv = !trash && n > 0 && convertiblePaths().length > 0;
    show("sb-conv", conv, conv);
    show("sb-move", !trash, n > 0);
    show("sb-copy", !trash, n > 0);
    show("sb-dbx", !trash, n > 0);
    show("sb-del", true, n > 0);
    show("sb-all", true, lastEntries.length > 0);
    var del = $("sb-del");
    if (del) {
      var lk = trash ? "trash.deleteForever" : "act.delete";
      del.title = t(lk);
      del.setAttribute("aria-label", t(lk));
      del.querySelector(".sb-l").textContent = t(lk);
    }
    var fb = $("sb-fav");
    if (fb && n === 1) {
      var p = selectionPrimary();
      var on = !!(p && CORE.favIs(favs, p.path));
      var fk = on ? "fav.remove" : "fav.add";
      fb.title = t(fk);
      fb.setAttribute("aria-label", t(fk));
      fb.querySelector(".sb-l").textContent = t(fk);
      fb.classList.toggle("on", on);
    }
  }

  // ===== ZIP: create (stored / deflated) and extract =====
  var zipBusy = false;
  var ZIP_MAX_FILES = 10000, ZIP_MAX_MB = 300, ZIP_OPEN_MB = 300;

  function deflateOk() {
    try { new CompressionStream("deflate-raw"); return true; } catch (e) { return false; }
  }
  function deflate(bytes) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw")))
      .arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  // Selected items → [{ rel, dir, path?, size?, mtime }] (folders whole).
  function zipCollect(paths) {
    var list = [], total = 0, over = false, top = [];
    function add(path, rel) {
      if (over) return Promise.resolve();
      return FS().stat(path).then(function (st) {
        if (st && st.dir) {
          list.push({ rel: rel + "/", dir: true, mtime: st.mtime || null });
          return fsList(path).then(function (kids) {
            var chain = Promise.resolve();
            kids.forEach(function (k) {
              chain = chain.then(function () { return add(join(path, k.name), rel + "/" + k.name); });
            });
            return chain;
          });
        }
        var size = st && typeof st.size === "number" ? st.size : 0;
        total += size;
        list.push({ rel: rel, path: path, size: size, mtime: st && st.mtime || null });
        if (list.length > ZIP_MAX_FILES || total > ZIP_MAX_MB * 1048576) over = true;
      });
    }
    var chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        var rel = uniqueName(baseName(p), top);      // same name from two folders (Recent)
        top.push(rel);
        return add(p, rel);
      });
    });
    return chain.then(function () { return { list: list, over: over }; });
  }

  function zipCreate(paths) {
    paths = (paths || []).filter(function (p) { return !CORE.isTrashPath(p); });
    if (!paths.length) return;
    if (zipBusy) { transientNote(t("zip.busy")); return; }
    zipBusy = true;
    var parent = parentOf(paths[0]);
    if (parent === "/") parent = ROOT;
    var canDeflate = deflateOk();
    setJob(tfmt("zip.working", { n: 0, t: "…" }));
    zipCollect(paths).then(function (c) {
      if (c.over) {
        transientNote(tfmt("zip.tooBig", { n: ZIP_MAX_FILES, mb: ZIP_MAX_MB }));
        return null;
      }
      var nFiles = c.list.filter(function (it) { return !it.dir; }).length, done = 0, entries = [];
      var chain = Promise.resolve();
      c.list.forEach(function (it) {
        chain = chain.then(function () {
          if (it.dir) {
            entries.push({ name: it.rel, size: 0, crc: 0, data: new Uint8Array(0), method: 0, date: it.mtime });
            return null;
          }
          return FS().read(it.path).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
            var raw = new Uint8Array(buf);
            var crc = CORE.crc32(raw);
            var squeeze = canDeflate && raw.length > 64 && !CORE.shouldStore(it.rel)
              ? deflate(raw).catch(function () { return null; }) : Promise.resolve(null);
            return squeeze.then(function (def) {
              var use = !!(def && def.length < raw.length);
              entries.push({ name: it.rel, size: raw.length, crc: crc, data: use ? def : raw,
                             method: use ? 8 : 0, date: it.mtime });
              done++;
              setJob(tfmt("zip.working", { n: done, t: nFiles }));
            });
          });
        });
      });
      return chain.then(function () {
        var parts = CORE.zipBuild(entries);
        var dirs = paths.map(function (p, i) {
          return c.list.some(function (it) { return it.dir && it.rel === baseName(p) + "/"; });
        });
        return fsList(parent, true).then(function (list) {
          var names = list.map(function (e) { return e.name; });
          var name = uniqueName(CORE.zipNameFor(paths.map(baseName), dirs) || (t("zip.archive") + ".zip"), names);
          var dst = join(parent, name);
          return FS().write(dst, new Blob(parts, { type: "application/zip" })).then(function () {
            recentsTouch(dst);
            transientNote(tfmt("zip.done", { name: name }));
            forceStorageRecalc();
            markDirty();
          });
        });
      });
    }).catch(function () {
      transientNote(t("zip.fail"));
    }).then(function () {
      zipBusy = false;
      setJob("");
      refresh();
    });
  }

  // Read a ZIP of the disk with atelier/zip.js (AtelierZip.open).
  function zipOpen(path) {
    var Z = window.AtelierZip;
    if (!Z || typeof Z.open !== "function") return Promise.reject(new Error("bad"));
    return FS().stat(path).then(function (st) {
      if (st && st.size > ZIP_OPEN_MB * 1048576) throw new Error("big");
      return FS().read(path);
    }).then(function (blob) {
      return blob.arrayBuffer();
    }).then(function (buf) {
      try { return Z.open(new Uint8Array(buf)); }
      catch (e) { throw new Error("bad"); }
    });
  }
  function zipErrorText(e) {
    return e && e.message === "big" ? tfmt("zip.big", { mb: ZIP_OPEN_MB }) : t("zip.bad");
  }

  // Into a new folder named after the ZIP, next to it.
  function zipExtract(path) {
    if (zipBusy) { transientNote(t("zip.busy")); return; }
    zipBusy = true;
    var parent = parentOf(path);
    setJob(tfmt("zip.extracting", { n: 0, t: "…" }));
    zipOpen(path).then(function (z) {
      var plan = CORE.extractPlan(z.names, z.size);
      if (plan.tooMany || plan.tooBig) { transientNote(tfmt("zip.tooBig", { n: 20000, mb: 1024 })); return null; }
      if (!plan.items.length) { transientNote(t("zip.empty")); return null; }
      return fsList(parent, true).then(function (list) {
        var base = plan.top || baseName(path).replace(/\.zip$/i, "") || t("zip.archive");
        var folder = uniqueName(base, list.map(function (e) { return e.name; }));
        var dest = join(parent, folder);
        var cut = plan.top ? plan.top.length + 1 : 0;
        return FS().mkdir(dest).then(function () {
          var ok = 0, fail = 0, chain = Promise.resolve();
          plan.items.forEach(function (it) {
            chain = chain.then(function () {
              return z.bytes(it.name).then(function (b) {
                return FS().write(dest + "/" + it.rel.slice(cut), new Blob([b || new Uint8Array(0)]));
              }).then(function () { ok++; }, function () { fail++; }).then(function () {
                setJob(tfmt("zip.extracting", { n: ok + fail, t: plan.items.length }));
              });
            });
          });
          return chain.then(function () {
            transientNote(tfmt("zip.extracted", { n: ok, name: folder }));
            if (fail) transientNote(tfmt("zip.partial", { n: fail }));
            forceStorageRecalc();
            markDirty();
          });
        });
      });
    }).catch(function (e) {
      transientNote(zipErrorText(e));
    }).then(function () {
      zipBusy = false;
      setJob("");
      refresh();
    });
  }

  // Preview of a .zip: what is inside, and Extract.
  function renderZipPreview(path) {
    pvBodySet('<div class="pv-loading">' + escapeHtml(t("status.loading")) + "</div>");
    var acts = $("pv-actions");
    if (acts && !acts.dataset.hasZip) {
      acts.dataset.hasZip = "1";
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pv-btn";
      b.innerHTML = UNZIP_SVG + "<span></span>";
      b.querySelector("span").textContent = t("zip.extract");
      b.addEventListener("click", function () { closePreview(true); zipExtract(path); });
      acts.appendChild(b);
    }
    zipOpen(path).then(function (z) {
      var body = $("pv-body");
      if (!body) return;
      var plan = CORE.extractPlan(z.names, z.size);
      body.innerHTML = "";
      var info = document.createElement("p");
      info.className = "pv-zipinfo";
      info.textContent = tfmt("zip.entries", { n: plan.items.length, size: fmtKB(plan.total) });
      body.appendChild(info);
      var ul = document.createElement("ul");
      ul.className = "zip-list";
      plan.items.slice(0, 500).forEach(function (it) {
        var li = document.createElement("li");
        var n = document.createElement("span");
        n.className = "zn";
        n.textContent = it.rel;
        var s = document.createElement("span");
        s.className = "zs";
        s.textContent = fmtKB(it.size);
        li.appendChild(n);
        li.appendChild(s);
        ul.appendChild(li);
      });
      if (plan.items.length > 500) {
        var more = document.createElement("li");
        more.textContent = "…";
        ul.appendChild(more);
      }
      body.appendChild(ul);
    }).catch(function (e) {
      pvBodySet('<div class="pv-msg">' + escapeHtml(zipErrorText(e)) + "</div>");
    });
  }

  // ---------- 17. Wiring & boot ----------

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
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

      // Wave 3: search inside files too (this device remembers it)
      var cont = document.createElement("button");
      cont.type = "button";
      cont.id = "search-contents";
      cont.className = "sb-toggle";
      cont.title = t("search.contentsTitle");
      cont.setAttribute("aria-label", t("search.contentsTitle"));
      cont.innerHTML = TEXT_SVG + '<span class="tg-l"></span>';
      cont.querySelector(".tg-l").textContent = t("search.contents");
      cont.addEventListener("click", function () {
        prefs.contents = !prefs.contents;
        savePrefs();
        paintToggles();
        if (searchQuery !== null) runSearch(searchQuery);
      });
      bar.appendChild(cont);

      // Wave 3: list / grid, per device
      var lay = document.createElement("button");
      lay.type = "button";
      lay.id = "layout-toggle";
      lay.className = "sb-toggle";
      lay.addEventListener("click", function () {
        setLayout(prefs.layout === "grid" ? "list" : "grid");
      });
      bar.appendChild(lay);

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
      pick.addEventListener("click", openImportMenu);
      var actions = $("actions");
      if (actions) actions.insertBefore(pick, actions.firstChild);
    }

    // --- FL-6: "More actions" — the context menu for touch screens.
    // Preview, Download, Move, Copy and the clipboard actions lived
    // ONLY in the right-click menu; iOS has no such event, so on an
    // iPhone none of them could be reached at all.
    if (!$("more-actions")) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "tool";
      more.id = "more-actions";
      more.title = t("act.more");
      more.setAttribute("aria-label", t("act.more"));
      more.disabled = true;
      more.innerHTML = MORE_SVG;
      more.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; return; }
        var r = more.getBoundingClientRect();
        openContextMenu(r.left, r.bottom + 4);
      });
      var acts2 = $("actions");
      if (acts2) acts2.appendChild(more);
    }
  }

  function wire() {
    $("up").addEventListener("click", function () {
      if (view !== "files") { navigate(cwd); return; }
      if (cwd === ROOT) return;
      navigate(cwd.slice(0, cwd.lastIndexOf("/")) || ROOT);
    });

    $("new-folder").addEventListener("click", function () { openNameDialog("folder"); });
    $("new-file").addEventListener("click", function () { openNameDialog("file"); });
    $("rename").addEventListener("click", function () { openNameDialog("rename"); });
    $("delete").addEventListener("click", function () { openDeleteDialog(); });

    // Name dialog
    $("name-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitNameDialog();
    });
    $("name-cancel").addEventListener("click", function () {
      $("dlg-name").close();
    });

    // Delete dialog (Trash / forever / Empty Trash)
    $("delete-form").addEventListener("submit", function (e) {
      e.preventDefault();
      $("dlg-delete").close();
      confirmDelete();
    });

    // Esc leaves Select mode (the preview and dialogs take Esc first).
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !selectMode || pvOverlay) return;
      if (document.querySelector("dialog[open]")) return;
      setSelectMode(false);
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
  function paintToggles() {
    var cont = $("search-contents");
    if (cont) cont.setAttribute("aria-pressed", prefs.contents ? "true" : "false");
    var lay = $("layout-toggle");
    if (lay) {
      var grid = prefs.layout === "grid";
      lay.innerHTML = grid ? LIST_SVG : GRID_SVG;
      lay.title = t(grid ? "view.list" : "view.grid");
      lay.setAttribute("aria-label", lay.title);
    }
  }

  function boot() {
    loadPrefs();
    favLoad();
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

    renderSyncPill();
    watchVault();
    registerFavSync();
    cwd = prefs.last && prefs.last.indexOf(ROOT) === 0 && !CORE.isTrashPath(prefs.last) ? prefs.last : ROOT;
    clearSelection();

    // Ensure header + storage bar + column headers BEFORE the
    // first render paints (they were orphaned outside boot —
    // the fatal #1 regression).
    ensureHeaderAndStorage();
    ensureColumnHeaders();
    paintToggles();
    refresh();
    updateSortIndicators();
    ensureStorageBar();
    setTimeout(ensureStorageBar, 1500); // delayed recalc if first boot
    setTimeout(trashSweepMaybe, 4000);  // auto-empty: older than 30 days

    initDropbox();
    initDrive();

    console.log("[orOS] files.js v" + APP_VER + " booted (backend: " +
      (FS().mode ? FS().mode() : "unknown") + ")");

    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("files");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { path, dir }. A folder opens; a file opens its folder and
  // its preview. Paths outside the disk root are ignored.
  function openSearchTarget(t) {
    // Single app (solo.js) icon shortcut { newFolder: true }.
    if (t && t.newFolder === true) {
      if (isAvailable() && !document.querySelector("dialog[open]")) openNameDialog("folder");
      return;
    }
    if (!t || typeof t.path !== "string" || !isAvailable()) return;
    var p = t.path.replace(/\/+$/, "");
    if (p.indexOf(ROOT + "/") !== 0 || p.indexOf("/../") !== -1 || /\/\.\.?$/.test(p)) return;
    if (CORE.isTrashPath(p)) { openView("trash"); return; }
    if (t.dir) { navigate(p); return; }
    navigate(p.slice(0, p.lastIndexOf("/")) || ROOT);
    openPreview(p);
  }
  window.__orosOpenAt = openSearchTarget;

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
      th.title = t("sort." + field);                      // FL-13: sort.* were never shown
      th.addEventListener("click", function () { toggleSort(field); });
      return th;
    };

    // #7 FIX: 4 grid tracks to mirror the rows: icon-gap | name | size | date
    // (FG4: the gridCol param was dead — placement comes from the
    // .col-th:nth-child rules in files.css)
    hdr.appendChild(mkCol("col.name", "name"));
    hdr.appendChild(mkCol("col.size", "size"));
    hdr.appendChild(mkCol("col.date", "date"));

    // Wave 3: Select mode toggle, in the icon column (placed by CSS).
    var sel = document.createElement("button");
    sel.type = "button";
    sel.id = "sel-toggle";
    sel.title = t("sel.mode");
    sel.setAttribute("aria-label", t("sel.mode"));
    sel.setAttribute("aria-pressed", "false");
    sel.innerHTML = CHECK_SVG;
    sel.addEventListener("click", function (e) {
      e.stopPropagation();
      setSelectMode(!selectMode);
    });
    hdr.appendChild(sel);

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