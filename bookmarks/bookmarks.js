/*! ============================================================
 *  orOS Bookmarks — bookmarks.js
 *  A static, offline-first, mobile-first bookmark manager.
 *  Data: localStorage blob "oros-bookmarks-data" (single-blob,
 *  upgradeable to per-entry granularity in a later wave).
 *
 *  SCHEMA v1 (what sanitizeState enforces):
 *    {
 *      ver:     1,
 *      items:   { [id]: { id, url, title, note, folderId,
 *                          tags[], status, visits, lastVisit,
 *                          added, modified, fav?, pos,
 *                          chk?:  { s, at, code?, to? }   link check,
 *                          arch?: { at, f, n?, img? } } }  saved copy
 *      folders: { [id]: { id, name, pos, parent?, modified } },
 *      deleted: { [id]: epochMs },        // tombstones, 30d prune
 *      settings: {}
 *    }
 *  - "unsorted" is the permanent root folder (undeletable).
 *  - Wave 35: folders nest through "parent" (absent = top level; the
 *    effective tree and its cycle guard live in core.js). "chk" and
 *    "arch" are side records: they never move "modified" and merge
 *    on their own by their "at" (core.sideMerge). The saved copy
 *    itself is a file on the orOS disk (/internal/Bookmarks/Archive),
 *    never in the sync slice.
 *  - Merge: entity-union by id, newest "modified"/tombstone wins,
 *    deterministic tie-break on canonical JSON (no Date.now()
 *    inside the merge — both devices must compute identically).
 *
 *  Mantra: Offline first, Mobile first, No external deps,
 *          Full manual export, Full auto export, Snapshots,
 *          Auto merge sync, No guessing.
 *  ============================================================ */
(function () {
"use strict";

/* ---------- 0. Constants + tiny utils ---------- */

const SCRIPT_V = (document.currentScript &&
  (document.currentScript.src.match(/[?&]v=(\d[\w.]*)/) || [])[1]) || "dev";
const DATA_KEY = "oros-bookmarks-data";
const ROOT_FOLDER = "unsorted";
const DELETED_PRUNE_DAYS = 30;

const K = window.OrosBookmarksCore;
const ARCHIVE_DIR = "/internal/Bookmarks/Archive";

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "bm-" + Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2, 10);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Canonical JSON string for deterministic tie-breaks. */
function canon(v) {
  const keys = Object.keys(v).sort();
  return JSON.stringify(keys.reduce((o, k) => (o[k] = v[k], o), {}));
}

/* "example.com/path?x" — lowercase host, keep path/query. */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

/* ---------- 1. Palette inheritance (runtime, same-origin shell) ---------- */

const PALETTE_VARS = [
  "--bg", "--text", "--text-dim", "--accent", "--accent-hover",
  "--accent-soft", "--panel-bg", "--border", "--danger", "--shadow"
];

function inheritPalette() {
  try {
    const parentStyle = window.parent.getComputedStyle(
      window.parent.document.documentElement);
    const vars = {};
    PALETTE_VARS.forEach((name) => {
      const val = parentStyle.getPropertyValue(name);
      if (val && val.trim()) vars[name] = val.trim();
    });
    if (Object.keys(vars).length) {
      document.documentElement.style.cssText = "";
      const root = document.documentElement;
      Object.keys(vars).forEach((k) => root.style.setProperty(k, vars[k]));
    }
  } catch (e) { /* cross-origin or standalone — keep :root fallback */ }
}

function watchPalette() {
  try {
    const target = window.parent.document.documentElement;
    new MutationObserver(inheritPalette).observe(target, {
      attributes: true, attributeFilter: ["style", "class", "data-theme"]
    });
  } catch (e) { /* standalone — nothing to watch */ }
}

/* ---------- 2. i18n (EN default / EL) ---------- */

const STR = {
  "en": {
    "aria.folders": "Folders",
    "app.name": "Bookmarks",
    "tab.add": "New folder",
    "quick.add": "Paste a link — or link | title",
    "search.ph": "Search…",
    "search.clear": "Clear search",
    "import.title": "Import bookmarks (browsers, Pocket, Raindrop: HTML or CSV)",
    "export.title": "Export bookmarks (Netscape HTML)",
    "folder.settings": "Folder options",
    "folder.settings.dlg": "Folder settings",
    "folder.name": "Name",
    "folder.delete": "Delete folder",
    "folder.unsorted": "Unsorted",
    "view.all": "All",
    "folder.count": "{n} bookmark(s) in this folder",
    "folder.confirm.delete": "Delete this folder? What's inside moves up one level (to Unsorted from a top folder).",
    "folder.empty.title": "This folder is empty",
    "folder.empty.hint": "Links you add land in the open folder.",
    "empty.title": "Nothing here yet",
    "empty.hint": "Paste a link above to save it.",
    "search.none": "No matches",
    "search.none.hint": "Try another term or check the spelling.",
    "item.title": "Bookmark",
    "item.title.f": "Title",
    "item.url": "Address",
    "item.note": "Description",
    "item.folder": "Folder",
    "item.delete": "Delete",
    "item.follow": "Follow in Reader",
    "item.qr": "QR code",
    "item.open": "Open",
    "item.move": "Move to…",
    "item.edit": "Edit",
    "save": "Save",
    "cancel": "Cancel",
    "added": "Saved",
    "added.dup": "Already saved in “{f}”",
    "moved": "Moved to “{f}”",
    "deleted": "Deleted",
    "undo": "Undo",
    "import.picked": "Imported {n} bookmark(s), {f} folder(s)",
    "import.none": "No bookmarks found in this file",
    "import.have": "Nothing new: you already have the {n} bookmark(s) in this file",
    "exported": "Exported {n} bookmark(s)",
    "ctx.open": "Open",
  "ctx.open_maps": "Open in Maps",
  "ctx.edit": "Edit",
  "ctx.move": "Move to…",
  "ctx.delete": "Delete",
    "time.just": "just now",
    "time.min": "{n} min ago",
    "time.hour": "{n} h ago",
    "time.day": "{n} d ago",
    "item.tags": "Tags",
    "tags.hint": "Add tag, press Enter…",
    "tags.all": "All tags",
    "tags.none": "No tags yet — add some from a bookmark",
    "tags.clear": "Clear filters",
    "tags.dup": "already added",
    "tags.filter": "Click to filter",
    "sort.recent": "Recent",
    "sort.title": "Title A–Z",
    "sort.visited": "Most visited",
    "sort.manual": "Manual",
    "sel.mode": "Select bookmarks",
    "sel.selected": "{n} selected",
    "sel.move": "Move to…",
    "sel.delete": "Delete",
    "sel.share": "Send…",
    "ctx.share": "Send to someone…",
    "many.added": "{n} bookmark(s) added to {f}",
    "many.none": "You already have all of these",
    "sel.done": "Done",
    "sel.deleted": "Deleted {n} bookmark(s)",
    "sel.moved": "Moved {n} bookmark(s)",
    "sel.none": "Select at least one bookmark",
    "tab.rename": "Rename",
    "tab.movel": "Move left",
    "tab.mover": "Move right",
    "dupe.title": "Duplicate bookmarks",
    "dupe.none": "No duplicates found — each address exists only once.",
    "dupe.keep": "Merge into oldest, remove {n}",
    "dupe.deleted": "Merged {n} duplicate(s)",
    "dupe.keeper": "oldest — kept, gets the tags and notes",
    "dupe.apply.all": "Apply all ({n} groups)",
    "dupe.apply.sel": "Apply selected",
    "dupe.none.sel": "Select at least one group",
    "fav.title": "Favorites",
    "fav.add": "Add to favorites",
    "fav.remove": "Remove from favorites",
    "fav.added": "Added to favorites",
    "fav.removed": "Removed from favorites",
    "item.new": "New bookmark",
    "ok": "OK",
    "send.title": "Save from your browser",
    "send.intro": "Save any page to orOS Bookmarks without copying its address.",
    "send.pc": "Computer (Chrome, Edge, Firefox, Brave):",
    "send.pc.hint": "Show the bookmarks bar (Ctrl+Shift+B), then drag this button onto it. On any page, click it: orOS opens with the page ready to save.",
    "send.link": "Save to orOS",
    "send.copy": "Copy code",
    "send.copied": "Copied. Make a new bookmark and paste it as its address.",
    "send.drag": "Drag this button to your bookmarks bar",
    "send.android": "Android:",
    "send.android.hint": "Install orOS (browser menu → Install app). Then, in any app, choose Share → orOS.",
    "send.safe": "Nothing is saved until you press Save in orOS.",
    "folder.parent": "Inside",
    "folder.top": "Top level (a tab)",
    "folder.sub.add": "New subfolder",
    "folder.subs": "{n} subfolder(s)",
    "folder.moved": "“{f}” moved",
    "folder.path": "Folder path",
    "tab.into": "Move into…",
    "tab.sub": "New subfolder",
    "pick.item": "Move to folder",
    "pick.folder": "Move “{f}” into",
    "pick.top": "Top level (a tab)",
    "tools.title": "Tidy up",
    "chk.folder": "Check links in this folder",
    "chk.all": "Check all links",
    "chk.one": "Check link",
    "chk.running": "Checking links… {i} of {n}",
    "chk.stop": "Stop",
    "chk.done": "Checked {n}: {d} broken, {m} moved, {e} couldn't be checked",
    "chk.stopped": "Stopped after {n} link(s)",
    "chk.offline": "You're offline. Links can't be checked now.",
    "chk.norelay": "Without a relay (Reader or Mail settings) most sites can't be checked from the browser.",
    "chk.none": "No links to check here",
    "chk.busy": "A link check is already running",
    "chk.s.dead": "Broken",
    "chk.s.moved": "Moved",
    "chk.s.err": "Couldn't check",
    "chk.s.ok": "Works",
    "chk.s.skip": "Can't be checked",
    "chk.line": "Link check: {s} · {when}",
    "chk.to": "Now at {u}",
    "chk.use": "Use new address",
    "chk.used": "Address updated",
    "chk.filter": "Broken and moved links",
    "chk.show": "Show broken and moved links",
    "arc.save": "Save a readable copy",
    "arc.read": "Read saved copy",
    "arc.again": "Save again",
    "arc.remove": "Remove copy",
    "arc.open": "Original page",
    "arc.back": "Back",
    "arc.saving": "Saving a readable copy…",
    "arc.saved": "Readable copy saved",
    "arc.none": "No article text found on this page",
    "arc.err": "Couldn't save the page ({why})",
    "arc.nodisk": "Saved copies need the orOS disk: open Bookmarks inside orOS.",
    "arc.missing": "The saved copy isn't on this device yet. It arrives with Vault Drive, or save it again here.",
    "arc.removed": "Saved copy removed",
    "arc.img": "Keep pictures",
    "arc.when": "Saved {d}",
    "arc.badge": "Saved copy",
    "why.offline": "offline",
    "why.norelay": "no relay",
    "why.timeout": "no answer in time",
    "why.http": "the site answered {c}",
    "why.disk": "disk error"
  },
  "el": {
    "aria.folders": "Φάκελοι",
    "app.name": "Συντομεύσεις",
    "tab.add": "Νέος φάκελος",
    "quick.add": "Κόλλησε σύνδεσμο — ή σύνδεσμος | τίτλος",
    "search.ph": "Αναζήτηση…",
    "search.clear": "Καθαρισμός",
    "import.title": "Εισαγωγή σελιδοδεικτών (browsers, Pocket, Raindrop: HTML ή CSV)",
    "export.title": "Εξαγωγή σελιδοδεικτών (Netscape HTML)",
    "folder.settings": "Επιλογές φακέλου",
    "folder.settings.dlg": "Ρυθμίσεις φακέλου",
    "folder.name": "Όνομα",
    "folder.delete": "Διαγραφή φακέλου",
    "folder.unsorted": "Αταξινόμητα",
    "view.all": "Όλα",
    "folder.count": "{n} συντόμευση(εις) σε αυτόν τον φάκελο",
    "folder.confirm.delete": "Διαγραφή φακέλου; Το περιεχόμενό του ανεβαίνει ένα επίπεδο (στα Αταξινόμητα από φάκελο πρώτου επιπέδου).",
    "folder.empty.title": "Ο φάκελος είναι κενός",
    "folder.empty.hint": "Οι σύνδεσμοι που προσθέτεις πέφτουν στον ανοιχτό φάκελο.",
    "empty.title": "Δεν υπάρχει τίποτα ακόμα",
    "empty.hint": "Κόλλησε έναν σύνδεσμο παραπάνω για αποθήκευση.",
    "search.none": "Κανένα αποτέλεσμα",
    "search.none.hint": "Δοκίμασε άλλον όρο ή έλεγξε την ορθογραφία.",
    "item.title": "Συντόμευση",
    "item.title.f": "Τίτλος",
    "item.url": "Διεύθυνση",
    "item.note": "Περιγραφή",
    "item.folder": "Φάκελος",
    "item.delete": "Διαγραφή",
    "item.follow": "Στον Αναγνώστη",
    "item.qr": "Κωδικός QR",
    "item.open": "Άνοιγμα",
    "item.move": "Μετακίνηση σε…",
    "item.edit": "Επεξεργασία",
    "save": "Αποθήκευση",
    "cancel": "Ακύρωση",
    "added": "Αποθηκεύτηκε",
    "added.dup": "Βρίσκεται ήδη στα «{f}»",
    "moved": "Μεταφέρθηκε στα «{f}»",
    "deleted": "Διαγράφηκε",
    "undo": "Αναίρεση",
    "import.picked": "Εισήχθησαν {n} συντόμευση(εις), {f} φάκελος(οι)",
    "import.none": "Δεν βρέθηκαν συντομεύσεις σε αυτό το αρχείο",
    "import.have": "Τίποτα καινούργιο: έχεις ήδη τους {n} σελιδοδείκτες αυτού του αρχείου",
    "exported": "Εξήχθησαν {n} συντόμευση(εις)",
    "ctx.open": "Άνοιγμα",
    "ctx.open_maps": "Άνοιγμα στον χάρτη",
    "ctx.edit": "Επεξεργασία",
    "ctx.move": "Μετακίνηση σε…",
    "ctx.delete": "Διαγραφή",
    "time.just": "μόλις τώρα",
    "time.min": "πριν {n} λεπτά",
    "time.hour": "πριν {n} ώρες",
    "time.day": "πριν {n} ημέρες",
    "item.tags": "Ετικέτες",
    "tags.hint": "Προσθήκη ετικέτας, Enter…",
    "tags.all": "Όλες οι ετικέτες",
    "tags.none": "Καμία ετικέτα ακόμα — πρόσθεσε από κάποια συντόμευση",
    "tags.clear": "Καθαρισμός φίλτρων",
    "tags.dup": "ήδη προστέθηκε",
    "tags.filter": "Πάτα για φίλτρο",
    "sort.recent": "Πρόσφατα",
    "sort.title": "Τίτλος Α–Ω",
    "sort.visited": "Πιο δημοφιλή",
    "sort.manual": "Χειροκίνητα",
    "sel.mode": "Επιλογή σελιδοδεικτών",
    "sel.selected": "{n} επιλεγμένα",
    "sel.move": "Μετακίνηση σε…",
    "sel.delete": "Διαγραφή",
    "sel.share": "Αποστολή…",
    "ctx.share": "Στείλε σε κάποιον…",
    "many.added": "Μπήκαν {n} σελιδοδείκτες στον φάκελο «{f}»",
    "many.none": "Τους έχεις ήδη όλους",
    "sel.done": "Τέλος",
    "sel.deleted": "Διεγράφησαν {n} συντόμευση(εις)",
    "sel.moved": "Μετακινήθηκαν {n} συντόμευση(εις)",
    "sel.none": "Επίλεξε τουλάχιστον έναν σελιδοδείκτη",
    "tab.rename": "Μετονομασία",
    "tab.movel": "Κίνηση αριστερά",
    "tab.mover": "Κίνηση δεξιά",
    "dupe.title": "Διπλότυπες εγγραφές",
    "dupe.none": "Δεν βρέθηκαν διπλότυπα — κάθε διεύθυνση υπάρχει μόνο μία φορά.",
    "dupe.keep": "Συγχώνευση στην παλαιότερη, αφαίρεση {n}",
    "dupe.deleted": "Συγχωνεύτηκαν {n} διπλότυπες",
    "dupe.keeper": "παλαιότερη — μένει και παίρνει ετικέτες και σημειώσεις",
    "dupe.apply.all": "Εφαρμογή όλων ({n} ομάδες)",
    "dupe.apply.sel": "Εφαρμογή επιλεγμένων",
    "dupe.none.sel": "Επίλεξε τουλάχιστον μία ομάδα",
    "fav.title": "Αγαπημένες",
    "fav.add": "Προσθήκη στις αγαπημένες",
    "fav.remove": "Αφαίρεση από τις αγαπημένες",
    "fav.added": "Προστέθηκε στις αγαπημένες",
    "fav.removed": "Αφαιρέθηκε από τις αγαπημένες",
    "item.new": "Νέα συντόμευση",
    "ok": "Εντάξει",
    "send.title": "Αποθήκευση από τον browser",
    "send.intro": "Αποθήκευσε οποιαδήποτε σελίδα στους Σελιδοδείκτες του orOS χωρίς να αντιγράψεις τη διεύθυνση.",
    "send.pc": "Υπολογιστής (Chrome, Edge, Firefox, Brave):",
    "send.pc.hint": "Εμφάνισε τη γραμμή σελιδοδεικτών (Ctrl+Shift+B) και σύρε επάνω της αυτό το κουμπί. Σε οποιαδήποτε σελίδα, πάτα το: ανοίγει το orOS με τη σελίδα έτοιμη για αποθήκευση.",
    "send.link": "Στο orOS",
    "send.copy": "Αντιγραφή κώδικα",
    "send.copied": "Αντιγράφηκε. Φτιάξε νέο σελιδοδείκτη και επικόλλησέ το ως διεύθυνση.",
    "send.drag": "Σύρε αυτό το κουμπί στη γραμμή σελιδοδεικτών",
    "send.android": "Android:",
    "send.android.hint": "Εγκατέστησε το orOS (μενού του browser → Εγκατάσταση εφαρμογής). Μετά, από οποιαδήποτε εφαρμογή, Κοινοποίηση → orOS.",
    "send.safe": "Τίποτα δεν αποθηκεύεται πριν πατήσεις Αποθήκευση στο orOS.",
    "folder.parent": "Μέσα σε",
    "folder.top": "Πρώτο επίπεδο (καρτέλα)",
    "folder.sub.add": "Νέος υποφάκελος",
    "folder.subs": "{n} υποφάκελος(οι)",
    "folder.moved": "Ο φάκελος «{f}» μετακινήθηκε",
    "folder.path": "Διαδρομή φακέλου",
    "tab.into": "Μετακίνηση μέσα σε…",
    "tab.sub": "Νέος υποφάκελος",
    "pick.item": "Μετακίνηση σε φάκελο",
    "pick.folder": "Μετακίνηση του «{f}» μέσα σε",
    "pick.top": "Πρώτο επίπεδο (καρτέλα)",
    "tools.title": "Τακτοποίηση",
    "chk.folder": "Έλεγχος συνδέσμων του φακέλου",
    "chk.all": "Έλεγχος όλων των συνδέσμων",
    "chk.one": "Έλεγχος συνδέσμου",
    "chk.running": "Έλεγχος συνδέσμων… {i} από {n}",
    "chk.stop": "Διακοπή",
    "chk.done": "Ελέγχθηκαν {n}: {d} χαλασμένοι, {m} μετακινήθηκαν, {e} δεν ελέγχθηκαν",
    "chk.stopped": "Διακόπηκε μετά από {n} σύνδεσμο(ους)",
    "chk.offline": "Είσαι εκτός σύνδεσης. Οι σύνδεσμοι δεν μπορούν να ελεγχθούν τώρα.",
    "chk.norelay": "Χωρίς διακομιστή αναμετάδοσης (ρυθμίσεις Αναγνώστη ή Mail) οι περισσότεροι ιστότοποι δεν ελέγχονται από τον browser.",
    "chk.none": "Δεν υπάρχουν σύνδεσμοι για έλεγχο εδώ",
    "chk.busy": "Ένας έλεγχος συνδέσμων τρέχει ήδη",
    "chk.s.dead": "Χαλασμένος",
    "chk.s.moved": "Μετακινήθηκε",
    "chk.s.err": "Δεν ελέγχθηκε",
    "chk.s.ok": "Λειτουργεί",
    "chk.s.skip": "Δεν ελέγχεται",
    "chk.line": "Έλεγχος συνδέσμου: {s} · {when}",
    "chk.to": "Τώρα στο {u}",
    "chk.use": "Χρήση της νέας διεύθυνσης",
    "chk.used": "Η διεύθυνση ενημερώθηκε",
    "chk.filter": "Χαλασμένοι και μετακινημένοι σύνδεσμοι",
    "chk.show": "Εμφάνιση χαλασμένων και μετακινημένων",
    "arc.save": "Αποθήκευση αντιγράφου για ανάγνωση",
    "arc.read": "Ανάγνωση αποθηκευμένου αντιγράφου",
    "arc.again": "Νέα αποθήκευση",
    "arc.remove": "Αφαίρεση αντιγράφου",
    "arc.open": "Αρχική σελίδα",
    "arc.back": "Πίσω",
    "arc.saving": "Αποθήκευση αντιγράφου για ανάγνωση…",
    "arc.saved": "Το αντίγραφο αποθηκεύτηκε",
    "arc.none": "Δεν βρέθηκε κείμενο άρθρου σε αυτή τη σελίδα",
    "arc.err": "Η σελίδα δεν αποθηκεύτηκε ({why})",
    "arc.nodisk": "Τα αντίγραφα χρειάζονται τον δίσκο του orOS: άνοιξε τους Σελιδοδείκτες μέσα στο orOS.",
    "arc.missing": "Το αντίγραφο δεν έχει έρθει ακόμα σε αυτή τη συσκευή. Έρχεται με το Vault Drive, ή αποθήκευσέ το ξανά εδώ.",
    "arc.removed": "Το αντίγραφο αφαιρέθηκε",
    "arc.img": "Με τις εικόνες",
    "arc.when": "Αποθηκεύτηκε {d}",
    "arc.badge": "Αποθηκευμένο αντίγραφο",
    "why.offline": "εκτός σύνδεσης",
    "why.norelay": "χωρίς διακομιστή αναμετάδοσης",
    "why.timeout": "καμία απάντηση εγκαίρως",
    "why.http": "ο ιστότοπος απάντησε {c}",
    "why.disk": "σφάλμα δίσκου"
  }
};

let LANG = "en";
(function detectLang() {
  try { LANG = window.parent.orosLang || "en"; } catch (e) { /* standalone */ }
  if (LANG !== "el") LANG =
    (localStorage.getItem("oros-lang") === "el") ? "el" : "en";
})();

function t(key, vars) {
  let s = (STR[LANG] && STR[LANG][key]) != null ? STR[LANG][key]
        : (STR.en[key] != null ? STR.en[key] : key);
  if (vars) {
    Object.keys(vars).forEach((k) =>
      s = s.split("{" + k + "}").join(String(vars[k])));
  }
  return s;
}

function applyI18n(root) {
  (root || document).querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  (root || document).querySelectorAll("[data-i18n-aria]:not([data-i18n-title])").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  (root || document).querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-ph"));
  });
  (root || document).querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
    if (el.hasAttribute("data-i18n-aria")) el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  document.title = t("app.name") + " · orOS";
}

