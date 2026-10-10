// ============================================================
// orOS Layout — core (v1.0.0)
// Desktop publishing in the browser: pages and spreads, master
// pages, threaded text frames with paragraph / character styles,
// image frames, shapes, swatches (RGB + CMYK), text wrap, vector
// PDF with bleed and crop marks, lossless .oroslayout packages.
// The engine lives in ../designkit/ (shared with Atelier): model,
// text (fonts + typesetting), render, pdf, assets.
// Files:
//   layout.js  core: i18n, state, storage, sync, undo, home, boot
//   editor.js  the canvas: view, tools, selection, snapping, threads
//   panels.js  side panels (properties, pages, styles, colours) +
//              dialogs (new document, setup, style, swatch)
//   story.js   the Story Editor
//   io.js      PDF export, packages, images, text import
// Data:
//   - synced slice "layout" (oros-layout-data): LAYOUT v1, see
//     designkit/model.js (per-entity LWW + tombstones, canonical)
//   - images: /internal/Assets/<sha256>.<ext> on the orOS disk,
//     synced per file by Vault Drive (designkit/assets.js)
//   - device-local (R10): oros-layout-prefs ({ doc, zoom }),
//     oros-layout-data-broken (rescue copy)
//   - undo history: memory only
// Sections:
//   1. Constants, i18n
//   2. Helpers + toasts
//   3. Storage + prefs
//   4. Undo + mutations
//   5. Home
//   6. Sync slice + palette
//   7. Boot
// ============================================================
(function () {
  "use strict";

  var LY = window.LY = {};
  var DK = window.orosDK;
  var M = LY.M = DK.model, T = LY.T = DK.text, R = LY.R = DK.render;
  LY.P = DK.pdf; LY.A = DK.assets;

  var STORAGE_KEY = "oros-layout-data";
  var PREFS_KEY   = "oros-layout-prefs";
  var UNDO_MAX    = 100;
  var DOC_WARN    = 400 * 1024;
  LY.STORAGE_KEY = STORAGE_KEY;

  // ---------- 1. Constants, i18n ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = LY.LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "Layout", "loading": "Loading fonts…",
      "home.new": "New document", "home.import": "Open file", "home.search": "Search documents",
      "home.empty.title": "No documents yet",
      "home.empty.sub": "Flyers, newsletters, posters, cards, booklets: start with a page size.",
      "home.count": "{n} documents", "home.count1": "1 document",
      "home.pages": "{n} pages", "home.pages1": "1 page", "home.none": "No document matches.",
      "doc.untitled": "Untitled", "doc.copy": "{name} (copy)",
      "card.open": "Open", "card.rename": "Rename", "card.dup": "Duplicate", "card.pkg": "Save as package", "card.del": "Delete",
      "ed.back": "Documents", "ed.undo": "Undo", "ed.redo": "Redo", "ed.zin": "Zoom in", "ed.zout": "Zoom out",
      "zoom.title": "Zoom", "zoom.page": "Fit page", "zoom.spread": "Fit spread", "ruler.hint": "Drag from a ruler to add a guide; drag a guide back onto the ruler to remove it.", "ed.preview": "Preview (hide guides and frames)", "ed.panel": "Panels", "ed.more": "More",
      "ed.export": "Export", "ed.rename": "Rename document",
      "more.setup": "Document setup…", "more.pkg": "Save as package (.oroslayout)", "more.text": "Import text (.txt)…",
      "more.story": "Story Editor", "more.selall": "Select all on this page", "more.rec": "Recovered text ({n})",
      "tool.select": "Select (V)", "tool.text": "Text frame (T)", "tool.image": "Image frame (F)",
      "tool.rect": "Rectangle (R)", "tool.ell": "Ellipse (E)", "tool.line": "Line (L)", "tool.hand": "Hand (H)",
      "tab.props": "Properties", "tab.pages": "Pages", "tab.styles": "Styles", "tab.colors": "Colours",
      "st.page": "Page {n} of {c}", "st.master": "Master {name}", "st.sel": "{n} selected", "st.sel1": "1 selected",
      "st.overset": "Overset text ({n})",
      "st.pf": "Preflight: {n}", "st.pfOk": "Preflight OK",
      "pf.title": "Preflight", "pf.none": "No problems found: the document is ready to print.", "pf.note": "Pick a problem to select its object.",
      "pf.page": "Page {n}", "pf.master": "Master {name}",
      "pf.overset": "Overset text", "pf.missing": "Missing image", "pf.ppi": "Low resolution ({n} ppi, 150+ for print)",
      "pf.bleed": "Reaches the trim edge but not the bleed", "pf.small": "Text smaller than 6 pt", "pf.empty": "Empty frame",
      "ms.editing": "Editing {name}", "ms.done": "Done",
      "ms.detach": "Detach master objects here", "ms.detachOne": "Detach this master object", "ms.reset": "Reset to master", "ms.detached": "{n} master objects detached", "ms.noneHere": "No master objects on this page",
      "thread.hint": "Click a text frame or an empty spot on a page to continue the text there.",
      "thread.notEmpty": "That frame already has text. Pick an empty text frame or an empty spot.",
      "thread.otherKind": "A page frame and a master frame cannot share a story.",
      "btn.cancel": "Cancel", "btn.ok": "OK", "btn.create": "Create", "btn.save": "Save", "btn.close": "Close",
      "btn.delete": "Delete", "btn.undo": "Undo", "btn.apply": "Apply", "btn.new": "New", "btn.edit": "Edit",
      "props.none": "Nothing selected", "props.doc": "Document", "props.size": "Page size",
      "props.setup": "Document setup…", "props.pageMaster": "Master of this page", "props.noMaster": "[None]",
      "props.pos": "Position and size", "props.x": "X", "props.y": "Y", "props.w": "W", "props.h": "H",
      "props.rot": "Rotation", "props.op": "Opacity", "props.fill": "Fill", "props.stroke": "Stroke",
      "props.sw": "Weight", "props.dash": "Dashed", "props.r": "Corners", "props.none2": "None",
      "props.text": "Text frame", "props.cols": "Columns", "props.gut": "Gutter", "props.ins": "Inset",
      "props.va": "Vertical align", "props.va.t": "Top", "props.va.c": "Centre", "props.va.b": "Bottom",
      "props.edit": "Edit text", "props.threadNext": "Continue in a new frame", "props.autoflow": "Autoflow: add pages until it fits",
      "props.unthread": "Break thread after this frame", "props.chain": "Frame {i} of {n} in this story",
      "props.image": "Image", "props.place": "Place image…", "props.replace": "Replace image…",
      "props.fit": "Fit", "props.fillf": "Fill", "props.scale": "Scale", "props.offx": "Offset X", "props.offy": "Offset Y",
      "props.ppi": "{n} ppi effective", "props.ppiLow": "{n} ppi: low for print", "props.missing": "Image file not on this device yet",
      "props.wrap": "Text wrap", "props.wrap.none": "None", "props.wrap.box": "Box", "props.wrap.ell": "Ellipse", "props.wo": "Offset",
      "props.arrange": "Arrange", "props.front": "Bring to front", "props.fwd": "Bring forward", "props.bwd": "Send backward", "props.back": "Send to back",
      "props.align": "Align", "props.alignTo": "to margins", "props.alignSel": "to selection",
      "props.al": "Align left", "props.ac": "Align centre", "props.ar": "Align right",
      "props.at": "Align top", "props.am": "Align middle", "props.ab": "Align bottom",
      "props.dh": "Distribute horizontally", "props.dv": "Distribute vertically",
      "props.lock": "Lock position", "props.hide": "Hide", "hide.done": "Hidden. Show it again from the page panel (nothing selected).", "hide.show": "Show hidden objects ({n})", "props.group": "Group", "props.ungroup": "Ungroup",
      "props.dup": "Duplicate", "props.del": "Delete", "props.multi": "{n} objects",
      "pages.title": "Pages", "pages.add": "Add page", "pages.dup": "Duplicate page", "pages.del": "Delete page",
      "pages.up": "Move earlier", "pages.down": "Move later", "pages.masters": "Masters",
      "pages.newMaster": "New master", "pages.editMaster": "Edit master", "pages.renameMaster": "Rename",
      "pages.delMaster": "Delete master", "pages.applyMaster": "Apply to this page", "pages.n": "{n}",
      "pages.lastOne": "A document keeps at least one page.", "pages.max": "A document can have at most {n} pages.",
      "pages.masterUsed": "Pages using it will have no master.",
      "styles.para": "Paragraph styles", "styles.char": "Character styles", "styles.new": "New style",
      "styles.noneChar": "[No character style]", "styles.applyHint": "Open a story to apply styles; tap the pencil to edit a style.",
      "styles.edit": "Edit style", "styles.del": "Delete style",
      "sty.name": "Name", "sty.base": "Based on", "sty.baseNone": "[None]", "sty.font": "Font", "sty.size": "Size (pt)",
      "sty.lead": "Leading (pt)", "sty.auto": "Auto", "sty.align": "Alignment",
      "sty.al": "Left", "sty.ac": "Centre", "sty.ar": "Right", "sty.aj": "Justify",
      "sty.b": "Bold", "sty.i": "Italic", "sty.u": "Underline", "sty.caps": "All caps", "sty.bul": "Bullet",
      "sty.sb": "Space before", "sty.sa": "Space after", "sty.fi": "First-line indent", "sty.li": "Left indent", "sty.ri": "Right indent",
      "sty.track": "Tracking (1/1000 em)", "sty.color": "Colour", "sty.inherit": "As base",
      "font.sans": "Noto Sans", "font.serif": "Noto Serif", "font.mono": "Noto Sans Mono",
      "colors.title": "Swatches", "colors.new": "New swatch", "colors.edit": "Edit swatch", "colors.del": "Delete swatch",
      "colors.mode": "Mode", "colors.rgb": "RGB", "colors.cmyk": "CMYK", "colors.hex": "Hex",
      "colors.keep": "Black and Paper cannot be deleted.", "colors.used": "Objects using it switch to Black.",
      "colors.note": "CMYK is shown on screen with a simple conversion (no colour profile); the PDF gets the exact CMYK values.",
      "new.title": "New document", "new.from": "Start from", "new.blank": "Blank", "new.name": "Name", "new.size": "Page size", "new.custom": "Custom",
      "new.orient": "Orientation", "new.portrait": "Portrait", "new.landscape": "Landscape", "new.pages": "Pages",
      "new.facing": "Facing pages (spreads)", "new.margins": "Margins", "new.cols": "Columns", "new.gut": "Gutter",
      "new.bleed": "Bleed", "new.unit": "Units", "new.top": "Top", "new.bottom": "Bottom", "new.inside": "Inside",
      "new.outside": "Outside", "new.left": "Left", "new.right": "Right", "new.w": "Width", "new.h": "Height",
      "setup.title": "Document setup", "setup.note": "Objects keep their place when the page size changes.",
      "preset.a4": "A4", "preset.a5": "A5", "preset.a3": "A3", "preset.a6": "A6", "preset.b5": "B5",
      "preset.letter": "US Letter", "preset.legal": "US Legal", "preset.card": "Business card", "preset.dl": "DL flyer",
      "preset.square": "Square post", "preset.poster": "Poster 50×70", "preset.custom": "Custom",
      "unit.mm": "mm", "unit.pt": "pt", "unit.in": "in",
      "exp.title": "Export", "exp.img": "Image (PNG / JPG)", "exp.page": "Page", "exp.format": "Format", "exp.res": "Resolution", "exp.imgGo": "Export image", "exp.capped": "Exported at {n} dpi (16 megapixel limit)", "exp.pdf": "PDF", "exp.pkg": "Package", "exp.range": "Pages", "exp.all": "All",
      "exp.cur": "Current page", "exp.custom": "Range", "exp.rangeHint": "e.g. 1-3, 5",
      "exp.spreads": "Spreads", "exp.bleed": "Include bleed", "exp.marks": "Crop marks",
      "exp.quality": "Images", "exp.print": "Print (300 ppi)", "exp.screen": "Screen (150 ppi)",
      "exp.go": "Export PDF", "exp.working": "Building the PDF…", "exp.done": "PDF saved", "exp.fail": "The PDF could not be built.",
      "exp.badRange": "That page range is not valid.", "exp.pkgDone": "Package saved", "exp.pkgNote": "One file with the document and its images, to back up or open on another device.",
      "imp.done": "Document opened", "idml.working": "Reading the InDesign file…", "idml.bad": "This file could not be read as an InDesign (.idml) document.", "idml.done": "InDesign document imported: {p} pages, {n} objects.",
      "sla.working": "Reading the Scribus file…", "sla.bad": "This file could not be read as a Scribus document.", "sla.done": "Scribus document imported: {p} pages, {n} objects.", "sla.linked": "{n} images were not inside the file: put them back with Place image.", "sla.skipped": "{n} objects (tables, free shapes, text on a path) became simple boxes or were left out.", "imp.bad": "This file is not a Layout package.", "imp.imgFail": "{n} images could not be restored.",
      "img.fail": "This file could not be read as an image.", "img.nofs": "The orOS disk is not available on this device.",
      "img.placed": "Image placed", "img.missing": "Syncing…",
      "txt.fail": "This file could not be read as text.", "txt.done": "Text imported",
      "inframe.aria": "Type into the text frame",
      "story.title": "Story Editor", "story.empty": "Type here…", "story.ps": "Paragraph style", "story.cs": "Character style",
      "story.b": "Bold", "story.i": "Italic", "story.u": "Underline", "story.pn": "Insert page number", "story.pc": "Insert page count",
      "story.chars": "{n} characters", "story.overset": "· overset", "story.none": "Select a text frame first.",
      "rec.title": "Recovered text", "rec.note": "Edited on two devices at the same time: the other version is kept here.",
      "rec.copy": "Copy", "rec.copied": "Copied", "rec.del": "Discard",
      "toast.deleted": "Deleted", "toast.docDeleted": "Document deleted", "toast.save": "Storage is full: recent changes could not be saved on this device.",
      "toast.big": "This document is getting large ({n} KB). Large documents fill the storage every app shares.",
      "toast.locked": "This object is locked.", "toast.gone": "This document was deleted on another device.",
      "toast.fontFail": "The fonts could not be loaded.", "toast.maxItems": "A document can have at most {n} objects.",
      "toast.flowDone": "Text placed on {n} new pages.", "toast.flowMax": "Stopped after {n} pages: the text still overflows.",
      "toast.copied": "Copied", "ed.paste": "Paste",
      "dlg.rename": "Rename", "dlg.delDoc": "Delete this document?", "dlg.delDocSub": "You can undo right after.",
      "a11y.canvas": "Page canvas"
    },
    el: {
      "app.name": "Σελιδοποίηση", "loading": "Φόρτωση γραμματοσειρών…",
      "home.new": "Νέο έγγραφο", "home.import": "Άνοιγμα αρχείου", "home.search": "Αναζήτηση εγγράφων",
      "home.empty.title": "Δεν υπάρχουν έγγραφα ακόμα",
      "home.empty.sub": "Φυλλάδια, ενημερωτικά, αφίσες, κάρτες, βιβλιαράκια: ξεκίνα διαλέγοντας μέγεθος σελίδας.",
      "home.count": "{n} έγγραφα", "home.count1": "1 έγγραφο",
      "home.pages": "{n} σελίδες", "home.pages1": "1 σελίδα", "home.none": "Κανένα έγγραφο δεν ταιριάζει.",
      "doc.untitled": "Χωρίς τίτλο", "doc.copy": "{name} (αντίγραφο)",
      "card.open": "Άνοιγμα", "card.rename": "Μετονομασία", "card.dup": "Διπλασιασμός", "card.pkg": "Αποθήκευση ως πακέτο", "card.del": "Διαγραφή",
      "ed.back": "Έγγραφα", "ed.undo": "Αναίρεση", "ed.redo": "Επανάληψη", "ed.zin": "Μεγέθυνση", "ed.zout": "Σμίκρυνση",
      "zoom.title": "Ζουμ", "zoom.page": "Προσαρμογή σελίδας", "zoom.spread": "Προσαρμογή δισέλιδου", "ruler.hint": "Σύρε από έναν χάρακα για να προσθέσεις οδηγό· σύρε τον οδηγό πίσω στον χάρακα για να τον σβήσεις.", "ed.preview": "Προεπισκόπηση (χωρίς οδηγούς και πλαίσια)", "ed.panel": "Πάνελ", "ed.more": "Περισσότερα",
      "ed.export": "Εξαγωγή", "ed.rename": "Μετονομασία εγγράφου",
      "more.setup": "Ρυθμίσεις εγγράφου…", "more.pkg": "Αποθήκευση ως πακέτο (.oroslayout)", "more.text": "Εισαγωγή κειμένου (.txt)…",
      "more.story": "Story Editor", "more.selall": "Επιλογή όλων στη σελίδα", "more.rec": "Ανακτημένο κείμενο ({n})",
      "tool.select": "Επιλογή (V)", "tool.text": "Πλαίσιο κειμένου (T)", "tool.image": "Πλαίσιο εικόνας (F)",
      "tool.rect": "Ορθογώνιο (R)", "tool.ell": "Έλλειψη (E)", "tool.line": "Γραμμή (L)", "tool.hand": "Χέρι (H)",
      "tab.props": "Ιδιότητες", "tab.pages": "Σελίδες", "tab.styles": "Στυλ", "tab.colors": "Χρώματα",
      "st.page": "Σελίδα {n} από {c}", "st.master": "Master {name}", "st.sel": "{n} επιλεγμένα", "st.sel1": "1 επιλεγμένο",
      "st.overset": "Κείμενο που περισσεύει ({n})",
      "st.pf": "Προέλεγχος: {n}", "st.pfOk": "Προέλεγχος OK",
      "pf.title": "Προέλεγχος εκτύπωσης", "pf.none": "Κανένα πρόβλημα: το έγγραφο είναι έτοιμο για εκτύπωση.", "pf.note": "Διάλεξε ένα πρόβλημα για να επιλεγεί το αντικείμενό του.",
      "pf.page": "Σελίδα {n}", "pf.master": "Master {name}",
      "pf.overset": "Κείμενο που περισσεύει", "pf.missing": "Λείπει η εικόνα", "pf.ppi": "Χαμηλή ανάλυση ({n} ppi, 150+ για εκτύπωση)",
      "pf.bleed": "Φτάνει στο όριο κοπής αλλά όχι στο bleed", "pf.small": "Κείμενο μικρότερο από 6 pt", "pf.empty": "Άδειο πλαίσιο",
      "ms.editing": "Επεξεργασία: {name}", "ms.done": "Τέλος",
      "ms.detach": "Αποδέσμευση αντικειμένων master εδώ", "ms.detachOne": "Αποδέσμευση αυτού του αντικειμένου master", "ms.reset": "Επαναφορά από το master", "ms.detached": "Αποδεσμεύτηκαν {n} αντικείμενα master", "ms.noneHere": "Δεν υπάρχουν αντικείμενα master σε αυτή τη σελίδα",
      "thread.hint": "Πάτα σε πλαίσιο κειμένου ή σε κενό σημείο σελίδας για να συνεχίσει εκεί το κείμενο.",
      "thread.notEmpty": "Αυτό το πλαίσιο έχει ήδη κείμενο. Διάλεξε άδειο πλαίσιο ή κενό σημείο.",
      "thread.otherKind": "Πλαίσιο σελίδας και πλαίσιο master δεν μπορούν να μοιράζονται κείμενο.",
      "btn.cancel": "Άκυρο", "btn.ok": "OK", "btn.create": "Δημιουργία", "btn.save": "Αποθήκευση", "btn.close": "Κλείσιμο",
      "btn.delete": "Διαγραφή", "btn.undo": "Αναίρεση", "btn.apply": "Εφαρμογή", "btn.new": "Νέο", "btn.edit": "Επεξεργασία",
      "props.none": "Δεν έχει επιλεγεί τίποτα", "props.doc": "Έγγραφο", "props.size": "Μέγεθος σελίδας",
      "props.setup": "Ρυθμίσεις εγγράφου…", "props.pageMaster": "Master αυτής της σελίδας", "props.noMaster": "[Κανένα]",
      "props.pos": "Θέση και μέγεθος", "props.x": "X", "props.y": "Y", "props.w": "Π", "props.h": "Υ",
      "props.rot": "Περιστροφή", "props.op": "Αδιαφάνεια", "props.fill": "Γέμισμα", "props.stroke": "Περίγραμμα",
      "props.sw": "Πάχος", "props.dash": "Διακεκομμένο", "props.r": "Γωνίες", "props.none2": "Κανένα",
      "props.text": "Πλαίσιο κειμένου", "props.cols": "Στήλες", "props.gut": "Κενό στηλών", "props.ins": "Εσωτερικό περιθώριο",
      "props.va": "Κάθετη στοίχιση", "props.va.t": "Πάνω", "props.va.c": "Κέντρο", "props.va.b": "Κάτω",
      "props.edit": "Επεξεργασία κειμένου", "props.threadNext": "Συνέχεια σε νέο πλαίσιο", "props.autoflow": "Αυτόματη ροή: σελίδες μέχρι να χωρέσει",
      "props.unthread": "Αποσύνδεση μετά από αυτό το πλαίσιο", "props.chain": "Πλαίσιο {i} από {n} σε αυτό το κείμενο",
      "props.image": "Εικόνα", "props.place": "Τοποθέτηση εικόνας…", "props.replace": "Αντικατάσταση εικόνας…",
      "props.fit": "Ολόκληρη", "props.fillf": "Γέμισμα", "props.scale": "Κλίμακα", "props.offx": "Μετατόπιση X", "props.offy": "Μετατόπιση Y",
      "props.ppi": "{n} ppi πραγματική ανάλυση", "props.ppiLow": "{n} ppi: χαμηλή για εκτύπωση", "props.missing": "Το αρχείο της εικόνας δεν έχει έρθει ακόμα σε αυτή τη συσκευή",
      "props.wrap": "Αναδίπλωση κειμένου", "props.wrap.none": "Καμία", "props.wrap.box": "Ορθογώνιο", "props.wrap.ell": "Έλλειψη", "props.wo": "Απόσταση",
      "props.arrange": "Σειρά", "props.front": "Μπροστά απ' όλα", "props.fwd": "Ένα μπροστά", "props.bwd": "Ένα πίσω", "props.back": "Πίσω απ' όλα",
      "props.align": "Στοίχιση", "props.alignTo": "στα περιθώρια", "props.alignSel": "στην επιλογή",
      "props.al": "Στοίχιση αριστερά", "props.ac": "Στοίχιση στο κέντρο", "props.ar": "Στοίχιση δεξιά",
      "props.at": "Στοίχιση πάνω", "props.am": "Στοίχιση στη μέση", "props.ab": "Στοίχιση κάτω",
      "props.dh": "Ισοκατανομή οριζόντια", "props.dv": "Ισοκατανομή κάθετα",
      "props.lock": "Κλείδωμα θέσης", "props.hide": "Απόκρυψη", "hide.done": "Κρύφτηκε. Εμφανίζεται ξανά από το πάνελ σελίδας (χωρίς επιλογή).", "hide.show": "Εμφάνιση κρυφών αντικειμένων ({n})", "props.group": "Ομαδοποίηση", "props.ungroup": "Κατάργηση ομάδας",
      "props.dup": "Διπλασιασμός", "props.del": "Διαγραφή", "props.multi": "{n} αντικείμενα",
      "pages.title": "Σελίδες", "pages.add": "Νέα σελίδα", "pages.dup": "Διπλασιασμός σελίδας", "pages.del": "Διαγραφή σελίδας",
      "pages.up": "Μετακίνηση νωρίτερα", "pages.down": "Μετακίνηση αργότερα", "pages.masters": "Masters",
      "pages.newMaster": "Νέο master", "pages.editMaster": "Επεξεργασία master", "pages.renameMaster": "Μετονομασία",
      "pages.delMaster": "Διαγραφή master", "pages.applyMaster": "Εφαρμογή σε αυτή τη σελίδα", "pages.n": "{n}",
      "pages.lastOne": "Ένα έγγραφο κρατά τουλάχιστον μία σελίδα.", "pages.max": "Ένα έγγραφο έχει το πολύ {n} σελίδες.",
      "pages.masterUsed": "Οι σελίδες που το χρησιμοποιούν θα μείνουν χωρίς master.",
      "styles.para": "Στυλ παραγράφου", "styles.char": "Στυλ χαρακτήρων", "styles.new": "Νέο στυλ",
      "styles.noneChar": "[Χωρίς στυλ χαρακτήρων]", "styles.applyHint": "Άνοιξε ένα κείμενο για να εφαρμόσεις στυλ· το μολύβι αλλάζει το στυλ.",
      "styles.edit": "Επεξεργασία στυλ", "styles.del": "Διαγραφή στυλ",
      "sty.name": "Όνομα", "sty.base": "Βασίζεται σε", "sty.baseNone": "[Κανένα]", "sty.font": "Γραμματοσειρά", "sty.size": "Μέγεθος (pt)",
      "sty.lead": "Διάστιχο (pt)", "sty.auto": "Αυτόματο", "sty.align": "Στοίχιση",
      "sty.al": "Αριστερά", "sty.ac": "Κέντρο", "sty.ar": "Δεξιά", "sty.aj": "Πλήρης",
      "sty.b": "Έντονα", "sty.i": "Πλάγια", "sty.u": "Υπογράμμιση", "sty.caps": "Κεφαλαία", "sty.bul": "Κουκκίδα",
      "sty.sb": "Διάστημα πριν", "sty.sa": "Διάστημα μετά", "sty.fi": "Εσοχή πρώτης γραμμής", "sty.li": "Εσοχή αριστερά", "sty.ri": "Εσοχή δεξιά",
      "sty.track": "Αραίωση (1/1000 em)", "sty.color": "Χρώμα", "sty.inherit": "Όπως η βάση",
      "font.sans": "Noto Sans", "font.serif": "Noto Serif", "font.mono": "Noto Sans Mono",
      "colors.title": "Δείγματα", "colors.new": "Νέο δείγμα", "colors.edit": "Επεξεργασία δείγματος", "colors.del": "Διαγραφή δείγματος",
      "colors.mode": "Τύπος", "colors.rgb": "RGB", "colors.cmyk": "CMYK", "colors.hex": "Hex",
      "colors.keep": "Το Μαύρο και το Χαρτί δεν διαγράφονται.", "colors.used": "Ό,τι το χρησιμοποιεί γίνεται Μαύρο.",
      "colors.note": "Το CMYK φαίνεται στην οθόνη με απλή μετατροπή (χωρίς προφίλ χρώματος)· το PDF παίρνει τις ακριβείς τιμές CMYK.",
      "new.title": "Νέο έγγραφο", "new.from": "Ξεκίνα από", "new.blank": "Κενό", "new.name": "Όνομα", "new.size": "Μέγεθος σελίδας", "new.custom": "Προσαρμοσμένο",
      "new.orient": "Προσανατολισμός", "new.portrait": "Κάθετο", "new.landscape": "Οριζόντιο", "new.pages": "Σελίδες",
      "new.facing": "Αντικριστές σελίδες", "new.margins": "Περιθώρια", "new.cols": "Στήλες", "new.gut": "Κενό στηλών",
      "new.bleed": "Bleed (ξάκρισμα)", "new.unit": "Μονάδες", "new.top": "Πάνω", "new.bottom": "Κάτω", "new.inside": "Μέσα",
      "new.outside": "Έξω", "new.left": "Αριστερά", "new.right": "Δεξιά", "new.w": "Πλάτος", "new.h": "Ύψος",
      "setup.title": "Ρυθμίσεις εγγράφου", "setup.note": "Τα αντικείμενα μένουν στη θέση τους όταν αλλάζει το μέγεθος.",
      "preset.a4": "A4", "preset.a5": "A5", "preset.a3": "A3", "preset.a6": "A6", "preset.b5": "B5",
      "preset.letter": "US Letter", "preset.legal": "US Legal", "preset.card": "Επαγγελματική κάρτα", "preset.dl": "Φυλλάδιο DL",
      "preset.square": "Τετράγωνο post", "preset.poster": "Αφίσα 50×70", "preset.custom": "Προσαρμοσμένο",
      "unit.mm": "mm", "unit.pt": "pt", "unit.in": "in",
      "exp.title": "Εξαγωγή", "exp.img": "Εικόνα (PNG / JPG)", "exp.page": "Σελίδα", "exp.format": "Μορφή", "exp.res": "Ανάλυση", "exp.imgGo": "Εξαγωγή εικόνας", "exp.capped": "Εξήχθη στα {n} dpi (όριο 16 megapixel)", "exp.pdf": "PDF", "exp.pkg": "Πακέτο", "exp.range": "Σελίδες", "exp.all": "Όλες",
      "exp.cur": "Τρέχουσα σελίδα", "exp.custom": "Εύρος", "exp.rangeHint": "π.χ. 1-3, 5",
      "exp.spreads": "Ανά ζεύγος σελίδων", "exp.bleed": "Με bleed", "exp.marks": "Σημάδια κοπής",
      "exp.quality": "Εικόνες", "exp.print": "Εκτύπωση (300 ppi)", "exp.screen": "Οθόνη (150 ppi)",
      "exp.go": "Εξαγωγή PDF", "exp.working": "Φτιάχνω το PDF…", "exp.done": "Το PDF αποθηκεύτηκε", "exp.fail": "Το PDF δεν μπόρεσε να φτιαχτεί.",
      "exp.badRange": "Αυτό το εύρος σελίδων δεν είναι σωστό.", "exp.pkgDone": "Το πακέτο αποθηκεύτηκε", "exp.pkgNote": "Ένα αρχείο με το έγγραφο και τις εικόνες του, για αντίγραφο ή για άνοιγμα σε άλλη συσκευή.",
      "imp.done": "Το έγγραφο άνοιξε", "idml.working": "Διαβάζω το αρχείο InDesign…", "idml.bad": "Αυτό το αρχείο δεν διαβάζεται ως έγγραφο InDesign (.idml).", "idml.done": "Εισαγωγή από InDesign: {p} σελίδες, {n} αντικείμενα.",
      "sla.working": "Διαβάζω το αρχείο Scribus…", "sla.bad": "Αυτό το αρχείο δεν διαβάζεται ως έγγραφο Scribus.", "sla.done": "Εισαγωγή από Scribus: {p} σελίδες, {n} αντικείμενα.", "sla.linked": "{n} εικόνες δεν ήταν μέσα στο αρχείο: βάλ’ τες ξανά με «Τοποθέτηση εικόνας».", "sla.skipped": "{n} αντικείμενα (πίνακες, ελεύθερα σχήματα, κείμενο σε διαδρομή) έγιναν απλά πλαίσια ή παραλείφθηκαν.", "imp.bad": "Αυτό το αρχείο δεν είναι πακέτο της Σελιδοποίησης.", "imp.imgFail": "{n} εικόνες δεν επανήλθαν.",
      "img.fail": "Αυτό το αρχείο δεν διαβάζεται ως εικόνα.", "img.nofs": "Ο δίσκος του orOS δεν είναι διαθέσιμος σε αυτή τη συσκευή.",
      "img.placed": "Η εικόνα τοποθετήθηκε", "img.missing": "Συγχρονίζεται…",
      "txt.fail": "Αυτό το αρχείο δεν διαβάζεται ως κείμενο.", "txt.done": "Το κείμενο εισήχθη",
      "inframe.aria": "Πληκτρολόγηση στο πλαίσιο κειμένου",
      "story.title": "Story Editor", "story.empty": "Γράψε εδώ…", "story.ps": "Στυλ παραγράφου", "story.cs": "Στυλ χαρακτήρων",
      "story.b": "Έντονα", "story.i": "Πλάγια", "story.u": "Υπογράμμιση", "story.pn": "Αριθμός σελίδας", "story.pc": "Σύνολο σελίδων",
      "story.chars": "{n} χαρακτήρες", "story.overset": "· περισσεύει", "story.none": "Διάλεξε πρώτα ένα πλαίσιο κειμένου.",
      "rec.title": "Ανακτημένο κείμενο", "rec.note": "Άλλαξε σε δύο συσκευές ταυτόχρονα: η άλλη εκδοχή φυλάγεται εδώ.",
      "rec.copy": "Αντιγραφή", "rec.copied": "Αντιγράφηκε", "rec.del": "Απόρριψη",
      "toast.deleted": "Διαγράφηκε", "toast.docDeleted": "Το έγγραφο διαγράφηκε", "toast.save": "Ο χώρος γέμισε: οι τελευταίες αλλαγές δεν αποθηκεύτηκαν σε αυτή τη συσκευή.",
      "toast.big": "Το έγγραφο μεγαλώνει ({n} KB). Τα μεγάλα έγγραφα γεμίζουν τον χώρο που μοιράζονται όλες οι εφαρμογές.",
      "toast.locked": "Αυτό το αντικείμενο είναι κλειδωμένο.", "toast.gone": "Αυτό το έγγραφο διαγράφηκε σε άλλη συσκευή.",
      "toast.fontFail": "Οι γραμματοσειρές δεν φόρτωσαν.", "toast.maxItems": "Ένα έγγραφο έχει το πολύ {n} αντικείμενα.",
      "toast.flowDone": "Το κείμενο μπήκε σε {n} νέες σελίδες.", "toast.flowMax": "Σταμάτησα στις {n} σελίδες: το κείμενο ακόμα περισσεύει.",
      "toast.copied": "Αντιγράφηκε", "ed.paste": "Επικόλληση",
      "dlg.rename": "Μετονομασία", "dlg.delDoc": "Διαγραφή αυτού του εγγράφου;", "dlg.delDocSub": "Μπορείς να το αναιρέσεις αμέσως μετά.",
      "a11y.canvas": "Καμβάς σελίδας"
    }
  };
  LY.STRINGS = STRINGS;

  function t(key, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  LY.t = t;
  LY.label = function (name) { return M.label(name, LANG); };

  // BOOT MARKER
  try { console.log("[orOS] layout app v1.0.0 booted"); } catch (e) {}

  // ---------- 2. Helpers + toasts ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  LY.$ = $; LY.el = el;

  var ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    select: '<path d="M5 3l14 8-6 2-2 6z"/>',
    text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
    rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
    ell: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
    line: '<path d="M5 19L19 5"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V12"/><path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L3.3 14a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    al: '<path d="M4 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="7" y="14" width="6" height="4"/>',
    ac: '<path d="M12 3v18"/><rect x="6" y="6" width="12" height="4"/><rect x="8" y="14" width="8" height="4"/>',
    ar: '<path d="M20 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="11" y="14" width="6" height="4"/>',
    at: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="7" width="4" height="6"/>',
    am: '<path d="M3 12h18"/><rect x="6" y="6" width="4" height="12"/><rect x="14" y="8" width="4" height="8"/>',
    ab: '<path d="M3 20h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="11" width="4" height="6"/>',
    dh: '<path d="M4 4v16M20 4v16"/><rect x="9" y="8" width="6" height="8"/>',
    dv: '<path d="M4 4h16M4 20h16"/><rect x="8" y="9" width="8" height="6"/>',
    front: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
    toBack: '<rect x="4" y="4" width="12" height="12" rx="1"/><path d="M20 8v11a1 1 0 0 1-1 1H8"/>',
    fwd: '<path d="M12 19V5M6 11l6-6 6 6"/>', bwd: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
    hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17v.5"/>',
    group: '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/><path d="M3 15v6h6M21 9V3h-6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    flow: '<path d="M4 6h10M4 10h10M4 14h6"/><path d="M15 14l3 3 3-3M18 9v8"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }
  function iconBtn(name, label, cls) {
    var b = el("button", "icon-btn" + (cls ? " " + cls : ""));
    b.type = "button";
    b.innerHTML = icon(name);
    b.setAttribute("aria-label", label);
    b.title = label;
    return b;
  }
  function setIcon(btn, name, label) {
    btn.innerHTML = icon(name);
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }
  LY.icon = icon; LY.iconBtn = iconBtn; LY.setIcon = setIcon;

  // Toast with an optional action (Undo).
  var toastTimer = null;
  function toast(msg, action, fn) {
    var n = $("toast");
    n.innerHTML = "";
    n.appendChild(el("span", "", msg));
    if (action && fn) {
      var b = el("button", "toast-btn", action);
      b.type = "button";
      b.addEventListener("click", function () { hideToast(); fn(); });
      n.appendChild(b);
    }
    n.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 8000 : 2800);
  }
  function hideToast() { $("toast").classList.remove("on"); }
  LY.toast = toast;
  LY.live = function (msg) {
    var n = $("live");
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  };

  // Lengths in the document's unit.
  LY.unit = function () { return LY.doc ? LY.doc.setup.unit : "mm"; };
  LY.fmt = function (pt, unit) {
    var u = unit || LY.unit(), v = M.toUnit(pt, u);
    var d = u === "pt" ? 1 : u === "mm" ? 2 : 3;
    return String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
  };
  LY.parse = function (s, unit) {
    var v = parseFloat(String(s).replace(",", "."));
    return isFinite(v) ? M.fromUnit(v, unit || LY.unit()) : null;
  };

  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  LY.dialogHost = dialogHost;

  // ---------- 3. Storage + prefs ----------
  var data = { ver: 1, docs: [], dt: {} };
  LY.doc = null;
  LY.prefs = { doc: null, zoom: 0 };

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.docs)) { data = M.normData(parsed); return; }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] layout: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, docs: [], dt: {} };
  }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = p && typeof p === "object" ? p : {};
    LY.prefs = { doc: M.isId(p.doc) ? p.doc : null };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(LY.prefs)); } catch (e) {}
  }
  LY.savePrefs = savePrefs;

  var saveTimer = null, saveFailShown = false, bigWarned = {};
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; toast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  LY.save = save; LY.flush = function () { if (saveTimer) saveNow(); };
  LY.data = function () { return data; };

  function findDoc(id) { return M.find(data.docs, id); }
  LY.findDoc = findDoc;

  // ---------- 4. Undo + mutations ----------
  // A mutation snapshots the open document first, runs fn(doc, now)
  // (which stamps what it changes, R27), normalizes, saves. Undo
  // re-applies a snapshot as NEW edits (fresh mtimes, tombstones),
  // so it syncs like any other change.
  var undoStack = [], redoStack = [], gesture = null;
  var listeners = {};
  LY.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  function emit(ev, arg) { (listeners[ev] || []).forEach(function (fn) { try { fn(arg); } catch (e) { console.error(e); } }); }
  LY.emit = emit;

  var lastNow = 0;
  function now() { lastNow = Math.max(Date.now(), lastNow + 1); return lastNow; }
  LY.now = now;

  function replaceDoc(nd) {
    var i = data.docs.indexOf(LY.doc);
    if (i < 0) return;
    data.docs[i] = nd;
    LY.doc = nd;
  }

  // fn returns false to cancel. opts.gesture: part of a drag (one
  // undo step for the whole gesture).
  function op(fn, opts) {
    if (!LY.doc) return false;
    var before = gesture || JSON.stringify(LY.doc);
    var work = JSON.parse(JSON.stringify(LY.doc));
    var res = fn(work, now());
    if (res === false) return false;
    var nd = M.normDoc(work);
    var after = JSON.stringify(nd);
    if (after === JSON.stringify(LY.doc)) return false;
    if (!gesture) pushUndo(before);
    replaceDoc(nd);
    commit();
    return true;
  }
  LY.op = op;
  // During a drag the doc changes on every move: one snapshot at the
  // start, applied without saving; endGesture saves once.
  LY.beginGesture = function () { gesture = JSON.stringify(LY.doc); };
  LY.endGesture = function () {
    if (!gesture) return;
    var g = gesture; gesture = null;
    if (g !== JSON.stringify(LY.doc)) { pushUndo(g); commit(); }
  };
  LY.inGesture = function () { return !!gesture; };

  function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
  }

  function commit() {
    save();
    var bytes = M.docBytes(LY.doc);
    if (bytes > DOC_WARN && !bigWarned[LY.doc.id]) {
      bigWarned[LY.doc.id] = 1;
      toast(t("toast.big", { n: Math.round(bytes / 1024) }));
    }
    emit("doc");
  }
  LY.commit = commit;

  // Make the open doc look like `target` with fresh stamps.
  function applyState(target) {
    var cur = LY.doc, t0 = now();
    var nd = JSON.parse(JSON.stringify(cur));
    if (cur.name !== target.name || JSON.stringify(cur.setup) !== JSON.stringify(target.setup)) {
      nd.name = target.name; nd.setup = target.setup; nd.m = Math.max(t0, cur.m + 1);
    }
    M.COLLECTIONS.forEach(function (c) {
      if (c === "rec") return;
      var tmap = {}, cmap = {};
      target[c].forEach(function (e) { tmap[e.id] = e; });
      cur[c].forEach(function (e) { cmap[e.id] = e; });
      var list = [];
      Object.keys(tmap).forEach(function (id) {
        var e = tmap[id], ce = cmap[id];
        if (ce && JSON.stringify(withoutM(ce, c)) === JSON.stringify(withoutM(e, c))) { list.push(ce); return; }
        var copy = JSON.parse(JSON.stringify(e));
        copy.m = Math.max(t0, (ce ? ce.m : 0) + 1, (nd.tombs[id] || 0) + 1);
        if (c === "stories" && ce) copy.h = [ce.m].concat(ce.h || []);
        list.push(copy);
      });
      Object.keys(cmap).forEach(function (id) { if (!tmap[id]) nd.tombs[id] = Math.max(t0, cmap[id].m); });
      nd[c] = list;
    });
    return M.normDoc(nd);
  }
  // stamps aside (a story's h is its stamp history; an item's h is its height)
  function withoutM(e, c) { var o = {}; Object.keys(e).forEach(function (k) { if (k !== "m" && !(k === "h" && c === "stories")) o[k] = e[k]; }); return o; }

  LY.undo = function () {
    if (!LY.doc || !undoStack.length) return;
    LY.flushStory && LY.flushStory();
    var snap = undoStack.pop();
    redoStack.push(JSON.stringify(LY.doc));
    replaceDoc(applyState(JSON.parse(snap)));
    commit();
  };
  LY.redo = function () {
    if (!LY.doc || !redoStack.length) return;
    var snap = redoStack.pop();
    undoStack.push(JSON.stringify(LY.doc));
    replaceDoc(applyState(JSON.parse(snap)));
    commit();
  };
  LY.canUndo = function () { return undoStack.length > 0; };
  LY.canRedo = function () { return redoStack.length > 0; };

  // ---------- 5. Home ----------
  var thumbs = {};          // docId → { key, url }
  function docTitle(d) { return d.name || t("doc.untitled"); }
  function fmtDate(ms) {
    var d = new Date(ms);
    var dd = ("0" + d.getDate()).slice(-2), mm = ("0" + (d.getMonth() + 1)).slice(-2);
    var hh = ("0" + d.getHours()).slice(-2), mi = ("0" + d.getMinutes()).slice(-2);
    return LANG === "el" ? dd + "/" + mm + "/" + d.getFullYear() + " " + hh + ":" + mi
      : d.getFullYear() + "-" + mm + "-" + dd + " " + hh + ":" + mi;
  }
  LY.fmtDate = fmtDate;

  function thumbFor(d) {
    var key = M.maxM(d) + ":" + d.pages.length;
    var c = thumbs[d.id];
    if (c && c.key === key) return c.url;
    var pages = M.pagesInOrder(d);
    if (!pages.length || !T.isLoaded("sans-r")) return null;
    try {
      var L = R.computeLayout(d);
      var scale = 180 / Math.max(d.setup.w, d.setup.h);
      var cv = R.renderPage(d, pages[0], L, scale * (window.devicePixelRatio || 1), { getImage: LY.A.get });
      var url = cv.toDataURL("image/png");
      thumbs[d.id] = { key: key, url: url };
      return url;
    } catch (e) { return null; }
  }

  function renderHome() {
    var host = $("docs");
    host.innerHTML = "";
    var q = ($("home-search").value || "").trim().toLocaleLowerCase();
    var docs = data.docs.slice().sort(function (a, b) { return M.maxM(b) - M.maxM(a) || M.cmpStr(a.id, b.id); });
    $("home-tools").hidden = docs.length < 7;
    $("home-sub").textContent = docs.length === 1 ? t("home.count1") : docs.length ? t("home.count", { n: docs.length }) : "";
    $("home-empty").hidden = docs.length > 0;
    var shown = docs.filter(function (d) { return !q || docTitle(d).toLocaleLowerCase().indexOf(q) >= 0; });
    if (docs.length && !shown.length) host.appendChild(el("p", "hint", t("home.none")));
    shown.forEach(function (d) {
      var card = el("div", "doc-card");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      var th = el("div", "doc-thumb");
      var ratio = d.setup.h / d.setup.w;
      th.style.setProperty("--ratio", String(Math.min(1.6, Math.max(0.4, ratio))));
      var url = thumbFor(d);
      if (url) { var img = el("img"); img.src = url; img.alt = ""; th.appendChild(img); }
      card.appendChild(th);
      var meta = el("div", "doc-meta");
      meta.appendChild(el("span", "doc-title", docTitle(d)));
      var n = d.pages.length;
      meta.appendChild(el("span", "doc-sub", (n === 1 ? t("home.pages1") : t("home.pages", { n: n })) + " · " + fmtDate(M.maxM(d))));
      card.appendChild(meta);
      var more = iconBtn("more", t("ed.more"), "doc-more");
      more.addEventListener("click", function (e) { e.stopPropagation(); cardMenu(d, more); });
      card.appendChild(more);
      card.addEventListener("click", function () { openDoc(d.id); });
      card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDoc(d.id); } });
      card.addEventListener("contextmenu", function (e) { e.preventDefault(); cardMenu(d, more); });
      host.appendChild(card);
    });
  }
  LY.renderHome = renderHome;

  function cardMenu(d, anchor) {
    LY.menu(anchor, [
      { label: t("card.open"), fn: function () { openDoc(d.id); } },
      { label: t("card.rename"), fn: function () { renameDoc(d.id); } },
      { label: t("card.dup"), fn: function () { duplicateDoc(d.id); } },
      { label: t("card.pkg"), fn: function () { LY.io.exportPackage(d); } },
      { label: t("card.del"), danger: true, fn: function () { deleteDoc(d.id); } }
    ]);
  }

  // Data-level edits (outside the open-doc undo stack).
  function stampDoc(d, nowMs) { d.m = Math.max(nowMs, (d.m || 0) + 1); }

  function renameDoc(id) {
    var d = findDoc(id);
    if (!d) return;
    LY.prompt(t("dlg.rename"), docTitle(d), function (v) {
      v = String(v || "").trim().slice(0, 120);
      if (!v || v === d.name) return;
      if (LY.doc && LY.doc.id === id) {
        op(function (doc, nw) { doc.name = v; stampDoc(doc, nw); });
        $("ed-name").textContent = v;
      } else {
        d.name = v; stampDoc(d, now());
        save();
      }
      renderHome();
    });
  }
  LY.renameDoc = renameDoc;

  function duplicateDoc(id) {
    var d = findDoc(id);
    if (!d) return;
    var copy = JSON.parse(JSON.stringify(d));
    var nw = now();
    copy.id = M.newId("doc");
    copy.name = t("doc.copy", { name: docTitle(d) }).slice(0, 120);
    copy.m = nw;
    // fresh stamps so the copy is not older than anything it holds
    M.COLLECTIONS.forEach(function (c) { (copy[c] || []).forEach(function (e) { e.m = nw; if (e.h) e.h = []; }); });
    copy.tombs = {};
    data.docs.push(M.normDoc(copy));
    data = M.normData(data);
    save();
    renderHome();
  }

  function deleteDoc(id) {
    var d = findDoc(id);
    if (!d) return;
    var nw = now();
    var keep = JSON.parse(JSON.stringify(d));
    data.dt[id] = Math.max(nw, M.maxM(d));
    data = M.normData(data);
    save();
    if (LY.prefs.doc === id) { LY.prefs.doc = null; savePrefs(); }
    renderHome();
    toast(t("toast.docDeleted"), t("btn.undo"), function () {
      // resurrect: every entity newer than the tombstone (R17)
      var t1 = now();
      keep.m = t1;
      M.COLLECTIONS.forEach(function (c) { (keep[c] || []).forEach(function (e) { e.m = t1; }); });
      data.docs.push(M.normDoc(keep));
      data = M.normData(data);
      save();
      renderHome();
    });
  }

  function addDoc(d) {
    data.docs.push(d);
    data = M.normData(data);
    save();
    openDoc(d.id);
  }
  function createDoc(opts) { addDoc(M.newDoc(opts, now())); }
  LY.createDoc = createDoc; LY.addDoc = addDoc;

  function openDoc(id) {
    var d = findDoc(id);
    if (!d) return;
    LY.doc = d;
    undoStack = []; redoStack = []; gesture = null;
    LY.prefs.doc = id; savePrefs();
    $("home").hidden = true;
    $("editor").hidden = false;
    $("ed-name").textContent = docTitle(d);
    emit("open");
  }
  LY.openDoc = openDoc;

  function goHome() {
    LY.flushStory && LY.flushStory();
    emit("close");
    LY.doc = null;
    LY.prefs.doc = null; savePrefs();
    $("editor").hidden = true;
    $("home").hidden = false;
    renderHome();
  }
  LY.goHome = goHome;

  // ---------- Menus + small dialogs ----------
  var menuClose = null;
  LY.menu = function (anchor, items) {
    var m = $("menu");
    m.innerHTML = "";
    items.forEach(function (it) {
      if (it.sep) { m.appendChild(el("div", "menu-sep")); return; }
      var b = el("button", "menu-item" + (it.danger ? " danger" : "") + (it.on ? " on" : ""), it.label);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      if (it.disabled) b.disabled = true;
      b.addEventListener("click", function () { closeMenu(); it.fn(); });
      m.appendChild(b);
    });
    m.hidden = false;
    var r = anchor.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var x = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
    var y = r.bottom + 4;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 4);
    m.style.left = x + "px"; m.style.top = y + "px";
    var first = m.querySelector("button:not([disabled])");
    if (first) first.focus();
    setTimeout(function () {
      menuClose = function (e) {
        if (e.type === "keydown" && e.key !== "Escape") return;
        if (e.type !== "keydown" && m.contains(e.target)) return;
        closeMenu();
      };
      document.addEventListener("pointerdown", menuClose, true);
      document.addEventListener("keydown", menuClose, true);
    }, 0);
  };
  function closeMenu() {
    $("menu").hidden = true;
    if (menuClose) {
      document.removeEventListener("pointerdown", menuClose, true);
      document.removeEventListener("keydown", menuClose, true);
      menuClose = null;
    }
  }
  LY.closeMenu = closeMenu;

  // The one <dialog>: build(body, close) fills it.
  LY.openDialog = function (title, build, wide) {
    var d = $("dlg");
    if (d.open) d.close();
    d.innerHTML = "";
    d.className = "dlg" + (wide ? " wide" : "");
    d.appendChild(el("h2", "dlg-title", title));
    var body = el("div", "dlg-body");
    d.appendChild(body);
    function close() { if (d.open) d.close(); }
    build(body, close);
    d.showModal();
    var f = d.querySelector("input, select, button.primary");
    if (f) f.focus();
    return close;
  };

  LY.prompt = function (title, value, done) {
    LY.openDialog(title, function (body, close) {
      var inp = el("input", "inp");
      inp.type = "text"; inp.value = value || ""; inp.maxLength = 120;
      body.appendChild(inp);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var o = el("button", "btn primary", t("btn.ok")); o.type = "button";
      c.addEventListener("click", close);
      o.addEventListener("click", function () { close(); done(inp.value); });
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); o.click(); } });
      act.appendChild(c); act.appendChild(o);
      body.appendChild(act);
      setTimeout(function () { inp.select(); }, 0);
    });
  };

  // ---------- 6. Sync slice + palette ----------
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
    emit("palette");
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
    api.registerSlice("layout", sliceGet, sliceSet, STORAGE_KEY, M.mergeData);
  }

  function sliceGet() { return M.normData(data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.docs)) return;
    var before = JSON.stringify(data);
    var openId = LY.doc ? LY.doc.id : null;
    var openBefore = LY.doc ? JSON.stringify(LY.doc) : null;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = M.normData(incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    if (openId) {
      var d = findDoc(openId);
      if (!d) { toast(t("toast.gone")); goHome(); return; }
      LY.doc = d;
      if (JSON.stringify(d) !== openBefore) emit("remote");
    } else renderHome();
  }

  // ---------- 7. Boot ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("home-search").placeholder = t("home.search");
    $("home-search").setAttribute("aria-label", t("home.search"));
  }

  function wireHome() {
    $("btn-new").addEventListener("click", function () { LY.dlg.newDoc(); });
    $("btn-new2").addEventListener("click", function () { LY.dlg.newDoc(); });
    $("btn-import").addEventListener("click", function () { LY.io.importPackage(); });
    $("home-search").addEventListener("input", renderHome);
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { LY.flushStory && LY.flushStory(); LY.flush(); }
    });
    window.addEventListener("pagehide", function () { LY.flushStory && LY.flushStory(); LY.flush(); });
    LY.A.onChange(function () { thumbs = {}; if (!LY.doc) renderHome(); });
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    registerSync();
    inheritPalette();
    watchPalette();
    wireHome();
    emit("boot");
    T.load(T.allKeys()).then(function () {
      $("loading").hidden = true;
      if (LY.prefs.doc && findDoc(LY.prefs.doc)) openDoc(LY.prefs.doc);
      else renderHome();
      takeSearchTarget();
    }, function () {
      $("loading").hidden = true;
      toast(t("toast.fontFail"));
      renderHome();
      takeSearchTarget();
    });
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget): target { doc }.
  // Opens the document (leaving the one that is open through Home, so
  // the Story Editor flushes). Unknown id → no-op; nothing happens
  // while a dialog is open.
  var searchReady = false, searchLater = null;   // fonts first (boot)
  function openSearchTarget(tg) {
    if (!searchReady) { searchLater = tg; return; }
    var id = tg && typeof tg.doc === "string" ? tg.doc : null;
    if (!id || !findDoc(id)) return;
    if (document.querySelector("dialog[open]")) return;
    if (LY.doc && LY.doc.id === id) return;
    if (LY.doc) goHome();
    openDoc(id);
  }
  window.__orosOpenAt = openSearchTarget;
  function takeSearchTarget() {
    searchReady = true;
    if (searchLater) { var later = searchLater; searchLater = null; openSearchTarget(later); return; }
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("layout");
        if (pending) openSearchTarget(pending);
      }
    } catch (e) {}
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
