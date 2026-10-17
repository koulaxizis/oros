// ============================================================
// orOS Mind Map — App logic (v1.2.0)
// Mind maps: a centre, branches on both sides (or the right
// only), always laid out neatly. Drag a node onto another to move
// it, edit in place, fold branches, switch to an outline view,
// export PNG / SVG / Markdown / OPML / JSON, import OPML,
// Markdown or indented lists.
// Phase 2 (v1.1.0): cross-links with labels, free placement (drop a
// node on empty space: it keeps an offset from its automatic place),
// small pictures in nodes (re-encoded JPEG data URIs, ~1 MB budget).
// Data:
//   - synced slice "mindmap" (oros-mindmap-data): MINDMAP v1, see
//     mm-core.js (LWW per entity + tombstones, R5, R17, R26)
//   - device-local (R10): oros-mindmap-prefs ({map, view,
//     fold{mapId:[ids]}, exp{}}), oros-mindmap-data-broken
// Folding is a VIEW of the map, so it stays on the device: a click
// on a fold badge never writes to the sync slice.
// Pure logic (normalize, merge, resolve, layout, import, SVG)
// lives in mm-core.js (window.MMCore) and is unit-tested in node.
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage, prefs
//   3. Mutations + undo / redo (stamp at the mutation site, R27)
//   4. Map view: render, camera, pointer (select, drag, pinch)
//  4b. Free placement + cross-links
// Wave 27 (v1.2.0): node styles (shape, fill, border, text size),
// quick icons, boundaries / summaries around sibling ideas, layouts
// (map, org chart, tree, timeline) and a full-screen presentation
// (sections 8b, 8c).
//   5. In-place editor
//   6. Keyboard (map view) + clipboard
//   7. Outline view
//   8. Node details dialog, context menu, node bar
//   9. Maps dialog, new map, paste a list
//  10. Find
//  11. Export (PNG, SVG, Markdown, OPML, JSON, print, Files) + import
//  12. Menus, dialogs, toasts
//  13. Sync slice + palette
//  14. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var M = window.MMCore;
  var STORAGE_KEY = "oros-mindmap-data";
  var PREFS_KEY   = "oros-mindmap-prefs";
  var SVGNS = "http://www.w3.org/2000/svg";
  var FONT = "Nunito, 'Segoe UI', system-ui, -apple-system, sans-serif";
  var UNDO_MAX = 100;

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
      "view.map": "Map", "view.outline": "Outline",
      "btn.undo": "Undo", "btn.redo": "Redo", "btn.find": "Find", "btn.fit": "Fit to screen",
      "btn.more": "More", "btn.zoomIn": "Zoom in", "btn.zoomOut": "Zoom out",
      "maps.title": "Your mind maps", "maps.none": "No map", "maps.new": "New map", "maps.search": "Search maps",
      "maps.nodes": "{n} nodes", "maps.rename": "Rename {name}", "maps.copy": "Duplicate {name}",
      "maps.del": "Delete {name}", "maps.copyName": "{name} (copy)", "untitled": "Untitled map",
      "empty.text": "Start a mind map: one idea in the centre, branches around it.",
      "empty.new": "New map", "empty.example": "Show an example", "empty.import": "Import…",
      "new.title": "New map", "new.label": "Central idea", "new.ph": "e.g. Plan the party",
      "rename.title": "Rename map", "ok": "OK", "cancel": "Cancel", "save": "Save", "close": "Close",
      "nb.child": "Child", "nb.sibling": "Sibling", "nb.edit": "Edit", "nb.details": "Details",
      "nb.fold": "Fold", "nb.unfold": "Unfold", "nb.delete": "Delete",
      "ctx.child": "Add child", "ctx.sibling": "Add sibling", "ctx.edit": "Edit text", "ctx.details": "Details…",
      "ctx.fold": "Fold branch", "ctx.unfold": "Unfold branch", "ctx.done": "Mark as done", "ctx.undone": "Mark as not done",
      "ctx.up": "Move up", "ctx.down": "Move down", "ctx.copy": "Copy as text", "ctx.paste": "Paste a list here…",
      "ctx.keep": "Keep it here", "ctx.delete": "Delete branch", "ctx.export": "Export this branch…",
      "det.title": "Node details", "det.text": "Text", "det.emoji": "Emoji or symbol", "det.color": "Branch colour",
      "det.auto": "Automatic", "det.done": "Done", "det.note": "Note", "det.url": "Link (web address)",
      "det.open": "Open link", "det.badUrl": "Only web addresses (https://…) can be links",
      "det.rec": "This node came back after two devices changed the map at the same time (its place was deleted on the other one). Drag it where it belongs, or keep it here.",
      "col.red": "Red", "col.orange": "Orange", "col.yellow": "Yellow", "col.green": "Green", "col.teal": "Teal",
      "col.violet": "Violet", "col.pink": "Pink", "col.grey": "Grey",
      "menu.new": "New map", "menu.maps": "Your maps…", "menu.paste": "Paste a list…", "menu.export": "Export…",
      "menu.copy": "Copy map as text", "menu.import": "Import (orOS, FreeMind, XMind, SimpleMind, MindManager, OPML, Markdown, text, JSON)…",
      "menu.folder": "Unzipped orOS folder…", "exp.oros": "orOS file (.orosmind)",
      "imp.err.newer": "This file was made by a newer orOS. Update orOS to open it.",
      "menu.backup": "Back up all maps (JSON)", "menu.present": "Present", "menu.layout": "Layout…",
      "menu.unfoldAll": "Unfold all", "menu.foldAll": "Fold main branches",
      "menu.keys": "Keyboard shortcuts",
      "paste.title": "Paste a list", "paste.hint": "One idea per line. Indent with spaces or tabs (or use Markdown “- ” lists and # headings) to make branches.",
      "paste.under": "It goes under: {name}", "paste.newMap": "It becomes a new map.", "paste.add": "Add",
      "find.ph": "Find in this map", "find.none": "No match", "find.prev": "Previous match", "find.next": "Next match",
      "find.close": "Close find",
      "exp.title": "Export", "exp.scope": "What", "exp.whole": "Whole map", "exp.branch": "Selected branch",
      "exp.format": "Format", "exp.theme": "Colours", "exp.light": "Light", "exp.dark": "Dark",
      "exp.transparent": "Transparent background (PNG, SVG)", "exp.save": "Save…", "exp.files": "Save to Files",
      "exp.print": "Print", "exp.copy": "Copy as text",
      "imp.title": "Import a backup", "imp.stats": "{maps} maps, {nodes} nodes", "imp.dropped": "{n} damaged rows were skipped.",
      "imp.merge": "Maps you already have are merged: newer changes are kept and nothing you deleted comes back.",
      "imp.go": "Import", "imp.done": "Imported", "imp.newMap": "Imported as a new map",
      "imp.err.size": "The file is too big (max 5 MB)", "imp.err.json": "This is not a valid JSON file",
      "imp.err.format": "This file is not a mind map, outline or list", "imp.err.toolarge": "Too many maps or nodes in this file",
      "imp.err.empty": "Nothing to import in this file", "imp.err.read": "The file could not be read",
      "imp.err.zip": "This file is damaged or not a mind map from XMind, SimpleMind or MindManager", "imp.sheets": "Only the first of {n} sheets was imported",
      "keys.title": "Keyboard shortcuts",
      "keys.list": "Tab|Add a child\nEnter|Add a sibling\nF2 or type|Edit the selected node\nShift+Enter|New line while editing\nDelete|Delete the branch\nSpace|Fold or unfold\nArrows|Move around the map\nAlt+↑ / Alt+↓|Move the node up / down\nCtrl+Z / Ctrl+Y|Undo / redo\nCtrl+C / Ctrl+V|Copy a branch as text / paste a list\nCtrl+F|Find\n+ / − / Home|Zoom in / out / fit\n→ / ← (presenting)|Next / back; Esc ends",
      "ol.indent": "Indent", "ol.outdent": "Outdent", "ol.up": "Move up", "ol.down": "Move down", "ol.new": "New line",
      "ol.delete": "Delete", "ol.fold": "Fold or unfold",
      "toast.undo": "Undo", "toast.deleted": "Deleted “{name}”", "toast.deletedN": "Deleted “{name}” and {n} more",
      "toast.mapDeleted": "Map “{name}” deleted", "toast.root": "The centre can't be deleted. Delete the map from Your maps.",
      "toast.save": "Couldn't save: storage is full. Free up space (Files, Notes or images).",
      "toast.exported": "Exported", "toast.saved": "Saved to Files", "toast.noFiles": "Files is not available",
      "toast.copied": "Copied", "toast.copyFail": "Couldn't copy: your browser blocked the clipboard",
      "toast.pngBig": "Too big for PNG: export SVG instead", "toast.nothing": "Nothing to undo", "toast.noRedo": "Nothing to redo",
      "toast.noMove": "A branch can't go inside itself", "toast.selectFirst": "Select a node first",
      "toast.tooMany": "This map is at its size limit", "toast.noPrev": "There is no line above to indent under",
      "live.sel": "Selected: {name}", "live.moved": "Moved under {name}", "empty.node": "(empty)",
      "live.link": "Link selected", "live.placed": "Placed here",
      "ctx.link": "Link to another node…", "ctx.resetPos": "Back to its place", "menu.tidy": "Tidy up (all back in place)",
      "toast.tidied": "All nodes are back in place", "toast.linkDeleted": "Link deleted",
      "link.pick": "Tap the node to link “{name}” to", "link.self": "Pick another node",
      "link.dup": "These two are already linked", "link.title": "Link", "link.label": "Label (optional)",
      "link.ph": "e.g. depends on", "link.noLabel": "No label", "link.edit": "Label", "link.reverse": "Reverse",
      "link.goFrom": "Go to the start", "link.goTo": "Go to the end", "link.delete": "Delete link",
      "app.name": "Mind Map", "ctx.todo": "Send to To-Do…", "ctx.slides": "Make slides from this branch…",
      "menu.slides": "Make slides from this map…", "toast.noBridge": "That app can't take it yet",
      "toast.todoNone": "Nothing to send (done items are left out)", "toast.todoMany": "Too many items for one list (at most {n})",
      "toast.slidesBig": "This branch is too big for one deck",
      "ctx.sendApp": "Send to an app…",
      "ctx.notes": "Save as a note", "menu.notes": "Save the map as a note",
      "toast.notesBig": "This branch is too long for one note", "toast.notesSent": "Saved “{name}” in Notes",
      "det.pic": "Picture", "det.picAdd": "Choose picture", "det.picDel": "Remove picture",
      "toast.picBudget": "Picture space is full (about 1 MB for all pictures)", "toast.picBad": "Could not read that image",
      "ctx.style": "Style…", "ctx.copyStyle": "Copy style", "ctx.pasteStyle": "Paste style",
      "ctx.frame": "Add a boundary or summary…", "ctx.present": "Present from here", "nb.style": "Style",
      "det.icons": "Quick icons",
      "sty.title": "Node style", "sty.shape": "Shape", "sty.fill": "Fill", "sty.border": "Border", "sty.size": "Text size",
      "sty.bold": "Bold text", "sty.branch": "Apply to the whole branch", "sty.reset": "Reset style",
      "shape.auto": "Automatic", "shape.rect": "Rectangle", "shape.round": "Rounded", "shape.pill": "Pill",
      "shape.ellipse": "Ellipse", "shape.diamond": "Diamond", "shape.hex": "Hexagon", "shape.line": "Underline", "shape.none": "Text only",
      "fill.auto": "Automatic", "fill.none": "None", "fill.tint": "Light", "fill.solid": "Solid",
      "border.auto": "Automatic", "border.none": "None", "border.thin": "Thin", "border.thick": "Thick", "border.dashed": "Dashed",
      "size.s": "Small", "size.m": "Normal", "size.l": "Large",
      "toast.styleCopied": "Style copied. Choose “Paste style” on another node.",
      "fr.new": "New boundary or summary", "fr.editT": "Boundary or summary", "fr.edit": "Edit", "fr.delete": "Delete",
      "fr.kind": "Type", "fr.boundary": "Boundary", "fr.summary": "Summary", "fr.label": "Label (optional)", "fr.ph": "e.g. Phase 1",
      "fr.color": "Colour", "fr.members": "Ideas inside", "fr.none": "Tick at least one idea", "fr.many": "At most {n} ideas",
      "live.frame": "Boundary selected", "toast.boundaryDeleted": "Boundary deleted", "toast.summaryDeleted": "Summary deleted",
      "lay.title": "Layout", "lay.both": "Map", "lay.both.d": "Branches on both sides of the centre",
      "lay.right": "Map to the right", "lay.right.d": "All branches on the right",
      "lay.org": "Org chart", "lay.org.d": "From the top down, like a family tree",
      "lay.tree": "Tree", "lay.tree.d": "An indented list, like folders",
      "lay.time": "Timeline", "lay.time.d": "Main branches in a row, left to right",
      "pres.title": "Presentation", "pres.prev": "Back", "pres.next": "Next", "pres.end": "End presentation",
      "pres.start": "Presentation: arrow keys or a tap go on, Esc ends", "pres.overview": "The whole map"
    },
    el: {
      "view.map": "Χάρτης", "view.outline": "Περίγραμμα",
      "btn.undo": "Αναίρεση", "btn.redo": "Επανάληψη", "btn.find": "Εύρεση", "btn.fit": "Προσαρμογή στην οθόνη",
      "btn.more": "Περισσότερα", "btn.zoomIn": "Μεγέθυνση", "btn.zoomOut": "Σμίκρυνση",
      "maps.title": "Οι χάρτες σου", "maps.none": "Κανένας χάρτης", "maps.new": "Νέος χάρτης", "maps.search": "Αναζήτηση χαρτών",
      "maps.nodes": "{n} κόμβοι", "maps.rename": "Μετονομασία: {name}", "maps.copy": "Αντίγραφο: {name}",
      "maps.del": "Διαγραφή: {name}", "maps.copyName": "{name} (αντίγραφο)", "untitled": "Χάρτης χωρίς τίτλο",
      "empty.text": "Ξεκίνα έναν νοητικό χάρτη: μια ιδέα στο κέντρο και κλαδιά γύρω της.",
      "empty.new": "Νέος χάρτης", "empty.example": "Δείξε ένα παράδειγμα", "empty.import": "Εισαγωγή…",
      "new.title": "Νέος χάρτης", "new.label": "Κεντρική ιδέα", "new.ph": "π.χ. Οργάνωση του πάρτι",
      "rename.title": "Μετονομασία χάρτη", "ok": "OK", "cancel": "Άκυρο", "save": "Αποθήκευση", "close": "Κλείσιμο",
      "nb.child": "Παιδί", "nb.sibling": "Αδελφός", "nb.edit": "Κείμενο", "nb.details": "Στοιχεία",
      "nb.fold": "Σύμπτυξη", "nb.unfold": "Ανάπτυξη", "nb.delete": "Διαγραφή",
      "ctx.child": "Νέο παιδί", "ctx.sibling": "Νέος αδελφός", "ctx.edit": "Επεξεργασία κειμένου", "ctx.details": "Στοιχεία…",
      "ctx.fold": "Σύμπτυξη κλαδιού", "ctx.unfold": "Ανάπτυξη κλαδιού", "ctx.done": "Σήμανση ως έγινε", "ctx.undone": "Δεν έγινε ακόμα",
      "ctx.up": "Μετακίνηση πάνω", "ctx.down": "Μετακίνηση κάτω", "ctx.copy": "Αντιγραφή ως κείμενο", "ctx.paste": "Επικόλληση λίστας εδώ…",
      "ctx.keep": "Να μείνει εδώ", "ctx.delete": "Διαγραφή κλαδιού", "ctx.export": "Εξαγωγή αυτού του κλαδιού…",
      "det.title": "Στοιχεία κόμβου", "det.text": "Κείμενο", "det.emoji": "Emoji ή σύμβολο", "det.color": "Χρώμα κλαδιού",
      "det.auto": "Αυτόματο", "det.done": "Έγινε", "det.note": "Σημείωση", "det.url": "Σύνδεσμος (διεύθυνση web)",
      "det.open": "Άνοιγμα συνδέσμου", "det.badUrl": "Σύνδεσμος μπορεί να είναι μόνο διεύθυνση web (https://…)",
      "det.rec": "Αυτός ο κόμβος επανήλθε επειδή δύο συσκευές άλλαξαν τον χάρτη ταυτόχρονα (η θέση του σβήστηκε στην άλλη). Σύρε τον εκεί που ανήκει ή άφησέ τον εδώ.",
      "col.red": "Κόκκινο", "col.orange": "Πορτοκαλί", "col.yellow": "Κίτρινο", "col.green": "Πράσινο", "col.teal": "Γαλαζοπράσινο",
      "col.violet": "Μωβ", "col.pink": "Ροζ", "col.grey": "Γκρι",
      "menu.new": "Νέος χάρτης", "menu.maps": "Οι χάρτες σου…", "menu.paste": "Επικόλληση λίστας…", "menu.export": "Εξαγωγή…",
      "menu.copy": "Αντιγραφή χάρτη ως κείμενο", "menu.import": "Εισαγωγή (orOS, FreeMind, XMind, SimpleMind, MindManager, OPML, Markdown, κείμενο, JSON)…",
      "menu.folder": "Αποσυμπιεσμένος φάκελος orOS…", "exp.oros": "Αρχείο orOS (.orosmind)",
      "imp.err.newer": "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.",
      "menu.backup": "Αντίγραφο όλων των χαρτών (JSON)", "menu.present": "Προβολή κλαδί-κλαδί", "menu.layout": "Διάταξη…",
      "menu.unfoldAll": "Ανάπτυξη όλων", "menu.foldAll": "Σύμπτυξη κύριων κλαδιών",
      "menu.keys": "Συντομεύσεις πληκτρολογίου",
      "paste.title": "Επικόλληση λίστας", "paste.hint": "Μία ιδέα ανά γραμμή. Με εσοχή (κενά ή tab), ή με λίστες Markdown «- » και επικεφαλίδες #, γίνονται κλαδιά.",
      "paste.under": "Θα μπει κάτω από: {name}", "paste.newMap": "Θα γίνει νέος χάρτης.", "paste.add": "Προσθήκη",
      "find.ph": "Εύρεση σε αυτόν τον χάρτη", "find.none": "Κανένα αποτέλεσμα", "find.prev": "Προηγούμενο", "find.next": "Επόμενο",
      "find.close": "Κλείσιμο εύρεσης",
      "exp.title": "Εξαγωγή", "exp.scope": "Τι", "exp.whole": "Όλος ο χάρτης", "exp.branch": "Επιλεγμένο κλαδί",
      "exp.format": "Μορφή", "exp.theme": "Χρώματα", "exp.light": "Φωτεινά", "exp.dark": "Σκοτεινά",
      "exp.transparent": "Διάφανο φόντο (PNG, SVG)", "exp.save": "Αποθήκευση…", "exp.files": "Αποθήκευση στα Αρχεία",
      "exp.print": "Εκτύπωση", "exp.copy": "Αντιγραφή ως κείμενο",
      "imp.title": "Εισαγωγή αντιγράφου", "imp.stats": "{maps} χάρτες, {nodes} κόμβοι", "imp.dropped": "Παραλείφθηκαν {n} κατεστραμμένες εγγραφές.",
      "imp.merge": "Οι χάρτες που ήδη έχεις συγχωνεύονται: κρατιούνται οι νεότερες αλλαγές και δεν επιστρέφει τίποτα που έσβησες.",
      "imp.go": "Εισαγωγή", "imp.done": "Έγινε η εισαγωγή", "imp.newMap": "Εισήχθη ως νέος χάρτης",
      "imp.err.size": "Το αρχείο είναι πολύ μεγάλο (έως 5 MB)", "imp.err.json": "Δεν είναι έγκυρο αρχείο JSON",
      "imp.err.format": "Το αρχείο δεν είναι νοητικός χάρτης, περίγραμμα ή λίστα", "imp.err.toolarge": "Πάρα πολλοί χάρτες ή κόμβοι σε αυτό το αρχείο",
      "imp.err.empty": "Δεν υπάρχει κάτι για εισαγωγή σε αυτό το αρχείο", "imp.err.read": "Το αρχείο δεν διαβάστηκε",
      "imp.err.zip": "Το αρχείο είναι κατεστραμμένο ή δεν είναι χάρτης XMind, SimpleMind ή MindManager", "imp.sheets": "Εισήχθη μόνο το πρώτο από {n} φύλλα",
      "keys.title": "Συντομεύσεις πληκτρολογίου",
      "keys.list": "Tab|Νέο παιδί\nEnter|Νέος αδελφός\nF2 ή πληκτρολόγηση|Επεξεργασία του επιλεγμένου\nShift+Enter|Νέα γραμμή στην επεξεργασία\nDelete|Διαγραφή κλαδιού\nSpace|Σύμπτυξη ή ανάπτυξη\nΒελάκια|Κίνηση στον χάρτη\nAlt+↑ / Alt+↓|Μετακίνηση πάνω / κάτω\nCtrl+Z / Ctrl+Y|Αναίρεση / επανάληψη\nCtrl+C / Ctrl+V|Αντιγραφή κλαδιού ως κείμενο / επικόλληση λίστας\nCtrl+F|Εύρεση\n+ / − / Home|Μεγέθυνση / σμίκρυνση / προσαρμογή\n→ / ← (στην προβολή)|Επόμενο / πίσω· Esc για τέλος",
      "ol.indent": "Εσοχή", "ol.outdent": "Αφαίρεση εσοχής", "ol.up": "Πάνω", "ol.down": "Κάτω", "ol.new": "Νέα γραμμή",
      "ol.delete": "Διαγραφή", "ol.fold": "Σύμπτυξη ή ανάπτυξη",
      "toast.undo": "Αναίρεση", "toast.deleted": "Διαγράφηκε το «{name}»", "toast.deletedN": "Διαγράφηκε το «{name}» και {n} ακόμα",
      "toast.mapDeleted": "Ο χάρτης «{name}» διαγράφηκε", "toast.root": "Το κέντρο δεν διαγράφεται. Διάγραψε τον χάρτη από τους χάρτες σου.",
      "toast.save": "Η αποθήκευση απέτυχε: ο χώρος γέμισε. Ελευθέρωσε χώρο (Αρχεία, Σημειώσεις ή εικόνες).",
      "toast.exported": "Η εξαγωγή έγινε", "toast.saved": "Αποθηκεύτηκε στα Αρχεία", "toast.noFiles": "Τα Αρχεία δεν είναι διαθέσιμα",
      "toast.copied": "Αντιγράφηκε", "toast.copyFail": "Η αντιγραφή απέτυχε: ο browser μπλόκαρε το πρόχειρο",
      "toast.pngBig": "Πολύ μεγάλο για PNG: κάνε εξαγωγή σε SVG", "toast.nothing": "Δεν υπάρχει κάτι για αναίρεση", "toast.noRedo": "Δεν υπάρχει κάτι για επανάληψη",
      "toast.noMove": "Ένα κλαδί δεν μπαίνει μέσα στον εαυτό του", "toast.selectFirst": "Διάλεξε πρώτα έναν κόμβο",
      "toast.tooMany": "Ο χάρτης έφτασε το όριο μεγέθους", "toast.noPrev": "Δεν υπάρχει γραμμή από πάνω για να μπει από κάτω της",
      "live.sel": "Επιλογή: {name}", "live.moved": "Μετακινήθηκε κάτω από: {name}", "empty.node": "(κενό)",
      "live.link": "Επιλέχθηκε σύνδεσμος", "live.placed": "Τοποθετήθηκε εδώ",
      "ctx.link": "Σύνδεση με άλλον κόμβο…", "ctx.resetPos": "Πίσω στη θέση του", "menu.tidy": "Τακτοποίηση (όλα στη θέση τους)",
      "toast.tidied": "Όλοι οι κόμβοι γύρισαν στη θέση τους", "toast.linkDeleted": "Ο σύνδεσμος διαγράφηκε",
      "link.pick": "Πάτα τον κόμβο που θα συνδεθεί με το «{name}»", "link.self": "Διάλεξε άλλον κόμβο",
      "link.dup": "Αυτοί οι δύο είναι ήδη συνδεδεμένοι", "link.title": "Σύνδεσμος", "link.label": "Ετικέτα (προαιρετικά)",
      "link.ph": "π.χ. εξαρτάται από", "link.noLabel": "Χωρίς ετικέτα", "link.edit": "Ετικέτα", "link.reverse": "Αντιστροφή",
      "link.goFrom": "Πήγαινε στην αρχή", "link.goTo": "Πήγαινε στο τέλος", "link.delete": "Διαγραφή συνδέσμου",
      "app.name": "Νοητικός χάρτης", "ctx.todo": "Αποστολή στις Εργασίες…", "ctx.slides": "Παρουσίαση από αυτό το κλαδί…",
      "menu.slides": "Παρουσίαση από τον χάρτη…", "toast.noBridge": "Αυτή η εφαρμογή δεν μπορεί να το δεχτεί ακόμα",
      "toast.todoNone": "Δεν υπάρχει κάτι να σταλεί (όσα έγιναν μένουν έξω)", "toast.todoMany": "Πάρα πολλά για μία λίστα (έως {n})",
      "toast.slidesBig": "Το κλαδί είναι πολύ μεγάλο για μία παρουσίαση",
      "ctx.sendApp": "Στείλε σε εφαρμογή…",
      "ctx.notes": "Αποθήκευση ως σημείωση", "menu.notes": "Αποθήκευση του χάρτη ως σημείωση",
      "toast.notesBig": "Το κλαδί είναι πολύ μεγάλο για μία σημείωση", "toast.notesSent": "Το «{name}» αποθηκεύτηκε στις Σημειώσεις",
      "det.pic": "Εικόνα", "det.picAdd": "Επιλογή εικόνας", "det.picDel": "Αφαίρεση εικόνας",
      "toast.picBudget": "Ο χώρος για εικόνες γέμισε (περίπου 1 MB για όλες)", "toast.picBad": "Η εικόνα δεν διαβάστηκε",
      "ctx.style": "Στιλ…", "ctx.copyStyle": "Αντιγραφή στιλ", "ctx.pasteStyle": "Επικόλληση στιλ",
      "ctx.frame": "Προσθήκη πλαισίου ή σύνοψης…", "ctx.present": "Προβολή από εδώ", "nb.style": "Στιλ",
      "det.icons": "Γρήγορα εικονίδια",
      "sty.title": "Στιλ κόμβου", "sty.shape": "Σχήμα", "sty.fill": "Γέμισμα", "sty.border": "Περίγραμμα", "sty.size": "Μέγεθος κειμένου",
      "sty.bold": "Έντονο κείμενο", "sty.branch": "Εφαρμογή σε όλο το κλαδί", "sty.reset": "Επαναφορά στιλ",
      "shape.auto": "Αυτόματο", "shape.rect": "Ορθογώνιο", "shape.round": "Στρογγυλεμένο", "shape.pill": "Κάψουλα",
      "shape.ellipse": "Έλλειψη", "shape.diamond": "Ρόμβος", "shape.hex": "Εξάγωνο", "shape.line": "Υπογράμμιση", "shape.none": "Μόνο κείμενο",
      "fill.auto": "Αυτόματο", "fill.none": "Χωρίς", "fill.tint": "Απαλό", "fill.solid": "Γεμάτο",
      "border.auto": "Αυτόματο", "border.none": "Χωρίς", "border.thin": "Λεπτό", "border.thick": "Χοντρό", "border.dashed": "Διακεκομμένο",
      "size.s": "Μικρό", "size.m": "Κανονικό", "size.l": "Μεγάλο",
      "toast.styleCopied": "Το στιλ αντιγράφηκε. Διάλεξε «Επικόλληση στιλ» σε άλλον κόμβο.",
      "fr.new": "Νέο πλαίσιο ή σύνοψη", "fr.editT": "Πλαίσιο ή σύνοψη", "fr.edit": "Επεξεργασία", "fr.delete": "Διαγραφή",
      "fr.kind": "Είδος", "fr.boundary": "Πλαίσιο", "fr.summary": "Σύνοψη", "fr.label": "Ετικέτα (προαιρετικά)", "fr.ph": "π.χ. Φάση 1",
      "fr.color": "Χρώμα", "fr.members": "Ιδέες μέσα", "fr.none": "Τσέκαρε τουλάχιστον μία ιδέα", "fr.many": "Έως {n} ιδέες",
      "live.frame": "Επιλέχθηκε πλαίσιο", "toast.boundaryDeleted": "Το πλαίσιο διαγράφηκε", "toast.summaryDeleted": "Η σύνοψη διαγράφηκε",
      "lay.title": "Διάταξη", "lay.both": "Χάρτης", "lay.both.d": "Κλαδιά και στις δύο πλευρές του κέντρου",
      "lay.right": "Χάρτης προς τα δεξιά", "lay.right.d": "Όλα τα κλαδιά δεξιά",
      "lay.org": "Οργανόγραμμα", "lay.org.d": "Από πάνω προς τα κάτω, σαν γενεαλογικό δέντρο",
      "lay.tree": "Δέντρο", "lay.tree.d": "Λίστα με εσοχές, σαν φάκελοι",
      "lay.time": "Χρονολόγιο", "lay.time.d": "Τα κύρια κλαδιά στη σειρά, από αριστερά προς τα δεξιά",
      "pres.title": "Προβολή", "pres.prev": "Πίσω", "pres.next": "Επόμενο", "pres.end": "Τέλος προβολής",
      "pres.start": "Προβολή: τα βελάκια ή ένα πάτημα προχωρούν, το Esc τελειώνει", "pres.overview": "Όλος ο χάρτης"
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
  function clone(x) { return x ? JSON.parse(JSON.stringify(x)) : null; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function fold(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function label(n, max) { return n ? (M.title((n.emoji ? n.emoji + " " : "") + n.text, max || 60) || t("empty.node")) : "?"; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("mindmap.js v" + (m ? m[1] : "?") + " boot");
  })();

  function ic(body, fill) {
    return '<svg viewBox="0 0 24 24" fill="' + (fill ? "currentColor" : "none") + '" stroke="' + (fill ? "none" : "currentColor") +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";
  }
  var UI = {
    map:    ic('<circle cx="12" cy="12" r="3"/><circle cx="4" cy="5" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="19" r="2"/><path d="M6 6l3.5 4M18 6l-3.5 4M6 18l3.5-4M18 18l-3.5-4"/>'),
    chev:   ic('<path d="M6 9l6 6 6-6"/>'),
    undo:   ic('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo:   ic('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
    find:   ic('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
    fit:    ic('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    swap:   ic('<path d="M7 7h12l-3-3M17 17H5l3 3"/>'),
    more:   ic('<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>', true),
    plus:   ic('<path d="M12 5v14M5 12h14"/>'),
    minus:  ic('<path d="M5 12h14"/>'),
    x:      ic('<path d="M18 6L6 18M6 6l12 12"/>'),
    up:     ic('<path d="M18 15l-6-6-6 6"/>'),
    down:   ic('<path d="M6 9l6 6 6-6"/>'),
    child:  ic('<rect x="3" y="4" width="8" height="6" rx="2"/><rect x="13" y="14" width="8" height="6" rx="2"/><path d="M7 10v4a3 3 0 0 0 3 3h3"/>'),
    sib:    ic('<rect x="3" y="3" width="10" height="6" rx="2"/><rect x="3" y="15" width="10" height="6" rx="2"/><path d="M18 12v6M15 15h6"/>'),
    edit:   ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    info:   ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
    foldI:  ic('<path d="M7 9l5-5 5 5M7 15l5 5 5-5"/>'),
    trash:  ic('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    indent: ic('<path d="M3 6h18M11 12h10M11 18h10M3 10l4 3-4 3"/>'),
    outdent: ic('<path d="M3 6h18M11 12h10M11 18h10M7 10l-4 3 4 3"/>'),
    caretR: ic('<path d="M9 6l6 6-6 6"/>'),
    caretL: ic('<path d="M15 6l-6 6 6 6"/>'),
    style:  ic('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.2-1.7-.5-1.1.2-2.3 1.4-2.3H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.3"/><circle cx="10.5" cy="7" r="1.3"/><circle cx="15.5" cy="7.5" r="1.3"/>'),
    caretD: ic('<path d="M6 9l6 6 6-6"/>'),
    link:   ic('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>')
  };
  function iconBtn(cls, svg, lbl, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;                         // static icon markup only
    b.setAttribute("aria-label", lbl);
    b.title = lbl;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function textBtn(cls, lbl, fn) {
    var b = el("button", cls, lbl);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  // ---------- 2. Storage, prefs ----------
  // Working state: rows by id. `canonical()` is the merged, sorted
  // slice (R26) that is stored and synced.
  // Phase 2: LINKS (cross-links), POS (free-placement offsets) and
  // IMGS (pictures) are rows of their own; POS / IMGS share the
  // node's id (see mm-core.js header).
  var MAPS = Object.create(null), NODES = Object.create(null), TOMBS = Object.create(null);
  var LINKS = Object.create(null), POS = Object.create(null), IMGS = Object.create(null);
  // Wave 27: STYLES (node styles, id = node id), FRAMES (boundaries /
  // summaries) and LAYOUTS (layout kind, id = map id).
  var STYLES = Object.create(null), FRAMES = Object.create(null), LAYOUTS = Object.create(null);
  var prefs = null;

  function adopt(d) {
    MAPS = Object.create(null); NODES = Object.create(null); TOMBS = Object.create(null);
    LINKS = Object.create(null); POS = Object.create(null); IMGS = Object.create(null);
    STYLES = Object.create(null); FRAMES = Object.create(null); LAYOUTS = Object.create(null);
    (d.styles || []).forEach(function (x) { STYLES[x.id] = x; });
    (d.frames || []).forEach(function (x) { FRAMES[x.id] = x; });
    (d.layouts || []).forEach(function (x) { LAYOUTS[x.id] = x; });
    d.maps.forEach(function (x) { MAPS[x.id] = x; });
    d.nodes.forEach(function (x) { NODES[x.id] = x; });
    (d.links || []).forEach(function (x) { LINKS[x.id] = x; });
    (d.pos || []).forEach(function (x) { POS[x.id] = x; });
    (d.imgs || []).forEach(function (x) { IMGS[x.id] = x; });
    Object.keys(d.tombs).forEach(function (k) { TOMBS[k] = d.tombs[k]; });
  }
  function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
  function canonical() {
    return M.merge({ maps: values(MAPS), nodes: values(NODES), links: values(LINKS), pos: values(POS),
                     imgs: values(IMGS), styles: values(STYLES), frames: values(FRAMES), layouts: values(LAYOUTS),
                     tombs: TOMBS }, {});
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.nodes)) {
          adopt(M.merge(parsed, parsed));
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] mindmap: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    adopt(M.emptyData());
  }

  var saveFailShown = false;
  function saveNow() {
    var d = canonical();
    adopt(d);                                   // nodes of deleted maps leave too
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
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
    var fd = {};
    if (p.fold && typeof p.fold === "object") {
      Object.keys(p.fold).forEach(function (k) {
        if (!M.isMapId(k) || !Array.isArray(p.fold[k])) return;
        var ids = p.fold[k].filter(M.isId).slice(0, 5000);
        if (ids.length) fd[k] = ids;
      });
    }
    var exp = p.exp && typeof p.exp === "object" ? p.exp : {};
    prefs = {
      map: M.isMapId(p.map) ? p.map : null,
      view: p.view === "outline" ? "outline" : "map",
      fold: fd,
      exp: {
        fmt: ["png", "svg", "md", "opml", "json", "oros"].indexOf(exp.fmt) !== -1 ? exp.fmt : "png",
        dark: exp.dark === true, transparent: exp.transparent === true
      }
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    Object.keys(prefs.fold).forEach(function (k) {
      if (!MAPS[k]) { delete prefs.fold[k]; return; }
      prefs.fold[k] = prefs.fold[k].filter(function (id) { return !!NODES[id]; });
      if (!prefs.fold[k].length) delete prefs.fold[k];
    });
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function foldSet(mapId) {
    var o = {};
    (prefs.fold[mapId] || []).forEach(function (id) { o[id] = 1; });
    return o;
  }
  function isFolded(id) { return !!(R && prefs.fold[R.root.map] && prefs.fold[R.root.map].indexOf(id) !== -1); }
  function setFold(id, on) {
    var mapId = R.root.map, list = prefs.fold[mapId] || [];
    var i = list.indexOf(id);
    if (on && i === -1 && (R.kids[id] || []).length) list.push(id);
    if (!on && i !== -1) list.splice(i, 1);
    prefs.fold[mapId] = list;
    savePrefs();
  }
  function unfoldTo(id) {
    var changed = false, cur = R.par[id], guard = 0;
    while (cur && guard++ < M.MAX_NODES) {
      if (isFolded(cur)) { setFold(cur, false); changed = true; }
      cur = R.par[cur];
    }
    return changed;
  }

  // ---------- current map ----------
  var R = null;            // M.resolve() of the current map
  var sel = null;          // selected node id (session, R10)

  function curMap() { return prefs.map && MAPS[prefs.map] ? MAPS[prefs.map] : null; }
  function mapTitle(mapId) {
    var r = NODES[M.rootId(mapId)];
    return r ? (M.title(r.text, 80) || t("untitled")) : t("untitled");
  }
  function mapList() {
    var last = Object.create(null), count = Object.create(null);
    Object.keys(MAPS).forEach(function (id) { last[id] = MAPS[id].m; count[id] = 0; });
    Object.keys(NODES).forEach(function (id) {
      var n = NODES[id];
      if (!own(last, n.map)) return;
      if (n.m > last[n.map]) last[n.map] = n.m;
      count[n.map]++;
    });
    return Object.keys(MAPS).map(function (id) { return { id: id, title: mapTitle(id), last: last[id], count: count[id] }; })
      .sort(function (a, b) { return b.last - a.last || cmpStr(a.id, b.id); });
  }
  function ensureMap() {
    if (!curMap()) {
      var list = mapList();
      prefs.map = list.length ? list[0].id : null;
    }
    resolveNow();
  }
  function resolveNow() {
    var mp = curMap();
    if (!mp) { R = null; sel = null; return; }
    function of(dict) { return values(dict).filter(function (x) { return x.map === mp.id; }); }
    R = M.resolve({ maps: [mp], nodes: of(NODES), links: of(LINKS), pos: of(POS), imgs: of(IMGS),
                    styles: of(STYLES), frames: of(FRAMES), layouts: LAYOUTS[mp.id] ? [LAYOUTS[mp.id]] : [] }, mp.id);
    if (sel && !R.N[sel]) sel = null;
    if (selFrame && !R.frames.some(function (f) { return f.id === selFrame; })) selFrame = null;
    if (selLink && !R.links.some(function (l) { return l.id === selLink; })) selLink = null;
  }

  // ---------- 3. Mutations + undo / redo ----------
  // Every user action is one transaction: the rows it touches are
  // snapshotted before, the result after, so undo / redo re-apply
  // a side with FRESH stamps (a newer edit, R17) and travel through
  // sync like any edit.
  var undoStack = [], redoStack = [], tx = null;

  function begin(key) { tx = { before: {}, key: key || "", sel: sel }; }
  // Keys: "m:" map, "n:" node, "l:" link, "p:" position, "i:" picture,
  // "s:" style, "f:" frame, "v:" layout kind.
  var KIND = { m: function () { return MAPS; }, n: function () { return NODES; }, l: function () { return LINKS; },
               p: function () { return POS; }, i: function () { return IMGS; }, s: function () { return STYLES; },
               f: function () { return FRAMES; }, v: function () { return LAYOUTS; } };
  function rowOf(k) { return KIND[k.charAt(0)]()[k.slice(2)]; }
  function touch(k) { if (tx && !own(tx.before, k)) tx.before[k] = clone(rowOf(k)); }
  function putNode(row) {
    touch("n:" + row.id);
    var x = M.normNode(row);
    if (x) NODES[x.id] = x;
    return x;
  }
  function putMap(row) {
    touch("m:" + row.id);
    var x = M.normMap(row);
    if (x) MAPS[x.id] = x;
    return x;
  }
  function putLink(row) {
    touch("l:" + row.id);
    var x = M.normLink(row);
    if (x) LINKS[x.id] = x;
    return x;
  }
  function putPos(row) {
    touch("p:" + row.id);
    var x = M.normPos(row);
    if (x) POS[x.id] = x;
    return x;
  }
  function putImg(row) {
    touch("i:" + row.id);
    var x = M.normImg(row);
    if (x) IMGS[x.id] = x;
    return x;
  }
  function putStyle(row) {
    touch("s:" + row.id);
    var x = M.normStyle(row);
    if (x) STYLES[x.id] = x;
    return x;
  }
  function putFrame(row) {
    touch("f:" + row.id);
    var x = M.normFrame(row);
    if (x) FRAMES[x.id] = x;
    return x;
  }
  function putLayout(row) {
    touch("v:" + row.id);
    var x = M.normLayout(row);
    if (x) LAYOUTS[x.id] = x;
    return x;
  }
  // Positions, pictures, styles and layout kinds are never tombstoned
  // (their id is the node's or the map's): "removing" one writes a
  // zero / empty / default row instead.
  function tombRow(k) {
    var c = k.charAt(0), row = rowOf(k), id = k.slice(2);
    if (c === "p" || c === "i" || c === "s" || c === "v") {
      if (!row) return;
      touch(k);
      if (c === "p") putPos({ id: id, m: nextM(id, row), map: row.map, dx: 0, dy: 0 });
      else if (c === "i") putImg({ id: id, m: nextM(id, row), map: row.map, src: "", w: 0, h: 0 });
      else if (c === "s") putStyle({ id: id, m: nextM(id, row), map: row.map });
      else putLayout({ id: id, m: nextM(id, row), map: id, kind: "" });
      return;
    }
    touch(k);
    if (!row) return;
    TOMBS[id] = Math.max(Date.now(), row.m, TOMBS[id] || 0);
    delete KIND[c]()[id];
  }
  // Fresh stamp for a row about to change: above its own m and any
  // tombstone, so the change wins LWW and resurrects if needed.
  function nextM(id, row) { return stamp(Math.max(row ? row.m : 0, TOMBS[id] || 0)); }
  function commit() {
    if (!tx) return;
    var t0 = tx;
    tx = null;
    var after = {}, changed = false;
    Object.keys(t0.before).forEach(function (k) {
      after[k] = clone(rowOf(k));
      if (JSON.stringify(after[k]) !== JSON.stringify(t0.before[k])) changed = true;
    });
    if (!changed) return;
    var top = undoStack[undoStack.length - 1];
    if (t0.key && top && top.key === t0.key) {
      Object.keys(t0.before).forEach(function (k) { if (!own(top.before, k)) top.before[k] = t0.before[k]; });
      Object.keys(after).forEach(function (k) { top.after[k] = after[k]; });
    } else {
      undoStack.push({ before: t0.before, after: after, key: t0.key, sel: t0.sel, selAfter: sel });
      if (undoStack.length > UNDO_MAX) undoStack.shift();
    }
    redoStack = [];
    saveNow();
    refresh();
  }
  function applySide(snap) {
    Object.keys(snap).forEach(function (k) {
      var want = snap[k], id = k.slice(2), cur = rowOf(k);
      if (!want) { if (cur) tombRow(k); return; }
      var row = clone(want), c = k.charAt(0);
      row.m = nextM(id, cur);
      if (c === "m") putMap(row); else if (c === "n") putNode(row); else if (c === "l") putLink(row);
      else if (c === "p") putPos(row); else if (c === "i") putImg(row); else if (c === "s") putStyle(row);
      else if (c === "f") putFrame(row); else putLayout(row);
    });
  }
  function undo() {
    var e = undoStack.pop();
    if (!e) { showToast(t("toast.nothing")); return; }
    applySide(e.before);
    redoStack.push(e);
    sel = e.sel;
    afterHistory(e.before);
  }
  function redo() {
    var e = redoStack.pop();
    if (!e) { showToast(t("toast.noRedo")); return; }
    applySide(e.after);
    undoStack.push(e);
    sel = e.selAfter;
    afterHistory(e.after);
  }
  function afterHistory(snap) {
    // follow the change if it happened in another map
    var mapIds = Object.keys(snap).map(function (k) { var r = snap[k]; return r ? (r.map || r.id) : null; })
      .filter(function (id) { return id && MAPS[id]; });
    if (mapIds.length && mapIds.indexOf(prefs.map) === -1) { prefs.map = mapIds[0]; savePrefs(); camFor = null; }
    saveNow();
    refresh();
  }
  // Drop the newest entry without redo (a new empty node cancelled).
  function rollbackTop(key) {
    var top = undoStack[undoStack.length - 1];
    if (!top || top.key !== key) return false;
    undoStack.pop();
    applySide(top.before);
    sel = top.sel;
    saveNow();
    refresh();
    return true;
  }

  function kidsRows(pid, exclude) {
    return (R.kids[pid] || []).filter(function (id) { return id !== exclude && !R.rec[id]; })
      .map(function (id) { return R.N[id]; });
  }
  // Put node `id` (a full row) under `pid` at `index`; respaces the
  // siblings when their keys leave no room.
  function placeUnder(row, pid, index) {
    var sibs = kidsRows(pid, row.id);
    var p = M.placeAt(sibs, index === undefined ? sibs.length : index);
    (p.respace || []).forEach(function (r) {
      var s = clone(NODES[r.id] || R.N[r.id]);
      if (!s) return;
      s.ord = r.ord; s.m = nextM(s.id, s);
      putNode(s);
    });
    row.parent = pid;
    row.ord = p.ord;
    row.m = nextM(row.id, NODES[row.id]);
    return putNode(row);
  }
  function freshNode(mapId) {
    return { id: newId(), m: 0, map: mapId, parent: "", ord: "", text: "", emoji: "", color: "", note: "", url: "", done: false };
  }
  // Rows that exist only as the drawn placeholder become real here.
  function ensureRoot() {
    if (!R.root.virtual) return;
    var r = clone(R.root);
    delete r.virtual;
    r.text = r.text || t("untitled");
    r.m = nextM(r.id, null);
    putNode(r);
  }
  function tooBig() {
    if (R.count >= M.MAX_NODES) { showToast(t("toast.tooMany")); return true; }
    return false;
  }

  function addChild(pid) {
    if (!R || tooBig()) return;
    pid = pid || R.root.id;
    begin("");
    ensureRoot();
    var row = placeUnder(freshNode(R.root.map), pid);
    if (isFolded(pid)) setFold(pid, false);
    var id = row.id;
    tx.key = "new:" + id;
    sel = id;
    commit();
    startEdit(id, "", true);
  }
  function addSibling(id) {
    if (!R) return;
    if (!id || id === R.root.id || R.rec[id]) { addChild(R.root.id); return; }
    if (tooBig()) return;
    var pid = R.par[id];
    var idx = kidsRows(pid, null).map(function (n) { return n.id; }).indexOf(id) + 1;
    begin("");
    var row = placeUnder(freshNode(R.root.map), pid, idx);
    tx.key = "new:" + row.id;
    sel = row.id;
    commit();
    startEdit(row.id, "", true);
  }
  // Partial change of one node; no stamp, no entry when nothing
  // really changed (R27).
  function updateNode(id, patch, key) {
    var cur = R.N[id];
    if (!cur) return;
    var next = clone(cur);
    delete next.virtual;
    Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
    var a = M.normNode(Object.assign({}, cur, { m: 1 })), b = M.normNode(Object.assign({}, next, { m: 1 }));
    if (!cur.virtual && JSON.stringify(a) === JSON.stringify(b)) return;
    begin(key || "");
    next.m = nextM(id, NODES[id]);
    putNode(next);
    commit();
  }
  function deleteNode(id) {
    if (!R || !R.N[id]) return;
    if (id === R.root.id) { showToast(t("toast.root")); return; }
    var all = M.subtree(R, id), name = label(R.N[id], 40);
    var pid = R.par[id], sibs = kidsRows(pid, null).map(function (n) { return n.id; }), i = sibs.indexOf(id);
    begin("");
    var gone = {};
    all.forEach(function (x) { gone[x] = 1; });
    linksOf(gone).forEach(function (lid) { tombRow("l:" + lid); });
    all.forEach(function (x) {
      if (POS[x]) touch("p:" + x);
      if (IMGS[x]) touch("i:" + x);
      if (STYLES[x]) touch("s:" + x);
      if (NODES[x]) tombRow("n:" + x);
    });
    // a boundary / summary whose last living member goes, goes too
    framesOf(gone).forEach(function (fid) {
      if (FRAMES[fid].nodes.every(function (x) { return own(gone, x) || !NODES[x]; })) tombRow("f:" + fid);
    });
    sel = sibs[i + 1] || sibs[i - 1] || pid;
    selLink = null;
    selFrame = null;
    commit();
    undoToast(all.length > 1 ? t("toast.deletedN", { name: name, n: all.length - 1 }) : t("toast.deleted", { name: name }), undo);
  }
  // Frames with a member in `set` (a dict).
  function framesOf(set) {
    return Object.keys(FRAMES).filter(function (fid) { return FRAMES[fid].nodes.some(function (x) { return own(set, x); }); });
  }
  // Links touching any id in `set` (a dict).
  function linksOf(set) {
    return Object.keys(LINKS).filter(function (lid) { var l = LINKS[lid]; return own(set, l.from) || own(set, l.to); });
  }
  // Move `id` under `pid` at `index` (index in the list without it).
  // A free-placed node goes back to its automatic place there.
  function moveNode(id, pid, index) {
    if (!R.N[id] || id === R.root.id) return false;
    if (M.isInside(R, id, pid)) { showToast(t("toast.noMove")); return false; }
    begin("");
    ensureRoot();
    if (POS[id] && (POS[id].dx || POS[id].dy)) tombRow("p:" + id);
    placeUnder(clone(R.N[id]), pid, index);
    if (isFolded(pid)) setFold(pid, false);
    sel = id;
    commit();
    return true;
  }
  function moveBy(id, delta) {
    if (!R.N[id] || id === R.root.id) return;
    var pid = R.par[id];
    var sibs = kidsRows(pid, null).map(function (n) { return n.id; }), i = sibs.indexOf(id);
    if (i === -1) { moveNode(id, pid, 0); return; }               // recovered: keep it here
    var j = i + delta;
    if (j < 0 || j >= sibs.length) return;
    moveNode(id, pid, j);
  }
  function indent(id) {
    var pid = R.par[id];
    if (!pid || id === R.root.id) return false;
    var sibs = (R.kids[pid] || []), i = sibs.indexOf(id);
    if (i <= 0) { showToast(t("toast.noPrev")); return false; }
    return moveNode(id, sibs[i - 1]);
  }
  function outdent(id) {
    var pid = R.par[id];
    if (!pid || pid === R.root.id || id === R.root.id) return false;
    var gp = R.par[pid];
    var idx = kidsRows(gp, id).map(function (n) { return n.id; }).indexOf(pid) + 1;
    return moveNode(id, gp, idx);
  }
  // Layout of the current map: kind "" (classic map, with `sides`),
  // "org", "tree" or "time". The kind is its own row (wave 27), so a
  // device on older code keeps showing the classic map.
  function curLayout() { var mp = curMap(); return mp && LAYOUTS[mp.id] ? LAYOUTS[mp.id].kind : ""; }
  function setLayout(kind, sides) {
    var mp = curMap();
    if (!mp) return;
    var cur = LAYOUTS[mp.id];
    if ((cur ? cur.kind : "") === kind && (kind || mp.sides === sides)) return;
    begin("");
    ensureRoot();
    if (!kind && mp.sides !== sides) putMap({ id: mp.id, m: nextM(mp.id, mp), sides: sides });
    if ((cur ? cur.kind : "") !== kind) putLayout({ id: mp.id, m: nextM(mp.id, cur), map: mp.id, kind: kind });
    commit();
    camFor = null;
    refresh();
  }

  // ---------- 4. Map view ----------
  var lay = null;
  var view = { s: 1, tx: 0, ty: 0 };
  var camFor = null;                       // map id the camera belongs to
  var cams = Object.create(null);          // session camera per map (R10)
  var hits = null, hitList = [], hitAt = -1;
  var drop = null;                         // { id, mode } while dragging
  var selLink = null;                      // selected cross-link id (session)
  var selFrame = null;                     // selected boundary / summary id (session)
  var pres = null;                         // presentation: { steps[], i, keep } (session)
  var linking = null;                      // { from } while picking a link's other end

  var mctx = null, mcache = new Map();
  function measure(text, px, weight) {
    var k = weight + "|" + px + "|" + text;
    var v = mcache.get(k);
    if (v !== undefined) return v;
    if (!mctx) {
      try { mctx = document.createElement("canvas").getContext("2d"); } catch (e) { mctx = null; }
    }
    if (!mctx) return M.estimate(text, px);
    mctx.font = weight + " " + px + "px " + FONT;
    v = mctx.measureText(text).width;
    if (mcache.size > 20000) mcache.clear();
    mcache.set(k, v);
    return v;
  }

  function cssPal() {
    var cs = getComputedStyle(document.documentElement);
    function v(name) { return cs.getPropertyValue(name).trim(); }
    return { bg: v("--bg"), panel: v("--panel-bg"), text: v("--text"), dim: v("--text-dim"), border: v("--border"),
             accent: v("--accent"), onAccent: v("--bg") };
  }

  function domItem(it) {
    if (!M.TAGS[it.tag]) return null;
    var n = document.createElementNS(SVGNS, it.tag);
    if (it.cls) n.setAttribute("class", it.cls);
    Object.keys(it.a || {}).forEach(function (k) {
      if (M.ATTRS[k]) n.setAttribute(k, String(it.a[k]));
    });
    if (it.text !== undefined) n.textContent = it.text;
    (it.kids || []).forEach(function (k) { var c = domItem(k); if (c) n.appendChild(c); });
    return n;
  }

  function renderMap() {
    var vp = $("vp");
    while (vp.firstChild) vp.removeChild(vp.firstChild);
    if (!R) { lay = null; return; }
    lay = M.layout(R, { measure: measure, fold: foldSet(R.root.map), placeholder: t("untitled") });
    var so = { pal: cssPal(), sel: sel, hi: hits, drop: drop, selLink: selLink, selFrame: selFrame };
    if (pres) so = { pal: so.pal, only: presOnly(), cur: pres.steps[pres.i], keep: presKeep() };
    var sc = M.scene(R, lay, so);
    var frag = document.createDocumentFragment();
    sc.items.forEach(function (it) {
      var n = domItem(it);
      if (!n) return;
      var id = it.a && it.a["data-id"], lid = it.a && it.a["data-link"], fid = it.a && it.a["data-frame"];
      if (fid) {
        var ft = document.createElementNS(SVGNS, "title"), fr = FRAMES[fid];
        ft.textContent = fr ? (fr.label || t(fr.kind === "brace" ? "fr.summary" : "fr.boundary")) : "";
        n.insertBefore(ft, n.firstChild);
      }
      if (lid) {
        var lt = document.createElementNS(SVGNS, "title"), lk = linkRow(lid);
        lt.textContent = lk ? label(R.N[lk.from], 40) + " → " + label(R.N[lk.to], 40) + (lk.label ? "\n" + lk.label : "") : "";
        n.insertBefore(lt, n.firstChild);
      }
      if (id) {
        var title = document.createElementNS(SVGNS, "title");
        var nn = R.N[id];
        title.textContent = (nn.emoji ? nn.emoji + " " : "") + (nn.text || t("empty.node")) + (nn.note ? "\n\n" + nn.note : "");
        n.insertBefore(title, n.firstChild);
      }
      frag.appendChild(n);
    });
    vp.appendChild(frag);
    if (pres) { applyView(); positionEditor(); renderNodebar(); return; }
    if (camFor !== R.root.map) {
      if (camFor) cams[camFor] = { s: view.s, tx: view.tx, ty: view.ty };
      camFor = R.root.map;
      if (cams[camFor]) { view.s = cams[camFor].s; view.tx = cams[camFor].tx; view.ty = cams[camFor].ty; }
      else startView();
    }
    applyView();
    positionEditor();
    renderNodebar();
  }

  function stageRect() { return $("stage").getBoundingClientRect(); }
  function applyView() {
    $("vp").setAttribute("transform", "translate(" + view.tx.toFixed(1) + " " + view.ty.toFixed(1) + ") scale(" + view.s.toFixed(4) + ")");
    positionEditor();
  }
  // First look at a map: the whole map when it fits at a readable
  // size, else the centre at a normal size.
  function startView() {
    var r = stageRect();
    if (!lay || !r.width) return;
    var s = Math.min(1, r.width / lay.w, (r.height - 70) / lay.h);
    if (s >= 0.6) { fit(); return; }
    view.s = r.width < 500 ? 0.85 : 1;
    centerOn(R.root.id);
  }
  function fit() {
    var r = stageRect();
    if (!lay || !r.width) return;
    var h = Math.max(100, r.height - (sel ? 70 : 0));
    view.s = Math.max(0.1, Math.min(1.2, r.width / lay.w, h / lay.h));
    view.tx = (r.width - lay.w * view.s) / 2;
    view.ty = (h - lay.h * view.s) / 2;
    applyView();
  }
  function centerOn(id, yFrac) {
    var c = lay && lay.nodes[id], r = stageRect();
    if (!c || !r.width) return;
    view.tx = r.width / 2 - c.cx * view.s;
    view.ty = r.height * (yFrac || 0.45) - c.cy * view.s;
    applyView();
  }
  // Keep a node in sight (above the node bar).
  function reveal(id) {
    var c = lay && lay.nodes[id], r = stageRect();
    if (!c || !r.width) return;
    var x0 = c.x * view.s + view.tx, x1 = (c.x + c.w) * view.s + view.tx;
    var y0 = c.y * view.s + view.ty, y1 = (c.y + c.h) * view.s + view.ty;
    var bottom = r.height - 76;
    if (x0 < 8 || x1 > r.width - 8 || y0 < 8 || y1 > bottom) {
      if (c.w * view.s > r.width - 16) view.tx = 8 - c.x * view.s;
      else view.tx += x0 < 8 ? 8 - x0 + 24 : (x1 > r.width - 8 ? r.width - 8 - x1 - 24 : 0);
      view.ty += y0 < 8 ? 8 - y0 + 24 : (y1 > bottom ? bottom - y1 - 24 : 0);
      applyView();
    }
  }
  function zoomAt(f, cx, cy) {
    var s = Math.max(0.1, Math.min(3, view.s * f));
    view.tx = cx - (cx - view.tx) * (s / view.s);
    view.ty = cy - (cy - view.ty) * (s / view.s);
    view.s = s;
    applyView();
  }
  function zoomCenter(f) { var r = stageRect(); zoomAt(f, r.width / 2, r.height / 2); }
  function toMap(px, py) { return { x: (px - view.tx) / view.s, y: (py - view.ty) / view.s }; }

  function linkRow(lid) {
    if (!R) return null;
    for (var i = 0; i < R.links.length; i++) if (R.links[i].id === lid) return R.links[i];
    return null;
  }
  function selectLink(lid) {
    selLink = lid && linkRow(lid) ? lid : null;
    sel = null;
    selFrame = null;
    renderMap();
    if (selLink) live(t("live.link"));
  }
  function selectFrame(fid) {
    selFrame = fid && FRAMES[fid] ? fid : null;
    sel = null;
    selLink = null;
    renderMap();
    if (selFrame) live(t("live.frame"));
  }
  function select(id, quiet) {
    if (id && (!R || !R.N[id])) id = null;
    if (selLink || selFrame) {
      selLink = null; selFrame = null; sel = id; renderMap();
      if (id && !quiet) live(t("live.sel", { name: label(R.N[id]) }));
      return;
    }
    if (sel === id) { renderNodebar(); return; }
    sel = id;
    [].forEach.call($("vp").querySelectorAll("g.mm-node"), function (g) {
      g.classList.toggle("mm-sel", g.getAttribute("data-id") === id);
    });
    renderNodebar();
    if (id && !quiet) live(t("live.sel", { name: label(R.N[id]) }));
  }

  // Drop target under a map point: the node box (not inside the
  // dragged branch); top / bottom quarter = before / after it.
  function dropAt(p, dragId, blocked) {
    if (!lay) return null;
    var best = null;
    for (var i = lay.order.length - 1; i >= 0; i--) {
      var id = lay.order[i], c = lay.nodes[id];
      if (own(blocked, id)) continue;
      if (p.x >= c.x - 6 && p.x <= c.x + c.w + 6 && p.y >= c.y - 5 && p.y <= c.y + c.h + 5) { best = c; break; }
    }
    if (!best) return null;
    var mode = "child";
    if (best.depth > 0 && !R.rec[best.id]) {
      // siblings side by side (org chart, timeline): left / right third
      var f = best.sib === "h" ? (p.x - best.x) / best.w : (p.y - best.y) / best.h;
      if (f < 0.27) mode = "before"; else if (f > 0.73) mode = "after";
    }
    return { id: best.id, mode: mode };
  }
  function markDrop(d) {
    [].forEach.call($("vp").querySelectorAll("g.mm-node"), function (g) {
      var on = d && g.getAttribute("data-id") === d.id;
      g.classList.toggle("mm-drop-child", !!(on && d.mode === "child"));
      g.classList.toggle("mm-drop-before", !!(on && d.mode === "before"));
      g.classList.toggle("mm-drop-after", !!(on && d.mode === "after"));
      g.classList.toggle("mm-drop-h", !!(on && lay && lay.nodes[d.id] && lay.nodes[d.id].sib === "h"));
    });
  }
  function doDrop(id, d) {
    if (!d || d.id === id) return;
    var target = d.id, ok;
    if (d.mode === "child") ok = moveNode(id, target);
    else {
      var pid = R.par[target];
      var sibs = kidsRows(pid, id).map(function (n) { return n.id; });
      var i = sibs.indexOf(target);
      ok = moveNode(id, pid, d.mode === "after" ? i + 1 : i);
    }
    if (ok) live(t("live.moved", { name: label(R.N[R.par[id]]) }));
  }

  // Pointer: one finger / mouse pans; two fingers pinch; a tap
  // selects; a double tap or a tap on the selected node edits; a
  // node is dragged by mouse, or by finger once it is selected; a
  // long press (or right click) opens the node menu.
  function wirePointer() {
    var svg = $("svg"), pts = {}, start = null, pinch = null, lastTap = { t: 0, id: null }, press = null;
    function local(e) { var r = stageRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function count() { return Object.keys(pts).length; }
    function nodeAt(target) {
      var g = target && target.closest ? target.closest("g[data-id]") : null;
      return g ? g.getAttribute("data-id") : null;
    }
    function foldAt(target) {
      var g = target && target.closest ? target.closest("g[data-fold]") : null;
      return g ? g.getAttribute("data-fold") : null;
    }
    function linkAt(target) {
      var g = target && target.closest ? target.closest("g[data-link]") : null;
      return g ? g.getAttribute("data-link") : null;
    }
    function frameAt(target) {
      var g = target && target.closest ? target.closest("g[data-frame]") : null;
      return g ? g.getAttribute("data-frame") : null;
    }
    // Dropped on a node: new parent / place (doDrop). Dropped on empty
    // space: the branch stays where it was let go (free placement).
    function endDrag(apply, p) {
      if (!start || !start.drag) return;
      var g = start.drag.g;
      if (g && g.parentNode) g.parentNode.removeChild(g);
      [].forEach.call($("vp").querySelectorAll("g.mm-dragging"), function (x) { x.classList.remove("mm-dragging"); });
      var d = drop;
      drop = null;
      markDrop(null);
      if (!apply) return;
      if (d) doDrop(start.id, d);
      else if (p) nudge(start.id, (p.x - start.p.x) / view.s, (p.y - start.p.y) / view.s);
    }
    svg.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button > 0) return;
      if (editing) commitEdit();
      closeMenu();
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      pts[e.pointerId] = local(e);
      if (count() === 1) {
        var id = nodeAt(e.target);
        start = { p: local(e), tx: view.tx, ty: view.ty, moved: false, id: id, fold: foldAt(e.target),
                  link: id ? null : linkAt(e.target), frame: id ? null : frameAt(e.target),
                  touch: e.pointerType !== "mouse", drag: null };
        clearTimeout(press);
        if (id && start.touch) {
          press = setTimeout(function () {
            if (start && !start.moved && start.id === id && !linking) {
              start.moved = true; start.pressed = true;
              select(id);
              openNodeMenu(id, e.clientX, e.clientY, true);
            }
          }, 520);
        }
      } else if (count() === 2) {
        clearTimeout(press);
        if (start && start.drag) endDrag(false);
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
        var s = Math.max(0.1, Math.min(3, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        view.s = s;
        view.tx = cx - (pinch.cx - pinch.tx) * (s / pinch.s);
        view.ty = cy - (pinch.cy - pinch.ty) * (s / pinch.s);
        applyView();
        return;
      }
      if (!start || start.pressed) return;
      var p = pts[e.pointerId], dx = p.x - start.p.x, dy = p.y - start.p.y;
      if (!start.moved && Math.hypot(dx, dy) > 6) {
        start.moved = true;
        clearTimeout(press);
        var canDrag = !linking && start.id && start.id !== R.root.id && (!start.touch || start.id === sel);
        if (canDrag) {
          var src = $("vp").querySelector('g[data-id="' + CSS.escape(start.id) + '"]');
          var blocked = {};
          M.subtree(R, start.id).forEach(function (x) { blocked[x] = 1; });
          [].forEach.call($("vp").querySelectorAll("g.mm-node"), function (g) {
            if (own(blocked, g.getAttribute("data-id"))) g.classList.add("mm-dragging");
          });
          var ghost = src ? src.cloneNode(true) : null;
          if (ghost) {
            ghost.setAttribute("class", "mm-ghost");
            ghost.removeAttribute("data-id");
            $("vp").appendChild(ghost);
          }
          start.drag = { g: ghost, blocked: blocked };
          select(start.id, true);
        } else svg.classList.add("panning");
      }
      if (!start.moved) return;
      if (start.drag) {
        if (start.drag.g) start.drag.g.setAttribute("transform", "translate(" + (dx / view.s).toFixed(1) + " " + (dy / view.s).toFixed(1) + ")");
        // edge auto-pan
        var r = stageRect(), ex = 0, ey = 0;
        if (p.x < 30) ex = 10; else if (p.x > r.width - 30) ex = -10;
        if (p.y < 30) ey = 10; else if (p.y > r.height - 30) ey = -10;
        if (ex || ey) { view.tx += ex; view.ty += ey; start.p.x += ex; start.p.y += ey; applyView(); }
        drop = dropAt(toMap(p.x, p.y), start.id, start.drag.blocked);
        markDrop(drop);
      } else {
        view.tx = start.tx + dx; view.ty = start.ty + dy; applyView();
      }
    });
    function end(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      clearTimeout(press);
      if (count() < 2) pinch = null;
      if (count() !== 0) return;
      svg.classList.remove("panning");
      if (start && start.drag) endDrag(e.type === "pointerup", local(e));
      else if (start && !start.moved && e.type === "pointerup") {
        if (linking) { finishLink(start.id); start = null; return; }
        if (start.fold) { toggleFold(start.fold); start = null; return; }
        if (start.link) { selectLink(start.link); start = null; return; }
        if (start.frame) { selectFrame(start.frame); start = null; return; }
        var id = start.id, now = Date.now();
        if (id && ((lastTap.id === id && now - lastTap.t < 380) || (start.touch && id === sel))) {
          lastTap = { t: 0, id: null };
          select(id);
          startEdit(id, null, false);
        } else {
          lastTap = { t: now, id: id };
          select(id);
        }
      }
      start = null;
    }
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (linking) return;
      var id = nodeAt(e.target), lid = id ? null : linkAt(e.target), fid = id || lid ? null : frameAt(e.target);
      if (lid) { selectLink(lid); openLinkMenu(lid, e.clientX, e.clientY); return; }
      if (fid) { selectFrame(fid); openFrameMenu(fid, e.clientX, e.clientY); return; }
      if (!id) return;
      select(id);
      openNodeMenu(id, e.clientX, e.clientY);
    });
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = local(e);
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), p.x, p.y);
      else if (e.shiftKey) { view.tx -= e.deltaY; applyView(); }
      else { view.tx -= e.deltaX; view.ty -= e.deltaY * (e.deltaMode === 1 ? 20 : 1); applyView(); }
    }, { passive: false });
  }

  function toggleFold(id) {
    if (!R || !(R.kids[id] || []).length || id === R.root.id) return;
    setFold(id, !isFolded(id));
    refresh();
  }

  // ---------- 4b. Free placement + cross-links (phase 2) ----------
  // A node's offset from its automatic place; it carries its branch.
  function nudge(id, dx, dy) {
    if (!R || !R.N[id] || id === R.root.id) return;
    var cur = POS[id], nx = Math.round((cur ? cur.dx : 0) + dx), ny = Math.round((cur ? cur.dy : 0) + dy);
    nx = Math.max(-M.MAX_OFF, Math.min(M.MAX_OFF, nx)); ny = Math.max(-M.MAX_OFF, Math.min(M.MAX_OFF, ny));
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    begin("");
    ensureRoot();
    putPos({ id: id, m: nextM(id, cur || NODES[id]), map: R.root.map, dx: nx, dy: ny });
    sel = id;
    commit();
    live(t("live.placed"));
  }
  function isMoved(id) { return !!(POS[id] && (POS[id].dx || POS[id].dy) && R && R.N[id]); }
  function resetPos(id) {
    if (!isMoved(id)) return;
    begin("");
    tombRow("p:" + id);
    commit();
  }
  function anyMoved() { return !!R && Object.keys(R.pos || {}).some(function (id) { return R.pos[id].dx || R.pos[id].dy; }); }
  function tidyAll() {
    if (!anyMoved()) return;
    begin("");
    Object.keys(R.pos).forEach(function (id) { if (R.pos[id].dx || R.pos[id].dy) tombRow("p:" + id); });
    commit();
    undoToast(t("toast.tidied"), undo);
  }
  function startLink(from) {
    if (!R || !R.N[from]) return;
    commitEdit();
    if (R.links.length >= M.MAX_LINKS) { showToast(t("toast.tooMany")); return; }
    linking = { from: from };
    select(from, true);
    showHint(t("link.pick", { name: label(R.N[from], 40) }));
  }
  function cancelLink() {
    if (!linking) return;
    linking = null;
    showHint("");
  }
  function finishLink(to) {
    var from = linking && linking.from;
    cancelLink();
    if (!to || !from || !R || !R.N[from] || !R.N[to]) return;
    if (to === from) { showToast(t("link.self")); return; }
    var dup = R.links.some(function (l) { return (l.from === from && l.to === to); });
    if (dup) { showToast(t("link.dup")); return; }
    begin("");
    ensureRoot();
    var row = putLink({ id: newId(), m: stamp(0), map: R.root.map, from: from, to: to, label: "" });
    commit();
    if (row) {
      selectLink(row.id);
      editLinkLabel(row.id, true);
    }
  }
  function updateLink(lid, patch) {
    var cur = LINKS[lid];
    if (!cur) return;
    var next = Object.assign(clone(cur), patch);
    if (JSON.stringify(M.normLink(Object.assign({}, next, { m: 1 }))) === JSON.stringify(M.normLink(Object.assign({}, cur, { m: 1 })))) return;
    begin("");
    next.m = nextM(lid, cur);
    putLink(next);
    commit();
  }
  function editLinkLabel(lid, isNew) {
    var l = LINKS[lid];
    if (!l) return;
    var dlg = makeDialog("mm-linklbl", t("link.title"));
    var form = el("form");
    form.method = "dialog";
    var f = el("label", "fld");
    f.appendChild(el("span", "fld-lbl", t("link.label")));
    var inp = el("input");
    inp.type = "text"; inp.value = l.label; inp.placeholder = t("link.ph"); inp.maxLength = M.LABEL_LEN; inp.autocomplete = "off";
    f.appendChild(inp);
    form.appendChild(f);
    form.appendChild(el("p", "dlg-sub", label(R.N[l.from], 40) + " → " + label(R.N[l.to], 40)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", isNew ? t("link.noLabel") : t("cancel"), function () { dlg.close(); }));
    var ok = textBtn("dlg-btn primary", t("save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      dlg.close();
      updateLink(lid, { label: M.line(inp.value, M.LABEL_LEN) });
    });
    dlg.appendChild(form);
    showDialog(dlg);
    inp.focus();
  }
  function reverseLink(lid) {
    var l = LINKS[lid];
    if (l) updateLink(lid, { from: l.to, to: l.from });
  }
  function deleteLink(lid) {
    if (!LINKS[lid]) return;
    begin("");
    tombRow("l:" + lid);
    selLink = null;
    commit();
    undoToast(t("toast.linkDeleted"), undo);
  }
  function openLinkMenu(lid, x, y, fromPress) {
    var l = linkRow(lid);
    if (!l) return;
    openMenuAt([
      ["link.edit", function () { editLinkLabel(lid); }],
      ["link.reverse", function () { reverseLink(lid); }],
      ["link.goFrom", function () { select(l.from); reveal(l.from); }],
      ["link.goTo", function () { select(l.to); reveal(l.to); }],
      ["link.delete", function () { deleteLink(lid); }, "danger"]
    ], x, y, null, false, fromPress);
  }
  function showHint(text) {
    var h = $("hint");
    h.textContent = text;
    h.hidden = !text;
    if (text) {
      var c = el("button", "hint-x", t("cancel"));
      c.type = "button";
      c.addEventListener("click", cancelLink);
      h.appendChild(c);
    }
  }

  // ---------- 5. In-place editor ----------
  var editing = null;      // { id, isNew }

  function startEdit(id, initial, isNew) {
    if (!R || !R.N[id]) return;
    if (prefs.view === "outline") { focusRow(id, true); return; }
    if (unfoldTo(id)) refresh();
    select(id, true);
    var c = lay && lay.nodes[id];
    if (!c) return;
    // readable size + in sight before the keyboard comes up
    if (view.s < 0.75) { var r0 = stageRect(); zoomAt(1 / view.s, r0.width / 2, r0.height / 2); }
    var r = stageRect();
    if (r.width < 600) centerOn(id, 0.3); else reveal(id);
    editing = { id: id, isNew: !!isNew };
    var ed = $("editor");
    ed.value = initial !== null && initial !== undefined ? initial : R.N[id].text;
    ed.hidden = false;
    positionEditor();
    ed.focus();
    if (initial === null || initial === undefined) ed.select();
    else ed.setSelectionRange(ed.value.length, ed.value.length);
  }
  function positionEditor() {
    var ed = $("editor");
    if (!editing || ed.hidden || !lay) return;
    var c = lay.nodes[editing.id];
    if (!c) return;
    var fs = Math.max(16, c.sty.font * view.s);
    var k = fs / c.sty.font;
    ed.style.fontSize = fs.toFixed(1) + "px";
    ed.style.fontWeight = String(c.sty.weight);
    ed.style.lineHeight = (c.sty.lh * k).toFixed(1) + "px";
    var w = Math.max(c.w * view.s, 180), r = stageRect();
    w = Math.min(w, r.width - 16);
    var x = Math.max(8, Math.min(c.x * view.s + view.tx - 2, r.width - w - 8));
    ed.style.left = x.toFixed(1) + "px";
    ed.style.top = Math.max(4, c.y * view.s + view.ty - 2).toFixed(1) + "px";
    ed.style.width = w.toFixed(1) + "px";
    ed.style.height = "auto";
    ed.style.height = Math.max(ed.scrollHeight, c.h * view.s) + "px";
  }
  function commitEdit(then) {
    if (!editing) return;
    var e = editing, ed = $("editor");
    editing = null;
    var text = M.para(ed.value, M.TEXT_LEN);
    ed.hidden = true;
    ed.blur();
    if (!R || !R.N[e.id]) { refresh(); return; }
    if (e.isNew && !text) { rollbackTop("new:" + e.id); }
    else updateNode(e.id, { text: text }, e.isNew ? "new:" + e.id : "");
    if (then) then(e.id);
    else $("svg").focus({ preventScroll: true });
  }
  function cancelEdit() {
    if (!editing) return;
    var e = editing;
    editing = null;
    $("editor").hidden = true;
    if (e.isNew && R && R.N[e.id] && !R.N[e.id].text) rollbackTop("new:" + e.id);
    $("svg").focus({ preventScroll: true });
  }
  function wireEditor() {
    var ed = $("editor");
    ed.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); commitEdit(); }
      else if (e.key === "Tab" && !e.isComposing) {
        e.preventDefault();
        commitEdit(function (id) { if (R && R.N[id]) { if (e.shiftKey) addSibling(id); else addChild(id); } });
      } else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    });
    ed.addEventListener("input", positionEditor);
    ed.addEventListener("blur", function () { if (editing) setTimeout(function () { if (editing && document.activeElement !== ed) commitEdit(); }, 0); });
  }

  // ---------- 6. Keyboard (map view) + clipboard ----------
  // Arrow keys: where they go depends on the layout (mm-core navTarget).
  function navigate(dir) {
    if (!lay || !R) return;
    if (!sel || !lay.nodes[sel]) { select(R.root.id); reveal(R.root.id); return; }
    var r = M.navTarget(R, lay, sel, dir);
    if (!r) return;
    if (r.unfold) { toggleFold(r.unfold); return; }
    select(r.id);
    reveal(r.id);
  }

  function inField(e) {
    var tag = e.target && e.target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable);
  }
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
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]") || $("mm-menu")) return;
      if (pres) { presKey(e); return; }
      var mod = e.ctrlKey || e.metaKey, k = e.key;
      if (mod && !e.altKey && (k === "z" || k === "Z") && !inField(e)) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && !e.altKey && (k === "y" || k === "Y") && !inField(e)) { e.preventDefault(); redo(); return; }
      if (mod && !e.altKey && (k === "f" || k === "F")) { e.preventDefault(); openFind(); return; }
      if (inField(e) || prefs.view !== "map" || !R) return;
      if (mod) return;
      if (e.altKey) {
        if (k === "ArrowUp" && sel) { e.preventDefault(); moveBy(sel, -1); }
        else if (k === "ArrowDown" && sel) { e.preventDefault(); moveBy(sel, 1); }
        return;
      }
      if (linking && k === "Escape") { e.preventDefault(); cancelLink(); return; }
      if (selFrame) {
        if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteFrame(selFrame); return; }
        if (k === "Escape") { e.preventDefault(); selectFrame(null); return; }
        if (k === "Enter" || k === "F2") { e.preventDefault(); openFrame(selFrame); return; }
      }
      if (selLink) {
        if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteLink(selLink); return; }
        if (k === "Escape") { e.preventDefault(); selectLink(null); return; }
        if (k === "Enter" || k === "F2") { e.preventDefault(); editLinkLabel(selLink); return; }
      }
      if (k === "Tab") { e.preventDefault(); addChild(sel || R.root.id); }
      else if (k === "Enter") { e.preventDefault(); if (sel) addSibling(sel); else addChild(R.root.id); }
      else if (k === "F2") { e.preventDefault(); startEdit(sel || R.root.id, null, false); }
      else if (k === "Delete" || k === "Backspace") { if (sel) { e.preventDefault(); deleteNode(sel); } }
      else if (k === " ") { e.preventDefault(); if (sel) toggleFold(sel); }
      else if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
        e.preventDefault(); navigate(k.slice(5).toLowerCase());
      }
      else if (k === "Escape") { if (hits) closeFind(); else select(null); }
      else if (k === "+" || k === "=") zoomCenter(1.2);
      else if (k === "-" || k === "_") zoomCenter(1 / 1.2);
      else if (k === "Home") fit();
      else if (k.length === 1 && sel && /\S/.test(k)) { e.preventDefault(); startEdit(sel, k, false); }
    });
    // Copy / cut a branch as Markdown, paste a list under the selection.
    document.addEventListener("copy", function (e) {
      if (inField(e) || prefs.view !== "map" || !R || !sel || !e.clipboardData) return;
      e.clipboardData.setData("text/plain", M.toOutline(subR(sel)));
      e.preventDefault();
      showToast(t("toast.copied"));
    });
    document.addEventListener("cut", function (e) {
      if (inField(e) || prefs.view !== "map" || !R || !sel || sel === R.root.id || !e.clipboardData) return;
      e.clipboardData.setData("text/plain", M.toOutline(subR(sel)));
      e.preventDefault();
      deleteNode(sel);
    });
    document.addEventListener("paste", function (e) {
      if (inField(e) || prefs.view !== "map" || !R || !e.clipboardData) return;
      var text = e.clipboardData.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      pasteList(text, sel || R.root.id);
    });
  }

  // ---------- 7. Outline view ----------
  var olFocus = null;           // { id, start, end } restored after a rebuild
  var olWant = null;            // focus a structural change asks for (wins over the old focus)
  var olPending = Object.create(null), olTimer = null;

  function olRows() {
    var out = [], fs = foldSet(R.root.map), stack = [[R.root.id, 0]];
    while (stack.length) {
      var e = stack.pop();
      out.push(e);
      if (own(fs, e[0]) && e[0] !== R.root.id) continue;
      var k = R.kids[e[0]] || [];
      for (var i = k.length - 1; i >= 0; i--) stack.push([k[i], e[1] + 1]);
    }
    return out;
  }
  function renderOutline() {
    var box = $("outline");
    var act = document.activeElement;
    if (olWant) { olFocus = olWant; olWant = null; }
    else if (act && act.classList && act.classList.contains("ol-text")) {
      olFocus = { id: act.getAttribute("data-id"), start: act.selectionStart, end: act.selectionEnd };
    }
    var scroll = box.scrollTop;
    box.innerHTML = "";
    if (!R) return;
    var list = el("div", "ol-list");
    list.setAttribute("role", "tree");
    var fs = foldSet(R.root.map);
    olRows().forEach(function (e) {
      var id = e[0], n = R.N[id], depth = e[1];
      var row = el("div", "ol-row" + (depth === 0 ? " ol-root" : "") + (R.rec[id] ? " ol-rec" : ""));
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth + 1));
      row.style.paddingLeft = (8 + Math.min(depth, 12) * 22) + "px";
      var kids = R.kids[id] || [];
      if (kids.length && depth > 0) {
        var open = !own(fs, id);
        row.setAttribute("aria-expanded", open ? "true" : "false");
        var tg = iconBtn("ol-tog", open ? UI.caretD : UI.caretR, t("ol.fold"), function () { toggleFold(id); });
        tg.tabIndex = -1;
        row.appendChild(tg);
      } else row.appendChild(el("span", "ol-tog ol-dot"));
      if (depth > 0 && M.COLORS[n.color]) row.style.setProperty("--branch", M.COLORS[n.color]);
      if (n.emoji) row.appendChild(el("span", "ol-emoji", n.emoji));
      var ta = el("textarea", "ol-text" + (n.done ? " done" : ""));
      ta.rows = 1;
      ta.value = own(olPending, id) ? olPending[id] : n.text;
      ta.setAttribute("data-id", id);
      ta.setAttribute("aria-label", label(n));
      ta.placeholder = depth === 0 ? t("untitled") : "";
      row.appendChild(ta);
      if (n.note || n.url) row.appendChild(el("span", "ol-ind", (n.note ? "≡" : "") + (n.url ? "↗" : "")));
      if (kids.length && own(fs, id)) row.appendChild(el("span", "ol-count", String(M.subtree(R, id).length - 1)));
      row.appendChild(iconBtn("ol-more", UI.more, t("btn.more"), function (ev) {
        var r = ev.currentTarget.getBoundingClientRect();
        sel = id;
        openNodeMenu(id, r.left, r.bottom);
      }));
      list.appendChild(row);
    });
    box.appendChild(list);
    [].forEach.call(box.querySelectorAll("textarea.ol-text"), autosize);
    box.scrollTop = scroll;
    if (olFocus) {
      var f = box.querySelector('textarea[data-id="' + CSS.escape(olFocus.id) + '"]');
      if (f) {
        f.focus({ preventScroll: true });
        try { f.setSelectionRange(olFocus.start, olFocus.end); } catch (e) {}
      }
    }
    renderOlbar();
  }
  function autosize(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
  function focusRow(id, toEnd) {
    if (unfoldTo(id)) refresh();
    var ta = $("outline").querySelector('textarea[data-id="' + CSS.escape(id) + '"]');
    if (!ta) return;
    ta.focus();
    var n = toEnd ? ta.value.length : 0;
    ta.setSelectionRange(n, n);
    olFocus = { id: id, start: n, end: n };
    ta.scrollIntoView({ block: "nearest" });
  }
  // Pending text goes in after a pause, on blur, and before any
  // structural change (one undo entry per node while typing).
  function flushOutline() {
    clearTimeout(olTimer); olTimer = null;
    var ids = Object.keys(olPending);
    if (!ids.length) return;
    var p = olPending;
    olPending = Object.create(null);
    ids.forEach(function (id) {
      if (R && R.N[id]) updateNode(id, { text: M.para(p[id], M.TEXT_LEN) }, "text:" + id);
    });
  }
  function olIds() {
    return [].map.call($("outline").querySelectorAll("textarea.ol-text"), function (x) { return x.getAttribute("data-id"); });
  }
  function olFocusedId() {
    var a = document.activeElement;
    return a && a.classList && a.classList.contains("ol-text") ? a.getAttribute("data-id") : (olFocus && olFocus.id);
  }
  function olNew(id) {
    flushOutline();
    if (tooBig()) return;
    begin("");
    ensureRoot();
    var row;
    if (id === R.root.id || (R.kids[id] || []).length && !isFolded(id)) row = placeUnder(freshNode(R.root.map), id, 0);
    else {
      var pid = R.par[id], idx = kidsRows(pid, null).map(function (n) { return n.id; }).indexOf(id) + 1;
      row = placeUnder(freshNode(R.root.map), pid, idx);
    }
    olWant = { id: row.id, start: 0, end: 0 };
    sel = row.id;
    commit();
  }
  function olDelete(id, viaBackspace) {
    if (id === R.root.id) return;
    if (viaBackspace && (R.kids[id] || []).length) return;
    var ids = olIds(), i = ids.indexOf(id), prev = ids[i - 1];
    delete olPending[id];
    flushOutline();
    if (prev) { var p = R.N[prev]; olWant = { id: prev, start: (p.text || "").length, end: (p.text || "").length }; }
    if (viaBackspace) {
      begin("");
      tombRow("n:" + id);
      commit();
    } else deleteNode(id);
  }
  function olStruct(fn, id) {
    flushOutline();
    var ta = $("outline").querySelector('textarea[data-id="' + CSS.escape(id) + '"]');
    olWant = { id: id, start: ta ? ta.selectionStart : 0, end: ta ? ta.selectionEnd : 0 };
    fn(id);
    olWant = null;                // nothing changed: nothing to restore
  }
  function wireOutline() {
    var box = $("outline");
    box.addEventListener("input", function (e) {
      var ta = e.target;
      if (!ta.classList || !ta.classList.contains("ol-text")) return;
      autosize(ta);
      olPending[ta.getAttribute("data-id")] = ta.value;
      clearTimeout(olTimer);
      olTimer = setTimeout(flushOutline, 700);
    });
    box.addEventListener("focusin", function (e) {
      var ta = e.target;
      if (!ta.classList || !ta.classList.contains("ol-text")) return;
      sel = ta.getAttribute("data-id");
      olFocus = { id: sel, start: ta.selectionStart, end: ta.selectionEnd };
      renderOlbar();
    });
    box.addEventListener("focusout", function (e) {
      if (e.target.classList && e.target.classList.contains("ol-text")) {
        flushOutline();
        setTimeout(renderOlbar, 0);
      }
    });
    box.addEventListener("keydown", function (e) {
      var ta = e.target;
      if (!ta.classList || !ta.classList.contains("ol-text") || e.isComposing) return;
      var id = ta.getAttribute("data-id"), k = e.key;
      if (k === "Enter" && !e.shiftKey) { e.preventDefault(); olNew(id); }
      else if (k === "Tab") { e.preventDefault(); olStruct(e.shiftKey ? outdent : indent, id); }
      else if (k === "Backspace" && !ta.value && ta.selectionStart === 0) { e.preventDefault(); olDelete(id, true); }
      else if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) {
        e.preventDefault();
        olStruct(function (x) { moveBy(x, k === "ArrowUp" ? -1 : 1); }, id);
      } else if ((k === "ArrowUp" && ta.selectionStart === 0 && ta.selectionEnd === 0) ||
                 (k === "ArrowDown" && ta.selectionStart === ta.value.length)) {
        var ids = olIds(), i = ids.indexOf(id) + (k === "ArrowUp" ? -1 : 1);
        if (ids[i]) { e.preventDefault(); focusRow(ids[i], k === "ArrowUp"); }
      }
    });
  }
  function renderOlbar() {
    var bar = $("olbar");
    var id = olFocusedId();
    var show = prefs.view === "outline" && R && id && R.N[id] && document.activeElement &&
               document.activeElement.classList && document.activeElement.classList.contains("ol-text");
    bar.hidden = !show;
    if (!show) return;
    bar.innerHTML = "";
    function b(icon, key, fn, off) {
      var x = iconBtn("nb-btn", icon, t(key), null);
      x.disabled = !!off;
      // pointerdown: act before the textarea loses focus
      x.addEventListener("pointerdown", function (e) { e.preventDefault(); });
      x.addEventListener("click", function () { var cur = olFocusedId(); if (cur && R.N[cur]) fn(cur); });
      bar.appendChild(x);
    }
    var root = id === R.root.id;
    b(UI.outdent, "ol.outdent", function (x) { olStruct(outdent, x); }, root || R.par[id] === R.root.id);
    b(UI.indent, "ol.indent", function (x) { olStruct(indent, x); }, root);
    b(UI.up, "ol.up", function (x) { olStruct(function (y) { moveBy(y, -1); }, x); }, root);
    b(UI.down, "ol.down", function (x) { olStruct(function (y) { moveBy(y, 1); }, x); }, root);
    b(UI.plus, "ol.new", function (x) { olNew(x); });
    b(UI.info, "nb.details", function (x) { flushOutline(); openDetails(x); });
    b(UI.trash, "ol.delete", function (x) { olDelete(x, false); }, root);
  }

  // ---------- 8. Details, node menu, node bar ----------
  // The branch under `id` as its own tree (exports, copy). Links
  // whose both ends are in the branch come along.
  function subR(id) {
    var inside = null;
    if (id !== R.root.id) { inside = {}; M.subtree(R, id).forEach(function (x) { inside[x] = 1; }); }
    return { map: R.map, root: R.N[id], N: R.N, kids: R.kids, par: R.par, rec: id === R.root.id ? R.rec : {}, count: 0,
             pos: R.pos, img: R.img, sty: R.sty, kind: R.kind,
             frames: (R.frames || []).filter(function (f) { return !inside || f.nodes.some(function (x) { return own(inside, x); }); }),
             links: (R.links || []).filter(function (l) { return !inside || (own(inside, l.from) && own(inside, l.to)); }) };
  }

  function openDetails(id) {
    var n = R && R.N[id];
    if (!n) return;
    var dlg = makeDialog("mm-det", t("det.title"));
    dlg.classList.add("wide");
    var form = el("form", "det-form");
    form.method = "dialog";
    form.noValidate = true;                    // the link is checked (and fixed) by cleanUrl
    function field(lbl, input) {
      var f = el("label", "fld");
      f.appendChild(el("span", "fld-lbl", lbl));
      f.appendChild(input);
      return f;
    }
    if (R.rec[id]) form.appendChild(el("p", "dlg-sub rec-note", t("det.rec")));
    var txt = el("textarea");
    txt.rows = 3; txt.maxLength = M.TEXT_LEN; txt.value = n.text;
    form.appendChild(field(t("det.text"), txt));
    var row = el("div", "fld-grid");
    var emo = el("input");
    emo.type = "text"; emo.value = n.emoji; emo.maxLength = 32; emo.autocomplete = "off";
    row.appendChild(field(t("det.emoji"), emo));
    var picks = el("div", "emo-picks");
    picks.setAttribute("role", "group");
    picks.setAttribute("aria-label", t("det.icons"));
    ["⭐", "❗", "❓", "✅", "❌", "💡", "⚠️", "🔥", "📌", "🚩", "❤️", "1️⃣", "2️⃣", "3️⃣"].forEach(function (g) {
      var b = el("button", "emo-pick", g);
      b.type = "button";
      b.setAttribute("aria-pressed", emo.value === g ? "true" : "false");
      b.addEventListener("click", function () {
        emo.value = emo.value === g ? "" : g;
        [].forEach.call(picks.children, function (x) { x.setAttribute("aria-pressed", x.textContent === emo.value ? "true" : "false"); });
      });
      picks.appendChild(b);
    });
    emo.addEventListener("input", function () {
      [].forEach.call(picks.children, function (x) { x.setAttribute("aria-pressed", x.textContent === emo.value ? "true" : "false"); });
    });
    var doneL = el("label", "chk");
    var done = el("input");
    done.type = "checkbox"; done.checked = n.done;
    doneL.appendChild(done);
    doneL.appendChild(el("span", "", t("det.done")));
    if (id !== R.root.id) row.appendChild(doneL);
    form.appendChild(row);
    form.appendChild(picks);
    var color = n.color;
    if (id !== R.root.id) {
      var cf = el("fieldset", "seg-field");
      cf.appendChild(el("legend", "fld-lbl", t("det.color")));
      var chips = el("div", "swatches");
      [""].concat(M.COLOR_KEYS).forEach(function (k) {
        var b = el("button", "swatch" + (k ? "" : " auto"));
        b.type = "button";
        if (k) b.style.background = M.COLORS[k]; else b.textContent = "A";
        b.setAttribute("aria-label", k ? t("col." + k) : t("det.auto"));
        b.title = k ? t("col." + k) : t("det.auto");
        b.setAttribute("aria-pressed", color === k ? "true" : "false");
        b.addEventListener("click", function () {
          color = k;
          [].forEach.call(chips.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        });
        chips.appendChild(b);
      });
      cf.appendChild(chips);
      form.appendChild(cf);
    }
    var note = el("textarea");
    note.rows = 4; note.maxLength = M.NOTE_LEN; note.value = n.note;
    form.appendChild(field(t("det.note"), note));
    var url = el("input");
    url.type = "text"; url.value = n.url; url.placeholder = "https://"; url.autocomplete = "off"; url.inputMode = "url";
    url.className = "det-url"; emo.className = "det-emoji";
    var urlRow = el("div", "url-row");
    urlRow.appendChild(url);
    var openB = iconBtn("icon-btn", UI.link, t("det.open"), function () {
      var u = M.cleanUrl(url.value);
      if (!u) { showToast(t("det.badUrl")); return; }
      try { window.open(u, "_blank", "noopener,noreferrer"); } catch (e) {}
    });
    urlRow.appendChild(openB);
    var uf = field(t("det.url"), urlRow);
    form.appendChild(uf);
    // picture: undefined = unchanged, null = remove, {src,w,h} = new
    var pic, curPic = R.img && R.img[id] ? R.img[id] : null;
    var pf = el("div", "fld");
    pf.appendChild(el("span", "fld-lbl", t("det.pic")));
    var picRow = el("div", "pic-row");
    pf.appendChild(picRow);
    function drawPic() {
      picRow.innerHTML = "";
      var shown = pic === undefined ? curPic : pic;
      if (shown) {
        var im = el("img", "pic-thumb");
        im.alt = "";
        im.src = shown.src;                    // validated data:image URI only
        picRow.appendChild(im);
      }
      picRow.appendChild(textBtn("dlg-btn", t("det.picAdd"), function () {
        pickPicture(id).then(function (r) { if (r) { pic = r; drawPic(); } });
      }));
      if (shown) picRow.appendChild(textBtn("dlg-btn", t("det.picDel"), function () { pic = null; drawPic(); }));
    }
    drawPic();
    form.appendChild(pf);
    var acts = el("div", "dlg-actions");
    if (R.rec[id]) acts.appendChild(textBtn("dlg-btn", t("ctx.keep"), function () { dlg.close(); moveNode(id, R.root.id); }));
    acts.appendChild(textBtn("dlg-btn", t("cancel"), function () { dlg.close(); }));
    var save = textBtn("dlg-btn primary", t("save"));
    save.type = "submit";
    acts.appendChild(save);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var u = url.value.trim() ? M.cleanUrl(url.value) : "";
      if (url.value.trim() && !u) { showToast(t("det.badUrl")); url.focus(); return; }
      dlg.close();
      if (!R.N[id]) return;
      var patch = { text: M.para(txt.value, M.TEXT_LEN), emoji: M.emoji(emo.value), done: done.checked,
                    color: color, note: M.para(note.value, M.NOTE_LEN), url: u };
      if (pic === undefined) { updateNode(id, patch); return; }
      begin("");
      ensureRoot();
      var cur = R.N[id], next = clone(cur);
      delete next.virtual;
      Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
      if (JSON.stringify(M.normNode(Object.assign({}, cur, { m: 1 }))) !== JSON.stringify(M.normNode(Object.assign({}, next, { m: 1 })))) {
        next.m = nextM(id, NODES[id]);
        putNode(next);
      }
      if (pic) putImg({ id: id, m: nextM(id, IMGS[id] || NODES[id]), map: R.root.map, src: pic.src, w: pic.w, h: pic.h });
      else if (IMGS[id]) tombRow("i:" + id);
      commit();
    });
    dlg.appendChild(form);
    showDialog(dlg);
    txt.focus();
  }

  // Pictures are re-drawn on a canvas and stored as a small JPEG data
  // URI (nothing of the original file is kept: no EXIF, no script).
  var PIC_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";
  function picBytesUsed(except) {
    var n = 0;
    Object.keys(IMGS).forEach(function (k) { if (k !== except && IMGS[k].src) n += IMGS[k].src.length; });
    return n;
  }
  function encodePicture(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var w0 = im.naturalWidth, h0 = im.naturalHeight;
        if (!w0 || !h0) { resolve(null); return; }
        var side = Math.min(M.IMG_MAX, 480), out = null;
        try {
          for (var round = 0; round < 6 && !out; round++) {
            var k = Math.min(1, side / Math.max(w0, h0));
            var cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
            var g = cv.getContext("2d");
            g.fillStyle = "#ffffff";
            g.fillRect(0, 0, cv.width, cv.height);
            g.drawImage(im, 0, 0, cv.width, cv.height);
            for (var q = 0.82; q >= 0.5 && !out; q -= 0.1) {
              var src = cv.toDataURL("image/jpeg", q);
              if (M.validImg(src)) out = { src: src, w: cv.width, h: cv.height };
            }
            side = Math.round(side * 0.75);
          }
        } catch (e) { out = null; }
        resolve(out);
      };
      im.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }
  function pickPicture(id) {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(PIC_ACCEPT) : localPickFile(PIC_ACCEPT);
    return Promise.resolve(pick).then(function (file) {
      if (!file) return null;
      if (file.size > 30 * 1024 * 1024) { showToast(t("toast.picBad")); return null; }
      return encodePicture(file).then(function (r) {
        if (!r) { showToast(t("toast.picBad")); return null; }
        if (picBytesUsed(id) + r.src.length > M.IMG_TOTAL) { showToast(t("toast.picBudget")); return null; }
        return r;
      });
    }).catch(function () { showToast(t("toast.picBad")); return null; });
  }

  // fromPress: opened by a long press while the finger is still down.
  function openNodeMenu(id, x, y, fromPress) {
    if (!R || !R.N[id]) return;
    var n = R.N[id], root = id === R.root.id, has = (R.kids[id] || []).length > 0;
    var items = [
      ["ctx.edit", function () { startEdit(id, null, false); }],
      ["ctx.child", function () { addChild(id); }]
    ];
    if (!root) items.push(["ctx.sibling", function () { addSibling(id); }]);
    items.push(["ctx.details", function () { openDetails(id); }]);
    items.push(["ctx.style", function () { openStyle(id); }]);
    items.push(["ctx.copyStyle", function () { copyStyle(id); }]);
    if (styleClip) items.push(["ctx.pasteStyle", function () { pasteStyle(id); }]);
    if (!root) items.push(["ctx.frame", function () { openFrame(null, id); }]);
    if (has && !root) items.push([isFolded(id) ? "ctx.unfold" : "ctx.fold", function () { toggleFold(id); }]);
    if (!root) {
      items.push([n.done ? "ctx.undone" : "ctx.done", function () { updateNode(id, { done: !n.done }); }]);
      if (R.rec[id]) items.push(["ctx.keep", function () { moveNode(id, R.root.id); }]);
      else {
        items.push(["ctx.up", function () { moveBy(id, -1); }]);
        items.push(["ctx.down", function () { moveBy(id, 1); }]);
      }
    }
    items.push(["ctx.link", function () { startLink(id); }]);
    if (isMoved(id)) items.push(["ctx.resetPos", function () { resetPos(id); }]);
    items.push(["ctx.copy", function () { copyText(M.toOutline(subR(id))); }]);
    items.push(["ctx.paste", function () { openPaste(id); }]);
    items.push(["ctx.export", function () { openExport(id); }]);
    items.push(["ctx.todo", function () { sendToTodo(id); }]);
    items.push(["ctx.notes", function () { sendToNotes(id); }]);
    if (has) items.push(["ctx.slides", function () { sendToSlides(id); }]);
    if (sendApi()) items.push(["ctx.sendApp", function () { sendBranch(id); }]);
    items.push(["ctx.present", function () { startPresent(id); }]);
    if (!root) items.push(["ctx.delete", function () { deleteNode(id); }, "danger"]);
    openMenuAt(items, x, y, null, false, fromPress);
  }

  function renderNodebar() {
    var bar = $("nodebar");
    var lk = prefs.view === "map" && R && selLink && !editing ? linkRow(selLink) : null;
    var fr = prefs.view === "map" && R && selFrame && !editing ? FRAMES[selFrame] : null;
    var show = !pres && (!!lk || !!fr || (prefs.view === "map" && R && sel && R.N[sel] && !editing && !linking));
    bar.hidden = !show;
    $("zoom").classList.toggle("lift", !!show);
    if (!show) return;
    bar.innerHTML = "";
    if (fr) {
      [[UI.edit, "fr.edit", function () { openFrame(fr.id); }],
       [UI.trash, "fr.delete", function () { deleteFrame(fr.id); }]].forEach(function (d, i) {
        var x = iconBtn("nb-btn", d[0], t(d[1]), d[2]);
        x.appendChild(el("span", "nb-lbl", t(d[1])));
        if (i === 1) x.classList.add("danger");
        bar.appendChild(x);
      });
      return;
    }
    if (lk) {
      [[UI.edit, "link.edit", function () { editLinkLabel(lk.id); }],
       [UI.swap, "link.reverse", function () { reverseLink(lk.id); }],
       [UI.trash, "link.delete", function () { deleteLink(lk.id); }]].forEach(function (d, i) {
        var x = iconBtn("nb-btn", d[0], t(d[1]), d[2]);
        x.appendChild(el("span", "nb-lbl", t(d[1])));
        if (i === 2) x.classList.add("danger");
        bar.appendChild(x);
      });
      bar.appendChild(iconBtn("nb-btn nb-more", UI.more, t("btn.more"), function (e) {
        var r = e.currentTarget.getBoundingClientRect();
        openLinkMenu(lk.id, r.right, r.top);
      }));
      return;
    }
    var id = sel, root = id === R.root.id, has = (R.kids[id] || []).length > 0;
    function b(icon, key, fn) {
      var x = iconBtn("nb-btn", icon, t(key), fn);
      x.appendChild(el("span", "nb-lbl", t(key)));
      bar.appendChild(x);
      return x;
    }
    b(UI.child, "nb.child", function () { addChild(id); });
    if (!root) b(UI.sib, "nb.sibling", function () { addSibling(id); });
    b(UI.edit, "nb.edit", function () { startEdit(id, null, false); });
    b(UI.info, "nb.details", function () { openDetails(id); });
    b(UI.style, "nb.style", function () { openStyle(id); });
    if (has && !root) b(UI.foldI, isFolded(id) ? "nb.unfold" : "nb.fold", function () { toggleFold(id); });
    if (!root) b(UI.trash, "nb.delete", function () { deleteNode(id); }).classList.add("danger");
    bar.appendChild(iconBtn("nb-btn nb-more", UI.more, t("btn.more"), function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      openNodeMenu(id, r.right, r.top);
    }));
  }

  // ---------- 8b. Styles, boundaries, layouts (wave 27) ----------
  // A row of toggle chips (wraps on a phone). opts: [[value, label, iconSvg?]]
  function chipGroup(legend, opts, val, onPick, iconOnly) {
    var fs = el("fieldset", "seg-field");
    fs.appendChild(el("legend", "fld-lbl", legend));
    var box = el("div", "chips" + (iconOnly ? " icons" : ""));
    opts.forEach(function (op) {
      var b = el("button", "chip");
      b.type = "button";
      if (op[2]) { b.innerHTML = op[2]; b.setAttribute("aria-label", op[1]); b.title = op[1]; }   // static icon markup only
      else b.textContent = op[1];
      b.setAttribute("aria-pressed", op[0] === val ? "true" : "false");
      b.addEventListener("click", function () {
        [].forEach.call(box.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        onPick(op[0]);
      });
      box.appendChild(b);
    });
    fs.appendChild(box);
    return fs;
  }
  function swatchGroup(legend, val, onPick) {
    var cf = el("fieldset", "seg-field");
    cf.appendChild(el("legend", "fld-lbl", legend));
    var chips = el("div", "swatches");
    [""].concat(M.COLOR_KEYS).forEach(function (k) {
      var b = el("button", "swatch" + (k ? "" : " auto"));
      b.type = "button";
      if (k) b.style.background = M.COLORS[k]; else b.textContent = "A";
      b.setAttribute("aria-label", k ? t("col." + k) : t("det.auto"));
      b.title = k ? t("col." + k) : t("det.auto");
      b.setAttribute("aria-pressed", val === k ? "true" : "false");
      b.addEventListener("click", function () {
        onPick(k);
        [].forEach.call(chips.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      });
      chips.appendChild(b);
    });
    cf.appendChild(chips);
    return cf;
  }
  function sv(body) {
    return '<svg viewBox="0 0 32 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">' + body + "</svg>";
  }
  var SHAPE_ICON = {
    "":      sv('<rect x="3" y="4" width="26" height="14" rx="4"/><path d="M11 11h10" stroke-dasharray="2 2"/>'),
    rect:    sv('<rect x="3" y="4" width="26" height="14" rx="0.5"/>'),
    round:   sv('<rect x="3" y="4" width="26" height="14" rx="5"/>'),
    pill:    sv('<rect x="3" y="4" width="26" height="14" rx="7"/>'),
    ellipse: sv('<ellipse cx="16" cy="11" rx="13" ry="8"/>'),
    diamond: sv('<path d="M16 2L30 11L16 20L2 11Z"/>'),
    hex:     sv('<path d="M8 3H24L30 11L24 19H8L2 11Z"/>'),
    line:    sv('<path d="M3 17H29"/><path d="M8 11h16" stroke-width="1.5" opacity=".6"/>'),
    none:    sv('<path d="M8 11h16" stroke-width="1.5" opacity=".6"/>')
  };
  var styleClip = null;                    // copied style (session only)
  function styleOf(id) {
    var s = STYLES[id];
    return { shape: s ? s.shape : "", fill: s ? s.fill : "", border: s ? s.border : "", size: s ? s.size : "", bold: !!(s && s.bold) };
  }
  // Writes `st` (shape, fill, border, size, bold) on every id; no row
  // for a node that already looks like that (R27).
  function writeStyles(ids, st) {
    ids.forEach(function (id) {
      if (!R.N[id] || R.N[id].virtual) return;
      var cur = STYLES[id], want = M.normStyle(Object.assign({ id: id, m: 1, map: R.root.map }, st));
      if (!want) return;
      if (cur ? JSON.stringify(Object.assign({}, cur, { m: 1 })) === JSON.stringify(want) : M.plainStyle(want)) return;
      want.m = nextM(id, cur || NODES[id]);
      putStyle(want);
    });
  }
  function openStyle(id) {
    var n = R && R.N[id];
    if (!n) return;
    var st = styleOf(id), color = n.color, root = id === R.root.id;
    var dlg = makeDialog("mm-style", t("sty.title"));
    dlg.classList.add("wide");
    dlg.appendChild(el("p", "dlg-sub", label(n, 60)));
    dlg.appendChild(chipGroup(t("sty.shape"), M.SHAPES.map(function (k) { return [k, t("shape." + (k || "auto")), SHAPE_ICON[k]]; }),
      st.shape, function (v) { st.shape = v; }, true));
    dlg.appendChild(chipGroup(t("sty.fill"), M.FILLS.map(function (k) { return [k, t("fill." + (k || "auto"))]; }),
      st.fill, function (v) { st.fill = v; }));
    dlg.appendChild(chipGroup(t("sty.border"), M.BORDERS.map(function (k) { return [k, t("border." + (k || "auto"))]; }),
      st.border, function (v) { st.border = v; }));
    dlg.appendChild(chipGroup(t("sty.size"), ["s", "", "l"].map(function (k) { return [k, t("size." + (k || "m"))]; }),
      st.size, function (v) { st.size = v; }));
    var bl = el("label", "chk");
    var bcb = el("input");
    bcb.type = "checkbox"; bcb.checked = st.bold;
    bcb.addEventListener("change", function () { st.bold = bcb.checked; });
    bl.appendChild(bcb);
    bl.appendChild(el("span", "", t("sty.bold")));
    dlg.appendChild(bl);
    if (!root) dlg.appendChild(swatchGroup(t("det.color"), color, function (k) { color = k; }));
    var has = (R.kids[id] || []).length > 0, all = null;
    if (has) {
      var al = el("label", "chk");
      all = el("input");
      all.type = "checkbox";
      al.appendChild(all);
      al.appendChild(el("span", "", t("sty.branch")));
      dlg.appendChild(al);
    }
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(textBtn("dlg-btn", t("sty.reset"), function () {
      dlg.close();
      apply({ shape: "", fill: "", border: "", size: "", bold: false }, n.color);
    }));
    acts.appendChild(textBtn("dlg-btn", t("cancel"), function () { dlg.close(); }));
    acts.appendChild(textBtn("dlg-btn primary", t("save"), function () { dlg.close(); apply(st, color); }));
    dlg.appendChild(acts);
    function apply(s2, col) {
      if (!R.N[id]) return;
      begin("");
      ensureRoot();
      writeStyles(all && all.checked ? M.subtree(R, id) : [id], s2);
      if (!root && col !== R.N[id].color) {
        var next = clone(R.N[id]);
        next.color = col; next.m = nextM(id, NODES[id]);
        putNode(next);
      }
      commit();
    }
    showDialog(dlg);
  }
  function copyStyle(id) { styleClip = styleOf(id); showToast(t("toast.styleCopied")); }
  function pasteStyle(id) {
    if (!styleClip || !R || !R.N[id]) return;
    begin("");
    ensureRoot();
    writeStyles([id], styleClip);
    commit();
  }

  // Boundary (box) or summary (brace) around sibling ideas. New: the
  // node and the siblings ticked; editing: the same dialog.
  function openFrame(fid, fromId) {
    var f = fid ? FRAMES[fid] : null;
    if (!R || (fid && !f)) return;
    var members = {}, anchor = fromId;
    if (f) {
      f.nodes.forEach(function (x) { members[x] = 1; });
      anchor = f.nodes.filter(function (x) { return R.N[x] && R.par[x]; })[0];
    } else if (anchor) members[anchor] = 1;
    if (!anchor || !R.N[anchor] || anchor === R.root.id) return;
    var kind = f ? f.kind : "box", color = f ? f.color : "";
    var dlg = makeDialog("mm-frame", t(f ? "fr.editT" : "fr.new"));
    dlg.classList.add("wide");
    var form = el("form");
    form.method = "dialog";
    form.appendChild(chipGroup(t("fr.kind"), [["box", t("fr.boundary")], ["brace", t("fr.summary")]], kind, function (v) { kind = v; }));
    var lf = el("label", "fld");
    lf.appendChild(el("span", "fld-lbl", t("fr.label")));
    var inp = el("input");
    inp.type = "text"; inp.value = f ? f.label : ""; inp.placeholder = t("fr.ph"); inp.maxLength = M.LABEL_LEN; inp.autocomplete = "off";
    lf.appendChild(inp);
    form.appendChild(lf);
    form.appendChild(swatchGroup(t("fr.color"), color, function (k) { color = k; }));
    // the siblings of the anchor, plus members that live elsewhere
    var sibs = (R.kids[R.par[anchor]] || []).filter(function (x) { return !R.rec[x]; }).slice(0, 200);
    Object.keys(members).forEach(function (x) { if (R.N[x] && sibs.indexOf(x) === -1) sibs.push(x); });
    var mf = el("fieldset", "seg-field");
    mf.appendChild(el("legend", "fld-lbl", t("fr.members")));
    var list = el("div", "fr-list"), boxes = [];
    sibs.forEach(function (x) {
      var l = el("label", "chk");
      var cb = el("input");
      cb.type = "checkbox"; cb.checked = own(members, x); cb.value = x;
      l.appendChild(cb);
      l.appendChild(el("span", "", label(R.N[x], 60)));
      list.appendChild(l);
      boxes.push(cb);
    });
    mf.appendChild(list);
    form.appendChild(mf);
    var acts = el("div", "dlg-actions wrap");
    if (f) acts.appendChild(textBtn("dlg-btn danger", t("fr.delete"), function () { dlg.close(); deleteFrame(fid); }));
    acts.appendChild(textBtn("dlg-btn", t("cancel"), function () { dlg.close(); }));
    var ok = textBtn("dlg-btn primary", t("save"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ids = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
      // members that are gone from this device stay members
      if (f) f.nodes.forEach(function (x) { if (!R.N[x] && ids.indexOf(x) === -1) ids.push(x); });
      if (!ids.some(function (x) { return R.N[x]; })) { showToast(t("fr.none")); return; }
      if (ids.length > M.FRAME_NODES) { showToast(t("fr.many", { n: M.FRAME_NODES })); return; }
      dlg.close();
      var row = { id: f ? f.id : newId(), m: 0, map: R.root.map, nodes: ids, kind: kind, label: M.line(inp.value, M.LABEL_LEN), color: color };
      var want = M.normFrame(Object.assign({}, row, { m: 1 }));
      if (f && JSON.stringify(Object.assign({}, f, { m: 1 })) === JSON.stringify(want)) return;
      begin("");
      ensureRoot();
      row.m = nextM(row.id, f);
      var x = putFrame(row);
      commit();
      if (x) selectFrame(x.id);
    });
    dlg.appendChild(form);
    showDialog(dlg);
    if (!f) inp.focus();
  }
  function deleteFrame(fid) {
    if (!FRAMES[fid]) return;
    var kind = FRAMES[fid].kind;
    begin("");
    tombRow("f:" + fid);
    selFrame = null;
    commit();
    undoToast(t(kind === "brace" ? "toast.summaryDeleted" : "toast.boundaryDeleted"), undo);
  }
  function openFrameMenu(fid, x, y, fromPress) {
    if (!FRAMES[fid]) return;
    openMenuAt([
      ["fr.edit", function () { openFrame(fid); }],
      ["fr.delete", function () { deleteFrame(fid); }, "danger"]
    ], x, y, null, false, fromPress);
  }

  var LAYOUT_OPTS = [
    ["", "both", "lay.both", '<circle cx="16" cy="11" r="3.5"/><path d="M12.5 11H8M19.5 11H24M8 5v12M24 5v12M8 5H4M8 17H4M24 5h4M24 17h4"/>'],
    ["", "right", "lay.right", '<circle cx="7" cy="11" r="3.5"/><path d="M10.5 11H15M15 4v14M15 4h12M15 11h12M15 18h12"/>'],
    ["org", "", "lay.org", '<rect x="12" y="2" width="8" height="5" rx="1"/><path d="M16 7v4M6 11h20M6 11v4M16 11v4M26 11v4"/><rect x="3" y="15" width="6" height="5" rx="1"/><rect x="13" y="15" width="6" height="5" rx="1"/><rect x="23" y="15" width="6" height="5" rx="1"/>'],
    ["tree", "", "lay.tree", '<rect x="3" y="2" width="10" height="5" rx="1"/><path d="M6 7v12M6 12h6M6 19h6"/><rect x="13" y="9.5" width="14" height="5" rx="1"/><rect x="13" y="16.5" width="14" height="5" rx="1"/>'],
    ["time", "", "lay.time", '<path d="M2 6H30"/><circle cx="6" cy="6" r="2.5"/><circle cx="16" cy="6" r="2.5"/><circle cx="26" cy="6" r="2.5"/><path d="M16 9v9M16 12h4M16 17h4M26 9v5M26 13h3"/>']
  ];
  function openLayout() {
    var mp = curMap();
    if (!mp) return;
    var kind = curLayout(), dlg = makeDialog("mm-layout", t("lay.title"));
    var list = el("div", "lay-list");
    list.setAttribute("role", "radiogroup");
    LAYOUT_OPTS.forEach(function (o) {
      var on = o[0] === kind && (kind || o[1] === mp.sides);
      var b = el("button", "lay-opt");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.innerHTML = sv(o[3]);                  // static icon markup only
      var txt = el("span", "lay-txt");
      txt.appendChild(el("span", "lay-name", t(o[2])));
      txt.appendChild(el("span", "lay-desc", t(o[2] + ".d")));
      b.appendChild(txt);
      b.addEventListener("click", function () { dlg.close(); setLayout(o[0], o[1] || mp.sides); });
      list.appendChild(b);
    });
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("close"), function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
    var cur = list.querySelector('[aria-checked="true"]');
    if (cur) cur.focus();
  }

  // ---------- 8c. Presentation (wave 27) ----------
  // Branch by branch, full screen: each step shows one more idea and
  // the camera frames its main branch; the last step shows the whole
  // map. Keys: → ↓ Space PageDown next, ← ↑ PageUp back, Home / End,
  // Esc ends. Tap the right of the screen for next, the left for back,
  // or swipe. Nothing is written (a view, R10).
  var presAnim = 0;
  function presOnly() {
    var o = {}, n = Math.min(pres.i + 1, pres.steps.length);
    for (var i = 0; i < n; i++) o[pres.steps[i]] = 1;
    return o;
  }
  function presKeep() {
    var id = pres.steps[pres.i];
    if (!id || id === R.root.id) return null;
    var main = M.branchOf(R, id), o = {};
    if (!main) return null;
    o[R.root.id] = 1;
    M.subtree(R, main).forEach(function (x) { o[x] = 1; });
    return o;
  }
  function startPresent(fromId) {
    if (!R || pres) return;
    commitEdit();
    closeMenu();
    if (!$("findbar").hidden) closeFind();
    var steps = M.presentSteps(R, foldSet(R.root.map));
    var i = fromId ? Math.max(0, steps.indexOf(fromId)) : 0;
    pres = { steps: steps, i: i, back: { s: view.s, tx: view.tx, ty: view.ty }, sel: sel, fs: false };
    selLink = null; selFrame = null; sel = null;
    document.body.classList.add("presenting");
    buildPresUi();
    try {
      var de = document.documentElement, rq = de.requestFullscreen || de.webkitRequestFullscreen;
      if (rq && !document.fullscreenElement) {
        var p = rq.call(de);
        pres.fs = true;
        if (p && p.catch) p.catch(function () { if (pres) pres.fs = false; });
      }
    } catch (e) { pres.fs = false; }
    renderMap();
    presGo(i, false);
    live(t("pres.start"));
  }
  function stopPresent() {
    if (!pres) return;
    var back = pres.back, s0 = pres.sel;
    cancelAnimationFrame(presAnim);
    try {
      if (pres.fs && (document.fullscreenElement || document.webkitFullscreenElement)) {
        var ex = document.exitFullscreen || document.webkitExitFullscreen, p = ex && ex.call(document);
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
    pres = null;
    document.body.classList.remove("presenting");
    var ui = $("pres");
    if (ui) ui.remove();
    view.s = back.s; view.tx = back.tx; view.ty = back.ty;
    sel = s0 && R && R.N[s0] ? s0 : null;
    refresh();
    $("svg").focus({ preventScroll: true });
  }
  function presGo(i, animate) {
    if (!pres || !R) return;
    i = Math.max(0, Math.min(pres.steps.length, i));
    var changed = i !== pres.i;
    pres.i = i;
    renderMap();
    presAim(animate !== false && changed);
    var cnt = $("pres-count");
    if (cnt) cnt.textContent = Math.min(i + 1, pres.steps.length + 1) + " / " + (pres.steps.length + 1);
    var pv = $("pres-prev"), nx = $("pres-next");
    if (pv) pv.disabled = i === 0;
    if (nx) nx.disabled = i >= pres.steps.length;
    var id = pres.steps[i];
    live(id && R.N[id] ? label(R.N[id], 120) : t("pres.overview"));
  }
  function presAim(animate) {
    if (!pres || !lay) return;
    var r = stageRect(), v = M.presentView(R, lay, pres.steps, pres.i);
    if (!r.width || !v.w) return;
    var h = Math.max(100, r.height - 64);
    var s = Math.max(0.1, Math.min(1.6, (r.width - 24) / v.w, (h - 16) / v.h));
    var to = { s: s, tx: (r.width - v.w * s) / 2 - v.x * s, ty: (h - v.h * s) / 2 - v.y * s };
    cancelAnimationFrame(presAnim);
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (!animate || reduce) { view.s = to.s; view.tx = to.tx; view.ty = to.ty; applyView(); return; }
    var from = { s: view.s, tx: view.tx, ty: view.ty }, t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / 380), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      view.s = from.s + (to.s - from.s) * e;
      view.tx = from.tx + (to.tx - from.tx) * e;
      view.ty = from.ty + (to.ty - from.ty) * e;
      applyView();
      if (k < 1 && pres) presAnim = requestAnimationFrame(step);
    }
    presAnim = requestAnimationFrame(step);
  }
  function buildPresUi() {
    var old = $("pres");
    if (old) old.remove();
    var ui = el("div", "pres");
    ui.id = "pres";
    var pad = el("div", "pres-pad");
    pad.setAttribute("aria-hidden", "true");
    var down = null;
    pad.addEventListener("pointerdown", function (e) { down = { x: e.clientX, y: e.clientY }; });
    pad.addEventListener("pointerup", function (e) {
      if (!down || !pres) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y, r = pad.getBoundingClientRect();
      down = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { presGo(pres.i + (dx < 0 ? 1 : -1)); return; }
      if (Math.hypot(dx, dy) > 12) return;
      presGo(pres.i + (e.clientX - r.left < r.width / 3 ? -1 : 1));
    });
    pad.addEventListener("pointercancel", function () { down = null; });
    ui.appendChild(pad);
    var bar = el("div", "pres-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("pres.title"));
    var prev = iconBtn("icon-btn", UI.caretL, t("pres.prev"), function () { presGo(pres.i - 1); });
    prev.id = "pres-prev";
    var cnt = el("span", "pres-count");
    cnt.id = "pres-count";
    var next = iconBtn("icon-btn", UI.caretR, t("pres.next"), function () { presGo(pres.i + 1); });
    next.id = "pres-next";
    bar.appendChild(prev);
    bar.appendChild(cnt);
    bar.appendChild(next);
    bar.appendChild(iconBtn("icon-btn", UI.x, t("pres.end"), stopPresent));
    ui.appendChild(bar);
    $("stage").appendChild(ui);
  }
  function presKey(e) {
    var k = e.key;
    if (k === "Escape") { e.preventDefault(); stopPresent(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest(".pres-bar") && (k === "Enter" || k === " ")) return;   // the focused button
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); presGo(pres.i + 1); }
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") { e.preventDefault(); presGo(pres.i - 1); }
    else if (k === "Home") { e.preventDefault(); presGo(0); }
    else if (k === "End") { e.preventDefault(); presGo(pres.steps.length); }
  }

  // ---------- 9. Maps dialog, new map, paste a list ----------
  function openMaps() {
    var dlg = makeDialog("mm-maps", t("maps.title"));
    dlg.classList.add("wide");
    var all = mapList(), q = null;
    if (all.length > 8) {
      q = el("input");
      q.type = "search"; q.placeholder = t("maps.search"); q.setAttribute("aria-label", t("maps.search"));
      dlg.appendChild(q);
    }
    var list = el("div", "map-list");
    dlg.appendChild(list);
    function draw() {
      list.innerHTML = "";
      var f = q ? fold(q.value) : "";
      all.filter(function (x) { return !f || fold(x.title).indexOf(f) !== -1; }).slice(0, 300).forEach(function (x) {
        var row = el("div", "map-row");
        var b = textBtn("map-pick" + (x.id === prefs.map ? " on" : ""), "", function () {
          dlg.close();
          openMap(x.id);
        });
        b.appendChild(el("span", "map-pick-t", x.title));
        b.appendChild(el("span", "map-count", t("maps.nodes", { n: x.count }) + " · " + fmtDate(x.last)));
        row.appendChild(b);
        row.appendChild(iconBtn("icon-btn", UI.edit, t("maps.rename", { name: x.title }), function () { dlg.close(); renameMap(x.id); }));
        row.appendChild(iconBtn("icon-btn", UI.sib, t("maps.copy", { name: x.title }), function () { dlg.close(); duplicateMap(x.id); }));
        row.appendChild(iconBtn("icon-btn danger", UI.trash, t("maps.del", { name: x.title }), function () { dlg.close(); deleteMap(x.id); }));
        list.appendChild(row);
      });
    }
    if (q) q.addEventListener("input", draw);
    draw();
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("close"), function () { dlg.close(); }));
    acts.appendChild(textBtn("dlg-btn primary", t("maps.new"), function () { dlg.close(); newMapDialog(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return "";
    var p = function (v) { return (v < 10 ? "0" : "") + v; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function openMap(mapId) {
    if (!MAPS[mapId]) return;
    commitEdit();
    flushOutline();
    prefs.map = mapId;
    savePrefs();
    sel = null;
    hits = null;
    closeFind();
    refresh();
  }
  function textDialog(title, lbl, value, ph, onOk) {
    var dlg = makeDialog("mm-name", title);
    var form = el("form");
    form.method = "dialog";
    var f = el("label", "fld");
    f.appendChild(el("span", "fld-lbl", lbl));
    var inp = el("input");
    inp.type = "text"; inp.value = value || ""; inp.placeholder = ph || ""; inp.maxLength = 200; inp.required = true;
    f.appendChild(inp);
    form.appendChild(f);
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("cancel"), function () { dlg.close(); }));
    var ok = textBtn("dlg-btn primary", t("ok"));
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = M.line(inp.value, 200);
      if (!v) { inp.focus(); return; }
      dlg.close();
      onOk(v);
    });
    dlg.appendChild(form);
    showDialog(dlg);
    inp.focus();
    inp.select();
  }
  function newMapDialog() {
    textDialog(t("new.title"), t("new.label"), "", t("new.ph"), function (name) {
      commitEdit();
      flushOutline();
      var id = newId(), now = Date.now();
      begin("");
      putMap({ id: id, m: now, sides: "both" });
      putNode({ id: M.rootId(id), m: now, map: id, parent: "", ord: "", text: name });
      prefs.map = id;
      prefs.view = prefs.view || "map";
      savePrefs();
      sel = M.rootId(id);
      commit();
    });
  }
  function renameMap(mapId) {
    var r = NODES[M.rootId(mapId)];
    textDialog(t("rename.title"), t("new.label"), r ? r.text : "", "", function (name) {
      if (mapId !== prefs.map) openMap(mapId);
      if (!R) return;
      ensureRootAndUpdate(name);
    });
  }
  function ensureRootAndUpdate(name) {
    if (R.root.virtual) {
      begin("");
      ensureRoot();
      var r = clone(NODES[R.root.id]);
      r.text = name; r.m = nextM(r.id, r);
      putNode(r);
      commit();
    } else updateNode(R.root.id, { text: name });
  }
  function duplicateMap(mapId) {
    var src = [];
    Object.keys(NODES).forEach(function (id) { if (NODES[id].map === mapId) src.push(NODES[id]); });
    var nid = newId(), now = Date.now(), map = Object.create(null);
    map[M.rootId(mapId)] = M.rootId(nid);
    src.forEach(function (n) { if (!map[n.id]) map[n.id] = newId(); });
    begin("");
    putMap({ id: nid, m: now, sides: MAPS[mapId].sides });
    src.forEach(function (n) {
      var c = clone(n);
      c.id = map[n.id]; c.map = nid; c.m = now;
      c.parent = n.parent && map[n.parent] ? map[n.parent] : (c.id === M.rootId(nid) ? "" : n.parent);
      if (c.id === M.rootId(nid)) c.text = t("maps.copyName", { name: M.title(n.text, 150) || t("untitled") });
      putNode(c);
    });
    if (!src.some(function (n) { return n.id === M.rootId(mapId); })) {
      putNode({ id: M.rootId(nid), m: now, map: nid, parent: "", text: t("maps.copyName", { name: t("untitled") }) });
    }
    values(LINKS).forEach(function (l) {
      if (l.map === mapId && map[l.from] && map[l.to]) putLink({ id: newId(), m: now, map: nid, from: map[l.from], to: map[l.to], label: l.label });
    });
    values(POS).forEach(function (x) {
      if (x.map === mapId && map[x.id] && (x.dx || x.dy)) putPos({ id: map[x.id], m: now, map: nid, dx: x.dx, dy: x.dy });
    });
    values(IMGS).forEach(function (x) {
      if (x.map === mapId && map[x.id] && x.src) putImg({ id: map[x.id], m: now, map: nid, src: x.src, w: x.w, h: x.h });
    });
    values(STYLES).forEach(function (x) {
      if (x.map === mapId && map[x.id] && !M.plainStyle(x)) putStyle(Object.assign(clone(x), { id: map[x.id], m: now, map: nid }));
    });
    values(FRAMES).forEach(function (f) {
      if (f.map !== mapId) return;
      var ids = f.nodes.filter(function (x) { return map[x]; }).map(function (x) { return map[x]; });
      if (ids.length) putFrame({ id: newId(), m: now, map: nid, nodes: ids, kind: f.kind, label: f.label, color: f.color });
    });
    if (LAYOUTS[mapId] && LAYOUTS[mapId].kind) putLayout({ id: nid, m: now, map: nid, kind: LAYOUTS[mapId].kind });
    prefs.map = nid;
    savePrefs();
    sel = null;
    commit();
  }
  function deleteMap(mapId) {
    var name = mapTitle(mapId);
    begin("");
    Object.keys(LINKS).forEach(function (id) { if (LINKS[id].map === mapId) tombRow("l:" + id); });
    Object.keys(POS).forEach(function (id) { if (POS[id].map === mapId) touch("p:" + id); });
    Object.keys(IMGS).forEach(function (id) { if (IMGS[id].map === mapId) touch("i:" + id); });
    Object.keys(STYLES).forEach(function (id) { if (STYLES[id].map === mapId) touch("s:" + id); });
    Object.keys(FRAMES).forEach(function (id) { if (FRAMES[id].map === mapId) tombRow("f:" + id); });
    if (LAYOUTS[mapId]) touch("v:" + mapId);
    Object.keys(NODES).forEach(function (id) { if (NODES[id].map === mapId) tombRow("n:" + id); });
    tombRow("m:" + mapId);
    if (prefs.map === mapId) { prefs.map = null; sel = null; }
    commit();
    ensureMap();
    savePrefs();
    refresh();
    undoToast(t("toast.mapDeleted", { name: name }), function () { undo(); });
  }
  function createExample() {
    var ex = M.exampleRows(LANG, Date.now());
    begin("");
    var mp = MAPS[ex.map.id];
    ex.map.m = nextM(ex.map.id, mp);
    putMap(ex.map);
    ex.nodes.forEach(function (n) { n.m = nextM(n.id, NODES[n.id]); putNode(n); });
    prefs.map = ex.map.id;
    savePrefs();
    sel = null;
    camFor = null;
    commit();
  }

  function openPaste(underId, prefill) {
    var dlg = makeDialog("mm-paste", t("paste.title"));
    dlg.classList.add("wide");
    dlg.appendChild(el("p", "dlg-sub", t("paste.hint")));
    var ta = el("textarea", "paste-ta");
    ta.rows = 10;
    ta.spellcheck = false;
    if (typeof prefill === "string") ta.value = prefill;
    dlg.appendChild(ta);
    var target = R && underId && R.N[underId] ? underId : null;
    dlg.appendChild(el("p", "dlg-sub", target ? t("paste.under", { name: label(R.N[target], 50) }) : t("paste.newMap")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("cancel"), function () { dlg.close(); }));
    acts.appendChild(textBtn("dlg-btn primary", t("paste.add"), function () {
      var v = ta.value;
      dlg.close();
      if (target && R && R.N[target]) pasteList(v, target);
      else importOutlineText(v, t("untitled"));
    }));
    dlg.appendChild(acts);
    showDialog(dlg);
    ta.focus();
  }
  // Markdown / text: mm-import's reader (front matter, Logseq
  // properties and inline Markdown cleaned), mm-core's as fallback.
  function readOutline(text, fallback) {
    var X = window.MMImport;
    return X && X.parseMarkdown ? X.parseMarkdown(text, fallback) : M.parseOutline(text, fallback);
  }
  function pasteList(text, underId) {
    var p = readOutline(text, "");
    if (!p.ok) { showToast(t("imp.err.empty")); return; }
    var tops = M.topsOf(p.tree);
    if (R.count + 1 >= M.MAX_NODES) { showToast(t("toast.tooMany")); return; }
    begin("");
    ensureRoot();
    var sibs = kidsRows(underId, null), keys = [], lo = sibs.length ? sibs[sibs.length - 1].ord : "";
    if (sibs.length && !M.validOrd(lo)) lo = "";
    for (var i = 0; i < tops.length; i++) { var k = M.between(lo, null) || M.spread(1)[0]; keys.push(k); lo = k; }
    var rows = M.treeToRows(p.tree, newId, Date.now(), { map: R.root.map, parent: underId, keys: keys });
    rows.nodes.slice(0, M.MAX_NODES - R.count).forEach(function (n) { n.m = stamp(n.m); putNode(n); });
    if (isFolded(underId)) setFold(underId, false);
    sel = underId;
    commit();
  }
  function importOutlineText(text, fallback) {
    var p = readOutline(text, fallback);
    if (!p.ok) { showToast(t(p.err === "size" ? "imp.err.size" : "imp.err.empty")); return; }
    addTreeAsMap(p.tree);
  }
  function addTreeAsMap(tree, msg) {
    commitEdit();
    flushOutline();
    var rows = M.treeToRows(tree, newId, Date.now());
    begin("");
    putMap(rows.map);
    rows.nodes.forEach(putNode);
    rows.links.forEach(putLink);
    prefs.map = rows.map.id;
    savePrefs();
    sel = null;
    camFor = null;
    commit();
    undoToast(msg || t("imp.newMap"), function () { undo(); });
  }

  // ---------- 10. Find ----------
  function openFind() {
    if (!R) return;
    $("findbar").hidden = false;
    var inp = $("find-input");
    inp.focus();
    inp.select();
    runFind();
  }
  function closeFind() {
    $("findbar").hidden = true;
    var had = !!hits;
    hits = null; hitList = []; hitAt = -1;
    $("find-count").textContent = "";
    if (had) refresh();
  }
  function runFind() {
    var q = fold($("find-input").value.trim());
    if (!q || !R) { hits = null; hitList = []; hitAt = -1; $("find-count").textContent = ""; refresh(); return; }
    hits = {}; hitList = [];
    M.subtree(R, R.root.id).forEach(function (id) {
      var n = R.N[id];
      if (fold(n.text + " " + n.emoji + " " + n.note).indexOf(q) !== -1) { hits[id] = 1; hitList.push(id); }
    });
    hitAt = hitList.length ? 0 : -1;
    showHit();
  }
  function stepFind(d) {
    if (!hitList.length) return;
    hitAt = (hitAt + d + hitList.length) % hitList.length;
    showHit();
  }
  function showHit() {
    $("find-count").textContent = hitList.length ? (hitAt + 1) + "/" + hitList.length : t("find.none");
    if (hitAt < 0) { refresh(); return; }
    var id = hitList[hitAt];
    unfoldTo(id);
    sel = id;
    refresh();
    if (prefs.view === "map") {
      if (view.s < 0.8) { view.s = 0.9; centerOn(id); } else reveal(id);
    } else {
      var ta = $("outline").querySelector('textarea[data-id="' + CSS.escape(id) + '"]');
      if (ta) ta.scrollIntoView({ block: "center" });
    }
  }

  // ---------- 11. Export + import ----------
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
    var s = String(name || "mind-map").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
    return (s || "mind-map").slice(0, 60);
  }
  function copyText(text) {
    var done = function () { showToast(t("toast.copied")); };
    var fail = function () { showToast(t("toast.copyFail")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fail); return; }
    } catch (e) {}
    fail();
  }

  var FMT = {
    png:  { ext: ".png",  mime: "image/png", desc: "PNG" },
    svg:  { ext: ".svg",  mime: "image/svg+xml", desc: "SVG" },
    md:   { ext: ".md",   mime: "text/markdown", desc: "Markdown" },
    opml: { ext: ".opml", mime: "text/x-opml", desc: "OPML" },
    json: { ext: ".json", mime: "application/json", desc: "JSON" },
    oros: { ext: ".orosmind", mime: "application/x-oros-mind", desc: "orOS Mind Map" }
  };
  // The export always draws the map unfolded.
  function buildSvg(rootId, o) {
    var r = subR(rootId);
    var l = M.layout(r, { measure: measure, fold: {}, placeholder: t("untitled") });
    var th = M.THEMES[o.dark ? "dark" : "light"];
    var sc = M.scene(r, l, { pal: th });
    return { svg: M.toSvg(sc, { title: label(R.N[rootId], 100), bg: o.transparent ? "none" : th.bg }), w: l.w, h: l.h };
  }
  function buildExport(fmt, rootId, o) {
    var r = subR(rootId), name = fileBase(label(R.N[rootId], 60));
    if (fmt === "md") return Promise.resolve({ blob: new Blob([M.toOutline(r)], { type: FMT.md.mime }), name: name });
    if (fmt === "opml") return Promise.resolve({ blob: new Blob([M.toOpml(r, null, new Date().toISOString())], { type: FMT.opml.mime }), name: name });
    if (fmt === "json") return Promise.resolve({ blob: new Blob([M.exportData(canonical(), R.root.map, new Date().toISOString())], { type: FMT.json.mime }), name: name });
    if (fmt === "oros") return buildBundle(R.root.map).then(function (bytes) {
      return bytes ? { blob: new Blob([bytes], { type: FMT.oros.mime }), name: fileBase(label(R.root, 60)) } : null;
    });
    var b = buildSvg(rootId, o);
    if (fmt === "svg") return Promise.resolve({ blob: new Blob([b.svg], { type: FMT.svg.mime }), name: name });
    return toPng(b).then(function (blob) { return blob ? { blob: blob, name: name } : null; });
  }

  function openExport(branchId) {
    if (!R) return;
    var o = prefs.exp;
    if (o.fmt === "oros" && !window.OrosBundle) o.fmt = "json";
    var scope = branchId && branchId !== R.root.id ? branchId : null;
    var dlg = makeDialog("mm-export", t("exp.title"));
    function seg(lbl, opts, val, set) {
      var fs = el("fieldset", "seg-field");
      fs.appendChild(el("legend", "fld-lbl", lbl));
      var s = el("div", "seg");
      opts.forEach(function (op) {
        var b = textBtn("", op[1], function () {
          set(op[0]);
          [].forEach.call(s.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          sync();
        });
        b.setAttribute("aria-pressed", op[0] === val ? "true" : "false");
        if (op[2]) b.disabled = true;
        s.appendChild(b);
      });
      fs.appendChild(s);
      return fs;
    }
    var selBranch = sel && sel !== R.root.id ? sel : null;
    dlg.appendChild(seg(t("exp.scope"), [[null, t("exp.whole")], ["b", t("exp.branch"), !selBranch && !scope]],
      scope ? "b" : null, function (v) { scope = v ? (scope || selBranch) : null; }));
    dlg.appendChild(seg(t("exp.format"), [["png", "PNG"], ["svg", "SVG"], ["md", "Markdown"], ["opml", "OPML"], ["json", "JSON"]].concat(
      window.OrosBundle ? [["oros", t("exp.oros")]] : []),
      o.fmt, function (v) { o.fmt = v; savePrefs(); }));
    var themeF = seg(t("exp.theme"), [[false, t("exp.light")], [true, t("exp.dark")]], o.dark, function (v) { o.dark = v; savePrefs(); });
    dlg.appendChild(themeF);
    var tl = el("label", "chk");
    var tcb = el("input");
    tcb.type = "checkbox"; tcb.checked = o.transparent;
    tcb.addEventListener("change", function () { o.transparent = tcb.checked; savePrefs(); });
    tl.appendChild(tcb);
    tl.appendChild(el("span", "", t("exp.transparent")));
    dlg.appendChild(tl);
    function sync() {
      var pic = o.fmt === "png" || o.fmt === "svg";
      themeF.hidden = !pic;
      tl.hidden = !pic;
    }
    sync();
    function rootFor() { return scope && R.N[scope] ? scope : R.root.id; }
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(textBtn("dlg-btn primary", t("exp.save"), function () {
      var f = FMT[o.fmt], rid = rootFor();
      dlg.close();
      buildExport(o.fmt, rid, o).then(function (x) {
        if (x) downloadBlob(x.blob, x.name + f.ext, f.mime, [{ description: f.desc, accept: makeAccept(f) }]);
      });
    }));
    acts.appendChild(textBtn("dlg-btn", t("exp.files"), function () {
      var f = FMT[o.fmt], rid = rootFor();
      dlg.close();
      buildExport(o.fmt, rid, o).then(function (x) { if (x) saveToFiles(x.blob, x.name + f.ext); });
    }));
    acts.appendChild(textBtn("dlg-btn", t("exp.print"), function () {
      var rid = rootFor();
      dlg.close();
      printSvg(buildSvg(rid, { dark: false, transparent: false }));
    }));
    acts.appendChild(textBtn("dlg-btn", t("exp.copy"), function () {
      var rid = rootFor();
      dlg.close();
      copyText(M.toOutline(subR(rid)));
    }));
    dlg.appendChild(acts);
    var close = el("div", "dlg-actions");
    close.appendChild(textBtn("dlg-btn", t("close"), function () { dlg.close(); }));
    dlg.appendChild(close);
    showDialog(dlg);
  }
  // ---------- 11a. orOS file (.orosmind, ../bundle.js) ----------
  // One map = one bundle: content.json is mm-core's packBundle (the
  // map's JSON export, pictures moved to media/<sha256>.<ext>),
  // preview/ holds the outline as Markdown and OPML plus a thumbnail
  // of the map. Opening one always makes a NEW map (fresh ids).
  function buildBundle(mapId) {
    var rid = M.rootId(mapId);
    return M.packBundle(canonical(), mapId, OrosBundle.sha256, new Date().toISOString()).then(function (p) {
      if (!p) return null;
      return thumbPng(rid).then(function (thumb) {
        return OrosBundle.write({
          mime: FMT.oros.mime, app: "mindmap", schema: "mindmap/1", content: p.content, media: p.media,
          meta: { title: p.title, created: p.created || undefined, modified: p.modified || undefined, id: mapId,
                  language: appLang() === "el" ? "el" : "en", generator: "orOS Mind Map" },
          thumbnail: thumb,
          preview: [{ name: "map.md", data: p.outline, type: "text/markdown" },
                    { name: "map.opml", data: p.opml, type: "text/x-opml" }],
          date: new Date()
        });
      });
    }).catch(function (e) { console.error("[orOS] mindmap: .orosmind failed", e); showToast(t("imp.err.read")); return null; });
  }
  // The map drawn light, at most 512 px a side; null when it cannot be drawn.
  function thumbPng(rid) {
    if (!R || !R.N[rid]) return Promise.resolve(null);
    var b = buildSvg(rid, { dark: false, transparent: false });
    var scale = Math.min(1, 512 / b.w, 512 / b.h);
    return svgImage(b.svg).then(function (x) {
      if (!x) return null;
      return new Promise(function (resolve) {
        try {
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(b.w * scale));
          cv.height = Math.max(1, Math.round(b.h * scale));
          cv.getContext("2d").drawImage(x.im, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(x.url);
          cv.toBlob(function (bl) {
            if (!bl) { resolve(null); return; }
            bl.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, function () { resolve(null); });
          }, "image/png");
        } catch (e) { URL.revokeObjectURL(x.url); resolve(null); }
      });
    });
  }
  // job: Promise of a bundle.js read result (a .orosmind or its folder)
  function openBundle(job) {
    return job.then(function (r) {
      var u = M.unpackBundle(r.content, r.media, newId, Date.now());
      if (!u.ok) { showToast(t("imp.err." + u.err)); return; }
      applyBundle(u);
    }, function (e) {
      console.error("[orOS] mindmap: .orosmind not opened", e);
      showToast(t(e && e.code === "newer" ? "imp.err.newer" : "imp.err.format"));
    });
  }
  function applyBundle(u) {
    commitEdit();
    flushOutline();
    var d = u.data;
    begin("");
    d.maps.forEach(putMap);
    d.nodes.forEach(putNode);
    d.links.forEach(putLink);
    d.pos.forEach(putPos);
    d.imgs.forEach(putImg);
    d.styles.forEach(putStyle);
    d.frames.forEach(putFrame);
    d.layouts.forEach(putLayout);
    prefs.map = u.map;
    savePrefs();
    sel = null;
    camFor = null;
    commit();
    undoToast(t("imp.newMap"), function () { undo(); });
  }
  function importFolder() {
    if (!window.OrosBundle) return;
    OrosBundle.pickFolder().then(function (files) {
      if (files) openBundle(OrosBundle.readFolder(files, { mime: FMT.oros.mime }));
    });
  }

  function makeAccept(f) { var a = {}; a[f.mime] = [f.ext]; return a; }   // R37: no computed keys

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
    var dir = "/internal/Mind Map";
    Promise.resolve(typeof fs.mkdir === "function" ? fs.mkdir(dir).catch(function () {}) : null)
      .then(function () { return fs.writeBlob(dir + "/" + name, blob); })
      .then(function () { showToast(t("toast.saved")); }, function () { showToast(t("toast.noFiles")); });
  }

  function backupAll() {
    var text = M.exportData(canonical(), null, new Date().toISOString());
    var d = new Date(), p = function (v) { return (v < 10 ? "0" : "") + v; };
    downloadBlob(new Blob([text], { type: "application/json" }),
      "mind-maps-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + ".json", "application/json",
      [{ description: "JSON", accept: { "application/json": [".json"] } }]);
  }

  var IMPORT_ACCEPT = ".orosmind,application/x-oros-mind,.json,.opml,.xml,.md,.markdown,.txt,.mm,.xmind,.smmx,.mmap,application/json,text/x-opml,text/xml," +
    "text/markdown,text/plain,application/zip";
  var ZIP_MAX = 30 * 1024 * 1024;               // a whole .xmind / .smmx / .mmap (pictures inside count)
  function importErr(err) { showToast(t("imp.err." + (err === "empty" || err === "size" || err === "zip" ? err : "format"))); }
  function importTree(r) {
    if (!r.ok) { importErr(r.err); return; }
    addTreeAsMap(r.tree, r.tree.sheets > 1 ? t("imp.sheets", { n: r.tree.sheets }) : "");
  }
  function importFile() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(IMPORT_ACCEPT) : localPickFile(IMPORT_ACCEPT);
    importFromFile(pick);
  }
  // Also the way in for a file from the system's "Open with" (shell fileopen.js).
  function importFromFile(file) {
    Promise.resolve(file).then(function (file) {
      if (!file) return;                        // cancel — silent exit
      if (file.size > ZIP_MAX) { showToast(t("imp.err.size")); return; }
      return file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf), base = String(file.name || "").replace(/\.[^.]+$/, "");
        var X = window.MMImport;
        // an orOS file (a ZIP whose first entry names its type); other ZIPs go on to MMImport
        if (window.OrosBundle && OrosBundle.sniff(bytes.subarray(0, 128))) return openBundle(OrosBundle.read(bytes, { mime: FMT.oros.mime }));
        if (X && X.sniff(bytes) === "zip") return X.parseArchive(bytes, base).then(importTree);
        if (bytes.length > M.IMPORT_MAX) { showToast(t("imp.err.size")); return; }
        var s = new TextDecoder("utf-8").decode(bytes).replace(/^\ufeff/, "").trim();
        if (s.charAt(0) === "{") {
          var r = M.parseImport(s, canonical());
          if (!r.ok) { showToast(t("imp.err." + r.err)); return; }
          previewImport(r);
        } else if (s.charAt(0) === "<") {
          var head = s.slice(0, 4000);
          if (X && /<map[\s>]/.test(head) && !/<opml[\s>]/.test(head)) importTree(X.parseFreeMind(s, base));
          else if (X && (/<xmap-content[\s>]/.test(head) || /<simplemind-mindmaps[\s>]/.test(head) ||
                         (/<(?:\w+:)?Map[\s>]/.test(head) && /mindjet/i.test(head)))) return X.parseArchive(bytes, base).then(importTree);
          else importTree(M.parseOpml(s, base));
        } else importOutlineText(s, base);
      });
    }).catch(function () { showToast(t("imp.err.read")); });
  }
  function previewImport(r) {
    var dlg = makeDialog("mm-imp", t("imp.title"));
    dlg.appendChild(el("p", "imp-stats", t("imp.stats", { maps: r.stats.maps, nodes: r.stats.nodes })));
    if (r.stats.dropped) dlg.appendChild(el("p", "dlg-sub", t("imp.dropped", { n: r.stats.dropped })));
    dlg.appendChild(el("p", "dlg-sub", t("imp.merge")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn", t("cancel"), function () { dlg.close(); }));
    acts.appendChild(textBtn("dlg-btn primary", t("imp.go"), function () { dlg.close(); applyImport(r.data); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }
  // Restore is a merge: the same LWW + tombstones as sync, so newer
  // local edits stay and nothing deleted comes back. Undo restores
  // the rows the import changed.
  function applyImport(imp) {
    commitEdit();
    flushOutline();
    var merged = M.merge(canonical(), imp);
    begin("");
    imp.maps.forEach(function (x) { touch("m:" + x.id); });
    imp.nodes.forEach(function (x) { touch("n:" + x.id); });
    (imp.links || []).forEach(function (x) { touch("l:" + x.id); });
    (imp.pos || []).forEach(function (x) { touch("p:" + x.id); });
    (imp.imgs || []).forEach(function (x) { touch("i:" + x.id); });
    (imp.styles || []).forEach(function (x) { touch("s:" + x.id); });
    (imp.frames || []).forEach(function (x) { touch("f:" + x.id); });
    (imp.layouts || []).forEach(function (x) { touch("v:" + x.id); });
    adopt(merged);
    var first = imp.maps.length ? imp.maps[0].id : null;
    if (first && MAPS[first] && !curMap()) prefs.map = first;
    savePrefs();
    commit();
    ensureMap();
    refresh();
    undoToast(t("imp.done"), function () { undo(); });
  }

  // ---------- 11b. Send to other apps (bridges owned by those apps) ----------
  // To-Do: BR-TD-ADD, __orosOpenAt("todo", { addItems }) — To-Do asks
  // before it writes anything. Slides: __orosOpenAt("slides",
  // { outline, title }) in the Slides outline format — Slides asks
  // for a theme before it creates the deck. Mind Map never writes
  // another app's data.
  function openIn(app, target) {
    var w = null;
    try { w = window.parent && window.parent !== window ? window.parent : null; } catch (e) { w = null; }
    if (!w || typeof w.__orosOpenAt !== "function") { showToast(t("toast.noBridge")); return false; }
    try { w.__orosOpenAt(app, target); return true; } catch (e) { showToast(t("toast.noBridge")); return false; }
  }
  var TODO_MAX = 200;
  function sendToTodo(id) {
    if (!R || !R.N[id]) return;
    var n = R.N[id], kids = (R.kids[id] || []).length > 0, items = [];
    var ids = kids ? M.subtree(R, id).slice(1) : [id];
    ids.forEach(function (x) {
      var k = R.N[x];
      if (!k || k.done) return;
      var text = M.title((k.emoji ? k.emoji + " " : "") + k.text, 300);
      if (!text) return;
      var item = { text: text };
      var note = String(k.note || "").slice(0, 1000);
      if (note) item.note = note;
      items.push(item);
    });
    if (!items.length) { showToast(t("toast.todoNone")); return; }
    if (items.length > TODO_MAX) { showToast(t("toast.todoMany", { n: TODO_MAX })); return; }
    var target = { addItems: { from: t("app.name"), items: items } };
    if (kids) target.addItems.newList = M.title(n.text, 80) || t("untitled");
    openIn("todo", target);
  }
  var SLIDES_MAX = 200000;
  // "# branch" = title slide, each child "# child" = a slide, deeper
  // nodes "- " bullets (2 spaces a level, at most 4), notes "> ".
  function slidesOutline(id) {
    var out = [], top = R.N[id];
    function one(x) { var k = R.N[x]; return M.title((k.emoji ? k.emoji + " " : "") + k.text, 300) || "…"; }
    function notes(x) {
      String(R.N[x].note || "").split("\n").forEach(function (l) { l = l.trim(); if (l) out.push("> " + l); });
    }
    out.push("# " + one(id));
    notes(id);
    (R.kids[id] || []).forEach(function (c) {
      out.push("", "# " + one(c));
      notes(c);
      var stack = (R.kids[c] || []).slice().reverse().map(function (g) { return [g, 0]; });
      while (stack.length) {
        var e = stack.pop(), lv = Math.min(e[1], 3);
        out.push(new Array(lv + 1).join("  ") + "- " + one(e[0]));
        var kk = R.kids[e[0]] || [];
        for (var i = kk.length - 1; i >= 0; i--) stack.push([kk[i], e[1] + 1]);
      }
    });
    return top ? out.join("\n") + "\n" : "";
  }
  function sendToSlides(id) {
    if (!R || !R.N[id] || !(R.kids[id] || []).length) return;
    var text = slidesOutline(id);
    if (text.length > SLIDES_MAX || (R.kids[id] || []).length + 1 > 300) { showToast(t("toast.slidesBig")); return; }
    openIn("slides", { outline: text, title: M.title(R.N[id].text, 120) || t("untitled") });
  }

  // "Send to an app" (shell send/, BR-SEND): the branch as an indented
  // outline (as Copy gives it) to Writer, Kanban, Mail…
  function sendApi() {
    try { return window.parent !== window && window.parent.orosSend ? window.parent.orosSend : null; }
    catch (e) { return null; }
  }
  function sendBranch(id) {
    var api = sendApi();
    if (!api || !R || !R.N[id]) return;
    api.open({ kind: "text", data: { title: M.title(R.N[id].text, 200) || t("untitled"), text: M.toOutline(subR(id)) } });
  }

  var NOTES_MAX = 20000;
  // Notes: __orosOpenAt("notes", { add: { title, text } }) makes a new
  // top-level page (plain text). Body = the branch's note, then its
  // nodes as an indented "- " list with each node's link and note.
  function notesText(id) {
    var out = [], top = R.N[id];
    function one(k) { return (k.done ? "[x] " : "") + M.title((k.emoji ? k.emoji + " " : "") + k.text, 300); }
    function extra(k, pad) {
      if (k.url) out.push(pad + k.url);
      String(k.note || "").split("\n").forEach(function (l) { l = l.trim(); if (l) out.push(pad + l); });
    }
    extra(top, "");
    if (out.length && (R.kids[id] || []).length) out.push("");
    var stack = (R.kids[id] || []).slice().reverse().map(function (g) { return [g, 0]; });
    while (stack.length) {
      var e = stack.pop(), k = R.N[e[0]], pad = new Array(e[1] + 1).join("  ");
      out.push(pad + "- " + one(k));
      extra(k, pad + "  ");
      var kk = R.kids[e[0]] || [];
      for (var i = kk.length - 1; i >= 0; i--) stack.push([kk[i], e[1] + 1]);
    }
    return out.join("\n");
  }
  function sendToNotes(id) {
    if (!R || !R.N[id]) return;
    var text = notesText(id), title = M.title(R.N[id].text, 200) || t("untitled");
    if (text.length > NOTES_MAX) { showToast(t("toast.notesBig")); return; }
    if (openIn("notes", { add: { title: title, text: text } })) showToast(t("toast.notesSent", { name: title }));
  }

  // ---------- 12. Menus, dialogs, toasts ----------
  var menuCtl = null;
  function openMenu() {
    var btn = $("more-btn"), r = btn.getBoundingClientRect(), mp = curMap();
    var items = [
      ["menu.present", function () { startPresent(null); }, null, !R || prefs.view !== "map"],
      ["menu.new", newMapDialog],
      ["menu.maps", openMaps, null, !Object.keys(MAPS).length],
      ["menu.paste", function () { openPaste(R ? (sel || R.root.id) : null); }],
      ["menu.export", function () { openExport(null); }, null, !R],
      ["menu.copy", function () { copyText(M.toOutline(R)); }, null, !R],
      ["menu.slides", function () { sendToSlides(R.root.id); }, null, !R || !(R.kids[R.root.id] || []).length],
      ["menu.notes", function () { sendToNotes(R.root.id); }, null, !R],
      ["menu.import", importFile],
      ["menu.folder", importFolder, null, !window.OrosBundle],
      ["menu.backup", backupAll, null, !Object.keys(MAPS).length]
    ];
    if (mp) {
      items.push(["menu.layout", openLayout]);
      items.push(["menu.tidy", tidyAll, null, !anyMoved()]);
      items.push(["menu.unfoldAll", function () { delete prefs.fold[mp.id]; savePrefs(); refresh(); }]);
      items.push(["menu.foldAll", function () {
        prefs.fold[mp.id] = (R.kids[R.root.id] || []).filter(function (id) { return (R.kids[id] || []).length; });
        savePrefs(); refresh();
      }]);
    }
    items.push(["menu.keys", openKeys]);
    openMenuAt(items, r.right, r.bottom + 6, btn, true);
  }
  // Menus are anchored at their button or the pointer (R32 exception).
  // After a long press the lifted finger must not "click" the item
  // that opened under it: items arm only after that pointerup.
  function openMenuAt(items, x, y, btn, alignRight, fromPress) {
    closeMenu();
    var m = el("div", "menu");
    m.id = "mm-menu";
    m.setAttribute("role", "menu");
    var armed = !fromPress;
    if (fromPress) {
      document.addEventListener("pointerup", function () { setTimeout(function () { armed = true; }, 300); },
                                { once: true, capture: true });
    }
    items.forEach(function (it) {
      var b = textBtn("menu-item" + (it[2] ? " " + it[2] : ""), t(it[0]), function () { if (!armed) return; closeMenu(); it[1](); });
      b.setAttribute("role", "menuitem");
      if (it[3]) b.disabled = true;
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var W = window.innerWidth, H = window.innerHeight, mw = m.offsetWidth, mh = m.offsetHeight;
    var left = alignRight ? x - mw : x;
    left = Math.max(8, Math.min(left, W - mw - 8));
    var top = y + mh > H - 8 ? Math.max(8, y - mh) : y;
    m.style.left = Math.round(left) + "px";
    m.style.top = Math.round(top) + "px";
    menuCtl = new AbortController();
    var sig = { signal: menuCtl.signal };
    setTimeout(function () {
      if (!menuCtl) return;
      document.addEventListener("pointerdown", function (e) { if (!m.contains(e.target)) closeMenu(); }, sig);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { closeMenu(); if (btn) btn.focus(); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          var bs = [].filter.call(m.querySelectorAll("button"), function (x) { return !x.disabled; });
          var i = bs.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1);
          if (bs.length) bs[(i + bs.length) % bs.length].focus();
        }
      }, sig);
      window.addEventListener("resize", closeMenu, sig);
    }, 0);
    var first = m.querySelector("button:not([disabled])");
    if (first) first.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (menuCtl) { menuCtl.abort(); menuCtl = null; }
    var m = $("mm-menu");
    if (m) m.remove();
  }
  function openKeys() {
    var dlg = makeDialog("mm-keys", t("keys.title"));
    dlg.classList.add("wide");
    var dl = el("dl", "keys");
    t("keys.list").split("\n").forEach(function (l) {
      var p = l.split("|");
      dl.appendChild(el("dt", "", p[0]));
      dl.appendChild(el("dd", "", p[1]));
    });
    dlg.appendChild(dl);
    var acts = el("div", "dlg-actions");
    acts.appendChild(textBtn("dlg-btn primary", t("close"), function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
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
    closeMenu();
    commitEdit();
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "mindmap", title: String(text) })) return;
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
      new MutationObserver(function () { inheritPalette(); if (prefs.view === "map") renderMap(); }).observe(
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
    api.registerSlice("mindmap", sliceGet, sliceSet, STORAGE_KEY, M.merge);
  }

  function sliceGet() { return canonical(); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.nodes)) return;
    var before = JSON.stringify(canonical());
    var d = M.merge(incoming, incoming);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      adopt(d);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(d) === before) return;
    ensureMap();
    refresh();
  }

  // ---------- 14. Wiring & boot ----------
  function renderToolbar() {
    var mp = curMap();
    $("map-name").textContent = mp ? mapTitle(mp.id) : t("maps.none");
    document.title = (mp ? mapTitle(mp.id) : t("view.map")) + " · orOS";
    [].forEach.call($("view-seg").children, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-view") === prefs.view ? "true" : "false");
    });
    var has = !!R;
    $("view-seg").hidden = !has;
    $("find-btn").disabled = !has;
    $("fit-btn").disabled = !has || prefs.view !== "map";
    $("undo-btn").disabled = !undoStack.length;
    $("redo-btn").disabled = !redoStack.length;
  }
  // Re-sync every control with the state (R7).
  function refresh() {
    resolveNow();
    renderToolbar();
    var has = !!R;
    $("empty").hidden = has;
    $("stage").hidden = !has || prefs.view !== "map";
    $("outline").hidden = !has || prefs.view !== "outline";
    if (pres && (!has || prefs.view !== "map")) stopPresent();
    if (pres) {
      pres.steps = M.presentSteps(R, foldSet(R.root.map));
      pres.i = Math.min(pres.i, pres.steps.length);
    }
    if (!has) {
      $("nodebar").hidden = true; $("olbar").hidden = true;
      if (editing) { editing = null; $("editor").hidden = true; }
      return;
    }
    if (prefs.view === "map") renderMap();
    else { $("nodebar").hidden = true; renderOutline(); }
  }

  function applyI18n() {
    [].forEach.call($("view-seg").children, function (b) {
      b.textContent = t("view." + b.getAttribute("data-view"));
    });
    var mb = $("map-btn");
    mb.insertAdjacentHTML("afterbegin", UI.map);            // static icon
    mb.insertAdjacentHTML("beforeend", UI.chev);
    mb.setAttribute("aria-label", t("maps.title"));
    [["undo-btn", UI.undo, "btn.undo"], ["redo-btn", UI.redo, "btn.redo"], ["find-btn", UI.find, "btn.find"],
     ["fit-btn", UI.fit, "btn.fit"], ["more-btn", UI.more, "btn.more"],
     ["zoom-in", UI.plus, "btn.zoomIn"], ["zoom-out", UI.minus, "btn.zoomOut"],
     ["find-prev", UI.up, "find.prev"], ["find-next", UI.down, "find.next"], ["find-close", UI.x, "find.close"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = x[1];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    $("find-input").placeholder = t("find.ph");
    $("find-input").setAttribute("aria-label", t("find.ph"));
    $("empty-text").textContent = t("empty.text");
    $("empty-new").textContent = t("empty.new");
    $("empty-example").textContent = t("empty.example");
    $("empty-import").textContent = t("empty.import");
    $("stage").setAttribute("aria-label", t("view.map"));
    $("outline").setAttribute("aria-label", t("view.outline"));
    $("nodebar").setAttribute("aria-label", t("nb.edit"));
    $("svg").setAttribute("tabindex", "0");
  }

  function wire() {
    $("map-btn").addEventListener("click", function () { if (Object.keys(MAPS).length) openMaps(); else newMapDialog(); });
    [].forEach.call($("view-seg").children, function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-view");
        if (v === prefs.view) return;
        commitEdit();
        flushOutline();
        prefs.view = v;
        savePrefs();
        refresh();
        if (v === "map" && sel) reveal(sel);
        if (v === "outline" && sel) focusRow(sel, true);
      });
    });
    $("undo-btn").addEventListener("click", function () { commitEdit(); flushOutline(); undo(); });
    $("redo-btn").addEventListener("click", function () { commitEdit(); flushOutline(); redo(); });
    $("find-btn").addEventListener("click", function () { if ($("findbar").hidden) openFind(); else closeFind(); });
    $("fit-btn").addEventListener("click", fit);
    $("more-btn").addEventListener("click", function () { if ($("mm-menu")) closeMenu(); else openMenu(); });
    $("zoom-in").addEventListener("click", function () { zoomCenter(1.25); });
    $("zoom-out").addEventListener("click", function () { zoomCenter(1 / 1.25); });
    $("empty-new").addEventListener("click", newMapDialog);
    $("empty-example").addEventListener("click", createExample);
    $("empty-import").addEventListener("click", importFile);
    var fi = $("find-input"), ft = null;
    fi.addEventListener("input", function () { clearTimeout(ft); ft = setTimeout(runFind, 150); });
    fi.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { e.preventDefault(); closeFind(); $("svg").focus({ preventScroll: true }); }
    });
    $("find-prev").addEventListener("click", function () { stepFind(-1); });
    $("find-next").addEventListener("click", function () { stepFind(1); });
    $("find-close").addEventListener("click", closeFind);
    wirePointer();
    wireEditor();
    wireOutline();
    wireKeyboard();
    window.addEventListener("resize", function () { positionEditor(); if (pres) presAim(false); });
    // Esc in full screen is taken by the browser: leaving full screen ends the presentation too
    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
      document.addEventListener(ev, function () {
        if (pres && pres.fs && !(document.fullscreenElement || document.webkitFullscreenElement)) { pres.fs = false; stopPresent(); }
      });
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { commitEdit(); flushOutline(); savePrefsNow(); }
    });
    window.addEventListener("pagehide", function () { commitEdit(); flushOutline(); savePrefsNow(); });
  }

  function boot() {
    if (!M) { console.error("[orOS] mindmap: mm-core.js missing"); return; }
    load();
    loadPrefs();
    ensureMap();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    refresh();
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("mindmap");
        if (pending) openSearchTarget(pending);
      }
    } catch (e) {}
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget): target { map, node }.
  // Opens the map, unfolds the way to the node, selects it and brings
  // it into view (as Find does). Unknown map → no-op; unknown node →
  // the map only. Nothing happens while a dialog or the menu is open.
  // { openFile: { token } }: a file from the system's "Open with"
  // (shell fileopen.js), taken once, then the Import path.
  function openSearchTarget(t) {
    // Single app (solo.js): { newMap: true } → the New map dialog;
    // { pasteText: { text } } → the paste dialog filled with a share
    // (a new map only when the person presses Add).
    if (t && (t.newMap === true || t.pasteText)) {
      if (document.querySelector("dialog[open]") || $("mm-menu")) return;
      if (t.newMap === true) { newMapDialog(); return; }
      if (typeof t.pasteText.text === "string" && t.pasteText.text.trim()) openPaste(null, t.pasteText.text.slice(0, 20000));
      return;
    }
    if (t && t.openFile) {
      if (document.querySelector("dialog[open]") || $("mm-menu")) return;
      var f = null;
      try {
        var p = window.parent;
        if (typeof t.openFile.token === "string" && p && p !== window && typeof p.__orosTakeFile === "function")
          f = p.__orosTakeFile(t.openFile.token);
      } catch (e) { f = null; }
      if (f) importFromFile(f);
      return;
    }
    if (!t || typeof t.map !== "string" || !MAPS[t.map]) return;
    if (document.querySelector("dialog[open]") || $("mm-menu")) return;
    if (t.map !== prefs.map) openMap(t.map);
    else { commitEdit(); flushOutline(); }
    var id = typeof t.node === "string" ? t.node : null;
    if (!id || !R || !R.N[id]) { refresh(); return; }
    unfoldTo(id);
    sel = id;
    refresh();
    if (prefs.view === "map") {
      if (view.s < 0.8) { view.s = 0.9; centerOn(id); } else reveal(id);
    } else {
      var ta = $("outline").querySelector('textarea[data-id="' + CSS.escape(id) + '"]');
      if (ta) ta.scrollIntoView({ block: "center" });
    }
  }
  window.__orosOpenAt = openSearchTarget;

  boot();
})();