/* ---------- 3. State, schema, sanitizers, persistence ---------- */

let state = null;
let lastUndoSnapshot = null;
// Snapshots: handled globally by the orOS shell (oros-auto-snapshots, max 5).
// Bookmarks travels inside the full DB snapshot via its sync slice.

/* Whitelisted, bounded field sanitizers — everything else is dropped. */

const RE_ID   = /^[A-Za-z0-9_-]{1,64}$/;
const RE_URL  = /^https?:\/\/\S{1,2048}$/i;
const RE_TS   = /^\d{1,15}$/;    // epoch ms
const MAX_TXT = 512;

function sanText(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max || MAX_TXT);
}

function sanitizeItem(raw, idHint) {
  if (!raw || typeof raw !== "object") return null;
  const id = RE_ID.test(raw.id || "") ? raw.id : (idHint || uid());
  let url = sanText(raw.url, 2048);
  if (!/^https?:\/\//i.test(url)) {
    if (!url) return null;
    url = "https://" + url.replace(/^\/+/, "");
  }
  try { new URL(url); } catch (e) { return null; }   // must parse
  const ctxFolders = (arguments.length > 2 && arguments[2]) ||
                     (state && state.folders) || {};
  const folderId = ctxFolders[raw.folderId] ? raw.folderId : ROOT_FOLDER;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.slice(0, 12).map((tg) => sanText(tg, 32)).filter(Boolean)
    : [];
  const out = {
    id: id,
    url: url,
    title: sanText(raw.title, 256) || url,
    note: sanText(raw.note, 1024),
    folderId: folderId,
    tags: tags,
    status: raw.status === "dead" ? "dead"
          : raw.status === "unknown" ? "unknown" : "ok",
    visits: Math.max(0, parseInt(raw.visits, 10) || 0),
    lastVisit: RE_TS.test(String(raw.lastVisit)) ? Number(raw.lastVisit) : 0,
    fav: raw.fav === true,       // quick-launch flag — syncs via entity merge
    pos: (raw.pos !== undefined && Number.isFinite(raw.pos)) ? raw.pos : null, // manual order
    added: RE_TS.test(String(raw.added)) ? Number(raw.added)
          : (Date.now()),
    modified: RE_TS.test(String(raw.modified)) ? Number(raw.modified)
            : (Date.now())
  };
  /* Wave 35 side records: present only when set, so old data keeps
     its exact bytes. */
  const chk = K.sanChk(raw.chk), arch = K.sanArch(raw.arch);
  if (chk) out.chk = chk;
  if (arch) out.arch = arch;
  return out;
}

function sanitizeFolder(raw, idHint) {
  if (!raw || typeof raw !== "object") return null;
  const name = sanText(raw.name, 64);
  if (!name) return null;
  const id = RE_ID.test(raw.id || "") ? raw.id : (idHint || uid());
  const out = {
    id: id,
    name: name,
    pos: Number.isFinite(raw.pos) ? raw.pos : 1000,
    modified: RE_TS.test(String(raw.modified)) ? Number(raw.modified)
            : (Date.now())
  };
  /* Wave 35: nesting. Absent = top level (old folders stay byte-equal);
     a parent that is missing now is kept (it may come back with a
     merge) and simply reads as top level (core.parentOf). */
  if (typeof raw.parent === "string" && RE_ID.test(raw.parent) &&
      raw.parent !== id && raw.parent !== ROOT_FOLDER && id !== ROOT_FOLDER) {
    out.parent = raw.parent;
  }
  return out;
}

function sanitizeState(raw) {
  const out = { ver: 1, items: {}, folders: {}, deleted: {}, settings: {} };

  /* BM-1: keys are visited in sorted order, so every map comes out
     in one canonical key order — the sync engine compares JSON bytes
     (R26); insertion order made merge(A,B) differ from merge(B,A)
     and two open devices uploaded to each other forever. */
  if (raw && raw.folders) {
    Object.keys(raw.folders).sort().forEach((id) => {
      const f = sanitizeFolder(raw.folders[id], id);
      if (f) out.folders[f.id] = f;
    });
  }
  if (!out.folders[ROOT_FOLDER]) {
    out.folders[ROOT_FOLDER] = {
      id: ROOT_FOLDER,
      name: ROOT_FOLDER,           // re-labeled in UI via i18n
      pos: 0,
      modified: 0
    };
  }
  if (raw && raw.items) {
    Object.keys(raw.items).sort().forEach((id) => {
      const it = sanitizeItem(raw.items[id], id, out.folders);
      if (it && !out.deleted[it.id]) out.items[it.id] = it;
    });
    /* Assign implicit pos to items missing it (pre-Wave 2) —
       reverse-added order gives them a deterministic baseline
       so the first manual reorder works predictably. */
    let maxPos = 0;
    const sortedByAdded = Object.keys(out.items)
      .map((id) => out.items[id])
      .sort((a, b) => (b.added - a.added));
    sortedByAdded.forEach((it) => {
      if (it.pos === null) {
        it.pos = maxPos;
        maxPos += 1000;           // room for inserts between
      }
    });
  }
  if (raw && raw.deleted && typeof raw.deleted === "object") {
    Object.keys(raw.deleted).sort().forEach((id) => {
      if (!RE_ID.test(id)) return;
      const ts = Number(raw.deleted[id]);
      if (RE_TS.test(String(ts))) out.deleted[id] = ts;
    });
  }
  if (raw && raw.settings && typeof raw.settings === "object") {
    out.settings = raw.settings;
  }
  return out;
}

/* BM-1: the canonical form shared by load, the sync getter and the
   merge. Tombstone pruning (age > 30d) uses the DATASET's newest
   stamp, never the wall clock, so the same data gives the same
   bytes on every device at any time (Part VI, rule 3). The old
   load-time wall-clock prune dropped tombstones that the next pull
   put back, and a pruned getter never matched the merge. */
function pruneTombs(st) {
  let max = 0;
  const bump = (v) => { if (typeof v === "number" && v > max) max = v; };
  Object.keys(st.items).forEach((id) => bump(st.items[id].modified));
  Object.keys(st.folders).forEach((id) => bump(st.folders[id].modified));
  Object.keys(st.deleted).forEach((id) => bump(st.deleted[id]));
  const cutoff = max - DELETED_PRUNE_DAYS * 86400000;
  let pruned = false;
  Object.keys(st.deleted).forEach((id) => {
    if (st.deleted[id] < cutoff) { delete st.deleted[id]; pruned = true; }
  });
  return pruned;
}

function canonState(raw) {
  const st = sanitizeState(raw);
  pruneTombs(st);
  return st;
}

/* --- Load / save --- */

function load() {
  let raw = null, text = null;
  try { text = localStorage.getItem(DATA_KEY); } catch (e) { text = null; }
  try { raw = JSON.parse(text || "null"); }
  catch (e) {
    /* BM-9: unreadable data is copied to a device-local rescue key
       before the fresh state can overwrite it (Part II, data rules). */
    raw = null;
    try { localStorage.setItem(DATA_KEY + "-broken", text); } catch (e2) {}
    console.error("[orOS] bookmarks: unreadable data copied to " + DATA_KEY + "-broken");
  }
  state = sanitizeState(raw);
  const pruned = pruneTombs(state);
  if (pruned || !raw) save(false);
}

function save(dirty) {
  try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); }
  catch (e) { /* storage full — app still works in memory */ }
  if (dirty !== false) markDirty();
  /* Wave 35: saved copies of bookmarks deleted here leave the disk
     after the Undo window (sweepArchive, section 9b). */
  if (typeof scheduleSweep === "function" && Object.keys(state.deleted).length) scheduleSweep();
}

/* The sync engine lives in the PARENT window (the app iframe never
   loads sync.js itself) — same-origin, so parent lookup is legal.
   Same resolution order as registerSync in §11. */
function syncHost() {
  if (window.orosSync) return window.orosSync;
  try { return window.parent.orosSync || null; } catch (e) { return null; }
}

function markDirty() {
  const api = syncHost();
  if (api && typeof api.markDirty === "function") api.markDirty();
}

/* orosDialog lives in the parent shell (same-origin iframe).
   Standalone PWA mode -> null -> callers use local fallbacks. */
function dialogHost() {
  if (window.orosDialog) return window.orosDialog;
  try { return window.parent.orosDialog || null; } catch (e) { return null; }
}

/* Standalone file picker (no shell present) — hidden input, one-shot. */
function localPickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    if (accept) inp.accept = accept;
    inp.style.display = "none";
    inp.addEventListener("change", () => {
      const f = inp.files && inp.files[0] ? inp.files[0] : null;
      inp.remove();
      resolve(f);
    });
    inp.addEventListener("cancel", () => { inp.remove(); resolve(null); });
    document.body.appendChild(inp);
    inp.click();
  });
}

/* Snapshot for Undo (delete / move operations in later sections).
   BM-3: only the entities the action touches are recorded, and Undo
   puts back only those. The old whole-state snapshot re-stamped
   EVERY bookmark and folder with "now" and dropped every tombstone:
   an Undo silently overwrote whatever another device had changed
   in the meantime (A67 Q5). */
function snapshotForUndo(itemIds, folderIds) {
  const snap = { items: {}, folders: {} };
  (itemIds || []).forEach((id) => {
    if (state.items[id]) snap.items[id] = JSON.parse(JSON.stringify(state.items[id]));
  });
  (folderIds || []).forEach((id) => {
    if (state.folders[id]) snap.folders[id] = JSON.parse(JSON.stringify(state.folders[id]));
  });
  lastUndoSnapshot = snap;
}

function undoFromSnapshot() {
  if (!lastUndoSnapshot) return false;
  /* Fresh stamps only on what comes back, so it wins its tombstone. */
  const now = Date.now();
  const snap = lastUndoSnapshot;
  lastUndoSnapshot = null;
  Object.keys(snap.folders).forEach((id) => {
    const cur = state.folders[id], old = snap.folders[id];
    if (cur) {                                      // still there: put back where it was
      if ((cur.parent || "") !== (old.parent || "")) {
        if (old.parent) cur.parent = old.parent; else delete cur.parent;
        cur.modified = now;
      }
      return;
    }
    state.folders[id] = Object.assign(old, { modified: now });
    delete state.deleted[id];
  });
  Object.keys(snap.items).forEach((id) => {
    const old = snap.items[id], cur = state.items[id];
    if (!cur) {                                     // deleted / purged
      state.items[id] = Object.assign(old, { modified: now });
      delete state.deleted[id];
      return;
    }
    /* Moved (or a purge keeper): put back only what the action
       changed on a bookmark that is still there. */
    if (cur.folderId !== old.folderId) { cur.folderId = old.folderId; cur.modified = now; }
    /* A duplicate merge gave the keeper tags, notes and the star. */
    ["note", "fav", "url"].forEach((k) => {
      if (cur[k] !== old[k]) { cur[k] = old[k]; cur.modified = now; }
    });
    if (JSON.stringify(cur.tags) !== JSON.stringify(old.tags)) { cur.tags = old.tags; cur.modified = now; }
    cur.visits = old.visits;
    cur.lastVisit = old.lastVisit;
  });
  save();
  renderAll();
  return true;
}

/* Boot marker (visible in the shell's console, like every orOS app). */
console.log("[orOS] bookmarks.js v" + SCRIPT_V + " loaded (" + LANG + ")");

/* ===== 4. UI STATE + RENDER ===== */

let uiActiveFolder = ROOT_FOLDER;
let uiQuery = "";

function renderAll() {
  /* Guard: if the active folder vanished (remote delete via sync),
     fall back safely to the root folder. */
  if (uiActiveFolder !== "ALL_VIEW" && !state.folders[uiActiveFolder]) {
    uiActiveFolder = ROOT_FOLDER;
  }
  renderTabs();
  renderList();
}

/* Sort helper: folders by pos, items newest-first. */
function folderList() {
  /* Folders sort by pos (ascending) — smaller pos = leftmost tab. */
  return Object.keys(state.folders)
    .map((id) => state.folders[id])
    .sort((a, b) => (a.pos - b.pos) || (a.id < b.id ? -1 : 1));
}

/* Wave 35: the tabs are the top-level folders; the rest of the tree
   shows in the path strip under the controls (renderCrumbs). */
