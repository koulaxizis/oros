// ============================================================
// orOS Slides — core of the app (v1.0.0)
// Presentations: themes, layouts with placeholders, bullets with
// levels, pictures, shapes, speaker notes, a sorter and an outline
// view, a full-screen show with a presenter view, PDF / PNG export
// and lossless .orosslides packages.
// The engine is shared: ../designkit/ (model, text, render, pdf,
// assets from Layout; show.js from this app). slides/core.js is the
// data model and its merge, slides/dk.js turns slides into designkit
// documents for drawing.
// Files:
//   app.js     core: i18n, state, storage, sync, undo, home, boot
//   editor.js  the slide canvas, selection, the strip, sorter, outline, notes
//   text.js    editing the text of a box (bullets, levels, bold, colour)
//   panels.js  the side panel (slide, presentation, object) + dialogs
//   io.js      show, PDF / PNG export, packages, pictures
// Data:
//   - synced slice "slides" (oros-slides-data): SLIDES v1, see core.js
//     (merge in parts + tombstones + ghosts, canonical, R5/R17/R26)
//   - pictures: /internal/Assets/<sha256>.<ext> on the orOS disk,
//     synced per file by Vault Drive (designkit/assets.js, R30)
//   - device-local (R10): oros-slides-prefs ({ deck, view, notes }),
//     oros-slides-recovered (text kept from concurrent edits),
//     oros-slides-data-broken (rescue copy)
//   - undo history: memory only
// Sections:
//   1. Constants, i18n
//   2. Helpers + toasts
//   3. Storage + prefs + recovered text
//   4. Undo + mutations
//   5. Home
//   6. Menus + small dialogs
//   7. Sync slice + palette
//   8. Boot
// ============================================================
(function () {
  "use strict";

  var SL = window.SL = {};
  var C = SL.C = window.OrosSlidesCore;
  var DK = window.orosDK;
  SL.D = window.OrosSlidesDK;
  SL.T = DK.text; SL.R = DK.render; SL.P = DK.pdf; SL.A = DK.assets; SL.M = DK.model;

  var STORAGE_KEY = "oros-slides-data";
  var PREFS_KEY   = "oros-slides-prefs";
  var REC_KEY     = "oros-slides-recovered";
  var UNDO_MAX    = 100;
  var DECK_WARN   = 300 * 1024;
  SL.STORAGE_KEY = STORAGE_KEY;

  // ---------- 1. Constants, i18n ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = SL.LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "Slides", "loading": "Loading fonts…",
      "home.new": "New presentation", "home.import": "Open package", "home.search": "Search presentations",
      "home.empty.title": "No presentations yet",
      "home.empty.sub": "Start from a theme or a ready template, write in the outline, present full screen.",
      "home.count": "{n} presentations", "home.count1": "1 presentation",
      "home.slides": "{n} slides", "home.slides1": "1 slide", "home.none": "No presentation matches.",
      "deck.untitled": "Untitled presentation", "deck.copy": "{name} (copy)",
      "card.open": "Open", "card.rename": "Rename", "card.dup": "Duplicate", "card.pkg": "Save as package", "card.del": "Delete",
      "new.title": "New presentation", "new.blank": "Blank", "new.themes": "Start with a theme",
      "new.templates": "Or a ready template", "new.aspect": "Slide size", "new.wide": "16:9 wide", "new.std": "4:3",
      "new.name": "Name",
      "ed.back": "Presentations", "ed.undo": "Undo (Ctrl+Z)", "ed.redo": "Redo (Ctrl+Y)", "ed.more": "More",
      "ed.play": "Present", "ed.rename": "Rename presentation",
      "view.slide": "Slide", "view.sorter": "Sorter", "view.outline": "Outline",
      "tool.text": "Text box", "tool.image": "Picture", "tool.rect": "Rectangle", "tool.ell": "Ellipse",
      "tool.line": "Line", "tool.add": "New slide", "tool.format": "Format", "tool.layout": "Layout",
      "slide.n": "Slide {n}", "slide.hidden": "Hidden in the show",
      "sm.new": "New slide after this", "sm.dup": "Duplicate slide", "sm.del": "Delete slide",
      "sm.hide": "Hide in the show", "sm.show": "Show in the show", "sm.up": "Move earlier", "sm.down": "Move later",
      "sm.layout": "Layout…", "sm.present": "Present from this slide",
      "toast.slideDeleted": "Slide deleted", "toast.lastSlide": "A presentation keeps at least one slide.",
      "toast.maxSlides": "A presentation can have at most {n} slides.", "toast.maxItems": "A slide can hold at most {n} objects.",
      "toast.deleted": "Presentation deleted", "toast.save": "Could not save: the browser storage is full.",
      "toast.gone": "This presentation was deleted on another device.",
      "toast.big": "This presentation is getting large ({n} KB). Pictures are fine (they are files); very long texts and many slides make sync slower.",
      "toast.fontFail": "The fonts could not be loaded. Slides may look different until they do.",
      "toast.pasted": "Pasted", "toast.copied": "Copied", "it.copy": "Copy", "it.paste": "Paste", "toast.locked": "This object is locked. Unlock it in Format.",
      "toast.recovered": "Text changed on two devices was kept: More › Recovered text.",
      "ph.title": "Add a title", "ph.sub": "Add a subtitle", "ph.body": "Add text", "ph.body2": "Add text",
      "ph.cap": "Add a caption", "ph.cap2": "Add a caption", "ph.quote": "Add a quote", "ph.img": "Add a picture",
      "ph.text": "Type here",
      "notes.title": "Speaker notes", "notes.ph": "Notes for this slide. Only you see them while presenting.",
      "more.theme": "Theme and size…", "more.footer": "Footer…", "more.pdf": "Export PDF",
      "more.handout": "PDF with speaker notes", "more.png": "Save this slide as PNG", "more.pkg": "Save as package (.orosslides)",
      "more.rec": "Recovered text ({n})", "more.presenter": "Present with speaker view", "more.fromStart": "Present from the start",
      "more.keys": "Keyboard shortcuts",
      "side.slide": "Slide", "side.deck": "Presentation", "side.item": "Format", "side.close": "Close",
      "pn.layout": "Layout", "pn.transition": "Transition", "pn.bg": "Background", "pn.hidden": "Hide in the show",
      "pn.theme": "Theme", "pn.aspect": "Slide size", "pn.footer": "Footer",
      "tr.none": "None", "tr.fade": "Fade", "tr.slide": "Slide in", "tr.push": "Push", "tr.zoom": "Zoom",
      "tr.all": "Apply to all slides",
      "ft.n": "Slide number", "ft.d": "Date", "ft.x": "Footer text", "ft.s1": "Also on the first slide",
      "pn.pos": "Position and size", "pn.x": "X", "pn.y": "Y", "pn.w": "W", "pn.h": "H", "pn.rot": "Rotation",
      "pn.op": "Opacity", "pn.arrange": "Arrange", "pn.front": "Bring to front", "pn.fwd": "Bring forward",
      "pn.bwd": "Send backward", "pn.back": "Send to back", "pn.align": "Align",
      "pn.al": "Align left", "pn.ac": "Align centre", "pn.ar": "Align right",
      "pn.at": "Align top", "pn.am": "Align middle", "pn.ab": "Align bottom",
      "pn.toSlide": "to the slide", "pn.toSel": "to each other",
      "pn.lock": "Lock position", "pn.dup": "Duplicate", "pn.del": "Delete", "pn.multi": "{n} objects",
      "pn.text": "Text", "pn.font": "Font", "font.theme": "Theme font", "font.sans": "Noto Sans",
      "font.serif": "Noto Serif", "font.mono": "Noto Sans Mono", "pn.size": "Size", "pn.fit": "Shrink text to fit",
      "fit.shrunk": "Shrunk to {n}% to fit.", "fit.over": "The text does not fit the box.",
      "pn.talign": "Alignment", "pn.va": "Vertical", "pn.tcolor": "Text colour", "pn.fill": "Fill",
      "pn.stroke": "Outline", "pn.sw": "Weight", "pn.dash": "Dashed", "pn.edit": "Edit text",
      "pn.radius": "Rounded corners", "pn.shape": "Shape", "sh.rect": "Rectangle", "sh.ellipse": "Ellipse",
      "pn.flip": "Flip direction", "pn.line": "Line",
      "al.l": "Left", "al.c": "Centre", "al.r": "Right", "al.j": "Justify",
      "va.t": "Top", "va.m": "Middle", "va.b": "Bottom",
      "pn.image": "Picture", "img.add": "Add picture…", "img.replace": "Replace picture…", "img.fill": "Fill",
      "img.fit": "Fit", "img.zoom": "Zoom", "img.ox": "Move sideways", "img.oy": "Move up / down",
      "img.alt": "Description (alt text)", "img.missing": "This picture is not on this device yet (still syncing).",
      "img.fail": "This file could not be read as a picture.", "img.nofs": "The orOS disk is not available on this device.",
      "img.placed": "Picture added",
      "col.none": "None", "col.custom": "Custom colour",
      "col.bg": "Background", "col.fg": "Text", "col.mu": "Muted", "col.sf": "Surface",
      "col.a1": "Accent 1", "col.a2": "Accent 2", "col.a3": "Accent 3",
      "tx.b": "Bold (Ctrl+B)", "tx.i": "Italic (Ctrl+I)", "tx.u": "Underline (Ctrl+U)", "tx.bul": "Bullets",
      "tx.num": "Numbering", "tx.in": "Indent (Tab)", "tx.out": "Outdent (Shift+Tab)", "tx.color": "Text colour",
      "tx.done": "Done",
      "so.hint": "Drag a slide to move it, or use its menu.",
      "ol.hint": "# starts a slide · - bullet (2 spaces per level) · 1. numbered · -- second column · > speaker notes",
      "exp.working": "Building the PDF…", "exp.done": "PDF saved", "exp.fail": "The file could not be made.",
      "exp.png": "Picture saved", "exp.pkgDone": "Package saved",
      "imp.done": "Presentation opened", "imp.bad": "This file is not a Slides package.",
      "imp.imgFail": "{n} pictures could not be restored.",
      "show.allHidden": "Every slide is hidden in the show.",
      "show.summary": "Show ended after {t}.",
      "rec.title": "Recovered text",
      "rec.note": "Text that was changed on two devices at the same time. The newer version stays on the slide; the other one is kept here.",
      "rec.copy": "Copy", "rec.insert": "Add to the slide", "rec.drop": "Dismiss", "rec.none": "Nothing to recover.",
      "rec.notes": "Notes, slide {n}", "rec.text": "Text, slide {n}", "rec.gone": "Slide no longer here",
      "keys.title": "Keyboard shortcuts",
      "keys.rows": "Ctrl+Z / Ctrl+Y|Undo / redo\nEnter or double click|Edit the text of a box\nEsc|Stop editing, clear the selection\nDelete|Delete the selection\nCtrl+D|Duplicate\nCtrl+C / Ctrl+V|Copy / paste objects\nArrows (Shift: ×10)|Move the selection\nPage Up / Page Down|Previous / next slide\nCtrl+M|New slide\nF5|Present from the start\nShift+F5|Present from this slide\nTab / Shift+Tab (text)|Bullet level",
      "btn.cancel": "Cancel", "btn.ok": "OK", "btn.create": "Create", "btn.save": "Save", "btn.close": "Close",
      "btn.delete": "Delete", "btn.undo": "Undo", "btn.apply": "Apply", "btn.done": "Done"
    },
    el: {
      "app.name": "Παρουσιάσεις", "loading": "Φόρτωση γραμματοσειρών…",
      "home.new": "Νέα παρουσίαση", "home.import": "Άνοιγμα πακέτου", "home.search": "Αναζήτηση παρουσιάσεων",
      "home.empty.title": "Καμία παρουσίαση ακόμη",
      "home.empty.sub": "Ξεκίνα από ένα θέμα ή ένα έτοιμο πρότυπο, γράψε στο περίγραμμα, παρουσίασε σε πλήρη οθόνη.",
      "home.count": "{n} παρουσιάσεις", "home.count1": "1 παρουσίαση",
      "home.slides": "{n} διαφάνειες", "home.slides1": "1 διαφάνεια", "home.none": "Καμία παρουσίαση δεν ταιριάζει.",
      "deck.untitled": "Παρουσίαση χωρίς τίτλο", "deck.copy": "{name} (αντίγραφο)",
      "card.open": "Άνοιγμα", "card.rename": "Μετονομασία", "card.dup": "Διπλασιασμός", "card.pkg": "Αποθήκευση ως πακέτο", "card.del": "Διαγραφή",
      "new.title": "Νέα παρουσίαση", "new.blank": "Κενή", "new.themes": "Ξεκίνα με ένα θέμα",
      "new.templates": "Ή ένα έτοιμο πρότυπο", "new.aspect": "Μέγεθος διαφάνειας", "new.wide": "16:9 πλατιά", "new.std": "4:3",
      "new.name": "Όνομα",
      "ed.back": "Παρουσιάσεις", "ed.undo": "Αναίρεση (Ctrl+Z)", "ed.redo": "Επανάληψη (Ctrl+Y)", "ed.more": "Περισσότερα",
      "ed.play": "Προβολή", "ed.rename": "Μετονομασία παρουσίασης",
      "view.slide": "Διαφάνεια", "view.sorter": "Ταξινόμηση", "view.outline": "Περίγραμμα",
      "tool.text": "Πλαίσιο κειμένου", "tool.image": "Εικόνα", "tool.rect": "Ορθογώνιο", "tool.ell": "Έλλειψη",
      "tool.line": "Γραμμή", "tool.add": "Νέα διαφάνεια", "tool.format": "Μορφή", "tool.layout": "Διάταξη",
      "slide.n": "Διαφάνεια {n}", "slide.hidden": "Κρυφή στην προβολή",
      "sm.new": "Νέα διαφάνεια μετά από αυτή", "sm.dup": "Διπλασιασμός διαφάνειας", "sm.del": "Διαγραφή διαφάνειας",
      "sm.hide": "Απόκρυψη στην προβολή", "sm.show": "Εμφάνιση στην προβολή", "sm.up": "Μετακίνηση νωρίτερα", "sm.down": "Μετακίνηση αργότερα",
      "sm.layout": "Διάταξη…", "sm.present": "Προβολή από αυτή τη διαφάνεια",
      "toast.slideDeleted": "Η διαφάνεια διαγράφηκε", "toast.lastSlide": "Μια παρουσίαση κρατά τουλάχιστον μία διαφάνεια.",
      "toast.maxSlides": "Μια παρουσίαση έχει το πολύ {n} διαφάνειες.", "toast.maxItems": "Μια διαφάνεια χωρά το πολύ {n} αντικείμενα.",
      "toast.deleted": "Η παρουσίαση διαγράφηκε", "toast.save": "Η αποθήκευση απέτυχε: ο χώρος του browser γέμισε.",
      "toast.gone": "Αυτή η παρουσίαση διαγράφηκε σε άλλη συσκευή.",
      "toast.big": "Η παρουσίαση μεγαλώνει ({n} KB). Οι εικόνες δεν πειράζουν (είναι αρχεία)· πολύ μεγάλα κείμενα και πολλές διαφάνειες κάνουν το sync πιο αργό.",
      "toast.fontFail": "Οι γραμματοσειρές δεν φόρτωσαν. Οι διαφάνειες μπορεί να φαίνονται διαφορετικά μέχρι να φορτώσουν.",
      "toast.pasted": "Επικολλήθηκε", "toast.copied": "Αντιγράφηκε", "it.copy": "Αντιγραφή", "it.paste": "Επικόλληση", "toast.locked": "Αυτό το αντικείμενο είναι κλειδωμένο. Ξεκλείδωσέ το στη Μορφή.",
      "toast.recovered": "Κείμενο που άλλαξε σε δύο συσκευές κρατήθηκε: Περισσότερα › Ανακτημένο κείμενο.",
      "ph.title": "Πρόσθεσε τίτλο", "ph.sub": "Πρόσθεσε υπότιτλο", "ph.body": "Πρόσθεσε κείμενο", "ph.body2": "Πρόσθεσε κείμενο",
      "ph.cap": "Πρόσθεσε λεζάντα", "ph.cap2": "Πρόσθεσε λεζάντα", "ph.quote": "Πρόσθεσε παράθεση", "ph.img": "Πρόσθεσε εικόνα",
      "ph.text": "Γράψε εδώ",
      "notes.title": "Σημειώσεις ομιλητή", "notes.ph": "Σημειώσεις για αυτή τη διαφάνεια. Τις βλέπεις μόνο εσύ στην προβολή.",
      "more.theme": "Θέμα και μέγεθος…", "more.footer": "Υποσέλιδο…", "more.pdf": "Εξαγωγή PDF",
      "more.handout": "PDF με σημειώσεις ομιλητή", "more.png": "Αποθήκευση διαφάνειας ως PNG", "more.pkg": "Αποθήκευση ως πακέτο (.orosslides)",
      "more.rec": "Ανακτημένο κείμενο ({n})", "more.presenter": "Προβολή με οθόνη ομιλητή", "more.fromStart": "Προβολή από την αρχή",
      "more.keys": "Συντομεύσεις πληκτρολογίου",
      "side.slide": "Διαφάνεια", "side.deck": "Παρουσίαση", "side.item": "Μορφή", "side.close": "Κλείσιμο",
      "pn.layout": "Διάταξη", "pn.transition": "Μετάβαση", "pn.bg": "Φόντο", "pn.hidden": "Απόκρυψη στην προβολή",
      "pn.theme": "Θέμα", "pn.aspect": "Μέγεθος διαφάνειας", "pn.footer": "Υποσέλιδο",
      "tr.none": "Καμία", "tr.fade": "Σβήσιμο", "tr.slide": "Ολίσθηση", "tr.push": "Ώθηση", "tr.zoom": "Μεγέθυνση",
      "tr.all": "Σε όλες τις διαφάνειες",
      "ft.n": "Αριθμός διαφάνειας", "ft.d": "Ημερομηνία", "ft.x": "Κείμενο υποσέλιδου", "ft.s1": "Και στην πρώτη διαφάνεια",
      "pn.pos": "Θέση και μέγεθος", "pn.x": "X", "pn.y": "Y", "pn.w": "Π", "pn.h": "Υ", "pn.rot": "Περιστροφή",
      "pn.op": "Αδιαφάνεια", "pn.arrange": "Σειρά", "pn.front": "Μπροστά απ' όλα", "pn.fwd": "Ένα μπροστά",
      "pn.bwd": "Ένα πίσω", "pn.back": "Πίσω απ' όλα", "pn.align": "Στοίχιση",
      "pn.al": "Στοίχιση αριστερά", "pn.ac": "Στοίχιση στο κέντρο", "pn.ar": "Στοίχιση δεξιά",
      "pn.at": "Στοίχιση πάνω", "pn.am": "Στοίχιση στη μέση", "pn.ab": "Στοίχιση κάτω",
      "pn.toSlide": "στη διαφάνεια", "pn.toSel": "μεταξύ τους",
      "pn.lock": "Κλείδωμα θέσης", "pn.dup": "Διπλασιασμός", "pn.del": "Διαγραφή", "pn.multi": "{n} αντικείμενα",
      "pn.text": "Κείμενο", "pn.font": "Γραμματοσειρά", "font.theme": "Του θέματος", "font.sans": "Noto Sans",
      "font.serif": "Noto Serif", "font.mono": "Noto Sans Mono", "pn.size": "Μέγεθος", "pn.fit": "Σμίκρυνση για να χωρά",
      "fit.shrunk": "Μικρύνθηκε στο {n}% για να χωρέσει.", "fit.over": "Το κείμενο δεν χωρά στο πλαίσιο.",
      "pn.talign": "Στοίχιση", "pn.va": "Κάθετα", "pn.tcolor": "Χρώμα κειμένου", "pn.fill": "Γέμισμα",
      "pn.stroke": "Περίγραμμα", "pn.sw": "Πάχος", "pn.dash": "Διακεκομμένο", "pn.edit": "Επεξεργασία κειμένου",
      "pn.radius": "Στρογγυλές γωνίες", "pn.shape": "Σχήμα", "sh.rect": "Ορθογώνιο", "sh.ellipse": "Έλλειψη",
      "pn.flip": "Αντιστροφή κατεύθυνσης", "pn.line": "Γραμμή",
      "al.l": "Αριστερά", "al.c": "Κέντρο", "al.r": "Δεξιά", "al.j": "Πλήρης",
      "va.t": "Πάνω", "va.m": "Μέση", "va.b": "Κάτω",
      "pn.image": "Εικόνα", "img.add": "Προσθήκη εικόνας…", "img.replace": "Αντικατάσταση εικόνας…", "img.fill": "Γέμισμα",
      "img.fit": "Χωρά ολόκληρη", "img.zoom": "Μεγέθυνση", "img.ox": "Μετακίνηση πλάγια", "img.oy": "Μετακίνηση πάνω / κάτω",
      "img.alt": "Περιγραφή (εναλλακτικό κείμενο)", "img.missing": "Η εικόνα δεν είναι ακόμη σε αυτή τη συσκευή (συγχρονίζεται).",
      "img.fail": "Αυτό το αρχείο δεν διαβάζεται ως εικόνα.", "img.nofs": "Ο δίσκος του orOS δεν είναι διαθέσιμος σε αυτή τη συσκευή.",
      "img.placed": "Η εικόνα προστέθηκε",
      "col.none": "Κανένα", "col.custom": "Δικό σου χρώμα",
      "col.bg": "Φόντο", "col.fg": "Κείμενο", "col.mu": "Απαλό", "col.sf": "Επιφάνεια",
      "col.a1": "Έμφαση 1", "col.a2": "Έμφαση 2", "col.a3": "Έμφαση 3",
      "tx.b": "Έντονα (Ctrl+B)", "tx.i": "Πλάγια (Ctrl+I)", "tx.u": "Υπογράμμιση (Ctrl+U)", "tx.bul": "Κουκκίδες",
      "tx.num": "Αρίθμηση", "tx.in": "Εσοχή (Tab)", "tx.out": "Λιγότερη εσοχή (Shift+Tab)", "tx.color": "Χρώμα κειμένου",
      "tx.done": "Τέλος",
      "so.hint": "Σύρε μια διαφάνεια για να τη μετακινήσεις ή χρησιμοποίησε το μενού της.",
      "ol.hint": "# νέα διαφάνεια · - κουκκίδα (2 κενά ανά επίπεδο) · 1. αρίθμηση · -- δεύτερη στήλη · > σημειώσεις ομιλητή",
      "exp.working": "Δημιουργία PDF…", "exp.done": "Το PDF αποθηκεύτηκε", "exp.fail": "Το αρχείο δεν δημιουργήθηκε.",
      "exp.png": "Η εικόνα αποθηκεύτηκε", "exp.pkgDone": "Το πακέτο αποθηκεύτηκε",
      "imp.done": "Η παρουσίαση άνοιξε", "imp.bad": "Αυτό το αρχείο δεν είναι πακέτο Παρουσιάσεων.",
      "imp.imgFail": "{n} εικόνες δεν επανήλθαν.",
      "show.allHidden": "Όλες οι διαφάνειες είναι κρυφές στην προβολή.",
      "show.summary": "Η προβολή κράτησε {t}.",
      "rec.title": "Ανακτημένο κείμενο",
      "rec.note": "Κείμενο που άλλαξε σε δύο συσκευές την ίδια ώρα. Η νεότερη εκδοχή μένει στη διαφάνεια· η άλλη κρατιέται εδώ.",
      "rec.copy": "Αντιγραφή", "rec.insert": "Προσθήκη στη διαφάνεια", "rec.drop": "Απόρριψη", "rec.none": "Δεν υπάρχει κάτι για ανάκτηση.",
      "rec.notes": "Σημειώσεις, διαφάνεια {n}", "rec.text": "Κείμενο, διαφάνεια {n}", "rec.gone": "Η διαφάνεια δεν υπάρχει πια",
      "keys.title": "Συντομεύσεις πληκτρολογίου",
      "keys.rows": "Ctrl+Z / Ctrl+Y|Αναίρεση / επανάληψη\nEnter ή διπλό κλικ|Επεξεργασία κειμένου πλαισίου\nEsc|Τέλος επεξεργασίας, καμία επιλογή\nDelete|Διαγραφή επιλογής\nCtrl+D|Διπλασιασμός\nCtrl+C / Ctrl+V|Αντιγραφή / επικόλληση αντικειμένων\nΒελάκια (Shift: ×10)|Μετακίνηση επιλογής\nPage Up / Page Down|Προηγούμενη / επόμενη διαφάνεια\nCtrl+M|Νέα διαφάνεια\nF5|Προβολή από την αρχή\nShift+F5|Προβολή από αυτή τη διαφάνεια\nTab / Shift+Tab (κείμενο)|Επίπεδο κουκκίδας",
      "btn.cancel": "Άκυρο", "btn.ok": "OK", "btn.create": "Δημιουργία", "btn.save": "Αποθήκευση", "btn.close": "Κλείσιμο",
      "btn.delete": "Διαγραφή", "btn.undo": "Αναίρεση", "btn.apply": "Εφαρμογή", "btn.done": "Τέλος"
    }
  };
  SL.STRINGS = STRINGS;
  function t(key, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  SL.t = t;
  SL.label = function (obj) { return obj && (obj[LANG] || obj.en) || ""; };

  // BOOT MARKER
  try { console.log("[orOS] slides app v1.0.0 booted"); } catch (e) {}

  // ---------- 2. Helpers + toasts ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  SL.$ = $; SL.el = el;

  var ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    slide: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8"/>',
    sorter: '<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="3" y="14" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/>',
    outline: '<path d="M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01"/>',
    text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
    rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
    ell: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
    line: '<path d="M5 19L19 5"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M10 9v11"/>',
    format: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/>',
    al: '<path d="M4 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="7" y="14" width="6" height="4"/>',
    ac: '<path d="M12 3v18"/><rect x="6" y="6" width="12" height="4"/><rect x="8" y="14" width="8" height="4"/>',
    ar: '<path d="M20 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="11" y="14" width="6" height="4"/>',
    at: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="7" width="4" height="6"/>',
    am: '<path d="M3 12h18"/><rect x="6" y="6" width="4" height="12"/><rect x="14" y="8" width="4" height="8"/>',
    ab: '<path d="M3 20h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="11" width="4" height="6"/>',
    front: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
    toBack: '<rect x="4" y="4" width="12" height="12" rx="1"/><path d="M20 8v11a1 1 0 0 1-1 1H8"/>',
    fwd: '<path d="M12 19V5M6 11l6-6 6 6"/>', bwd: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
    bul: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    num: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4h1v4M4 8h2M4 11h2l-2 3h2M4 17h2v3H4M4 18.5h2"/>',
    indent: '<path d="M10 6h10M10 12h10M10 18h10M3 9l3 3-3 3"/>',
    outdent: '<path d="M10 6h10M10 12h10M10 18h10M6 9l-3 3 3 3"/>',
    tal: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', tac: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
    tar: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>', taj: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
    vt: '<path d="M4 4h16"/><path d="M8 8h8M8 12h8"/>', vm: '<path d="M8 10h8M8 14h8"/>', vb: '<path d="M4 20h16"/><path d="M8 12h8M8 16h8"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17v.5"/>'
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
  SL.icon = icon; SL.iconBtn = iconBtn; SL.setIcon = setIcon;

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
  SL.toast = toast;
  SL.live = function (msg) {
    var n = $("live");
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  };

  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  SL.dialogHost = dialogHost;

  function fmtDate(ms, short) {
    var d = new Date(ms);
    var dd = ("0" + d.getDate()).slice(-2), mm = ("0" + (d.getMonth() + 1)).slice(-2);
    var day = LANG === "el" ? dd + "/" + mm + "/" + d.getFullYear() : d.getFullYear() + "-" + mm + "-" + dd;
    if (short) return day;
    return day + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  SL.fmtDate = fmtDate;

  var rnd = (function () {
    var D = "0123456789abcdefghijklmnopqrstuvwxyz";
    return function () {
      var s = "s", b = new Uint8Array(12);
      try { crypto.getRandomValues(b); } catch (e) { for (var k = 0; k < 12; k++) b[k] = Math.floor(Math.random() * 256); }
      for (var i = 0; i < 12; i++) s += D.charAt(b[i] % 36);
      return s;
    };
  })();
  SL.newId = rnd;

  // ---------- 3. Storage + prefs + recovered text ----------
  var data = C.emptyData();
  SL.deck = null;            // id of the open deck
  SL.prefs = { deck: null, view: "slide", notes: true };
  var recovered = [];

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.decks && typeof parsed.decks === "object") { data = C.canonical(parsed); return; }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] slides: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = C.emptyData();
  }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = p && typeof p === "object" ? p : {};
    SL.prefs = {
      deck: typeof p.deck === "string" && C.ID_RE.test(p.deck) ? p.deck : null,
      view: ["slide", "sorter", "outline"].indexOf(p.view) >= 0 ? p.view : "slide",
      notes: p.notes !== false
    };
    try { recovered = C.pushRecovered(JSON.parse(localStorage.getItem(REC_KEY) || "[]"), null); } catch (e) { recovered = []; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(SL.prefs)); } catch (e) {}
  }
  SL.savePrefs = savePrefs;
  function saveRecovered() {
    try { localStorage.setItem(REC_KEY, JSON.stringify(recovered)); } catch (e) {}
  }
  function addRecovered(r) {
    var before = recovered.length;
    recovered = C.pushRecovered(recovered, r);
    saveRecovered();
    if (recovered.length !== before && SL.deck === r.d) recNotice = true;
  }
  var recNotice = false;
  SL.recovered = function (deckId) { return C.deckRecovered(recovered, deckId); };
  SL.dropRecovered = function (id) { recovered = C.dropRecovered(recovered, id); saveRecovered(); };

  var saveTimer = null, saveFailShown = false, bigWarned = {};
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; toast(t("toast.save")); }
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  SL.save = save; SL.flush = function () { if (saveTimer) saveNow(); };
  SL.data = function () { return data; };
  SL.curDeck = function () { return SL.deck ? data.decks[SL.deck] || null : null; };

  // ---------- 4. Undo + mutations ----------
  // A mutation snapshots the open deck, runs fn(data, now, newId) on
  // the store (core.js mutations stamp what they change, R27), then
  // canonicalizes and saves. Undo re-applies a snapshot as NEW edits
  // (fresh stamps; a deleted slide comes back newer than its tomb),
  // so it syncs like any other change.
  var undoStack = [], redoStack = [], gesture = null;
  var listeners = {};
  SL.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  function emit(ev, arg) { (listeners[ev] || []).forEach(function (fn) { try { fn(arg); } catch (e) { console.error(e); } }); }
  SL.emit = emit;

  var lastNow = 0;
  function now() { lastNow = Math.max(Date.now(), lastNow + 1); return lastNow; }
  SL.now = now;

  // The open deck: { deck, slides, items } (what undo restores).
  function snapshot() {
    var id = SL.deck, slides = C.deckSlides(data, id), items = [];
    slides.forEach(function (s) { items = items.concat(C.slideItems(data, s.id)); });
    return JSON.stringify({ deck: data.decks[id], slides: slides, items: items });
  }

  // fn returns false to cancel. One undo step, unless inside a gesture.
  function op(fn) {
    if (!SL.deck || !data.decks[SL.deck]) return false;
    var before = gesture || snapshot();
    var res = fn(data, now(), rnd);
    if (res === false) { data = C.canonical(data); return false; }
    data = C.canonical(data);
    if (snapshot() === before) return false;
    if (!gesture) pushUndo(before);
    commit();
    return res === undefined ? true : res;
  }
  SL.op = op;
  // During a drag the deck changes on every move: one snapshot at the
  // start, saved once at the end (one undo step).
  SL.beginGesture = function () { gesture = snapshot(); };
  SL.endGesture = function () {
    if (!gesture) return;
    var g = gesture; gesture = null;
    data = C.canonical(data);
    if (g !== snapshot()) { pushUndo(g); commit(); }
  };
  SL.inGesture = function () { return !!gesture; };
  // Live change during a gesture: no canonical pass, no save.
  SL.live2 = function (fn) {
    if (!gesture) return;
    fn(data, now());
    emit("deck", { live: true });
  };

  function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
  }

  function commit() {
    save();
    var bytes = snapshot().length;
    if (bytes > DECK_WARN && !bigWarned[SL.deck]) {
      bigWarned[SL.deck] = 1;
      toast(t("toast.big", { n: Math.round(bytes / 1024) }));
    }
    emit("deck", {});
  }
  SL.commit = commit;

  var DECK_KEYS = ["t", "as", "th", "ft"];
  var SLIDE_KEYS = ["p", "ly", "tr", "hid", "bg"];
  function same(a, b, keys) { return keys.every(function (k) { return JSON.stringify(a[k]) === JSON.stringify(b[k]); }); }
  function withoutClock(it) {
    var o = {};
    Object.keys(it).forEach(function (k) { if (k !== "m" && k !== "b") o[k] = it[k]; });
    return JSON.stringify(o);
  }
  // Make the open deck look like a snapshot, with fresh stamps.
  function applyState(snap) {
    var target = JSON.parse(snap), t0 = now(), id = SL.deck;
    var deck = data.decks[id];
    if (!deck) return;
    if (!same(deck, target.deck, DECK_KEYS)) {
      DECK_KEYS.forEach(function (k) { deck[k] = target.deck[k]; });
      deck.m = t0;
    }
    var want = {};
    target.slides.forEach(function (s) { want[s.id] = s; });
    C.deckSlides(data, id).forEach(function (s) { if (!want[s.id]) C.deleteSlide(data, s.id, t0); });
    target.slides.forEach(function (ts) {
      var s = data.slides[ts.id];
      if (!s) {
        s = JSON.parse(JSON.stringify(ts));
        s.m = t0; s.tm = t0; s.nb = 0; s.nm = s.n ? t0 : 0;
        delete data.ghosts.slides[s.id];
        data.slides[s.id] = s;
        return;
      }
      if (!same(s, ts, SLIDE_KEYS)) { SLIDE_KEYS.forEach(function (k) { if (ts[k] === undefined) delete s[k]; else s[k] = ts[k]; }); s.m = t0; }
      if (s.n !== ts.n) { s.nb = s.nm; s.n = ts.n; s.nm = t0; }
      s.tm = t0;
    });
    var wantIt = {};
    target.items.forEach(function (it) { wantIt[it.id] = it; });
    target.slides.forEach(function (ts) {
      C.slideItems(data, ts.id).forEach(function (it) {
        if (!wantIt[it.id]) { delete data.items[it.id]; data.tombs[it.id] = Math.max(t0, data.tombs[it.id] || 0); }
      });
    });
    target.items.forEach(function (ti) {
      var cur = data.items[ti.id];
      if (cur && withoutClock(cur) === withoutClock(ti)) return;
      var x = JSON.parse(JSON.stringify(ti));
      x.m = t0;
      if (x.k === "text") x.b = cur ? cur.m : 0;
      data.items[x.id] = x;
    });
    deck.tm = t0;
    data = C.canonical(data);
  }

  SL.undo = function () {
    if (!SL.deck || !undoStack.length) return;
    hideToast();             // its Undo button would now undo something else
    emit("flush");
    var snap = undoStack.pop();
    redoStack.push(snapshot());
    applyState(snap);
    commit();
  };
  SL.redo = function () {
    if (!SL.deck || !redoStack.length) return;
    emit("flush");
    var snap = redoStack.pop();
    undoStack.push(snapshot());
    applyState(snap);
    commit();
  };
  SL.canUndo = function () { return undoStack.length > 0; };
  SL.canRedo = function () { return redoStack.length > 0; };

  // ---------- 5. Home ----------
  var thumbs = {};          // deckId → { key, url }
  function deckTitle(d) { return d.t || t("deck.untitled"); }
  SL.deckTitle = deckTitle;

  // First slide of a deck as a picture (cached on the deck's clocks).
  function thumbFor(d) {
    var first = C.deckSlides(data, d.id)[0];
    if (!first) return null;
    var key = d.m + ":" + d.tm + ":" + first.id;
    var c = thumbs[d.id];
    if (c && c.key === key) return c.url;
    if (!SL.T.isLoaded("sans-r")) return null;
    try {
      var cv = SL.renderSlide(first.id, 200 * (window.devicePixelRatio || 1));
      var url = cv.toDataURL("image/png");
      thumbs[d.id] = { key: key, url: url };
      return url;
    } catch (e) { return null; }
  }

  // A slide drawn on a fresh canvas `px` wide (thumbnails, PNG).
  SL.renderSlide = function (slideId, px, opts) {
    var b = SL.D.slideDoc(data, slideId, { date: fmtDate(Date.now(), true), editing: opts && opts.editing });
    var doc = b.doc, L = SL.R.computeLayout(doc);
    return SL.R.renderPage(doc, doc.pages[0], L, px / doc.setup.w, { canvas: opts && opts.canvas, getImage: SL.A.get, background: "#ffffff" });
  };

  function renderHome() {
    var host = $("decks");
    host.innerHTML = "";
    var q = ($("home-search").value || "").trim().toLocaleLowerCase();
    var decks = C.deckList(data);
    $("home-tools").hidden = decks.length < 7;
    $("home-sub").textContent = decks.length === 1 ? t("home.count1") : decks.length ? t("home.count", { n: decks.length }) : "";
    $("home-empty").hidden = decks.length > 0;
    var shown = decks.filter(function (d) {
      if (!q) return true;
      if (deckTitle(d).toLocaleLowerCase().indexOf(q) >= 0) return true;
      return C.deckSlides(data, d.id).some(function (s) { return C.slideTitle(data, s.id).toLocaleLowerCase().indexOf(q) >= 0; });
    });
    if (decks.length && !shown.length) host.appendChild(el("p", "hint", t("home.none")));
    shown.forEach(function (d) {
      var card = el("div", "doc-card");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      var th = el("div", "doc-thumb");
      th.style.setProperty("--ratio", String(C.H / C.widthOf(d.as)));
      var url = thumbFor(d);
      if (url) { var img = el("img"); img.src = url; img.alt = ""; th.appendChild(img); }
      card.appendChild(th);
      var meta = el("div", "doc-meta");
      meta.appendChild(el("span", "doc-title", deckTitle(d)));
      var n = C.deckSlides(data, d.id).length;
      meta.appendChild(el("span", "doc-sub", (n === 1 ? t("home.slides1") : t("home.slides", { n: n })) + " · " + fmtDate(Math.max(d.m, d.tm))));
      card.appendChild(meta);
      var more = iconBtn("more", t("ed.more"), "doc-more");
      more.addEventListener("click", function (e) { e.stopPropagation(); cardMenu(d, more); });
      card.appendChild(more);
      card.addEventListener("click", function () { openDeck(d.id); });
      card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDeck(d.id); } });
      card.addEventListener("contextmenu", function (e) { e.preventDefault(); cardMenu(d, more); });
      host.appendChild(card);
    });
  }
  SL.renderHome = renderHome;

  function cardMenu(d, anchor) {
    SL.menu(anchor, [
      { label: t("card.open"), fn: function () { openDeck(d.id); } },
      { label: t("card.rename"), fn: function () { renameDeck(d.id); } },
      { label: t("card.dup"), fn: function () { duplicateDeck(d.id); } },
      { label: t("card.pkg"), fn: function () { SL.io.exportPackage(d.id); } },
      { label: t("card.del"), danger: true, fn: function () { deleteDeck(d.id); } }
    ]);
  }

  // Data-level edits (outside the open deck's undo stack).
  function dataOp(fn) {
    fn(data, now(), rnd);
    data = C.canonical(data);
    save();
  }

  function renameDeck(id) {
    var d = data.decks[id];
    if (!d) return;
    SL.prompt(t("ed.rename"), deckTitle(d), function (v) {
      v = C.cleanLine(v, C.LIM.title).trim();
      if (!v || v === d.t) return;
      var fn = function (dt, nw) { var x = dt.decks[id]; if (!x) return false; x.t = v; x.m = nw; };
      if (SL.deck === id) { op(fn); $("ed-name").textContent = v; }
      else dataOp(fn);
      renderHome();
    });
  }
  SL.renameDeck = renameDeck;

  function duplicateDeck(id) {
    var d = data.decks[id];
    if (!d) return;
    dataOp(function (dt, nw, newId) {
      var c = C.newDeck(dt, { t: C.cleanLine(t("deck.copy", { name: deckTitle(d) }), C.LIM.title), as: d.as, th: d.th, ft: d.ft }, nw, newId);
      C.deckSlides(dt, id).forEach(function (s) {
        var ns = JSON.parse(JSON.stringify(s));
        ns.id = newId(); ns.d = c.id; ns.m = nw; ns.nb = 0; ns.nm = ns.n ? nw : 0; ns.tm = nw;
        dt.slides[ns.id] = ns;
        C.slideItems(dt, s.id).forEach(function (it) {
          var x = JSON.parse(JSON.stringify(it));
          x.id = newId(); x.s = ns.id; x.m = nw; if (x.k === "text") x.b = 0;
          dt.items[x.id] = x;
        });
      });
    });
    renderHome();
  }

  function deleteDeck(id) {
    var d = data.decks[id];
    if (!d) return;
    var keep = null;
    dataOp(function (dt, nw) {
      var slides = C.deckSlides(dt, id), items = [];
      slides.forEach(function (s) { items = items.concat(C.slideItems(dt, s.id)); });
      keep = JSON.parse(JSON.stringify({ deck: dt.decks[id], slides: slides, items: items }));
      C.deleteDeck(dt, id, nw);
    });
    if (SL.prefs.deck === id) { SL.prefs.deck = null; savePrefs(); }
    renderHome();
    toast(t("toast.deleted"), t("btn.undo"), function () {
      // newer than the tombstones: the deck and everything in it are back (R17)
      dataOp(function (dt, nw) {
        var dk = keep.deck; dk.m = nw; dk.tm = nw;
        delete dt.ghosts.decks[id];
        dt.decks[id] = dk;
        keep.slides.forEach(function (s) { s.m = nw; s.tm = nw; s.nm = s.n ? nw : 0; s.nb = 0; delete dt.ghosts.slides[s.id]; dt.slides[s.id] = s; });
        keep.items.forEach(function (it) { it.m = nw; if (it.k === "text") it.b = 0; dt.items[it.id] = it; });
      });
      renderHome();
    });
  }

  // A new deck: blank (theme + aspect) or from a template.
  SL.createDeck = function (opts) {
    var made = null;
    dataOp(function (dt, nw, newId) {
      if (opts.tpl) made = C.fromTemplate(dt, opts.tpl, LANG, nw, newId);
      else {
        made = C.newDeck(dt, { t: opts.name || "", th: opts.th, as: opts.as }, nw, newId);
        C.addSlide(dt, made.id, "title", null, nw, newId);
      }
      if (made && opts.as && made.as !== opts.as) C.setAspect(dt, made.id, opts.as, nw);
      if (made && opts.name && opts.tpl) { made.t = C.cleanLine(opts.name, C.LIM.title); made.m = nw; }
    });
    if (made) openDeck(made.id);
  };
  SL.addDeckData = function (fn) { var r = null; dataOp(function (dt, nw, newId) { r = fn(dt, nw, newId); }); return r; };

  function openDeck(id) {
    if (!data.decks[id]) return;
    SL.deck = id;
    undoStack = []; redoStack = []; gesture = null;
    SL.prefs.deck = id; savePrefs();
    $("home").hidden = true;
    $("editor").hidden = false;
    $("ed-name").textContent = deckTitle(data.decks[id]);
    emit("open");
  }
  SL.openDeck = openDeck;

  function goHome() {
    emit("flush");
    emit("close");
    SL.flush();
    SL.deck = null;
    SL.prefs.deck = null; savePrefs();
    $("editor").hidden = true;
    $("home").hidden = false;
    renderHome();
  }
  SL.goHome = goHome;

  // ---------- 6. Menus + small dialogs ----------
  var menuClose = null;
  SL.menu = function (anchor, items, at) {
    var m = $("menu");
    m.innerHTML = "";
    items.forEach(function (it) {
      if (!it) return;
      if (it.sep) { m.appendChild(el("div", "menu-sep")); return; }
      var b = el("button", "menu-item" + (it.danger ? " danger" : "") + (it.on ? " on" : ""), it.label);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      if (it.disabled) b.disabled = true;
      b.addEventListener("click", function () { closeMenu(); it.fn(); });
      m.appendChild(b);
    });
    m.hidden = false;
    var r = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var x = Math.min(window.innerWidth - mw - 8, Math.max(8, at ? r.left : r.right - mw));
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
  SL.closeMenu = closeMenu;

  // The one <dialog>: build(body, close) fills it.
  SL.openDialog = function (title, build, wide) {
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

  SL.prompt = function (title, value, done) {
    SL.openDialog(title, function (body, close) {
      var inp = el("input", "inp");
      inp.type = "text"; inp.value = value || ""; inp.maxLength = C.LIM.title;
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

  // ---------- 7. Sync slice + palette ----------
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

  // The merge keeps text that lost a concurrent edit in this device's
  // recovered list (core.js: device-local, so the merge result never
  // depends on the sync order).
  function mergeFn(a, b) { return C.mergeSlides(a, b, addRecovered); }

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
    api.registerSlice("slides", sliceGet, sliceSet, STORAGE_KEY, mergeFn);
  }

  function sliceGet() { return C.canonical(data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.decks || typeof incoming.decks !== "object") return;
    emit("flush");
    var before = JSON.stringify(data);
    var openId = SL.deck;
    var openBefore = openId ? snapshot() : null;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.canonical(incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    thumbs = {};
    if (openId) {
      if (!data.decks[openId]) { toast(t("toast.gone")); goHome(); return; }
      if (snapshot() !== openBefore) emit("remote");
      if (recNotice) { recNotice = false; toast(t("toast.recovered")); }
    } else renderHome();
  }

  // ---------- 8. Boot ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    document.title = t("app.name") + " · orOS";
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("home-search").placeholder = t("home.search");
    $("home-search").setAttribute("aria-label", t("home.search"));
  }

  function wireHome() {
    $("btn-new").addEventListener("click", function () { SL.dlg.newDeck(); });
    $("btn-new2").addEventListener("click", function () { SL.dlg.newDeck(); });
    $("btn-import").addEventListener("click", function () { SL.io.importPackage(); });
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
      if (document.visibilityState === "hidden") { emit("flush"); SL.flush(); }
    });
    window.addEventListener("pagehide", function () { emit("flush"); SL.flush(); });
    SL.A.onChange(function () { thumbs = {}; if (!SL.deck) renderHome(); else emit("assets"); });
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
    SL.T.load(SL.T.allKeys()).then(function () {
      $("loading").hidden = true;
      SL.D.resetFit();
      if (SL.prefs.deck && data.decks[SL.prefs.deck]) openDeck(SL.prefs.deck);
      else renderHome();
      takeSearchTarget();
    }, function () {
      $("loading").hidden = true;
      toast(t("toast.fontFail"));
      renderHome();
      takeSearchTarget();
    });
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget): target { deck, slide }.
  // Opens the presentation (leaving the open one through Home, so
  // its text and notes flush) and goes to the slide. Unknown deck →
  // no-op; unknown slide → the deck only. Nothing happens while a
  // dialog is open. Before the fonts are in, it waits.
  var searchReady = false, searchLater = null;
  function openSearchTarget(tg) {
    if (!searchReady) { searchLater = tg; return; }
    var id = tg && typeof tg.deck === "string" ? tg.deck : null;
    if (!id || !data.decks[id]) return;
    if (document.querySelector("dialog[open]")) return;
    if (SL.deck !== id) {
      if (SL.deck) goHome();
      openDeck(id);
    }
    var sid = typeof tg.slide === "string" ? tg.slide : null;
    var s = sid ? data.slides[sid] : null;
    if (s && s.d === id && SL.ed && typeof SL.ed.go === "function") SL.ed.go(sid);
  }
  window.__orosOpenAt = openSearchTarget;
  function takeSearchTarget() {
    searchReady = true;
    if (searchLater) { var later = searchLater; searchLater = null; openSearchTarget(later); return; }
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("slides");
        if (pending) openSearchTarget(pending);
      }
    } catch (e) {}
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