function topFolders() {
  return K.childrenOf(state.folders, "").map((id) => state.folders[id]);
}

function folderName(f) {
  return f.id === ROOT_FOLDER ? t("folder.unsorted") : f.name;
}

/* "Work › Docs": the folder's whole path, for chips and menus. */
function folderPathName(id) {
  return K.pathIds(state.folders, id).map((x) => folderName(state.folders[x])).join(" › ");
}

/* Tree order with depth, for pickers and selects. */
function folderTree(skip) {
  return K.treeList(state.folders, skip).map((x) => ({ f: state.folders[x.id], depth: x.depth }));
}

function subfolderIds(id) {
  return Object.keys(state.folders).filter((x) => x !== id && K.isInside(state.folders, x, id));
}

function renderTabs() {
  const tabs = $("#tabs");
  tabs.textContent = "";
    /* "All" pseudo-tab — not a real folder, just a UI layer. */
  const allBtn = document.createElement("button");
  allBtn.className = "tab all-tab" +
    (uiActiveFolder === "ALL_VIEW" ? " active" : "");
  allBtn.setAttribute("role", "tab");
  allBtn.textContent = t("view.all");
  allBtn.dataset.folder = "ALL";   // marker value
  allBtn.addEventListener("click", () => {
    if (selectionMode) exitSelectionMode();
    uiActiveFolder = "ALL_VIEW";   // marker for renderList/itemsInFolder
    uiQuery = "";
    $("#search").value = "";
    $("#search-clear").hidden = true;
    clearTagFilters();
    renderAll();
  });
  wireTabDrop(allBtn, true);       // allow drop ON "All" (moves to Unsorted)
  tabs.appendChild(allBtn);
  const activeTop = uiActiveFolder === "ALL_VIEW" ? "" :
    (K.pathIds(state.folders, uiActiveFolder)[0] || "");
  topFolders().forEach((f) => {
    const b = document.createElement("button");
    b.className = "tab" + (f.id === activeTop ? " active" : "");
    b.setAttribute("role", "tab");
    b.textContent = folderName(f);
    b.dataset.folder = f.id;
    b.draggable = true;               // required — buttons aren't draggable
    b.addEventListener("dblclick", () => openFolderDialog("edit", f.id));
    b.addEventListener("click", () => {
      if (selectionMode) exitSelectionMode();
      uiActiveFolder = f.id;              // plain folder id — no prefix
      uiQuery = "";
      $("#search").value = "";
      $("#search-clear").hidden = true;
      clearTagFilters();
      renderAll();
    });
    wireTabDrop(b);
    wireTabLongPress(b, f.id);
    if (f.id !== ROOT_FOLDER) {
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showTabContextMenu(f.id, e.clientX, e.clientY);
      });
    }
    tabs.appendChild(b);
  });
}

/* ---- Nested folders (wave 35): path strip, subfolder chips, moves ---- */

let draggingFolderId = null;         // a folder chip or tab being dragged

/* Under the controls while a folder (not All / Unsorted) is open:
   the path (each part opens it; the first part is the tab), the
   subfolders as chips and "New subfolder". Hidden while searching
   or filtering, when the list mixes folders. */
function renderCrumbs(filterMode) {
  const nav = $("#crumbs");
  if (!nav) return;
  nav.textContent = "";
  const fid = uiActiveFolder;
  const show = !filterMode && fid !== "ALL_VIEW" && fid !== ROOT_FOLDER && !!state.folders[fid];
  nav.hidden = !show;
  if (!show) return;
  const path = K.pathIds(state.folders, fid);
  if (path.length > 1) {
    const trail = document.createElement("span");
    trail.className = "crumb-trail";
    path.forEach((id, i) => {
      if (i) {
        const sep = document.createElement("span");
        sep.className = "crumb-sep";
        sep.textContent = "›";
        sep.setAttribute("aria-hidden", "true");
        trail.appendChild(sep);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "crumb" + (id === fid ? " here" : "");
      b.textContent = folderName(state.folders[id]);
      if (id === fid) b.setAttribute("aria-current", "page");
      b.addEventListener("click", () => openFolder(id));
      wireFolderDrop(b, id);
      trail.appendChild(b);
    });
    nav.appendChild(trail);
  }
  K.childrenOf(state.folders, fid).forEach((id) => {
    const f = state.folders[id];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sub-chip";
    b.draggable = true;
    b.dataset.folder = id;
    const ic = document.createElement("span");
    ic.className = "sub-ic";
    ic.setAttribute("aria-hidden", "true");
    ic.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    const nm = document.createElement("span");
    nm.textContent = folderName(f);
    const n = itemsInFolder(id).length;
    const cnt = document.createElement("span");
    cnt.className = "sub-cnt";
    cnt.textContent = n ? String(n) : "";
    b.append(ic, nm, cnt);
    b.addEventListener("click", () => openFolder(id));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); showTabContextMenu(id, e.clientX, e.clientY); });
    b.addEventListener("dragstart", (e) => {
      draggingFolderId = id;
      b.classList.add("dragging");
      e.dataTransfer.setData("text/plain", "folder:" + id);
      e.dataTransfer.effectAllowed = "move";
    });
    b.addEventListener("dragend", () => { draggingFolderId = null; b.classList.remove("dragging"); clearDropTargets(); });
    wireFolderDrop(b, id);
    wireTabLongPress(b, id);
    nav.appendChild(b);
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "sub-add";
  add.title = t("folder.sub.add");
  add.setAttribute("aria-label", t("folder.sub.add"));
  add.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const al = document.createElement("span");
  al.textContent = t("folder.sub.add");
  add.appendChild(al);
  add.addEventListener("click", () => openFolderDialog("create", null, fid));
  nav.appendChild(add);
}

function openFolder(id) {
  if (!state.folders[id]) return;
  if (selectionMode) exitSelectionMode();
  uiActiveFolder = id;
  uiQuery = "";
  $("#search").value = "";
  $("#search-clear").hidden = true;
  uiBadFilter = false;
  clearTagFilters();
  renderTagFilter();
  renderAll();
}

/* A crumb or chip takes a dragged bookmark (move it there) or a
   dragged folder (nest it there). */
function wireFolderDrop(el, fid) {
  el.addEventListener("dragover", (e) => {
    if (draggingId || (draggingFolderId && K.canMoveFolder(state.folders, draggingFolderId, fid))) {
      e.preventDefault();
      el.classList.add("drop-target");
    }
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("drop-target");
    if (draggingId && state.items[draggingId]) { moveItem(draggingId, fid); return; }
    if (draggingFolderId) moveFolder(draggingFolderId, fid);
  });
}

/* Nest a folder (np = "" → top level, a tab). Siblings order by pos,
   so it goes last among its new siblings. Undo puts it back. */
function moveFolder(id, np) {
  const f = state.folders[id];
  if (!f || !K.canMoveFolder(state.folders, id, np)) return false;
  if (K.parentOf(state.folders, id) === (np || "")) return false;
  snapshotForUndo([], [id]);
  if (np) f.parent = np; else delete f.parent;
  f.pos = nextFolderPos();
  f.modified = Date.now();
  /* the name stays unique among its new siblings */
  const nm = uniquifyFolderName(f.name, np || "", id);
  if (nm !== f.name) f.name = nm;
  save();
  renderAll();
  showToast(t("folder.moved", { f: folderName(f) }), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
  return true;
}

/* One picker for every "Move to…": the folder tree as indented rows.
   mode "item": any folder; mode "folder": top level + every folder
   the folder may go into (not itself, not below itself, not Unsorted). */
function openPicker(mode, title, current, onPick, movingId) {
  const dlg = $("#dlg-pick");
  const list = $("#pick-list");
  $("#pick-title").textContent = title;
  list.textContent = "";
  const row = (label, id, depth, disabled) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pick-row" + (id === current ? " here" : "");
    b.style.paddingLeft = (12 + Math.min(depth, 8) * 16) + "px";
    b.textContent = label;
    b.disabled = !!disabled || id === current;
    b.addEventListener("click", () => { dlg.close(); onPick(id); });
    list.appendChild(b);
  };
  if (mode === "folder") row(t("pick.top"), "", 0, false);
  folderTree(mode === "folder" ? movingId : null).forEach((x) => {
    const off = mode === "folder" && !K.canMoveFolder(state.folders, movingId, x.f.id);
    row(folderName(x.f), x.f.id, x.depth + (mode === "folder" ? 1 : 0), off);
  });
  dlg.showModal();
}

function pickFolderFor(id) {
  const f = state.folders[id];
  if (!f || id === ROOT_FOLDER) return;
  openPicker("folder", t("pick.folder", { f: folderName(f) }),
    K.parentOf(state.folders, id), (np) => moveFolder(id, np), id);
}

/* ---- Items ---- */

function itemsInFolder(fid) {
  /* "ALL_VIEW" means show everything (cross-folder) */
  if (fid === "ALL_VIEW") {
    return Object.keys(state.items)
      .map((id) => state.items[id])
      .sort((a, b) => (b.added - a.added) || (a.id < b.id ? -1 : 1));
  }
  return Object.keys(state.items)
    .map((id) => state.items[id])
    .filter((it) => it.folderId === fid)
    .sort((a, b) => (b.added - a.added) || (a.id < b.id ? -1 : 1));
}

function searchItems(q) {
  q = q.toLowerCase();
  return Object.keys(state.items)
    .map((id) => state.items[id])
    .filter((it) => {
      const fld = state.folders[it.folderId];
      return it.title.toLowerCase().includes(q) ||
             it.url.toLowerCase().includes(q) ||
             (it.note || "").toLowerCase().includes(q) ||
             it.tags.some((tg) => tg.toLowerCase().includes(q)) ||
             (fld ? folderPathName(fld.id).toLowerCase().includes(q) : false);
    })
    .sort((a, b) => (b.added - a.added) || (a.id < b.id ? -1 : 1));
}

/* Deterministic domain-hash color (Wave 3 favicon simulation,
   shipped now because the row skeleton already depends on it). */
function faviconStyle(host) {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return "hsl(" + hue + ", 42%, 34%)";
}

function relTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 60) return t("time.just");
  if (s < 3600) return t("time.min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("time.hour", { n: Math.floor(s / 3600) });
  return t("time.day", { n: Math.floor(s / 86400) });
}

/* Selection mode variables MUST be declared before renderList uses them */
let selectionMode = false;
let selectedIds = new Set();

function renderList() {
  const ul = $("#items");
  ul.textContent = "";
  const searchMode = uiQuery.trim().length > 0;
  const filterMode = searchMode || uiTagFilters.size > 0 || uiBadFilter;
  renderCrumbs(filterMode);

  /* Base pool: search → everywhere; tag filters → everywhere
     (cross-folder); neither → active folder only. */
  let list;
  if (searchMode)      list = searchItems(uiQuery.trim());
  else if (uiTagFilters.size || uiBadFilter) list =
      Object.keys(state.items)
        .map((id) => state.items[id])
        .sort((a, b) => (b.added - a.added) || (a.id < b.id ? -1 : 1));
  else                 list = itemsInFolder(uiActiveFolder);
  list = list.filter(itemMatchesTags);
  if (uiBadFilter) list = list.filter(isBad);
  renderFavorites(filterMode);

  const total = Object.keys(state.items).length;
  $("#empty").hidden = total > 0;
  $("#no-match").hidden = !(filterMode && total > 0 && !list.length);
  $("#folder-empty").hidden =
    !(!filterMode && total > 0 && !list.length);
  ul.hidden = !list.length;

  list = sortItems(list);
  list.forEach((it) => ul.appendChild(buildRow(it, filterMode)));

  /* Selection unavailable while searching/filtering. */
  $("#select-btn").disabled = filterMode;
  $("#select-btn").style.opacity = filterMode ? ".45" : "1";
}

function buildRow(it, searchMode) {
  const host = hostOf(it.url) || it.url;
  const li = document.createElement("li");
  li.className = "item";
  li.dataset.id = it.id;
  li.draggable = true;

  /* Checkbox (appears only in selection mode — controlled externally) */
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "item-check" + (selectedIds.has(it.id) ? " on" : "");
  cb.value = it.id;
  if (selectionMode) {
    cb.checked = selectedIds.has(it.id);
    cb.style.display = "";
  } else {
    cb.checked = false;
    cb.style.display = "none";
  }
  cb.addEventListener("change", (e) => {
    e.stopPropagation();
    /* CSS visual mirrors the input state */
    cb.classList.toggle("on", e.target.checked);
    toggleSelection(it.id, e.target.checked);
  });
  li.prepend(cb);

  /* In selection mode, a row tap toggles instead of opening. */
  if (selectionMode) {
    li.classList.add("selecting");
    li.draggable = false;            // drag conflicts with check taps
  }

  const fav = document.createElement("span");
  fav.className = "favicon";
  fav.style.background = faviconStyle(host);
  fav.textContent = (host[0] || "?").toUpperCase();

  const info = document.createElement("div");
  info.className = "info";
  const ttl = document.createElement("div");
  const chkS = it.chk ? it.chk.s : "";
  ttl.className = "title" + (it.status === "dead" || chkS === "dead" ? " dead" : "");
  ttl.textContent = it.title;
  const meta = document.createElement("div");
  meta.className = "meta" + (it.tags.length ? " with-tags" : "");

  /* Wave 35 marks: a broken / moved link, a saved readable copy. */
  if (chkS === "dead" || chkS === "moved") {
    const bd = document.createElement("span");
    bd.className = "chk-badge " + chkS;
    bd.textContent = t("chk.s." + chkS);
    bd.title = chkS === "moved" && it.chk.to ? t("chk.to", { u: it.chk.to }) : t("chk.s." + chkS);
    meta.appendChild(bd);
  }
  if (it.arch && it.arch.f) {
    const ab = document.createElement("button");
    ab.type = "button";
    ab.className = "arc-badge";
    ab.title = t("arc.read");
    ab.setAttribute("aria-label", t("arc.read"));
    ab.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/></svg>';
    ab.addEventListener("click", (e) => { e.stopPropagation(); if (!selectionMode) openReader(it.id); });
    meta.appendChild(ab);
  }

  const hostText = document.createElement("span");
  hostText.className = "host-text";
  hostText.textContent = host + (it.visits ? " · " + it.visits + "× " +
    relTime(it.lastVisit) : " · " + relTime(it.added));
  meta.appendChild(hostText);

  if (it.tags.length) {
    const wrap = document.createElement("span");
    wrap.className = "tag-wrap";
    const shown = it.tags.slice(0, 3);
    shown.forEach((tg) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip";
      chip.textContent = tg;
      chip.title = uiTagFilters.has(tg) ? "" : t("tags.filter") || "";
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTagFilter(tg);
      });
      wrap.appendChild(chip);
    });
    if (it.tags.length > 3) {
      const more = document.createElement("span");
      more.className = "tag-more";
      more.textContent = "+" + (it.tags.length - 3);
      more.title = it.tags.slice(3).join(", ");
      wrap.appendChild(more);
    }
    meta.appendChild(wrap);
  }
  info.append(ttl, meta);

  li.append(fav, info);

  if (searchMode) {
    const chip = document.createElement("span");
    chip.className = "src-chip";
    const fld = state.folders[it.folderId];
    chip.textContent = fld ? folderPathName(fld.id) : "";
    chip.title = chip.textContent;
    li.appendChild(chip);
  }

  const favBtn = document.createElement("button");
  favBtn.className = "open-btn";
  favBtn.type = "button";
  favBtn.title = it.fav ? t("fav.remove") : t("fav.add");
  favBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="' +
    (it.fav ? "currentColor" : "none") +
    '" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M12 2l2.9 6.26 6.85.74-5.1 4.6 ' +
    '1.43 6.77L12 16.9l-6.08 3.47 1.43-6.77-5.1-4.6 6.85-.74z"/></svg>';
  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFav(it.id);
  });
  li.appendChild(favBtn);

  const editBtn = document.createElement("button");
  editBtn.className = "open-btn";
  editBtn.type = "button";
  editBtn.title = t("item.edit");
  editBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 ' +
    '20.5 2 22l1.5-5.5z"/></svg>';
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openItemDialog(it.id);
  });
  li.appendChild(editBtn);

  const openBtn = document.createElement("button");
  openBtn.className = "open-btn";
  openBtn.type = "button";
  openBtn.title = t("item.open");
  openBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8' +
    'a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" ' +
    'y1="14" x2="21" y2="3"/></svg>';
  li.appendChild(openBtn);

  li.addEventListener("click", () => {
    if (selectionMode) {
      const on = !selectedIds.has(it.id);
      const cb = li.querySelector(".item-check");
      if (cb) { cb.checked = on; cb.classList.toggle("on", on); }
      toggleSelection(it.id, on);
    } else {
      openItem(it.id);
    }
  });
 
  if (!selectionMode) {
    wireRowDrag(li, it.id);
    wireLongPress(li, it.id);
    /* Right-click = the same menu as a long-press (help promised it). */
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showCtxMenu(it.id, e.clientX, e.clientY);
    });
  }

  return li;
}

function openItem(id) {
  const it = state.items[id];
  if (!it) return;
  it.visits += 1;
  it.lastVisit = Date.now();
  /* BM-2: a visit does NOT move "modified". Visits merge on their own
     (max), so opening a link on one device can no longer revert a
     title / tag / folder edit made on another device (A67 Q2). */
  save();
  window.open(it.url, "_blank", "noopener,noreferrer");
  renderList();
}

/* Open bookmark location in orOS Maps app (bridge integration)
   Combines title + note as geocode query (Photon API via Maps).
   Works in two modes:
   1. Inside orOS shell: calls window.parent.__orosMapsOpen (iframe comms)
   2. Standalone PWA: opens Maps URL with ?q= param (fallback) */
function openInMaps(it) {
  const query = it.title + (it.note ? " " + it.note : "");

  // 1. Shell mode: geocode bridge on the parent (orOS desktop)
  try {
    if (window.parent && typeof window.parent.__orosOpenMapsQuery === "function") {
      window.parent.__orosOpenMapsQuery(query, it.title || "");
      return;
    }
  } catch (e) {}

  // 2. Standalone PWA mode: open Maps with query param (new window/tab)
  window.open("/maps/?q=" + encodeURIComponent(query), "_blank", "noopener,noreferrer");
}

/* ===== 4a. FAVORITES (quick-launch strip) ===== */

/* Favorites order: most recently favorited first. Toggling fav
   bumps "modified", so the existing merge propagates both the
   flag AND the order with zero schema changes beyond the bool. */
function favoriteItems() {
  return Object.keys(state.items)
    .map((id) => state.items[id])
    .filter((it) => it.fav)
    .sort((a, b) => ((b.modified || 0) - (a.modified || 0)) ||
      (a.id < b.id ? -1 : 1));
}

function toggleFav(id) {
  const it = state.items[id];
  if (!it) return;
  it.fav = !it.fav;
  it.modified = Date.now();
  save();
  renderAll();
  transientNote(it.fav ? t("fav.added") : t("fav.removed"));
}

/* One-time mount: strip + injected styles (self-contained — we
   deliberately don't rely on unseen selectors in bookmarks.css). */
let favStripMounted = false;
function mountFavStrip() {
  if (favStripMounted) return;
  const itemsEl = $("#items");
  if (!itemsEl) return;
  const strip = document.createElement("div");
  strip.id = "fav-strip";
  strip.hidden = true;
  itemsEl.parentNode.insertBefore(strip, itemsEl);
  favStripMounted = true;

  const st = document.createElement("style");
  st.textContent =
    "#fav-strip{display:block;margin:0 0 10px}" +
    "#fav-strip[hidden]{display:none}" +
    ".fav-head{font-size:11px;font-weight:600;text-transform:uppercase;" +
      "letter-spacing:.06em;color:var(--text-dim);margin:0 0 6px 2px;" +
      "display:flex;align-items:center;gap:5px}" +
    "#fav-grid{display:flex;flex-wrap:wrap;gap:8px}" +
    ".fav-tile{display:flex;flex-direction:column;align-items:center;" +
      "gap:6px;width:78px;padding:9px 4px 7px;border:1px solid var(--border);" +
      "border-radius:10px;background:var(--panel-bg);cursor:pointer;" +
      "color:var(--text);font:inherit}" +
    ".fav-tile:hover{border-color:var(--accent)}" +
    ".fav-icon{width:38px;height:38px;border-radius:10px;display:flex;" +
      "align-items:center;justify-content:center;color:#fff;" +
      "font-weight:700;font-size:16px;flex-shrink:0}" +
    ".fav-name{font-size:11px;line-height:1.2;max-width:70px;overflow:hidden;" +
      "text-overflow:ellipsis;white-space:nowrap;text-align:center}";
  document.head.appendChild(st);
}

/* Paint: shown above the list in folder / All views only —
   hidden while searching, tag-filtering, or in selection mode
   (same foot-gun rule as selection itself). */
function renderFavorites(filterMode) {
  const strip = $("#fav-strip");
  if (!strip) return;
  const favs = favoriteItems();
  strip.hidden = !favs.length || filterMode || selectionMode;
  strip.textContent = "";
  if (strip.hidden) return;

  const h = document.createElement("div");
  h.className = "fav-head";
  h.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">' +
    '<path d="M12 2l2.9 6.26 6.85.74-5.1 4.6 1.43 6.77L12 16.9l-6.08 3.47' +
    ' 1.43-6.77-5.1-4.6 6.85-.74z"/></svg>';
  const hTxt = document.createElement("span");
  hTxt.textContent = t("fav.title");
  h.appendChild(hTxt);
  strip.appendChild(h);

  const grid = document.createElement("div");
  grid.id = "fav-grid";
  favs.forEach((it) => grid.appendChild(buildFavTile(it)));
  strip.appendChild(grid);
}

/* Tile = favicon-style chip + name; click opens, right-click /
   long-press opens the SAME ctx menu as the row (with the new
   favorite toggle row) — one source of truth for item actions. */
function buildFavTile(it) {
  const host = hostOf(it.url) || it.url;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "fav-tile";
  b.title = it.title;

  const ic = document.createElement("span");
  ic.className = "fav-icon";
  ic.style.background = faviconStyle(host);
  ic.textContent = (host[0] || "?").toUpperCase();

  const nm = document.createElement("span");
  nm.className = "fav-name";
  nm.textContent = it.title;
  b.append(ic, nm);

  b.addEventListener("click", () => {
    if (!selectionMode) openItem(it.id);
  });
  b.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showCtxMenu(it.id, e.clientX, e.clientY);
  });

  /* Mobile long-press — same 500ms pattern as rows/tabs. */
  let lpTimer = null, lpY = 0;
  b.addEventListener("touchstart", (e) => {
    const x = e.touches[0].clientX;
    lpY = e.touches[0].clientY;
    lpTimer = setTimeout(() => {
      lpTimer = null;
      if (e.cancelable) e.preventDefault();
      navigator.vibrate && navigator.vibrate(15);
      showCtxMenu(it.id, x, lpY);
    }, 500);
  }, { passive: false });
  ["touchmove", "touchend", "touchcancel"].forEach((ev) => {
    b.addEventListener(ev, (e2) => {
      if (ev === "touchmove" && e2.touches &&
          Math.abs(e2.touches[0].clientY - lpY) < 12) return;
      clearTimeout(lpTimer);
      lpTimer = null;
    });
  });
  return b;
}

/* ===== 4b. TAGS (Wave 2): state, helpers, filter row, panel ===== */

let uiTagFilters = new Set();       // active tag filters (AND logic)

/* tag -> count, alphabetical order. */
function allTagCounts() {
  const counts = {};
  Object.keys(state.items).forEach((id) => {
    state.items[id].tags.forEach((tg) => {
      counts[tg] = (counts[tg] || 0) + 1;
    });
  });
  return Object.keys(counts).sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : 1)
    .reduce((o, tg) => (o[tg] = counts[tg], o), {});
}

function itemMatchesTags(it) {
  for (const tg of uiTagFilters) {
    if (!it.tags.includes(tg)) return false;
  }
  return true;                       // empty set = pass-through
}

function toggleTagFilter(tg) {
  if (uiTagFilters.has(tg)) uiTagFilters.delete(tg);
  else uiTagFilters.add(tg);
  if (selectionMode) exitSelectionMode();
  renderTagFilter();
  renderList();
}

function clearTagFilters() {
  if (!uiTagFilters.size && !uiBadFilter) return;
  uiTagFilters.clear();
  uiBadFilter = false;
  renderTagFilter();
  renderList();
}

/* Wave 35: broken / moved links (the last check said so). */
let uiBadFilter = false;
function isBad(it) { return !!it.chk && (it.chk.s === "dead" || it.chk.s === "moved"); }
function setBadFilter(on) {
  uiBadFilter = !!on;
  if (selectionMode) exitSelectionMode();
  renderTagFilter();
  renderList();
}

/* ---------- Sorting (Wave 2) ---------- */

let uiSortMode = "recent";          // "recent" | "title" | "visited" | "manual"

function setSortMode(mode) {
  uiSortMode = mode;
  // Persists locally only (UI pref, not synced)
  try { localStorage.setItem("oros-bookmarks-sort", mode); } catch (e) {}
  renderList();
}

function enterSelectionMode() {
  /* Available only in folder / All views — search + tag filter
     mixes are confusing for destructive bulk ops. */
  if (uiQuery.trim() || uiTagFilters.size) return;
  selectionMode = true;
  selectedIds.clear();
  $("#bulk-bar").classList.add("show");
  updateSelButtons();
  renderList();
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  $("#bulk-bar").classList.remove("show");
  renderList();
}

function toggleSelection(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelButtons();
}

function updateSelButtons() {
  const n = selectedIds.size;
  $("#sel-count").textContent = t("sel.selected", { n: n });
  $("#sel-move").textContent = t("sel.move");
  $("#sel-delete").textContent = t("sel.delete");
  $("#sel-done").textContent = t("sel.done");
  $("#sel-share").textContent = t("sel.share");
  $("#sel-share").hidden = !shareApi();
  $("#sel-share").disabled = !n;
  $("#sel-share").style.opacity = n ? "1" : ".45";
  $("#sel-move").disabled = !n;
  $("#sel-delete").disabled = !n;
  $("#sel-move").style.opacity = n ? "1" : ".45";
  $("#sel-delete").style.opacity = n ? "1" : ".45";
}

/* "Send to someone" (shell share/, kind "links"): one bookmark from
   its menu, or the selection (≤ 200) from the bulk bar. Title = the
   open folder's name. Tags, visits and favourites stay at home. */
function shareApi() {
  try { return window.parent !== window && window.parent.orosShare ? window.parent.orosShare : null; }
  catch (e) { return null; }
}
function shareItems(ids) {
  const api = shareApi();
  const items = ids.map((id) => state.items[id]).filter(Boolean).slice(0, 200)
    .map((it) => ({ u: it.url, t: it.title, n: it.note }));
  if (!api || !items.length) { if (!items.length) transientNote(t("sel.none")); return; }
  const fld = state.folders[uiActiveFolder];
  api.open({ kind: "links", data: { t: fld && fld.id !== ROOT_FOLDER ? folderName(fld) : "", i: items } });
}

/* "Add to my orOS" with several links: { addMany: { folder, items } }.
   The person already saw the list on the receiving page and asked for
   it; they land in a folder of that name (created when missing) and
   links already saved are skipped. */
function addManyTarget(p) {
  if (!p || !Array.isArray(p.items)) return;
  const name = sanText(p.folder, 60) || t("tab.add");
  let fid = null;
  folderList().forEach((f) => { if (!fid && f.name.toLowerCase() === name.toLowerCase()) fid = f.id; });
  const made = [];
  let newFolder = false;
  if (!fid) {
    const f = sanitizeFolder({ name: name, pos: nextFolderPos(), modified: Date.now() });
    if (!f) return;
    state.folders[f.id] = f;
    fid = f.id;
    newFolder = true;
  }
  p.items.slice(0, 200).forEach((x) => {
    const norm = normalizeUrl(x && x.url);
    if (!norm || findByUrl(norm)) return;
    const it = sanitizeItem({ url: norm, title: sanText(x.title, 256) || norm, folderId: fid });
    if (!it) return;
    state.items[it.id] = it;
    made.push(it.id);
  });
  if (!made.length) {
    if (newFolder) delete state.folders[fid];   // nothing new: no empty folder either
    transientNote(t("many.none"));
    return;
  }
  uiActiveFolder = fid;
  save();
  renderAll();
  transientNote(t("many.added", { n: made.length, f: name }));
}

/* Move all selected → folder chosen from a small runtime menu
   (reuses ctx-menu visuals, anchored to the Move button). */
function bulkMoveMenu() {
  if (!selectedIds.size) return;
  closeCtxMenu();
  /* Wave 35: the folder tree picker (nested folders). */
  const cur = uiActiveFolder === "ALL_VIEW" ? null : uiActiveFolder;
  openPicker("item", t("pick.item"), cur, (fid) => bulkMove(fid));
}

function bulkMove(folderId) {
  if (!selectedIds.size) return;
  snapshotForUndo(Array.from(selectedIds));
  let n = 0;
  selectedIds.forEach((id) => {
    const it = state.items[id];
    if (it && it.folderId !== folderId) {
      it.folderId = folderId;
      it.modified = Date.now();
      n++;
    }
  });
  if (!n) { transientNote(t("sel.none")); return; }
  save();
  exitSelectionMode();
  renderAll();
  showToast(t("sel.moved", { n: n }) + " — " + folderPathName(folderId), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

function bulkDelete() {
  if (!selectedIds.size) return;
  snapshotForUndo(Array.from(selectedIds));
  const now = Date.now();
  let n = 0;
  selectedIds.forEach((id) => {
    if (state.items[id]) {
      delete state.items[id];
      state.deleted[id] = now;      // tombstones — sync-safe
      n++;
    }
  });
  save();
  exitSelectionMode();
  renderAll();
  showToast(t("sel.deleted", { n: n }), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* ---- Tab reordering (folder pos updates) ---- */

let tabDragTarget = null;

document.addEventListener("dragover", (e) => {
  if (!(e.target instanceof Element)) return;
  const tab = e.target.closest(".tab");
  if (!tab || tab.dataset.folder === "ALL") return;
  if (!document.querySelector(".tab.dragging")) return;   // item drag — ignore
  if (tabDragTarget && tabDragTarget !== tab) {
    tabDragTarget.classList.remove("drop-target");
  }
  tabDragTarget = tab;
  tab.classList.add("drop-target");
  e.preventDefault();              // required so the document drop fires
});

document.addEventListener("drop", (e) => {
  if (!tabDragTarget) return;
  e.preventDefault();
  const src = e.currentTarget.querySelector(".tab.dragging");
  if (!src || !src.dataset.folder || !tabDragTarget.dataset.folder) return;
  if (src.dataset.folder === tabDragTarget.dataset.folder) return;
  reorderFolder(src.dataset.folder, tabDragTarget.dataset.folder);
  tabDragTarget.classList.remove("drop-target");
  tabDragTarget = null;
});

document.addEventListener("dragleave", (e) => {
  /* Left the tab strip entirely → drop the highlight. */
  const rel = e.relatedTarget;
  if (!rel || !(rel instanceof Element) || !rel.closest("#tabbar-wrap")) {
    if (tabDragTarget) tabDragTarget.classList.remove("drop-target");
    tabDragTarget = null;
  }
});

function reorderFolder(srcId, dstId) { swapFolders(srcId, dstId); }

/* Mobile: long-press on tab → move left/right menu. */
function wireTabLongPress(tab, id) {
  let timer = null, startY = 0;
  tab.addEventListener("touchstart", (e) => {
    const startX = e.touches[0].clientX;   // cache before timeout
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      if (e.cancelable) e.preventDefault();
      navigator.vibrate && navigator.vibrate(15);
      showTabContextMenu(id, startX, startY);
    }, 500);
  }, { passive: false });
  ["touchmove", "touchend", "touchcancel"].forEach((ev) => {
    tab.addEventListener(ev, (e) => {
      if (ev === "touchmove" &&
          Math.abs(e.touches[0].clientY - startY) < 12) return;
      clearTimeout(timer);
      timer = null;
    });
  });
}

function showTabContextMenu(id, x, y) {
  closeCtxMenu();
  const f = state.folders[id];
  if (!f || f.id === ROOT_FOLDER) return;

  const ordered = K.childrenOf(state.folders, K.parentOf(state.folders, id))
    .map((x) => state.folders[x]);
  const idx = ordered.findIndex((fd) => fd.id === id);

  const m = document.createElement("div");
  m.id = "ctx-menu";

  function row(label, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => { closeCtxMenu(); fn(); });
    m.appendChild(b);
  }

  row(t("tab.rename"), () => openFolderDialog("edit", id));
  if (idx > 0) {
    row(t("tab.movel"), () => swapFolders(id, ordered[idx - 1].id));
  }
  if (idx < ordered.length - 1) {
    row(t("tab.mover"), () => swapFolders(id, ordered[idx + 1].id));
  }
  row(t("tab.into"), () => pickFolderFor(id));
  row(t("tab.sub"), () => openFolderDialog("create", null, id));

  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  setTimeout(() => {
    document.addEventListener("click", closeCtxMenu, true);
    window.addEventListener("scroll", closeCtxMenu, true);
  }, 0);
}

/* Position swap between two adjacent folders — same primitive
   as desktop tab drag reorder, one source of truth. */
function swapFolders(aId, bId) {
  const a = state.folders[aId], b = state.folders[bId];
  if (!a || !b) return;
  const tmp = a.pos;
  a.pos = b.pos;
  b.pos = tmp;
  a.modified = Date.now();
  b.modified = Date.now();
  save();
  renderTabs();
  renderList();
}

function loadSortPreference() {
  try {
    const m = localStorage.getItem("oros-bookmarks-sort");
    if (["recent", "title", "visited", "manual"].includes(m))
      uiSortMode = m;
  } catch (e) {}
}

/* Sort comparator per mode — all stable by item id for determinism. */
function sortItems(list) {
  if (uiSortMode === "title") {
    return list.slice().sort((a, b) =>
      a.title.toLowerCase() < b.title.toLowerCase() ? -1 :
      a.title.toLowerCase() > b.title.toLowerCase() ? 1 :
      a.id < b.id ? -1 : 1);
  } else if (uiSortMode === "visited") {
    return list.slice().sort((a, b) =>
      (b.visits - a.visits) || (b.lastVisit || 0) - (a.lastVisit || 0) ||
      (a.id < b.id ? -1 : 1));
  } else if (uiSortMode === "manual") {
    return list.slice().sort((a, b) =>
      (a.pos ?? Infinity) - (b.pos ?? Infinity) ||
      (a.id < b.id ? -1 : 1));
  } else { /* "recent" — newest-first */
    return list.slice().sort((a, b) =>
      (b.added - a.added) || (a.id < b.id ? -1 : 1));
  }
}

function renderTagFilter() {
  const row = $("#tag-filter");
  row.textContent = "";
  row.hidden = uiTagFilters.size === 0 && !uiBadFilter;
  if (row.hidden) return;

  /* Wave 35: "Broken and moved links" is a filter like a tag. */
  if (uiBadFilter) {
    const chip = document.createElement("span");
    chip.className = "ftag bad";
    const label = document.createElement("span");
    label.textContent = t("chk.filter");
    const x = document.createElement("button");
    x.type = "button";
    x.className = "x";
    x.setAttribute("aria-label", t("search.clear"));
    x.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", () => setBadFilter(false));
    chip.append(label, x);
    row.appendChild(chip);
  }

  uiTagFilters.forEach((tg) => {
    const chip = document.createElement("span");
    chip.className = "ftag";
    const label = document.createElement("span");
    label.textContent = tg;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "x";
    x.setAttribute("aria-label", t("search.clear"));
    x.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", () => toggleTagFilter(tg));
    chip.append(label, x);
    row.appendChild(chip);
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "clear-all";
  clear.textContent = t("tags.clear");
  clear.addEventListener("click", clearTagFilters);
  row.appendChild(clear);
}

/* ---- "All tags" panel (overlay + anchored panel) ---- */

function closeTagsPanel() {
  const ov = $("#tags-overlay");
  if (ov) ov.remove();
}

function showTagsPanel() {
  closeTagsPanel();
  const counts = allTagCounts();
  const names = Object.keys(counts);

  const ov = document.createElement("div");
  ov.id = "tags-overlay";

  const panel = document.createElement("div");
  panel.id = "tags-panel";

  const h = document.createElement("h4");
  h.textContent = t("tags.all");
  panel.appendChild(h);

  if (!names.length) {
    const none = document.createElement("div");
    none.className = "tag-none";
    none.textContent = t("tags.none");
    panel.appendChild(none);
  } else {
    names.forEach((tg) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tag-row";
      const lbl = document.createElement("span");
      lbl.textContent = tg;
      const cnt = document.createElement("span");
      cnt.className = "cnt-bubble";
      cnt.textContent = counts[tg];
      b.append(lbl, cnt);
      b.addEventListener("click", () => {
        closeTagsPanel();
        toggleTagFilter(tg);
      });
      panel.appendChild(b);
    });
  }

  ov.appendChild(panel);
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeTagsPanel();
  });
  document.body.appendChild(ov);
}

/* ---- Duplicates (same-address bookmarks): finder + purge ---- */

/* Groups items by dupeKey() — the exact same canonical rule as
   findByUrl (scheme/www/case/fragment-insensitive), so whatever
   quick-add would have blocked as a duplicate IS found here too.
   Each group is sorted oldest-first, so g[0] is the original. */
function findDupeGroups() {
  /* Wave 35: core.dupeKey also ignores tracking parameters, the
     default port and the order of the query. */
  return K.dupeGroups(state.items);
}

function closeDupesPanel() {
  const ov = $("#dupes-overlay");
  if (ov) ov.remove();
}

function showDupesPanel() {
  closeDupesPanel();
  closeTagsPanel();
  const groups = findDupeGroups();

  const ov = document.createElement("div");
  ov.id = "dupes-overlay";

  const panel = document.createElement("div");
  panel.id = "dupes-panel";

  const h = document.createElement("h4");
  h.textContent = t("dupe.title");
  panel.appendChild(h);

  if (!groups.length) {
    const none = document.createElement("div");
    none.className = "tag-none";
    none.textContent = t("dupe.none");
    panel.appendChild(none);
  } else {
    /* Action bar: Apply all / Apply selected. */
    const actions = document.createElement("div");
    actions.className = "dupe-actions";
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "dupe-apply-all";
    allBtn.textContent = t("dupe.apply.all", { n: groups.length });
    allBtn.addEventListener("click", () => purgeGroups(groups));
    const selBtn = document.createElement("button");
    selBtn.type = "button";
    selBtn.className = "dupe-apply-sel";
    selBtn.textContent = t("dupe.apply.sel");
    selBtn.addEventListener("click", () => {
      const chosen = [];
      panel.querySelectorAll(".dupe-group").forEach((blk) => {
        const cb = blk.querySelector(".dupe-check");
        if (cb && cb.checked) {
          const g = groups.find((gr) => gr[0] && gr[0].id === cb.dataset.keep);
          if (g) chosen.push(g);
        }
      });
      if (!chosen.length) { transientNote(t("dupe.none.sel")); return; }
      purgeGroups(chosen);
    });
    actions.append(allBtn, selBtn);
    panel.appendChild(actions);

    groups.forEach((g) => {
      const keep = g[0];                // oldest — the original
      const blk = document.createElement("div");
      blk.className = "dupe-group";

      const head = document.createElement("div");
      head.className = "dupe-head";
      head.textContent = hostOf(keep.url) || keep.url;
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "dupe-check";
      chk.checked = true;              // selected by default
      chk.dataset.keep = keep.id;      // links box → group
      chk.addEventListener("click", (e) => e.stopPropagation());
      head.appendChild(chk);
      blk.appendChild(head);

      g.forEach((it) => {
        const row = document.createElement("div");
        row.className = "dupe-row";
        const lbl = document.createElement("span");
        lbl.className = "dupe-lbl";
        lbl.textContent = it.title +
          (it.id === keep.id ? " — " + t("dupe.keeper") : "");
        const sub = document.createElement("span");
        sub.className = "dupe-sub";
        const fld = state.folders[it.folderId];
        sub.textContent = (fld ? folderPathName(fld.id) : "?") +
          " · " + relTime(it.added);
        row.append(lbl, sub);
        blk.appendChild(row);
      });

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dupe-purge";
      btn.textContent = t("dupe.keep", { n: g.length - 1 });
      btn.addEventListener("click", () => purgeDupeGroup(g));
      blk.appendChild(btn);

      panel.appendChild(blk);
    });
  }

  ov.appendChild(panel);
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeDupesPanel();
  });
  document.body.appendChild(ov);

}

/* Core: folds duplicates into the oldest copy. Visits and
   lastVisit are merged into the keeper so stats survive. Returns
   the number of deleted copies — NO snapshot/save/toast here,
   so single and bulk purges share one source of truth. */
function purgeGroupCore(g) {
  if (!g || g.length < 2) return 0;
  const keep = state.items[g[0].id];   // oldest — the original
  if (!keep) return 0;
  const now = Date.now();
  const others = g.slice(1).map((it) => state.items[it.id]).filter(Boolean);
  if (!others.length) return 0;
  /* Wave 35 merge: the keeper gains every tag, every other
     description, the star, the visits, the newest check and a saved
     copy it lacked (core.mergeInto). */
  const m = K.mergeInto(keep, others);
  keep.tags = m.tags;
  keep.note = m.note;
  keep.fav = m.fav;
  keep.visits = m.visits;
  keep.lastVisit = m.lastVisit;
  if (m.chk) keep.chk = m.chk;
  if (m.arch) keep.arch = m.arch;
  others.forEach((it) => {
    delete state.items[it.id];
    state.deleted[it.id] = now;         // tombstones — sync-safe
  });
  keep.modified = now;
  return others.length;
}

/* Single-group purge (per-group button path). */
function purgeDupeGroup(g) {
  snapshotForUndo(g.map((it) => it.id));
  const n = purgeGroupCore(g);
  if (!n) return;
  save();
  closeDupesPanel();
  renderAll();
  showToast(t("dupe.deleted", { n: n }), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* Bulk purge: ONE undo snapshot, ONE save, ONE toast — atomic.
   A single Undo restores every purged copy at once. */
function purgeGroups(groups) {
  /* Guard against stale group references (panel open while a
     sync pulled changes): only groups whose keeper still lives. */
  const live = (groups || []).filter(
    (g) => g && g.length > 1 && state.items[g[0].id]);
  if (!live.length) return;
  snapshotForUndo([].concat.apply([], live.map((g) => g.map((it) => it.id))));
  let total = 0;
  live.forEach((g) => { total += purgeGroupCore(g); });
  if (!total) return;
  save();
  closeDupesPanel();
  renderAll();
  showToast(t("dupe.deleted", { n: total }), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* ===== 5. SEARCH + QUICK-ADD ===== */

function wireSearch() {
  const input = $("#search");
  input.addEventListener("input", () => {
    uiQuery = input.value;
    $("#search-clear").hidden = !uiQuery;
    renderList();
  });
  $("#search-clear").addEventListener("click", () => {
    input.value = "";
    uiQuery = "";
    $("#search-clear").hidden = true;
    input.focus();
    renderList();
  });
}

/* Normalize: trim, drop scheme-less input onto https, strip
   trailing slash so http(s)/site.tld match the stored twin.
   (Shared with the imports: core.normUrl.) */
function normalizeUrl(raw) { return K.normUrl(raw); }

/* Canonical equality key — one rule for BOTH the quick-add/edit
   duplicate guard AND the duplicate finder, so the two can never
   disagree again (core.dupeKey):
   - scheme-insensitive (http ≡ https), default port ignored
   - host lowercased, "www." dropped
   - fragment (#…) ignored, trailing slashes stripped
   - tracking parameters (utm_*, fbclid, gclid…) dropped, the rest
     of the query KEPT in sorted order (different query = different page) */
function dupeKey(raw) { return K.dupeKey(raw); }

function findByUrl(normalized) {
  const target = dupeKey(normalized);
  return Object.keys(state.items)
    .map((id) => state.items[id])
    .find((it) => dupeKey(it.url) === target) || null;
}

function quickAdd() {
  const input = $("#quick-add");
  const raw = input.value.trim();
  if (!raw) return;                 // silent exit — empty input is not an error
  let urlPart = raw, titlePart = "";
  const bar = raw.indexOf("|");
  if (bar > -1) {
    titlePart = raw.slice(bar + 1).trim();
    urlPart = raw.slice(0, bar);
  }
  const norm = normalizeUrl(urlPart);
  if (!norm) { flashDuplicate(); return; }

  const existing = findByUrl(norm);
  if (existing) {
    flashDuplicate();
    const fld = state.folders[existing.folderId];
    transientNote(t("added.dup", { f: fld ? folderPathName(fld.id) : "" }));
    return;
  }

  const it = sanitizeItem({
    url: norm,
    title: titlePart,
    /* All view has no target folder — new links land in Unsorted. */
    folderId: uiActiveFolder === "ALL_VIEW" ? ROOT_FOLDER : uiActiveFolder
  });
  if (!it) { flashDuplicate(); return; }
  state.items[it.id] = it;
  save();
  input.value = "";
  renderAll();
  transientNote(t("added"));
}

function flashDuplicate() {
  const bar = $("#addbar");
  bar.classList.remove("duplicate");
  void bar.offsetWidth;              // restart the CSS state
  bar.classList.add("duplicate");
  setTimeout(() => bar.classList.remove("duplicate"), 1200);
  $("#quick-add").focus();
}

/* ===== 6. MOVE (D&D desktop + long-press menu) ===== */

let draggingId = null;

function moveItem(id, folderId) {
  const it = state.items[id];
  if (!it || it.folderId === folderId) return;
  snapshotForUndo([id]);
  it.folderId = folderId;
  it.modified = Date.now();
  save();
  renderAll();
  const fld = state.folders[folderId];
  showToast(t("moved", { f: folderPathName(folderId) }), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

function wireRowDrag(li, id) {
  li.addEventListener("dragstart", (e) => {
    draggingId = id;
    li.classList.add("dragging");
    e.dataTransfer.setData("text/plain", id);   // Firefox needs data
    e.dataTransfer.effectAllowed = "move";
  });
  li.addEventListener("dragend", () => {
    draggingId = null;
    li.classList.remove("dragging");
    clearDropTargets();
  });
}

function wireTabDrop(tab, isAllView = false) {
  /* Item drop — moves bookmark to folder. */
  /* A subfolder chip dropped on a tab nests there (on All: back to
     the top level). Tab onto tab stays a reorder (document handler). */
  const chipDrag = () => draggingFolderId && !document.querySelector(".tab.dragging");
  const chipTarget = () => isAllView ? "" : tab.dataset.folder;
  tab.addEventListener("dragover", (e) => {
    if (draggingId || (chipDrag() && K.canMoveFolder(state.folders, draggingFolderId, chipTarget()))) {
      e.preventDefault(); tab.classList.add("drop-target");
    }
  });
  tab.addEventListener("dragleave", () => tab.classList.remove("drop-target"));
  tab.addEventListener("drop", (e) => {
    e.preventDefault();
    if (chipDrag()) {
      tab.classList.remove("drop-target");
      moveFolder(draggingFolderId, chipTarget());
      return;
    }
    const id = draggingId || e.dataTransfer.getData("text/plain");
    tab.classList.remove("drop-target");
    if (!id) return;

    if (isAllView && state.items[id]) {
      /* Drop on "All" → move to Unsorted (default recovery). */
      moveItem(id, ROOT_FOLDER);
      return;
    }
    if (state.items[id]) moveItem(id, tab.dataset.folder);
  });

  /* Tab-to-tab drag — reorder folders (Wave 2). Only triggers if
     the dragged element itself is a tab (tab.dragging flag).
     NOTE: This coexists with item dragstart (checked via class). */
  tab.addEventListener("dragstart", (e) => {
    if (e.target.classList.contains("tab") && !e.target.classList.contains("dragging")) {
      e.target.classList.add("dragging");
      if (tab.dataset.folder && tab.dataset.folder !== "ALL") draggingFolderId = tab.dataset.folder;
      e.dataTransfer.setData("text/plain", "tab-reorder:" + tab.dataset.folder);
      e.dataTransfer.effectAllowed = "move";
    }
  });
  tab.addEventListener("dragend", () => {
    draggingFolderId = null;
    $$(".tab.dragging").forEach((t) => t.classList.remove("dragging"));
    clearDropTargets();
  });
}

function clearDropTargets() {
  $$(".drop-target").forEach((el) => el.classList.remove("drop-target"));
}

/* Long-press (mobile) — 500ms hold, cancelled by scroll/second touch. */
function wireLongPress(li, id) {
  let timer = null, startY = 0;
  li.addEventListener("touchstart", (e) => {
    const startX = e.touches[0].clientX;   // cache before timeout
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      if (e.cancelable) e.preventDefault();
      navigator.vibrate && navigator.vibrate(15);
      showCtxMenu(id, startX, startY);
    }, 500);
  }, { passive: false });
  ["touchmove", "touchend", "touchcancel"].forEach((ev) => {
    li.addEventListener(ev, (e) => {
      if (ev === "touchmove" &&
          Math.abs(e.touches[0].clientY - startY) < 12) return;
      clearTimeout(timer);
      timer = null;
    });
  });
}

function closeCtxMenu() {
  const m = $("#ctx-menu");
  if (m) m.remove();
  document.removeEventListener("click", closeCtxMenu, true);
  window.removeEventListener("scroll", closeCtxMenu, true);
}

function showCtxMenu(id, x, y) {
  closeCtxMenu();
  const it = state.items[id];
  if (!it) return;

  const m = document.createElement("div");
  m.id = "ctx-menu";

  function row(label, fn, danger) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (danger) b.className = "danger";
    b.addEventListener("click", () => { closeCtxMenu(); fn(); });
    m.appendChild(b);
  }

  row(t("ctx.open"), () => openItem(id));
  row(t("ctx.open_maps"), () => openInMaps(it)); // NEW: Open in Maps integration
  row(t("ctx.edit"), () => openItemDialog(id));
  if (shareApi()) row(t("ctx.share"), () => shareItems([id]));
  row(it.fav ? t("fav.remove") : t("fav.add"), () => toggleFav(id));
  const sep = document.createElement("div");
  sep.className = "sep";
  m.appendChild(sep);
  /* Wave 35: saved readable copy, link check, the folder picker. */
  if (it.arch && it.arch.f) row(t("arc.read"), () => openReader(id));
  else row(t("arc.save"), () => openReader(id, true));
  row(t("chk.one"), () => runCheck([id]));
  if (it.chk && it.chk.s === "moved" && it.chk.to) row(t("chk.use"), () => useNewAddress(id));
  row(t("ctx.move"), () => openPicker("item", t("pick.item"), it.folderId, (fid) => moveItem(id, fid)));
  const sep2 = document.createElement("div");
  sep2.className = "sep";
  m.appendChild(sep2);
  row(t("ctx.delete"), () => deleteItem(id), true);

  document.body.appendChild(m);
  /* Clamp inside viewport — mobile-first. */
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";

  setTimeout(() => {               // let this tap finish first
    document.addEventListener("click", closeCtxMenu, true);
    window.addEventListener("scroll", closeCtxMenu, true);
  }, 0);
}

/* ---- Toast (single slot, top-right) ---- */

let toastTimer = null;
function showToast(msg, opts) {
  const el = $("#toast");
  el.textContent = "";
  el.appendChild(document.createTextNode(msg));
  if (opts && opts.action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action";
    b.textContent = opts.action.label;
    b.addEventListener("click", () => { hideToast(); opts.action.fn(); });
    el.appendChild(b);
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  /* Undo toasts stay 8 s (Part VII); plain notes 5 s. */
  toastTimer = setTimeout(hideToast, opts && opts.action ? 8000 : 5000);
}
function hideToast() { $("#toast").classList.remove("show"); }

/* Unified notifications (orOS compliance): informational toasts
   route through the shell's orosNotifs.transient() — click
   feedback, no inbox, no toggle needed. Falls back to the local
   toast when the app runs standalone (no shell present).
   Undo-bearing toasts keep the local path (interactive action). */
function transientNote(title, body) {
  let api = window.orosNotifs;
  if (!api) {
    try { api = window.parent.orosNotifs; } catch (e) {}
  }
  if (api && typeof api.transient === "function") {
    api.transient({ ns: "bookmarks", title: title, body: body || "" });
  } else {
    showToast(title + (body ? " — " + body : ""));
  }
}

/* ===== 7. ITEM DIALOG ===== */

let editingItemId = null;
let editingSnap = null;              // BM-4: what the form showed at open
let editingNew = false;              // dialog adds a shared link (no id yet)
let dlgTags = [];                    // working copy while dialog open
let acHighlighted = -1;              // autocomplete row index

function renderDlgTags() {
  const editor = $("#f-tags-editor");
  /* Remove existing chips, keep the input (last child). */
  editor.querySelectorAll(".chip").forEach((c) => c.remove());
  const input = $("#f-tags-input");
  dlgTags.forEach((tg) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const lbl = document.createElement("span");
    lbl.textContent = tg;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "x";
    x.setAttribute("aria-label", t("search.clear"));
    x.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", () => {
      dlgTags = dlgTags.filter((t2) => t2 !== tg);
      renderDlgTags();
    });
    chip.append(lbl, x);
    editor.insertBefore(chip, input);
  });
}

function addDlgTag(raw) {
  const tg = sanText(raw, 32);
  if (!tg) return;
  if (dlgTags.includes(tg)) {
    transientNote(t("tags.dup"), tg);
    return;
  }
  if (dlgTags.length >= 12) return;  // sanitizer cap: max 12 tags
  dlgTags.push(tg);
  renderDlgTags();
}

/* Autocomplete: suggestions from the 1st typed character,
   excluding already-added tags. Shows usage counts. */
function renderDlgAc(query) {
  const ac = $("#f-tags-ac");
  ac.textContent = "";
  acHighlighted = -1;
  if (!query) { ac.hidden = true; return; }
  const q = query.toLowerCase();
  const counts = allTagCounts();
  const sug = Object.keys(counts)
    .filter((tg) => tg.toLowerCase().startsWith(q) && !dlgTags.includes(tg))
    .slice(0, 6);
  if (!sug.length) { ac.hidden = true; return; }
  sug.forEach((tg) => {
    const b = document.createElement("button");
    b.type = "button";
    const lbl = document.createElement("span");
    lbl.textContent = tg;
    const cnt = document.createElement("span");
    cnt.className = "cnt";
    cnt.textContent = counts[tg];
    b.append(lbl, cnt);
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus
    b.addEventListener("click", () => {
      addDlgTag(tg);
      $("#f-tags-input").value = "";
      renderDlgAc("");
    });
    ac.appendChild(b);
  });
  ac.hidden = false;
}

function wireTagEditor() {
  const input = $("#f-tags-input");
  input.addEventListener("input", () => renderDlgAc(input.value));
  input.addEventListener("keydown", (e) => {
    const ac = $("#f-tags-ac");
    const rows = ac.hidden ? [] : Array.from(ac.querySelectorAll("button"));
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      acHighlighted = Math.min(acHighlighted + 1, rows.length - 1);
      rows.forEach((r, i) => r.classList.toggle("hl", i === acHighlighted));
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      acHighlighted = Math.max(acHighlighted - 1, 0);
      rows.forEach((r, i) => r.classList.toggle("hl", i === acHighlighted));
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (acHighlighted >= 0 && rows[acHighlighted]) {
        addDlgTag(rows[acHighlighted].querySelector("span").textContent);
      } else if (input.value.trim()) {
        addDlgTag(input.value);
      }
      input.value = "";
      renderDlgAc("");
    } else if (e.key === "Backspace" && !input.value && dlgTags.length) {
      dlgTags.pop();
      renderDlgTags();
    }
  });
  input.addEventListener("blur", () => {
    /* Commit a dangling fragment after 150ms (blur from AC click
       fires before the click handler — mousedown preventDefault
       above already guards, this is belt-and-braces). */
    setTimeout(() => { $("#f-tags-ac").hidden = true; }, 150);
  });
}

function shellOpenAt() {
  try { return window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent.__orosOpenAt : null; }
  catch (e) { return null; }
}

function openItemDialog(id) {
  const it = state.items[id];
  if (!it) return;
  editingItemId = id;
  editingSnap = { title: it.title, url: it.url, note: it.note || "",
                  folderId: it.folderId, tags: it.tags.slice() };
  dlgTags = it.tags.slice();
  renderDlgTags();
  $("#f-title").value = it.title;
  $("#f-url").value = it.url;
  $("#f-note").value = it.note || "";
  $("#f-tags-input").value = "";
  $("#f-tags-ac").hidden = true;
  fillFolderSelect(it.folderId);
  $("#f-qr").hidden = !shellOpenAt();
  renderDlgExtras(it);
  $("#dlg-item").showModal();
}

/* Wave 35: the last link check and the saved copy, under the form. */
function renderDlgExtras(it) {
  const box = $("#f-extras");
  if (!box) return;
  box.textContent = "";
  box.hidden = !it;
  if (!it) return;
  const line = document.createElement("div");
  line.className = "x-line";
  if (it.chk) {
    const s = document.createElement("span");
    s.className = "x-chk " + it.chk.s;
    s.textContent = t("chk.line", {
      s: t("chk.s." + it.chk.s) + (it.chk.code ? " (" + it.chk.code + ")" : ""),
      when: relTime(it.chk.at)
    });
    line.appendChild(s);
    if (it.chk.s === "moved" && it.chk.to) {
      const to = document.createElement("span");
      to.className = "x-to";
      to.textContent = t("chk.to", { u: it.chk.to });
      line.appendChild(to);
    }
  }
  box.appendChild(line);
  const acts = document.createElement("div");
  acts.className = "x-acts";
  const btn = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => { editingItemId = null; $("#dlg-item").close(); fn(); });
    acts.appendChild(b);
  };
  if (it.chk && it.chk.s === "moved" && it.chk.to) btn(t("chk.use"), () => useNewAddress(it.id));
  btn(t("chk.one"), () => runCheck([it.id]));
  if (it.arch && it.arch.f) btn(t("arc.read"), () => openReader(it.id));
  else btn(t("arc.save"), () => openReader(it.id, true));
  box.appendChild(acts);
}

/* "Send to orOS": the shell hands over { url, title } from a
   bookmarklet or Android share. Same dialog, add mode: nothing is
   stored until Save. A link already saved opens its own dialog. */
function openAddDialog(a) {
  const norm = normalizeUrl(a && a.url);
  if (!norm) return;
  const existing = findByUrl(norm);
  if (existing) {
    openItemDialog(existing.id);
    const fld = state.folders[existing.folderId];
    transientNote(t("added.dup", { f: fld ? folderPathName(fld.id) : "" }));
    return;
  }
  const folderId = uiActiveFolder === "ALL_VIEW" || !state.folders[uiActiveFolder]
    ? ROOT_FOLDER : uiActiveFolder;
  const title = sanText(a.title, 256);
  editingItemId = null;
  editingNew = true;
  editingSnap = { title: title, url: norm, note: "", folderId: folderId, tags: [] };
  dlgTags = [];
  renderDlgTags();
  $("#f-title").value = title;
  $("#f-url").value = norm;
  $("#f-qr").hidden = true;            // nothing saved yet
  $("#f-note").value = "";
  $("#f-tags-input").value = "";
  $("#f-tags-ac").hidden = true;
  fillFolderSelect(folderId);
  renderDlgExtras(null);
  $("#dlg-item h3").textContent = t("item.new");
  $("#f-delete").hidden = true;
  $("#dlg-item").showModal();
}

function fillFolderSelect(selectedId) {
  const sel = $("#f-folder");
  sel.textContent = "";
  /* Wave 35: the whole tree in tree order, each with its path. */
  folderTree().forEach((x) => {
    const o = document.createElement("option");
    o.value = x.f.id;
    o.textContent = folderPathName(x.f.id);
    if (x.f.id === selectedId) o.selected = true;
    sel.appendChild(o);
  });
}

/* BM-4: write only the fields the user changed since the dialog
   opened. A pull while the dialog is open no longer gets overwritten
   by the stale values still sitting in the untouched fields (A67 Q1),
   and a Save with no change does not stamp "modified" (R27). */
function submitItemDialog(normUrl) {
  if (editingNew) {
    const created = sanitizeItem({
      url: normUrl,
      title: sanText($("#f-title").value, 256) || normUrl,
      note: sanText($("#f-note").value, 1024),
      folderId: $("#f-folder").value || ROOT_FOLDER,
      tags: dlgTags.slice()
    });
    if (!created) return;
    state.items[created.id] = created;
    save();
    renderAll();
    transientNote(t("added"));
    return;
  }
  const it = state.items[editingItemId];
  const snap = editingSnap;
  if (!it || !snap) return;
  const title = sanText($("#f-title").value, 256) || normUrl;
  const note = sanText($("#f-note").value, 1024);
  const folderId = $("#f-folder").value || ROOT_FOLDER;
  const tags = dlgTags.slice();
  let changed = false;
  if (title !== snap.title) { it.title = title; changed = true; }
  if ($("#f-url").value.trim() !== snap.url && normUrl !== snap.url) {
    it.url = normUrl; changed = true;
  }
  if (note !== snap.note) { it.note = note; changed = true; }
  if (folderId !== snap.folderId) { it.folderId = folderId; changed = true; }
  if (JSON.stringify(tags) !== JSON.stringify(snap.tags)) { it.tags = tags; changed = true; }
  if (!changed) return;
  it.modified = Date.now();
  save();
  renderAll();
}

function deleteItem(id) {
  const it = state.items[id];
  if (!it) return;
  snapshotForUndo([id]);
  delete state.items[id];
  state.deleted[id] = Date.now();          // tombstone wins over stale copy
  save();
  renderAll();
  showToast(t("deleted"), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* "Send to orOS" bookmarklet: opens orOS (this origin) with the
   page's address and title; the shell hands them to openAddDialog.
   It reads location.href and document.title of the page it runs on
   and sends nothing anywhere else. */
function bookmarkletCode() {
  const root = new URL("../", location.href).href;
  return "javascript:(function(){var u=" + JSON.stringify(root + "?share-url=") +
    "+encodeURIComponent(location.href)+'&share-title='+encodeURIComponent(document.title);" +
    "if(!window.open(u,'_blank'))location.href=u;})();";
}

function wireSendDialog() {
  const link = $("#send-link");
  link.setAttribute("href", bookmarkletCode());
  /* Clicking it here would run it inside orOS: it is only for
     dragging to the bookmarks bar. */
  link.addEventListener("click", (e) => {
    e.preventDefault();
    transientNote(t("send.drag"));
  });
  $("#send-btn").addEventListener("click", () => {
    $("#send-code").hidden = true;
    $("#dlg-send").showModal();
  });
  $("#send-copy").addEventListener("click", () => {
    const code = bookmarkletCode();
    const box = $("#send-code");
    const done = () => transientNote(t("send.copied"));
    /* No clipboard access (some browsers inside an iframe): show the
       code selected, ready for Ctrl+C. */
    const manual = () => { box.hidden = false; box.focus(); box.select(); };
    box.value = code;
    try {
      navigator.clipboard.writeText(code).then(done, manual);
    } catch (e) { manual(); }
  });
}

/* ===== 8. FOLDER DIALOG (create / rename / move / delete) ===== */

let folderDlgMode = "edit";
let folderDlgId = null;
let folderArmDelete = false;

/* parentId: where a new folder goes ("" or absent = a tab). */
function openFolderDialog(mode, folderId, parentId) {
  folderDlgMode = mode;
  folderDlgId = folderId || null;
  folderArmDelete = false;
  const isRoot = mode === "edit" && folderId === ROOT_FOLDER;
  const nameInput = $("#l-name");
  nameInput.readOnly = isRoot;
  if (mode === "create") {
    folderDlgId = null;
    nameInput.value = "";
  } else {
    nameInput.value = isRoot ? t("folder.unsorted")
                             : state.folders[folderId].name;
  }
  $("#l-delete").hidden = mode !== "edit" || isRoot;
  /* Wave 35: "Inside" — top level or any folder it may go into. */
  const sel = $("#l-parent");
  sel.textContent = "";
  const cur = mode === "create" ? (state.folders[parentId] && parentId !== ROOT_FOLDER ? parentId : "")
                                : K.parentOf(state.folders, folderId);
  const opt = (v, label) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    if (v === cur) o.selected = true;
    sel.appendChild(o);
  };
  opt("", t("folder.top"));
  folderTree(mode === "edit" ? folderId : null).forEach((x) => {
    if (x.f.id === ROOT_FOLDER) return;
    if (mode === "edit" && !K.canMoveFolder(state.folders, folderId, x.f.id)) return;
    opt(x.f.id, "   ".repeat(Math.min(x.depth + 1, 8)) + folderName(x.f));
  });
  $("#l-parent-wrap").hidden = isRoot;
  const n = mode === "edit" ? itemsInFolder(folderId).length : 0;
  const subs = mode === "edit" ? K.childrenOf(state.folders, folderId).length : 0;
  $("#l-count").textContent = t("folder.count", { n: n }) +
    (subs ? " · " + t("folder.subs", { n: subs }) : "");
  $("#dlg-folder h3").textContent = mode === "create"
    ? (cur ? t("folder.sub.add") : t("tab.add")) : t("folder.settings.dlg");
  updateFolderDeleteLabel();
  $("#dlg-folder").showModal();
}

function updateFolderDeleteLabel() {
  $("#l-delete").textContent = folderArmDelete
    ? t("folder.confirm.delete")
    : t("folder.delete");
}

/* Names are unique among siblings (wave 35: nested folders may share
   a name in different places). self = the folder being renamed. */
function uniquifyFolderName(name, parent, self) {
  const names = K.childrenOf(state.folders, parent || "")
    .filter((id) => id !== self)
    .map((id) => folderName(state.folders[id]).toLowerCase());
  if (!names.includes(name.toLowerCase())) return name;
  let i = 2;
  while (names.includes((name + " " + i).toLowerCase())) i++;
  return name + " " + i;
}

function nextFolderPos() {
  return folderList().reduce((m, f) => Math.max(m, f.pos), 0) + 1;
}

function submitFolderDialog(name) {
  const np = $("#l-parent").value || "";
  if (folderDlgMode === "create") {
    const parent = state.folders[np] && np !== ROOT_FOLDER ? np : "";
    const f = sanitizeFolder({
      name: uniquifyFolderName(name, parent),
      pos: nextFolderPos(),
      parent: parent || undefined,
      modified: Date.now()
    });
    if (!f) return;
    state.folders[f.id] = f;
    uiActiveFolder = f.id;
  } else if (folderDlgId && folderDlgId !== ROOT_FOLDER) {
    const f = state.folders[folderDlgId];
    if (!f) return;
    const oldParent = K.parentOf(state.folders, folderDlgId);
    const parent = np !== oldParent && K.canMoveFolder(state.folders, folderDlgId, np) ? np : oldParent;
    if (parent !== oldParent) {
      snapshotForUndo([], [folderDlgId]);
      if (parent) f.parent = parent; else delete f.parent;
      f.pos = nextFolderPos();
      f.modified = Date.now();
    }
    const newName = uniquifyFolderName(name, parent, folderDlgId);
    if (f.name !== newName) {
      f.name = newName;
      f.modified = Date.now();
    }
  }
  save();
  renderAll();
}

/* What was inside moves up one level: subfolders to the deleted
   folder's parent (a tab when it was one), bookmarks to the parent
   folder, or to Unsorted from a top folder — never lost. Undo puts
   the folder, its bookmarks and its subfolders back. */
function deleteFolderNow() {
  if (!folderDlgId || folderDlgId === ROOT_FOLDER || !state.folders[folderDlgId]) return;
  const up = K.parentOf(state.folders, folderDlgId);
  const kids = K.childrenOf(state.folders, folderDlgId);
  snapshotForUndo(
    Object.keys(state.items).filter((id) => state.items[id].folderId === folderDlgId),
    [folderDlgId].concat(kids));
  const now = Date.now();
  Object.keys(state.items).forEach((id) => {
    if (state.items[id].folderId === folderDlgId) {
      state.items[id].folderId = up || ROOT_FOLDER;
      state.items[id].modified = now;
    }
  });
  kids.forEach((id) => {
    const c = state.folders[id];
    if (up) c.parent = up; else delete c.parent;
    c.modified = now;
  });
  delete state.folders[folderDlgId];
  state.deleted[folderDlgId] = now;
  uiActiveFolder = up || ROOT_FOLDER;
  $("#dlg-folder").close();
  save();
  renderAll();
  showToast(t("deleted"), {
    action: { label: t("undo"), fn: undoFromSnapshot }
  });
}

/* ===== 9. IMPORT / EXPORT (Netscape HTML, Pocket, Raindrop) ===== */

/* Wave 35: the parsers live in core.js (Node-tested). One button
   reads a browser / Linkding / Pinboard / Raindrop bookmarks HTML,
   Pocket's HTML or CSV export, Raindrop's CSV or any CSV with a url
   column. Folders nest by path; tags, descriptions, favourites and
   the created date come along; links already here are skipped. */
function importNames() {
  return { pocket: "Pocket", archive: LANG === "el" ? "Αρχείο" : "Archive" };
}

/* The folder at path [a, b, …] under the top level: an existing
   folder of that name among the siblings (any case), else a new one.
   A first part named Unsorted is the Unsorted folder itself. */
function importFolder(path, made, back, now) {
  let parent = "", fid = ROOT_FOLDER;
  const parts = (path || []).map((p) => sanText(p, 64)).filter(Boolean);
  parts.forEach((name, i) => {
    const low = name.toLowerCase();
    if (i === 0 && (low === "unsorted" || low === t("folder.unsorted").toLowerCase())) return;
    const key = parent + "\n" + low;
    let id = made[key];
    if (!id) {
      id = K.childrenOf(state.folders, parent).find((x) =>
        x !== ROOT_FOLDER && state.folders[x].name.toLowerCase() === low) || "";
    }
    if (!id) {
      const f = sanitizeFolder({ name: name, pos: nextFolderPos(), parent: parent || undefined, modified: now });
      if (!f) return;
      state.folders[f.id] = f;
      back.folders.push(f.id);
      id = f.id;
    }
    made[key] = id;
    parent = id;
    fid = id;
  });
  return fid;
}

function applyImport(res) {
  const entries = (res && res.entries) || [];
  const now = Date.now();
  const back = { items: [], folders: [], upd: [] };
  const have = new Set(Object.keys(state.items).map((id) => dupeKey(state.items[id].url)));
  const made = {};
  entries.forEach((entry) => {
    const norm = normalizeUrl(entry.url);
    if (!norm) return;
    const key = dupeKey(norm);
    if (have.has(key)) return;                 // dedup against existing (and the file itself)
    const fid = importFolder(entry.path, made, back, now);
    const it = sanitizeItem({
      url: norm, title: entry.title, note: entry.note, tags: entry.tags, fav: entry.fav === true,
      folderId: fid, added: entry.added || now, modified: now
    });
    if (!it) return;
    state.items[it.id] = it;
    have.add(key);
    back.items.push(it.id);
  });
  if (!back.items.length) {
    transientNote(entries.length ? t("import.have", { n: entries.length }) : t("import.none"));
    return;
  }
  save();
  renderAll();
  showToast(t("import.picked", { n: back.items.length, f: back.folders.length }), {
    action: { label: t("undo"), fn: () => platformUndo(back) }
  });
}


/* Import from Raindrop.io (integrations wave 6C, platforms.js).
   The plan comes from links/bookmarks.js; this is its one write.
   Undo takes out what came in (tombstoned, like any deletion here)
   and puts back the fields an update changed. Ids are the plan's
   (L.extId), so a second import finds them again. */
function platformApply(pl, doneText) {
  const now = Date.now();
  const back = { items: [], folders: [], upd: [] };
  let pos = nextFolderPos();
  pl.folders.add.forEach((x) => {
    if (state.folders[x.id]) return;
    const f = sanitizeFolder({ id: x.id, name: x.name, pos: pos++, modified: now }, x.id);
    if (!f) return;
    state.folders[f.id] = f;
    delete state.deleted[f.id];
    back.folders.push(f.id);
  });
  pl.items.add.forEach((x) => {
    if (state.items[x.id]) return;
    const it = sanitizeItem({ id: x.id, url: x.url, title: x.title, note: x.note, tags: x.tags,
                              fav: x.fav === true, folderId: x.folderId, added: now, modified: now }, x.id);
    if (!it) return;
    state.items[it.id] = it;
    delete state.deleted[it.id];
    back.items.push(it.id);
  });
  pl.items.upd.forEach((x) => {
    const it = state.items[x.id];
    if (!it) return;
    const old = {};
    ["title", "note", "tags"].forEach((f) => {
      if (x.f[f] === undefined) return;
      old[f] = Array.isArray(it[f]) ? it[f].slice() : it[f];
      it[f] = f === "tags" ? x.f.tags.slice(0, 12).map((tg) => sanText(tg, 32)).filter(Boolean)
            : sanText(x.f[f], f === "title" ? 256 : 1024);
    });
    it.modified = now;
    back.upd.push({ id: x.id, old: old });
  });
  save();
  renderAll();
  showToast(doneText, { action: { label: t("undo"), fn: () => platformUndo(back) } });
  return true;
}

function platformUndo(back) {
  const now = Date.now();
  back.items.forEach((id) => {
    if (state.items[id]) delete state.items[id];
    state.deleted[id] = now;
  });
  back.upd.forEach((u) => {
    const it = state.items[u.id];
    if (!it) return;
    Object.keys(u.old).forEach((f) => { it[f] = u.old[f]; });
    it.modified = now;
  });
  /* A folder that came in goes again only while it is empty (no
     bookmark, no subfolder); the newest first, so a nested import
     empties its inner folders before their parents. */
  back.folders.slice().reverse().forEach((id) => {
    if (!state.folders[id]) return;
    if (Object.keys(state.items).some((k) => state.items[k].folderId === id)) return;
    if (K.childrenOf(state.folders, id).length) return;
    delete state.folders[id];
    state.deleted[id] = now;
    if (uiActiveFolder === id) uiActiveFolder = ROOT_FOLDER;
  });
  save();
  renderAll();
}

function wirePlatforms() {
  const P = window.OrosBookmarksPlatforms;
  const btn = $("#raindrop-btn");
  if (!P || !btn || !P.has()) return;
  P.init({ lang: LANG, data: () => state, apply: platformApply, dupe: dupeKey });
  btn.title = P.label();
  btn.setAttribute("aria-label", P.label());
  btn.hidden = false;
  btn.addEventListener("click", () => P.open());
}

function exportNetscape() {
  /* Wave 35: the whole tree as nested <H3>/<DL>, tags in TAGS, the
     description in <DD>, ADD_DATE / LAST_MODIFIED (core.buildNetscape).
     Unsorted bookmarks sit at the top of the file, so an import puts
     them back in Unsorted. Branches without a bookmark are left out. */
  const node = (fid) => {
    const kids = K.childrenOf(state.folders, fid).filter((x) => x !== ROOT_FOLDER).map(node).filter(Boolean);
    const items = itemsInFolder(fid);
    if (!kids.length && !items.length) return null;
    return { name: folderName(state.folders[fid]), items: items, folders: kids };
  };
  const tree = {
    items: itemsInFolder(ROOT_FOLDER),
    folders: K.childrenOf(state.folders, "").filter((x) => x !== ROOT_FOLDER).map(node).filter(Boolean)
  };
  const built = K.buildNetscape(tree);
  const blob = new Blob([built.text], { type: "text/html" });
  const done = () =>
    transientNote(t("exported", { n: built.count }));
  const dlg = dialogHost();

  if (dlg && typeof dlg.saveFile === "function") {
    dlg.saveFile({
      blob: blob,
      filename: "oros-bookmarks.html",
      mime: "text/html",
      types: [{ description: "Bookmark HTML",
                accept: { "text/html": [".html"] } }]
    }).then((r) => { if (r && r.ok) done(); });
    return;                           // cancel (ok=false) = silent exit
  }

  /* Standalone fallback — classic download (no shell present). */
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = "oros-bookmarks.html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
  done();
}

/* ===== 9b. SAVED COPY, LINK CHECK, TIDY-UP MENU (wave 35) ===== */

/* The Reader's network and article pipeline, loaded on first use
   (relay/ is not touched): feeds/fetch.js (straight from the browser,
   else the relay's "web" op), feeds/extract.js (the main text of a
   page, parsed inert), feeds/sanitize.js (allow-list rebuild). */
const READER_LIBS = ["../feeds/core.js", "../feeds/fetch.js", "../feeds/extract.js", "../feeds/sanitize.js"];
let readerLibsP = null;
function loadReaderLibs() {
  if (window.orosFeedsCore && window.orosFeedsFetch && window.orosFeedsExtract && window.orosFeedsSanitize) {
    return Promise.resolve();
  }
  if (readerLibsP) return readerLibsP;
  readerLibsP = READER_LIBS.reduce((p, src) => p.then(() => new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src + "?v=" + SCRIPT_V;
    s.onload = () => res();
    s.onerror = () => rej(new Error("load"));
    document.head.appendChild(s);
  })), Promise.resolve()).catch((e) => { readerLibsP = null; throw e; });
  return readerLibsP;
}

/* The Reader's own relay setting (read only), else Mail's relay
   (fetch.js falls back to it by itself). */
function relayOpt() {
  try {
    const d = JSON.parse(localStorage.getItem("oros-feeds-data") || "null");
    const v = d && d.set && d.set.relay && d.set.relay.v;
    if (typeof v === "string" && v) return v;
  } catch (e) {}
  return "";
}

function diskApi() {
  try {
    const p = window.parent && window.parent !== window ? window.parent.orosFS : null;
    return p && typeof p.writeText === "function" && typeof p.readText === "function" ? p : null;
  } catch (e) { return null; }
}

function whyText(e) {
  const c = e && (e.code || e.message) || "";
  if (c === "http") return t("why.http", { c: e.extra || "?" });
  const k = "why." + c;
  return STR.en[k] ? t(k) : String(c || "?");
}

function arcImagesPref() {
  try { return localStorage.getItem("oros-bookmarks-arcimg") === "1"; } catch (e) { return false; }
}
function setArcImagesPref(on) {
  try { localStorage.setItem("oros-bookmarks-arcimg", on ? "1" : "0"); } catch (e) {}
}

function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
/* Only real raster pictures become data: URLs (the type comes from
   the bytes, not from the server). */
function sniffImage(b) {
  if (!b || b.length < 12) return "";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "";
}

/* "Keep pictures": each picture the site lets the browser read
   (CORS) goes inside the copy, so it reads offline; at most 30
   pictures, 1.5 MB each, 8 MB in all. The others stay links that
   show only online. The relay never carries pictures. */
function inlineImages(html) {
  const F = window.orosFeedsFetch;
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const imgs = Array.from(doc.querySelectorAll("img[src]"))
    .filter((im) => /^https?:/i.test(im.getAttribute("src"))).slice(0, 30);
  let total = 0;
  return imgs.reduce((p, im) => p.then(() => {
    if (total > 8e6) return;
    return F.direct(im.getAttribute("src"), { timeout: 15000 }).then((r) => {
      const b = r && r.status >= 200 && r.status < 300 ? r.bytes : null;
      const type = sniffImage(b);
      if (!type || b.length > 1.5e6 || total + b.length > 8e6) return;
      total += b.length;
      im.setAttribute("src", "data:" + type + ";base64," + bytesToB64(b));
    }, () => {});
  }), Promise.resolve()).then(() => doc.body.firstChild.innerHTML);
}

/* Fetch the page (Reader pipeline), keep the article, sanitise it,
   write one HTML file to the orOS disk. The slice only learns the
   file name and when (item.arch, a side record). */
function saveCopy(id, withImages) {
  const it = state.items[id];
  const fs = diskApi();
  if (!it) return Promise.reject({ code: "gone" });
  if (!fs) return Promise.reject({ code: "nodisk" });
  if (!navigator.onLine) return Promise.reject({ code: "offline" });
  const url = it.url;
  let ex = null;
  return loadReaderLibs().then(() =>
    window.orosFeedsFetch.fetchOne(url, { relay: relayOpt, timeout: 20000 })
  ).then((r) => {
    if (r.status < 200 || r.status >= 300 || !r.text) throw { code: "http", extra: r.status };
    ex = window.orosFeedsExtract(r.text, r.finalUrl || url);
    if (!ex) throw { code: "nofull" };
    const clean = window.orosFeedsSanitize(ex.html, { base: ex.base || r.finalUrl || url, images: withImages });
    return withImages ? inlineImages(clean.html) : clean.html;
  }).then((html) => {
    const cur = state.items[id];
    if (!cur) throw { code: "gone" };
    const at = Date.now();
    const name = K.archiveName(cur);
    const doc = K.archiveDoc({ id: id, url: cur.url, title: cur.title || ex.title, at: at, html: html, img: withImages ? 1 : 0 });
    const old = cur.arch && cur.arch.f && cur.arch.f !== name ? cur.arch.f : "";
    return fs.writeText(ARCHIVE_DIR + "/" + name, doc).catch(() => { throw { code: "disk" }; }).then(() => {
      if (old) return fs.rm(ARCHIVE_DIR + "/" + old).catch(() => {});
    }).then(() => {
      const it2 = state.items[id];
      if (!it2) return;
      it2.arch = K.sanArch({ at: at, f: name, n: ex.chars, img: withImages ? 1 : 0 });
      save();
      renderList();
    });
  });
}

function removeCopy(id) {
  const it = state.items[id];
  const fs = diskApi();
  if (!it || !it.arch || !it.arch.f) return;
  const f = it.arch.f;
  it.arch = { at: Math.max(Date.now(), it.arch.at + 1), f: "" };
  save();
  closeReader();
  renderList();
  if (fs) fs.rm(ARCHIVE_DIR + "/" + f).catch(() => {});
  transientNote(t("arc.removed"));
}

/* Files of bookmarks that are deleted here (tombstone, no live
   bookmark points at the file) go too. Only tombstoned ids: a file
   whose bookmark merely has not synced to this device yet stays. */
let sweepTimer = null;
function scheduleSweep(ms) {
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(sweepArchive, ms || 12000);
}
function sweepArchive() {
  const fs = diskApi();
  if (!fs || typeof fs.ls !== "function") return;
  const used = new Set();
  Object.keys(state.items).forEach((id) => {
    const a = state.items[id].arch;
    if (a && a.f) used.add(a.f);
  });
  fs.ls(ARCHIVE_DIR).then((list) => {
    (list || []).forEach((en) => {
      if (!en || en.dir || used.has(en.name)) return;
      const id = K.archiveId(en.name);
      if (id && state.deleted[id] && !state.items[id]) fs.rm(ARCHIVE_DIR + "/" + en.name).catch(() => {});
    });
  }, () => {});
}

/* ---- Reader view (full screen inside the app) ---- */

let readerId = null;
let readerBusy = false;

function closeReader() {
  const box = $("#reader");
  if (!box || box.hidden) return;
  box.hidden = true;
  $("#rd-body").textContent = "";
  readerId = null;
}

function readerMsg(text) {
  const body = $("#rd-body");
  body.textContent = "";
  const p = document.createElement("p");
  p.className = "rd-msg";
  p.textContent = text;
  body.appendChild(p);
}

function cssVar(name, fb) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  const s = (v || "").trim();
  return /^[#a-zA-Z0-9(),.\s%-]{1,60}$/.test(s) ? s : fb;
}

function openReader(id, saveFirst) {
  const it = state.items[id];
  if (!it) return;
  if (!diskApi()) { transientNote(t("arc.nodisk")); return; }
  closeCtxMenu();
  readerId = id;
  $("#rd-title").textContent = it.title;
  $("#rd-meta").textContent = hostOf(it.url);
  $("#rd-img").checked = arcImagesPref();
  $("#reader").hidden = false;
  updateReaderTools();
  $("#rd-back").focus();
  if (saveFirst || !it.arch || !it.arch.f) readerSave();
  else showCopy();
}

function updateReaderTools() {
  const it = state.items[readerId];
  const has = !!(it && it.arch && it.arch.f);
  $("#rd-again").textContent = has ? t("arc.again") : t("arc.save");
  $("#rd-remove").hidden = !has;
  $("#rd-again").disabled = readerBusy;
}

function readerSave() {
  const id = readerId;
  if (!id || readerBusy) return;
  readerBusy = true;
  updateReaderTools();
  readerMsg(t("arc.saving"));
  const imgs = $("#rd-img").checked;
  setArcImagesPref(imgs);
  saveCopy(id, imgs).then(() => {
    readerBusy = false;
    if (readerId !== id) { transientNote(t("arc.saved")); return; }
    updateReaderTools();
    showCopy();
  }, (e) => {
    readerBusy = false;
    if (readerId !== id) return;
    updateReaderTools();
    readerMsg(e && e.code === "nofull" ? t("arc.none")
      : e && e.code === "nodisk" ? t("arc.nodisk")
      : t("arc.err", { why: whyText(e) }));
  });
}

/* The stored file is read back and sanitised AGAIN before it is
   shown (it lives on a disk that syncs), then framed like the
   Reader does: sandbox without scripts, opaque origin, CSP. */
function showCopy() {
  const id = readerId;
  const it = state.items[id];
  const fs = diskApi();
  if (!it || !fs || !it.arch || !it.arch.f) return;
  const arch = it.arch;
  readerMsg("…");
  Promise.all([loadReaderLibs(), fs.readText(ARCHIVE_DIR + "/" + arch.f)]).then((r) => {
    if (readerId !== id) return;
    const rec = K.readArchive(r[1]);
    if (!rec) { readerMsg(t("arc.missing")); return; }
    const clean = window.orosFeedsSanitize(rec.html, { base: rec.url || it.url, images: arch.img === 1 });
    $("#rd-meta").textContent = hostOf(it.url) + " · " +
      t("arc.when", { d: new Date(arch.at).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric" }) });
    const body = $("#rd-body");
    body.textContent = "";
    body.appendChild(readerFrame(rec.title || it.title, it.url, clean.html, arch.img === 1));
  }, () => { if (readerId === id) readerMsg(t("arc.missing")); });
}

function readerFrame(title, url, html, images) {
  const E = esc;
  const bg = cssVar("--bg", "#1a1a1a"), fg = cssVar("--text", "#eee"), dim = cssVar("--text-dim", "#999"),
        acc = cssVar("--accent", "#4a9eff"), border = cssVar("--border", "#333"), panel = cssVar("--panel-bg", "#222");
  const light = document.documentElement.getAttribute("data-theme") === "light";
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:" + (images ? " https: http:" : "") +
              "; media-src https: http:; form-action 'none'; frame-src 'none'; font-src 'none'";
  const css = "html{background:" + bg + ";color-scheme:" + (light ? "light" : "dark") + "}" +
    "body{margin:0 auto;max-width:720px;padding:16px 18px 48px;font:17px/1.65 Georgia,'Noto Serif','Times New Roman',serif;" +
    "color:" + fg + ";overflow-wrap:anywhere}" +
    "h1{font:700 1.4em/1.25 'Nunito','Segoe UI',system-ui,sans-serif;margin:0 0 4px}h1 a{color:inherit;text-decoration:none}" +
    ".src{font:13px/1.4 'Nunito','Segoe UI',system-ui,sans-serif;color:" + dim + ";margin:0 0 18px}" +
    "h2,h3,h4{line-height:1.3}a{color:" + acc + "}" +
    "img,video{max-width:100%;height:auto;border-radius:6px}figure{margin:1em 0}figcaption{font-size:.85em;color:" + dim + "}" +
    "blockquote{margin:1em 0;padding-left:14px;border-left:3px solid " + acc + ";color:" + dim + "}" +
    "pre{white-space:pre-wrap;background:" + panel + ";padding:10px;border-radius:6px;font-size:.85em}" +
    "table{max-width:100%;border-collapse:collapse;display:block;overflow-x:auto}" +
    "td,th{border:1px solid " + border + ";padding:4px 8px}hr{border:0;border-top:1px solid " + border + "}" +
    ".embed{padding:10px 12px;border:1px solid " + border + ";border-radius:8px}";
  const doc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">" +
    "<meta name=\"referrer\" content=\"no-referrer\"><base target=\"_blank\">" +
    "<style>" + css + "</style></head><body dir=\"auto\"><h1><a href=\"" + E(url) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
    E(title) + "</a></h1><p class=\"src\">" + E(hostOf(url)) + "</p>" + html + "</body></html>";
  const fr = document.createElement("iframe");
  fr.className = "rd-frame";
  fr.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  fr.setAttribute("referrerpolicy", "no-referrer");
  fr.setAttribute("title", title);
  fr.srcdoc = doc;
  return fr;
}

function wireReader() {
  $("#rd-back").addEventListener("click", closeReader);
  $("#rd-open").addEventListener("click", () => { if (readerId) openItem(readerId); });
  $("#rd-again").addEventListener("click", readerSave);
  $("#rd-remove").addEventListener("click", () => { if (readerId) removeCopy(readerId); });
  $("#rd-img").addEventListener("change", (e) => setArcImagesPref(e.target.checked));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#reader").hidden && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      closeReader();
    }
  });
}

/* ---- Link check: on request, 10 links per call, a pause between ---- */

let chkRun = null;

function runCheck(ids) {
  if (chkRun) { transientNote(t("chk.busy")); return; }
  ids = (ids || []).filter((id) => state.items[id]).slice(0, 500);
  if (!ids.length) { transientNote(t("chk.none")); return; }
  if (!navigator.onLine) { transientNote(t("chk.offline")); return; }
  const run = chkRun = { stop: false };
  const tally = { n: 0, dead: 0, moved: 0, err: 0 };
  const stopBtn = { label: t("chk.stop"), fn: () => { run.stop = true; } };
  let i = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const finish = () => {
    chkRun = null;
    save();
    renderList();
    if (ids.length === 1) {
      const it = state.items[ids[0]];
      if (it && it.chk) transientNote(t("chk.line", { s: t("chk.s." + it.chk.s) + (it.chk.code ? " (" + it.chk.code + ")" : ""), when: relTime(it.chk.at) }));
      else hideToast();
      return;
    }
    const msg = run.stop && i < ids.length ? t("chk.stopped", { n: tally.n })
      : t("chk.done", { n: tally.n, d: tally.dead, m: tally.moved, e: tally.err });
    showToast(msg, tally.dead + tally.moved ? { action: { label: t("chk.show"), fn: () => setBadFilter(true) } } : undefined);
  };
  const step = () => {
    if (run.stop || i >= ids.length) return finish();
    const chunk = ids.slice(i, i + 10).filter((id) => state.items[id]);
    i += 10;
    if (ids.length > 1) showToast(t("chk.running", { i: Math.min(i, ids.length), n: ids.length }), { action: stopBtn });
    const F = window.orosFeedsFetch;
    return F.fetchFeeds(chunk.map((id) => ({ url: state.items[id].url })), { relay: relayOpt, timeout: 15000 }).then((res) => {
      const now = Date.now();
      res.forEach((a, k) => {
        const it = state.items[chunk[k]];
        if (!it || !a) return;
        if (a.err === "offline") { run.stop = true; return; }
        if (a.err === "norelay") { tally.n++; tally.err++; return; }   // not known: nothing stored
        const c = K.sanChk(Object.assign({ at: now }, K.classify(it.url, a)));
        if (!c) return;
        it.chk = c;                          // side record: "modified" stays
        tally.n++;
        if (c.s === "dead") tally.dead++;
        else if (c.s === "moved") tally.moved++;
        else if (c.s === "err" || c.s === "skip") tally.err++;
      });
      save();
      renderList();
      if (i < ids.length && !run.stop) return wait(2000).then(step);
      return finish();
    });
  };
  loadReaderLibs().then(() => {
    if (ids.length > 1 && !window.orosFeedsFetch.relayAvailable({ relay: relayOpt })) transientNote(t("chk.norelay"));
    return step();
  }).catch(() => { chkRun = null; transientNote(t("chk.offline")); });
}

function useNewAddress(id) {
  const it = state.items[id];
  if (!it || !it.chk || it.chk.s !== "moved" || !it.chk.to) return;
  const norm = normalizeUrl(it.chk.to);
  if (!norm) return;
  const dup = findByUrl(norm);
  if (dup && dup.id !== id) {
    transientNote(t("added.dup", { f: folderPathName(dup.folderId) }));
    return;
  }
  snapshotForUndo([id]);
  it.url = norm;
  it.modified = Date.now();
  it.chk = K.sanChk({ s: "ok", at: Date.now(), code: it.chk.code });
  save();
  renderAll();
  showToast(t("chk.used"), { action: { label: t("undo"), fn: undoFromSnapshot } });
}

/* All bookmarks of a folder and its subfolders. */
function idsUnder(fid) {
  const set = new Set([fid].concat(subfolderIds(fid)));
  return Object.keys(state.items).filter((id) => set.has(state.items[id].folderId));
}

/* The tidy-up button: link check, the broken-links filter, duplicates. */
function showToolsMenu() {
  closeCtxMenu();
  const btn = $("#dupes-btn");
  const m = document.createElement("div");
  m.id = "ctx-menu";
  const row = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => { closeCtxMenu(); fn(); });
    m.appendChild(b);
  };
  if (uiActiveFolder !== "ALL_VIEW" && state.folders[uiActiveFolder]) {
    row(t("chk.folder"), () => runCheck(idsUnder(uiActiveFolder)));
  }
  row(t("chk.all"), () => runCheck(Object.keys(state.items)));
  const bad = Object.keys(state.items).filter((id) => isBad(state.items[id])).length;
  row(t("chk.show") + (bad ? " (" + bad + ")" : ""), () => setBadFilter(true));
  const sep = document.createElement("div");
  sep.className = "sep";
  m.appendChild(sep);
  row(t("dupe.title"), showDupesPanel);
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), mr = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - mr.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - mr.height - 8)) + "px";
  setTimeout(() => {
    document.addEventListener("click", closeCtxMenu, true);
    window.addEventListener("scroll", closeCtxMenu, true);
  }, 0);
}

/* ===== 10. MERGE ENGINE (deterministic, clock-free) ===== */

/* Union merge by entity id:
   - newest "modified" wins per entity
   - identical mtimes → lexicographic canon() tie-break
   - tombstone beats an older entity; an entity modified AFTER
     its tombstone resurrects (that is how Undo survives sync)
   Both devices run this function on identical inputs, so the
   output converges without any coordination. */

function mergeBookmarks(aRaw, bRaw) {
  const A = aRaw || { items: {}, folders: {}, deleted: {}, settings: {} };
  const B = bRaw || { items: {}, folders: {}, deleted: {}, settings: {} };

  const out = { ver: 1, items: {}, folders: {}, deleted: {}, settings: {} };

  /* Deleted map: union, newest timestamp. */
  const delIds = new Set(
    Object.keys(A.deleted || {}).concat(Object.keys(B.deleted || {})));
  delIds.forEach((id) => {
    out.deleted[id] = Math.max(A.deleted[id] || 0, B.deleted[id] || 0);
  });

  function winner(a, b) {
    if (!a) return b;
    if (!b) return a;
    if ((b.modified || 0) !== (a.modified || 0))
      return (b.modified || 0) > (a.modified || 0) ? b : a;
    /* For manual reorders (pos-only changes), modified is equal
       on both sides — smaller pos wins (top-of-list preference). */
    if (a.pos !== b.pos) return (a.pos ?? 0) < (b.pos ?? 0) ? a : b;
    return canon(b) >= canon(a) ? b : a;
  }

  /* Entities whose sync-resurrection logic applies:
     tombstone only wins while it is newer than the entity. */
  function place(kind, map) {
    const ids = new Set(
      Object.keys(A[kind] || {}).concat(Object.keys(B[kind] || {})));
    ids.forEach((id) => {
      const a = A[kind] && A[kind][id], b = B[kind] && B[kind][id];
      let ent = winner(a, b);
      if (!ent) return;
      /* BM-2: visit counters are not content — they merge by max on
         their own, whichever side won the "modified" race. */
      if (kind === "items" && a && b) {
        ent = Object.assign({}, ent, {
          visits: Math.max(parseInt(a.visits, 10) || 0, parseInt(b.visits, 10) || 0),
          lastVisit: Math.max(Number(a.lastVisit) || 0, Number(b.lastVisit) || 0)
        });
        /* Wave 35: link check and saved copy merge on their own by
           "at", whichever side won (an older app drops them, the
           newer side keeps them). */
        const chk = K.sideMerge(K.sanChk(a.chk), K.sanChk(b.chk));
        const arch = K.sideMerge(K.sanArch(a.arch), K.sanArch(b.arch));
        if (chk) ent.chk = chk; else delete ent.chk;
        if (arch) ent.arch = arch; else delete ent.arch;
      }
      const death = out.deleted[id] || 0;
      if (death && (ent.modified || 0) <= death) return;  // stays dead
      if (death) delete out.deleted[id];                  // resurrected
      map[id] = ent;
    });
  }

  place("folders", out.folders);
  place("items", out.items);

  /* Root folder is immortal. */
  if (!out.folders[ROOT_FOLDER]) {
    out.folders[ROOT_FOLDER] =
      { id: ROOT_FOLDER, name: ROOT_FOLDER, pos: 0, modified: 0 };
    delete out.deleted[ROOT_FOLDER];
  }

  /* Deterministic settings pick — lexicographic JSON tie-break,
     symmetric on both devices (Object.assign was remote-wins =
     divergent). Empty settings lose to non-empty. */
  const sa = JSON.stringify(A.settings || {}),
        sb = JSON.stringify(B.settings || {});
  out.settings = (sa === "{}") ? (B.settings || {})
               : (sb === "{}") ? (A.settings || {})
               : (sb >= sa ? (B.settings || {}) : (A.settings || {}));
  return canonState(out);      // re-checks folder refs + drops junk (BM-1)
}

/* ===== 11. SYNC SLICE REGISTRATION ===== */

function registerSync(retries) {
  let host = window.orosSync;
  if (!host) {
    try { host = window.parent.orosSync; } catch (e) { /* standalone */ }
  }
  if (host && typeof host.registerSlice === "function") {
    host.registerSlice(
      "bookmarks",
      function getState() { return canonState(state); },   // BM-1: canonical copy
      function setState(remoteRaw) {
        if (typeof remoteRaw === "string") {
          try { remoteRaw = JSON.parse(remoteRaw); } catch (e) { return; }
        }
        const before = JSON.stringify(state);
        state = mergeBookmarks(state, remoteRaw);
        save(false);                     // no dirty echo — pull path
        if (JSON.stringify(state) !== before) renderAll();
      },
      DATA_KEY,
      mergeBookmarks
    );
  } else if (retries < 40) {
    /* The shell may still be loading sync.js — retry ~20s max. */
    setTimeout(() => registerSync(retries + 1), 500);
  }
}

/* ===== 12. WIRE + BOOT ===== */

function wire() {
  /* Quick-add */
  $("#quick-add-btn").addEventListener("click", quickAdd);
  $("#quick-add").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); quickAdd(); }
  });

  wireSearch();
  /* Sort dropdown */
  loadSortPreference();
  $("#sort-select").value = uiSortMode;
  $("#sort-select").addEventListener("change", (e) => {
    setSortMode(e.target.value);
  });
  wireTagEditor();
  $("#tags-btn").addEventListener("click", showTagsPanel);
  /* Duplicate finder — button is optional in HTML (guarded). */
  /* Wave 35: it opens the tidy-up menu (link check, broken links,
     duplicates). */
  const dupesBtn = $("#dupes-btn");
  if (dupesBtn) dupesBtn.addEventListener("click", showToolsMenu);
  wireReader();

  /* Selection mode */
  $("#select-btn").addEventListener("click", () => {
    if (selectionMode) exitSelectionMode();
    else enterSelectionMode();
  });
  $("#sel-done").addEventListener("click", exitSelectionMode);
  $("#sel-delete").addEventListener("click", bulkDelete);
  $("#sel-move").addEventListener("click", bulkMoveMenu);
  $("#sel-share").addEventListener("click", () => {
    if (selectedIds.size) shareItems(Array.from(selectedIds));
  });

  /* Typing in search while selecting exits selection mode
     (mixing the two is a foot-gun for destructive ops). */
  $("#search").addEventListener("input", () => {
    if (selectionMode) exitSelectionMode();
  });

  /* Import (file picker in — fully offline, orosDialog first) */
  $("#import-btn").addEventListener("click", async () => {
    const dlg = dialogHost();
    let file = null;
    const accept = ".html,.htm,.csv,text/html,text/csv";
    if (dlg && typeof dlg.openFile === "function") {
      file = await dlg.openFile(accept);
    } else {
      file = await localPickFile(accept);
    }
    if (!file) return;                // cancel — silent exit
    try {
      /* Wave 35: browsers, Linkding, Pinboard, Pocket (HTML / CSV),
         Raindrop (HTML / CSV): core.parseImport tells them apart. */
      applyImport(K.parseImport(await file.text(), file.name || "", importNames()));
    } catch (err) {
      transientNote(t("import.none"));
    }
  });

  /* Export */
  $("#export-btn").addEventListener("click", exportNetscape);

  /* Import from Raindrop.io (wave 6C): only inside the orOS shell */
  wirePlatforms();

  /* Folders */
  $("#folder-settings").addEventListener("click", () =>
    openFolderDialog("edit",
      uiActiveFolder === "ALL_VIEW" ? ROOT_FOLDER : uiActiveFolder));
  $("#tab-add").addEventListener("click",
    () => openFolderDialog("create"));

  /* Item dialog */
  $("#item-form").addEventListener("submit", (e) => {
    const norm = normalizeUrl($("#f-url").value);
    if (!norm) { e.preventDefault(); $("#f-url").focus(); return; }
    /* Duplicate guard: editing may not collide with another
       bookmark's address — same rule as quick-add. */
    const dup = findByUrl(norm);
    if (dup && dup.id !== editingItemId) {
      e.preventDefault();             // keep the dialog open for a fix
      const fld = state.folders[dup.folderId];
      transientNote(t("added.dup", { f: fld ? folderPathName(fld.id) : "" }));
      $("#f-url").focus();
      return;
    }
    submitItemDialog(norm);            // dialog closes via method="dialog"
  });
  $("#f-delete").addEventListener("click", () => {
    const id = editingItemId;
    editingItemId = null;
    $("#dlg-item").close();
    deleteItem(id);
  });

  /* "Follow in Reader": Reader opens its feed discovery for this
     address (shell deep link). Works for a saved link and in add mode;
     unsaved edits in the dialog are left behind, like Cancel. */
  const openAt = (() => {
    try { return window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent.__orosOpenAt : null; }
    catch (e) { return null; }
  })();
  $("#f-follow").hidden = !openAt;
  $("#f-follow").addEventListener("click", () => {
    const norm = normalizeUrl($("#f-url").value);
    if (!norm || !openAt) { $("#f-url").focus(); return; }
    editingItemId = null;
    $("#dlg-item").close();
    openAt("feeds", { add: { url: norm } });
  });

  /* "QR code": the QR app makes a new code from the SAVED bookmark
     (shell deep link; only the id travels). Unsaved edits in the
     dialog are left behind, like Cancel. */
  $("#f-qr").addEventListener("click", () => {
    const id = editingItemId, go = shellOpenAt();
    if (!id || !go) return;
    editingItemId = null;
    $("#dlg-item").close();
    go("qr", { from: "bookmarks", id: id });
  });

  /* Folder dialog */
  $("#folder-form").addEventListener("submit", (e) => {
    const name = sanText($("#l-name").value, 64);
    if (!name) { e.preventDefault(); return; }
    submitFolderDialog(name);
  });
  $("#l-delete").addEventListener("click", () => {
    if (!folderArmDelete) {            // two-step confirm, in-dialog
      folderArmDelete = true;
      updateFolderDeleteLabel();
    } else {
      deleteFolderNow();
    }
  });
  $("#dlg-folder").addEventListener("close", () => {
    folderArmDelete = false;
  });

  /* Add mode ends with the dialog, however it closes. */
  $("#dlg-item").addEventListener("close", () => {
    if (!editingNew) return;
    editingNew = false;
    $("#dlg-item h3").textContent = t("item.title");
    $("#f-delete").hidden = false;
  });

  wireSendDialog();

  /* Close dialogs on backdrop click (orOS convention) */
  ["#dlg-item", "#dlg-folder", "#dlg-send", "#dlg-pick"].forEach((sel) => {
    $(sel).addEventListener("click", (e) => {
      if (e.target === $(sel)) $(sel).close();
    });
  });
}

function boot() {
  load();
  applyI18n();
  wire();
  mountFavStrip();
  registerSync(0);
  scheduleSweep(6000);
  renderAll();
  inheritPalette();
  watchPalette();
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      const t = window.parent.__orosTakeTarget("bookmarks");
      if (t) openSearchTarget(t);
    }
  } catch (e) {}
}

/* Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
   target { id }, or { add: { url, title } } from "Send to orOS"
   (see openAddDialog). { id } shows the bookmark's folder with no filter, scrolls
   to its row and opens its dialog. Unknown id, or a dialog already
   open (maybe with unsaved edits) → no-op. */
function openSearchTarget(t) {
  if (t && !document.querySelector("dialog[open]")) closeReader();
  if (t && t.addMany && typeof t.addMany === "object") {
    addManyTarget(t.addMany);
    return;
  }
  if (t && t.add && typeof t.add === "object") {
    if (!document.querySelector("dialog[open]")) openAddDialog(t.add);
    return;
  }
  const it = t && typeof t.id === "string" ? state.items[t.id] : null;
  if (!it || document.querySelector("dialog[open]")) return;
  uiActiveFolder = state.folders[it.folderId] ? it.folderId : ROOT_FOLDER;
  uiQuery = "";
  const q = $("#search");
  if (q) q.value = "";
  const qc = $("#search-clear");
  if (qc) qc.hidden = true;
  renderAll();
  const row = document.querySelector('#items li.item[data-id="' + CSS.escape(it.id) + '"]');
  if (row) row.scrollIntoView({ block: "center" });
  openItemDialog(it.id);
}
window.__orosOpenAt = openSearchTarget;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

})();