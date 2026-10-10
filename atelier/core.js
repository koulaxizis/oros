// ============================================================
// orOS Atelier — core (v1.0.0)
// Graphic design for everyone (social posts, posters, invitations,
// cards, thumbnails, logos…), offline-first. The engine is
// ../designkit/ (shared with Layout): model + merge, text, assets,
// fx (shapes, effects, filters), media (open sources, phase 2).
// Files:
//   ax.js        Atelier's item extras + text layout + templates
//   templates.js starter templates (data)
//   core.js      i18n, state, storage, sync, undo, home, boot
//   draw.js      canvas drawing (editor, thumbnails, exports)
//   editor.js    the stage: view, selection, move / resize / rotate,
//                snapping, text editing, crop, pages strip
//   panels.js    side drawer (templates, elements, text, uploads,
//                background, colour, effects, filters…) + context bar
//   io.js        PNG / JPG / PDF export, .orosdesign packages, uploads
// Data:
//   - synced slice "atelier" (oros-atelier-data): designkit model v1
//     with Atelier extras on items (`ax`, see ax.js)
//   - images: /internal/Assets/<sha256>.<ext> on the orOS disk,
//     synced per file by Vault Drive (designkit/assets.js, R30)
//   - device-local (R10): oros-atelier-prefs ({ doc }),
//     oros-atelier-data-broken (rescue copy)
//   - undo history: memory only
// ============================================================
(function () {
  "use strict";

  var AT = window.AT = {};
  var DK = window.orosDK;
  var M = AT.M = DK.model, T = AT.T = DK.text, FX = AT.FX = DK.fx;
  var A = AT.A = DK.assets, AX = AT.AX = window.AtelierAX;
  AT.PRESETS = window.ATELIER_PRESETS; AT.TEMPLATES = window.ATELIER_TEMPLATES;

  var STORAGE_KEY = "oros-atelier-data";
  var PREFS_KEY   = "oros-atelier-prefs";
  var UNDO_MAX    = 100;
  var DOC_WARN    = 300 * 1024;
  AT.STORAGE_KEY = STORAGE_KEY;

  // ---------- 1. i18n ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = AT.LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "Atelier", "loading": "Loading fonts…",
      "home.make": "What will you make?", "home.templates": "Start from a template", "home.designs": "Your designs",
      "home.custom": "Custom size", "home.import": "Import", "home.search": "Search designs",
      "home.count": "{n} designs", "home.count1": "1 design", "home.none": "No design matches.",
      "home.empty": "Your designs will show up here. Pick a size or a template to begin.",
      "home.pages": "{n} pages", "home.pages1": "1 page",
      "doc.untitled": "Untitled design", "doc.copy": "{name} (copy)",
      "card.open": "Open", "card.rename": "Rename", "card.dup": "Duplicate", "card.pkg": "Save as package", "card.del": "Delete",
      "custom.title": "Custom size", "custom.w": "Width", "custom.h": "Height", "custom.unit": "Units",
      "custom.px": "Pixels (screen)", "custom.mm": "Millimetres (print)", "custom.range": "Between {a} and {b} {u}.",
      "ed.back": "Designs", "ed.undo": "Undo", "ed.redo": "Redo", "ed.zin": "Zoom in", "ed.zout": "Zoom out",
      "ed.fit": "Fit to screen", "ed.more": "More", "ed.export": "Download", "ed.rename": "Rename design",
      "more.resize": "Resize…", "more.pkg": "Save as package (.orosdesign)", "more.credits": "Credits",
      "more.selall": "Select all", "more.copy": "Copy", "more.paste": "Paste",
      "tab.templates": "Templates", "tab.elements": "Elements", "tab.text": "Text", "tab.uploads": "Uploads",
      "tab.background": "Background", "tab.colour": "Colour", "tab.effects": "Effects", "tab.filters": "Filters",
      "tab.adjust": "Adjust", "tab.position": "Position", "tab.mask": "Shape",
      "drawer.close": "Close panel",
      "tab.sources": "Sources",
      "ctx.video": "Video", "tab.video": "Video", "vd.upload": "Add video or sound",
      "vd.working": "Reading the file…", "vd.added": "Video added.", "vd.soundAdded": "Sound added to this page.",
      "vd.fail": "The file could not be added.", "vd.type": "This file is not a video or sound Atelier can play (MP4, WebM, MP3, M4A, OGG, WAV).",
      "vd.big": "The file is too large (videos up to 100 MB, sounds up to 30 MB).", "vd.long": "The file is too long (up to 30 minutes).",
      "vd.pick": "Select a video to change it.", "vd.reading": "Reading the video…",
      "vd.missing": "This video is not on this device yet; it arrives with sync.",
      "vd.trim": "Trim", "vd.from": "Start", "vd.to": "End", "vd.len": "The whole video is {s} long.",
      "vd.sound": "Sound", "vd.mute": "No sound", "vd.vol": "Volume", "vd.playback": "Playback", "vd.loop": "Play again when it ends",
      "vd.fitPage": "Show the page for {s} s (the video's length)", "vd.fitted": "The page now shows for {s} s.",
      "vd.hint": "Videos play in Play and in Download › Video (with their sound). Pictures, PDF, PowerPoint and the slide show use their first frame.",
      "vd.pageSound": "Page sound", "vd.noSound": "No sound on this page.", "vd.addSound": "Add a sound",
      "vd.startAt": "Start at", "vd.allPages": "Use on all pages", "vd.allDone": "Every page now has this sound.",
      "vd.replace": "Replace", "vd.removeSound": "Remove",
      "vd.soundHint": "Pages that share a sound play it on without starting over. It plays in Play, Present and Download › Video.",
      "an.stop": "Stop",
      "tab.brand": "Brand kit", "col.brand": "Brand colours",
      "br.intro": "Your colours, fonts and logos, on all your devices.", "br.edit": "Edit", "br.done": "Done",
      "br.colors": "Colours", "br.pickEl": "Select an element first, then tap a colour.", "br.remove": "Remove",
      "br.noColors": "No brand colours yet.", "br.addColor": "Add colour", "br.fromDesign": "From this design",
      "br.added": "{n} colours added.", "br.nothingNew": "No new colours in this design.",
      "br.fonts": "Fonts", "br.slot.h": "Heading", "br.slot.s": "Subheading", "br.slot.t": "Body text",
      "br.notSet": "Not set", "br.addText": "Add a text in this font", "br.useSel": "Use selected",
      "br.fontsHint": "Select a text and tap \u201cUse selected\u201d to keep its font. The Text panel then uses these fonts.",
      "br.logos": "Logos", "br.logo": "Logo", "br.addLogo": "Add logo",
      "tab.fonts": "Fonts", "fn.pick": "Select a text to change its font.", "fn.mine": "Your fonts",
      "fn.offlineOk": "always available", "fn.inDesign": "in this design", "fn.more": "More fonts (Fontsource)",
      "fn.search": "Search fonts", "fn.greek": "Only fonts with Greek letters", "fn.hasGreek": "Greek",
      "fn.browse": "Show all", "fn.loading": "Getting the font…", "fn.fail": "The font could not be fetched.",
      "fn.offline": "You are offline: only fonts already on this device can be used.",
      "fn.hint": "Free fonts with open licences. A font is downloaded the first time you use it and then works offline on this device. Letters a font lacks show in Sans.",
      "imp.file": "From a file (.pptx, picture, package)…", "imp.canva": "From your Canva account…",
      "cv.title": "Import from Canva", "cv.intro": "Bring your Canva designs over in one go. Each one is exported from Canva as PowerPoint and opened here as a new design.",
      "cv.checking": "Checking the connection…", "cv.off": "This orOS relay has no Canva connection set up yet. You can still download a design from Canva as PowerPoint and use Import › From a file.",
      "cv.connect": "Connect to Canva", "cv.connectHint": "A Canva window opens: sign in and allow access to your designs. Atelier only reads them; your Canva sign-in stays on this device.",
      "cv.waiting": "Finish in the Canva window…", "cv.popup": "The Canva window was blocked. Allow pop-ups for orOS and try again.",
      "cv.denied": "Canva did not give access.", "cv.auth": "The Canva connection has ended. Connect again.", "cv.rate": "Canva asks to slow down. Try again in a minute.",
      "cv.license": "Uses paid Canva content that cannot be exported.", "cv.approval": "Waiting for approval in your Canva team.", "cv.fail": "Canva could not be reached or did not answer.",
      "cv.search": "Search your Canva designs", "cv.none": "No designs found.", "cv.untitled": "Untitled design", "cv.pages": "{n} pages", "cv.page1": "1 page", "cv.imported": "imported",
      "cv.all": "Select all", "cv.none.sel": "Select none", "cv.import": "Import {n}", "cv.disconnect": "Disconnect",
      "cv.working": "Importing {i} of {n}…", "cv.stop": "Stop", "cv.stopping": "Stopping after this design…",
      "cv.done": "{n} designs imported.", "cv.lost": "{n} elements could not be brought over.",
      "tab.animate": "Animate", "ctx.animate": "Animate", "more.present": "Present (full screen)",
      "an.element": "Element entrance", "an.pick": "Select an element to animate it.", "an.nothing": "Nothing on this page is animated yet.",
      "an.none": "None", "an.fade": "Fade", "an.rise": "Rise", "an.pop": "Pop", "an.wipe": "Wipe", "an.type": "Typewriter",
      "an.page": "This page", "an.dur": "Shows for", "an.tr": "Transition to this page",
      "an.tr.none": "None", "an.tr.fade": "Fade", "an.tr.slide": "Slide", "an.tr.push": "Push", "an.tr.zoom": "Zoom",
      "an.play": "Play", "an.hint": "Animations play in Present, in video and in GIF. Pictures, PDF and print show the finished page.",
      "exp.video": "Video", "exp.gif": "GIF", "exp.videoHint": "A film of your pages with their animations, {s} seconds. It records in real time: keep this tab open.",
      "exp.gifHint": "A short looping animation for chats and posts, {s} seconds. Fewer colours than video.",
      "exp.videoWorking": "Recording the video: {s} of {t} s", "exp.gifWorking": "Making the GIF: {s} of {t} s",
      "src.k.photo": "Photos", "src.k.illus": "Illustrations", "src.k.icon": "Icons and clipart",
      "src.search": "Search free media", "src.go": "Search", "src.restricted": "Show licences with limits (no commercial use or no edits)",
      "src.intro": "Search millions of free photos, illustrations and icons from open libraries. What you add is saved with your design and works offline.",
      "src.none": "Nothing found. Try other words, in English too.", "src.searching": "Searching…", "src.more": "More results",
      "src.untitled": "Untitled", "src.limited": "Limits", "src.from": "Results from",
      "src.creditHint": "Each piece keeps its author and licence: see More › Credits.",
      "src.getting": "Downloading…", "src.added": "Added to your design", "src.fail": "This file could not be downloaded.",
      "src.tooBig": "This file is too large.", "src.offline": "Sources need an internet connection. Your designs still work offline.",
      "src.err.offline": "No connection to this library right now.", "src.err.rate": "Too many searches for now. Try again in a minute.",
      "src.err.key": "The key for this library was not accepted.", "src.err.server": "This library did not answer. Try another one.",
      "src.keys": "Pixabay and Pexels keys", "src.keysHint": "Both are free: make an account and copy your API key here. Keys stay on this device.",
      "src.getKey": "Get a key",
      "tpl.apply": "Use on this page", "tpl.hint": "A template replaces what is on the current page and is fitted to your size.",
      "tpl.confirm": "Replace this page with the template?",
      "el.shapes": "Shapes", "el.lines": "Lines", "el.icons": "Icons", "el.iconsSearch": "Search icons",
      "el.line": "Line", "el.arrow": "Arrow", "el.dashed": "Dashed line", "el.iconsNone": "No icon matches.",
      "el.all": "All", "el.iconsCredit": "Icons: Tabler Icons (MIT).",
      "txt.heading": "Add a heading", "txt.sub": "Add a subheading", "txt.body": "Add a little bit of body text",
      "txt.headingT": "Heading", "txt.subT": "Subheading", "txt.bodyT": "Body text",
      "txt.combos": "Styles", "txt.neon": "Neon", "txt.outline": "OUTLINE", "txt.curved": "Curved text", "txt.shadow": "Shadow", "txt.label": "Label",
      "up.add": "Upload an image", "up.hint": "Images stay on this device and sync with Vault Drive like your other files.",
      "up.none": "No uploads yet.", "up.used": "Images in your designs",
      "bg.colour": "Background colour", "bg.gradients": "Gradients", "bg.photo": "Use the selected photo as background",
      "bg.clearPhoto": "Remove background photo",
      "col.doc": "Colours in this design", "col.default": "Default colours", "col.custom": "Custom colour",
      "col.photo": "From your photos", "col.none": "No colour", "col.gradient": "Gradient", "col.solid": "Solid",
      "col.from": "From", "col.to": "To", "col.angle": "Angle",
      "fx.curve": "Curve", "fx.off": "Offset", "fx.dir": "Direction", "fx.blur": "Blur", "fx.alpha": "Transparency",
      "fx.color": "Colour", "fx.thick": "Thickness", "fx.pad": "Spread", "fx.round": "Roundness",
      "adj.bright": "Brightness", "adj.contrast": "Contrast", "adj.sat": "Saturation", "adj.warmth": "Warmth",
      "adj.tint": "Tint", "adj.fade": "Fade", "adj.sepia": "Sepia", "adj.vignette": "Vignette", "adj.blur": "Blur",
      "adj.sharpen": "Sharpen", "adj.reset": "Reset adjustments",
      "mask.none": "Original (rectangle)",
      "ctx.font": "Font", "ctx.size": "Font size", "ctx.colour": "Colour", "ctx.bold": "Bold", "ctx.italic": "Italic",
      "ctx.underline": "Underline", "ctx.caps": "Uppercase", "ctx.align": "Alignment", "ctx.spacing": "Spacing",
      "ctx.lh": "Line height", "ctx.tr": "Letter spacing", "ctx.effects": "Effects", "ctx.fill": "Fill",
      "ctx.stroke": "Border", "ctx.sw": "Border weight", "ctx.weight": "Weight", "ctx.round": "Roundness",
      "ctx.dashed": "Dashed", "ctx.start": "Start", "ctx.end": "End", "ctx.head.none": "None", "ctx.head.arrow": "Arrow",
      "ctx.head.dot": "Dot", "ctx.filters": "Filters", "ctx.adjust": "Adjust", "ctx.crop": "Crop", "ctx.flip": "Flip",
      "ctx.flipH": "Flip horizontal", "ctx.flipV": "Flip vertical", "ctx.mask": "Shape", "ctx.replace": "Replace",
      "ctx.op": "Transparency", "ctx.position": "Position", "ctx.lock": "Lock", "ctx.unlock": "Unlock",
      "ctx.dup": "Duplicate", "ctx.del": "Delete", "ctx.bg": "Background", "ctx.hint": "Tap an element to edit it.",
      "ctx.n": "{n} selected", "ctx.done": "Done", "ctx.edit": "Edit text",
      "pos.front": "Bring to front", "pos.fwd": "Bring forward", "pos.bwd": "Send backward", "pos.back": "Send to back",
      "pos.al": "Left", "pos.ac": "Centre", "pos.ar": "Right", "pos.at": "Top", "pos.am": "Middle", "pos.ab": "Bottom",
      "pos.layer": "Layer", "pos.align": "Align to page", "pos.alignSel": "Align selection", "pos.size": "Size and position",
      "pos.x": "X", "pos.y": "Y", "pos.w": "W", "pos.h": "H", "pos.rot": "Rotate",
      "crop.hint": "Drag the photo to move it inside its frame; pinch, scroll or use the slider to zoom.",
      "crop.zoom": "Zoom", "crop.reset": "Reset",
      "pg.add": "Add page", "pg.dup": "Duplicate page", "pg.del": "Delete page", "pg.left": "Move left", "pg.right": "Move right",
      "pg.n": "Page {n}", "pg.of": "Page {n} of {c}", "pg.lastOne": "A design keeps at least one page.",
      "pg.max": "A design can have at most {n} pages.",
      "exp.title": "Download", "exp.type": "File type", "exp.png": "PNG", "exp.jpg": "JPG", "exp.pdf": "PDF",
      "exp.pngHint": "Best for images with text or a transparent background.", "exp.jpgHint": "Smaller files for photos.",
      "exp.pdfHint": "For printing. Pages become high-resolution images, so the look stays exactly as you see it.",
      "exp.size": "Size", "exp.scale1": "Normal ({w} × {h} px)", "exp.scale2": "Large ×2 ({w} × {h} px)", "exp.scale3": "Extra large ×3 ({w} × {h} px)",
      "exp.dpi150": "150 dpi (screen, home printer)", "exp.dpi300": "300 dpi (print shop)",
      "exp.transparent": "Transparent background", "exp.pages": "Pages", "exp.all": "All pages", "exp.cur": "Current page",
      "exp.go": "Download", "exp.working": "Preparing your file…", "exp.done": "Saved", "exp.fail": "The file could not be made.",
      "exp.zipNote": "Each page is saved as its own file.", "exp.credits": "This design uses work by others: keep the credits with it.",
      "pkg.done": "Package saved", "imp.done": "Design opened", "imp.bad": "This file cannot be opened. Atelier opens its own packages (.orosdesign), PowerPoint files (.pptx, for example from Canva) and pictures.",
      "imp.working": "Importing…", "imp.partial": "Design opened. {n} elements could not be brought over (charts, tables, video or missing pictures).",
      "imp.imgFail": "{n} images could not be restored.",
      "img.fail": "This file could not be read as an image.", "img.nofs": "The orOS disk is not available on this device.",
      "img.added": "Image added", "img.missing": "Syncing…",
      "credits.title": "Credits", "credits.none": "Everything in this design is yours or from the built-in library.",
      "credits.copy": "Copy credits", "credits.copied": "Credits copied",
      "resize.title": "Resize design", "resize.note": "Everything is scaled to fit the new size.",
      "btn.cancel": "Cancel", "btn.ok": "OK", "btn.create": "Create", "btn.close": "Close", "btn.undo": "Undo",
      "btn.apply": "Apply", "btn.reset": "Reset",
      "toast.deleted": "Deleted", "toast.docDeleted": "Design deleted",
      "toast.save": "Storage is full: recent changes could not be saved on this device.",
      "toast.big": "This design is getting large ({n} KB). Large designs fill the storage every app shares.",
      "toast.locked": "This element is locked.", "toast.gone": "This design was deleted on another device.",
      "toast.fontFail": "The fonts could not be loaded.", "toast.maxItems": "A design can have at most {n} elements.",
      "toast.copied": "Copied", "toast.pasted": "Pasted",
      "dlg.rename": "Rename", "a11y.canvas": "Design canvas", "a11y.pages": "Pages"
    },
    el: {
      "app.name": "Ατελιέ", "loading": "Φόρτωση γραμματοσειρών…",
      "home.make": "Τι θα φτιάξεις;", "home.templates": "Ξεκίνα από πρότυπο", "home.designs": "Τα σχέδιά σου",
      "home.custom": "Δικό σου μέγεθος", "home.import": "Εισαγωγή", "home.search": "Αναζήτηση σχεδίων",
      "home.count": "{n} σχέδια", "home.count1": "1 σχέδιο", "home.none": "Κανένα σχέδιο δεν ταιριάζει.",
      "home.empty": "Τα σχέδιά σου θα εμφανίζονται εδώ. Διάλεξε μέγεθος ή πρότυπο για να ξεκινήσεις.",
      "home.pages": "{n} σελίδες", "home.pages1": "1 σελίδα",
      "doc.untitled": "Σχέδιο χωρίς τίτλο", "doc.copy": "{name} (αντίγραφο)",
      "card.open": "Άνοιγμα", "card.rename": "Μετονομασία", "card.dup": "Διπλασιασμός", "card.pkg": "Αποθήκευση ως πακέτο", "card.del": "Διαγραφή",
      "custom.title": "Δικό σου μέγεθος", "custom.w": "Πλάτος", "custom.h": "Ύψος", "custom.unit": "Μονάδες",
      "custom.px": "Pixels (οθόνη)", "custom.mm": "Χιλιοστά (εκτύπωση)", "custom.range": "Από {a} έως {b} {u}.",
      "ed.back": "Σχέδια", "ed.undo": "Αναίρεση", "ed.redo": "Επανάληψη", "ed.zin": "Μεγέθυνση", "ed.zout": "Σμίκρυνση",
      "ed.fit": "Προσαρμογή στην οθόνη", "ed.more": "Περισσότερα", "ed.export": "Λήψη", "ed.rename": "Μετονομασία σχεδίου",
      "more.resize": "Αλλαγή μεγέθους…", "more.pkg": "Αποθήκευση ως πακέτο (.orosdesign)", "more.credits": "Αναφορές δημιουργών",
      "more.selall": "Επιλογή όλων", "more.copy": "Αντιγραφή", "more.paste": "Επικόλληση",
      "tab.templates": "Πρότυπα", "tab.elements": "Στοιχεία", "tab.text": "Κείμενο", "tab.uploads": "Μεταφορτώσεις",
      "tab.background": "Φόντο", "tab.colour": "Χρώμα", "tab.effects": "Εφέ", "tab.filters": "Φίλτρα",
      "tab.adjust": "Ρυθμίσεις", "tab.position": "Θέση", "tab.mask": "Σχήμα",
      "drawer.close": "Κλείσιμο πάνελ",
      "tab.sources": "Πηγές",
      "ctx.video": "Βίντεο", "tab.video": "Βίντεο", "vd.upload": "Προσθήκη βίντεο ή ήχου",
      "vd.working": "Διαβάζω το αρχείο…", "vd.added": "Το βίντεο προστέθηκε.", "vd.soundAdded": "Ο ήχος μπήκε σε αυτή τη σελίδα.",
      "vd.fail": "Το αρχείο δεν μπόρεσε να προστεθεί.", "vd.type": "Αυτό το αρχείο δεν είναι βίντεο ή ήχος που παίζει το Ατελιέ (MP4, WebM, MP3, M4A, OGG, WAV).",
      "vd.big": "Το αρχείο είναι πολύ μεγάλο (βίντεο έως 100 MB, ήχοι έως 30 MB).", "vd.long": "Το αρχείο είναι πολύ μεγάλο σε διάρκεια (έως 30 λεπτά).",
      "vd.pick": "Διάλεξε ένα βίντεο για να το αλλάξεις.", "vd.reading": "Διαβάζω το βίντεο…",
      "vd.missing": "Αυτό το βίντεο δεν έχει έρθει ακόμα σε αυτή τη συσκευή· θα έρθει με τον συγχρονισμό.",
      "vd.trim": "Κόψιμο", "vd.from": "Αρχή", "vd.to": "Τέλος", "vd.len": "Όλο το βίντεο διαρκεί {s}.",
      "vd.sound": "Ήχος", "vd.mute": "Χωρίς ήχο", "vd.vol": "Ένταση", "vd.playback": "Αναπαραγωγή", "vd.loop": "Ξαναπαίζει όταν τελειώσει",
      "vd.fitPage": "Η σελίδα να φαίνεται {s} δ. (όσο το βίντεο)", "vd.fitted": "Η σελίδα φαίνεται τώρα {s} δ.",
      "vd.hint": "Τα βίντεο παίζουν στην Αναπαραγωγή και στη Λήψη › Βίντεο (με τον ήχο τους). Οι εικόνες, το PDF, το PowerPoint και η παρουσίαση δείχνουν το πρώτο τους καρέ.",
      "vd.pageSound": "Ήχος σελίδας", "vd.noSound": "Αυτή η σελίδα δεν έχει ήχο.", "vd.addSound": "Πρόσθεσε ήχο",
      "vd.startAt": "Ξεκινά από", "vd.allPages": "Σε όλες τις σελίδες", "vd.allDone": "Όλες οι σελίδες έχουν τώρα αυτόν τον ήχο.",
      "vd.replace": "Αλλαγή", "vd.removeSound": "Αφαίρεση",
      "vd.soundHint": "Οι σελίδες με τον ίδιο ήχο τον συνεχίζουν χωρίς να ξεκινά από την αρχή. Παίζει στην Αναπαραγωγή, στην Παρουσίαση και στη Λήψη › Βίντεο.",
      "an.stop": "Διακοπή",
      "tab.brand": "Ταυτότητα", "col.brand": "Χρώματα ταυτότητας",
      "br.intro": "Τα χρώματα, οι γραμματοσειρές και τα λογότυπά σου, σε όλες τις συσκευές σου.", "br.edit": "Επεξεργασία", "br.done": "Τέλος",
      "br.colors": "Χρώματα", "br.pickEl": "Διάλεξε πρώτα ένα στοιχείο και μετά πάτα ένα χρώμα.", "br.remove": "Αφαίρεση",
      "br.noColors": "Δεν υπάρχουν ακόμα χρώματα ταυτότητας.", "br.addColor": "Προσθήκη χρώματος", "br.fromDesign": "Από αυτό το σχέδιο",
      "br.added": "Προστέθηκαν {n} χρώματα.", "br.nothingNew": "Δεν υπάρχουν νέα χρώματα σε αυτό το σχέδιο.",
      "br.fonts": "Γραμματοσειρές", "br.slot.h": "Τίτλος", "br.slot.s": "Υπότιτλος", "br.slot.t": "Κείμενο",
      "br.notSet": "Δεν έχει οριστεί", "br.addText": "Πρόσθεσε κείμενο σε αυτή τη γραμματοσειρά", "br.useSel": "Από την επιλογή",
      "br.fontsHint": "Διάλεξε ένα κείμενο και πάτα \u00abΑπό την επιλογή\u00bb για να κρατήσεις τη γραμματοσειρά του. Το πάνελ Κείμενο θα χρησιμοποιεί αυτές τις γραμματοσειρές.",
      "br.logos": "Λογότυπα", "br.logo": "Λογότυπο", "br.addLogo": "Προσθήκη λογότυπου",
      "tab.fonts": "Γραμματοσειρές", "fn.pick": "Διάλεξε ένα κείμενο για να αλλάξεις τη γραμματοσειρά του.", "fn.mine": "Οι γραμματοσειρές σου",
      "fn.offlineOk": "πάντα διαθέσιμη", "fn.inDesign": "σε αυτό το σχέδιο", "fn.more": "Περισσότερες γραμματοσειρές (Fontsource)",
      "fn.search": "Αναζήτηση γραμματοσειράς", "fn.greek": "Μόνο με ελληνικά γράμματα", "fn.hasGreek": "Ελληνικά",
      "fn.browse": "Δείξε όλες", "fn.loading": "Κατεβάζω τη γραμματοσειρά…", "fn.fail": "Η γραμματοσειρά δεν μπόρεσε να κατέβει.",
      "fn.offline": "Είσαι εκτός σύνδεσης: μπορείς να χρησιμοποιήσεις μόνο όσες γραμματοσειρές έχει ήδη η συσκευή.",
      "fn.hint": "Δωρεάν γραμματοσειρές με ανοιχτές άδειες. Μια γραμματοσειρά κατεβαίνει την πρώτη φορά που τη χρησιμοποιείς και μετά δουλεύει χωρίς σύνδεση σε αυτή τη συσκευή. Όσα γράμματα δεν έχει φαίνονται σε Sans.",
      "imp.file": "Από αρχείο (.pptx, εικόνα, πακέτο)…", "imp.canva": "Από τον λογαριασμό σου στο Canva…",
      "cv.title": "Εισαγωγή από το Canva", "cv.intro": "Φέρε τα σχέδιά σου από το Canva με τη μία. Το καθένα εξάγεται από το Canva ως PowerPoint και ανοίγει εδώ ως νέο σχέδιο.",
      "cv.checking": "Ελέγχω τη σύνδεση…", "cv.off": "Αυτός ο relay του orOS δεν έχει ακόμη ρυθμισμένη σύνδεση με το Canva. Μπορείς πάντα να κατεβάσεις ένα σχέδιο από το Canva ως PowerPoint και να το ανοίξεις από Εισαγωγή › Από αρχείο.",
      "cv.connect": "Σύνδεση με το Canva", "cv.connectHint": "Ανοίγει ένα παράθυρο του Canva: συνδέσου και επίτρεψε την πρόσβαση στα σχέδιά σου. Το Ατελιέ μόνο τα διαβάζει· η σύνδεση με το Canva μένει σε αυτή τη συσκευή.",
      "cv.waiting": "Ολοκλήρωσε στο παράθυρο του Canva…", "cv.popup": "Το παράθυρο του Canva μπλοκαρίστηκε. Επίτρεψε τα αναδυόμενα για το orOS και ξαναδοκίμασε.",
      "cv.denied": "Το Canva δεν έδωσε πρόσβαση.", "cv.auth": "Η σύνδεση με το Canva έληξε. Συνδέσου ξανά.", "cv.rate": "Το Canva ζητά να πάμε πιο αργά. Ξαναδοκίμασε σε ένα λεπτό.",
      "cv.license": "Έχει επί πληρωμή περιεχόμενο του Canva που δεν εξάγεται.", "cv.approval": "Περιμένει έγκριση στην ομάδα σου στο Canva.", "cv.fail": "Το Canva δεν απάντησε ή δεν ήταν διαθέσιμο.",
      "cv.search": "Αναζήτηση στα σχέδιά σου στο Canva", "cv.none": "Δεν βρέθηκαν σχέδια.", "cv.untitled": "Σχέδιο χωρίς τίτλο", "cv.pages": "{n} σελίδες", "cv.page1": "1 σελίδα", "cv.imported": "εισήχθη",
      "cv.all": "Επιλογή όλων", "cv.none.sel": "Καμία επιλογή", "cv.import": "Εισαγωγή {n}", "cv.disconnect": "Αποσύνδεση",
      "cv.working": "Εισαγωγή {i} από {n}…", "cv.stop": "Διακοπή", "cv.stopping": "Σταματάω μετά από αυτό το σχέδιο…",
      "cv.done": "Εισήχθησαν {n} σχέδια.", "cv.lost": "{n} στοιχεία δεν μεταφέρθηκαν.",
      "tab.animate": "Κίνηση", "ctx.animate": "Κίνηση", "more.present": "Παρουσίαση (πλήρης οθόνη)",
      "an.element": "Είσοδος στοιχείου", "an.pick": "Διάλεξε ένα στοιχείο για να του βάλεις κίνηση.", "an.nothing": "Τίποτα σε αυτή τη σελίδα δεν έχει ακόμη κίνηση.",
      "an.none": "Καμία", "an.fade": "Σβήσιμο", "an.rise": "Ανάδυση", "an.pop": "Αναπήδηση", "an.wipe": "Σάρωση", "an.type": "Γραφομηχανή",
      "an.page": "Αυτή η σελίδα", "an.dur": "Διάρκεια", "an.tr": "Μετάβαση σε αυτή τη σελίδα",
      "an.tr.none": "Καμία", "an.tr.fade": "Σβήσιμο", "an.tr.slide": "Ολίσθηση", "an.tr.push": "Ώθηση", "an.tr.zoom": "Ζουμ",
      "an.play": "Αναπαραγωγή", "an.hint": "Οι κινήσεις παίζουν στην Παρουσίαση, στο βίντεο και στο GIF. Οι εικόνες, το PDF και η εκτύπωση δείχνουν την τελική σελίδα.",
      "exp.video": "Βίντεο", "exp.gif": "GIF", "exp.videoHint": "Ταινία με τις σελίδες σου και τις κινήσεις τους, {s} δευτερόλεπτα. Γράφεται σε πραγματικό χρόνο: κράτα αυτή την καρτέλα ανοιχτή.",
      "exp.gifHint": "Σύντομο κινούμενο που επαναλαμβάνεται, για συνομιλίες και αναρτήσεις, {s} δευτερόλεπτα. Λιγότερα χρώματα από το βίντεο.",
      "exp.videoWorking": "Γράφω το βίντεο: {s} από {t} δευτ.", "exp.gifWorking": "Φτιάχνω το GIF: {s} από {t} δευτ.",
      "src.k.photo": "Φωτογραφίες", "src.k.illus": "Εικονογραφήσεις", "src.k.icon": "Εικονίδια και clipart",
      "src.search": "Αναζήτηση ελεύθερων αρχείων", "src.go": "Αναζήτηση", "src.restricted": "Εμφάνιση αδειών με περιορισμούς (όχι εμπορική χρήση ή όχι αλλαγές)",
      "src.intro": "Ψάξε σε εκατομμύρια ελεύθερες φωτογραφίες, εικονογραφήσεις και εικονίδια από ανοιχτές βιβλιοθήκες. Ό,τι προσθέτεις αποθηκεύεται με το σχέδιο και δουλεύει και χωρίς σύνδεση.",
      "src.none": "Δεν βρέθηκε κάτι. Δοκίμασε άλλες λέξεις, και στα αγγλικά.", "src.searching": "Αναζήτηση…", "src.more": "Περισσότερα",
      "src.untitled": "Χωρίς τίτλο", "src.limited": "Όροι", "src.from": "Αποτελέσματα από",
      "src.creditHint": "Κάθε κομμάτι κρατά δημιουργό και άδεια: δες Περισσότερα › Αναφορές δημιουργών.",
      "src.getting": "Λήψη…", "src.added": "Προστέθηκε στο σχέδιο", "src.fail": "Το αρχείο δεν κατέβηκε.",
      "src.tooBig": "Το αρχείο είναι πολύ μεγάλο.", "src.offline": "Οι πηγές θέλουν σύνδεση στο internet. Τα σχέδιά σου δουλεύουν και χωρίς.",
      "src.err.offline": "Δεν υπάρχει σύνδεση με αυτή τη βιβλιοθήκη τώρα.", "src.err.rate": "Πολλές αναζητήσεις για την ώρα. Δοκίμασε σε ένα λεπτό.",
      "src.err.key": "Το κλειδί για αυτή τη βιβλιοθήκη δεν έγινε δεκτό.", "src.err.server": "Η βιβλιοθήκη δεν απάντησε. Δοκίμασε άλλη.",
      "src.keys": "Κλειδιά Pixabay και Pexels", "src.keysHint": "Είναι δωρεάν: φτιάξε λογαριασμό και αντέγραψε εδώ το API key σου. Τα κλειδιά μένουν σε αυτή τη συσκευή.",
      "src.getKey": "Πάρε κλειδί",
      "tpl.apply": "Χρήση σε αυτή τη σελίδα", "tpl.hint": "Το πρότυπο αντικαθιστά ό,τι έχει η τρέχουσα σελίδα και προσαρμόζεται στο μέγεθός σου.",
      "tpl.confirm": "Να αντικατασταθεί η σελίδα με το πρότυπο;",
      "el.shapes": "Σχήματα", "el.lines": "Γραμμές", "el.icons": "Εικονίδια", "el.iconsSearch": "Αναζήτηση εικονιδίων",
      "el.line": "Γραμμή", "el.arrow": "Βέλος", "el.dashed": "Διακεκομμένη", "el.iconsNone": "Κανένα εικονίδιο δεν ταιριάζει.",
      "el.all": "Όλα", "el.iconsCredit": "Εικονίδια: Tabler Icons (MIT).",
      "txt.heading": "Πρόσθεσε τίτλο", "txt.sub": "Πρόσθεσε υπότιτλο", "txt.body": "Πρόσθεσε λίγο κείμενο",
      "txt.headingT": "Τίτλος", "txt.subT": "Υπότιτλος", "txt.bodyT": "Κείμενο",
      "txt.combos": "Στυλ", "txt.neon": "Νέον", "txt.outline": "ΠΕΡΙΓΡΑΜΜΑ", "txt.curved": "Κυρτό κείμενο", "txt.shadow": "Σκιά", "txt.label": "Ετικέτα",
      "up.add": "Μεταφόρτωση εικόνας", "up.hint": "Οι εικόνες μένουν σε αυτή τη συσκευή και συγχρονίζονται με το Vault Drive όπως τα άλλα σου αρχεία.",
      "up.none": "Δεν υπάρχουν μεταφορτώσεις ακόμα.", "up.used": "Εικόνες στα σχέδιά σου",
      "bg.colour": "Χρώμα φόντου", "bg.gradients": "Διαβαθμίσεις", "bg.photo": "Η επιλεγμένη φωτογραφία ως φόντο",
      "bg.clearPhoto": "Αφαίρεση φωτογραφίας φόντου",
      "col.doc": "Χρώματα του σχεδίου", "col.default": "Βασικά χρώματα", "col.custom": "Δικό σου χρώμα",
      "col.photo": "Από τις φωτογραφίες σου", "col.none": "Χωρίς χρώμα", "col.gradient": "Διαβάθμιση", "col.solid": "Μονόχρωμο",
      "col.from": "Από", "col.to": "Προς", "col.angle": "Γωνία",
      "fx.curve": "Καμπύλη", "fx.off": "Απόσταση", "fx.dir": "Κατεύθυνση", "fx.blur": "Θόλωμα", "fx.alpha": "Διαφάνεια",
      "fx.color": "Χρώμα", "fx.thick": "Πάχος", "fx.pad": "Άπλωμα", "fx.round": "Στρογγύλεμα",
      "adj.bright": "Φωτεινότητα", "adj.contrast": "Αντίθεση", "adj.sat": "Κορεσμός", "adj.warmth": "Θερμότητα",
      "adj.tint": "Απόχρωση", "adj.fade": "Ξεθώριασμα", "adj.sepia": "Σέπια", "adj.vignette": "Βινιέτα", "adj.blur": "Θόλωμα",
      "adj.sharpen": "Όξυνση", "adj.reset": "Επαναφορά ρυθμίσεων",
      "mask.none": "Αρχικό (ορθογώνιο)",
      "ctx.font": "Γραμματοσειρά", "ctx.size": "Μέγεθος γραμμάτων", "ctx.colour": "Χρώμα", "ctx.bold": "Έντονα", "ctx.italic": "Πλάγια",
      "ctx.underline": "Υπογράμμιση", "ctx.caps": "Κεφαλαία", "ctx.align": "Στοίχιση", "ctx.spacing": "Αποστάσεις",
      "ctx.lh": "Διάστιχο", "ctx.tr": "Αραίωση γραμμάτων", "ctx.effects": "Εφέ", "ctx.fill": "Γέμισμα",
      "ctx.stroke": "Περίγραμμα", "ctx.sw": "Πάχος περιγράμματος", "ctx.weight": "Πάχος", "ctx.round": "Στρογγύλεμα",
      "ctx.dashed": "Διακεκομμένη", "ctx.start": "Αρχή", "ctx.end": "Τέλος", "ctx.head.none": "Τίποτα", "ctx.head.arrow": "Βέλος",
      "ctx.head.dot": "Τελεία", "ctx.filters": "Φίλτρα", "ctx.adjust": "Ρυθμίσεις", "ctx.crop": "Περικοπή", "ctx.flip": "Αναστροφή",
      "ctx.flipH": "Οριζόντια αναστροφή", "ctx.flipV": "Κάθετη αναστροφή", "ctx.mask": "Σχήμα", "ctx.replace": "Αντικατάσταση",
      "ctx.op": "Διαφάνεια", "ctx.position": "Θέση", "ctx.lock": "Κλείδωμα", "ctx.unlock": "Ξεκλείδωμα",
      "ctx.dup": "Διπλασιασμός", "ctx.del": "Διαγραφή", "ctx.bg": "Φόντο", "ctx.hint": "Πάτα ένα στοιχείο για να το αλλάξεις.",
      "ctx.n": "{n} επιλεγμένα", "ctx.done": "Τέλος", "ctx.edit": "Επεξεργασία κειμένου",
      "pos.front": "Μπροστά απ' όλα", "pos.fwd": "Ένα μπροστά", "pos.bwd": "Ένα πίσω", "pos.back": "Πίσω απ' όλα",
      "pos.al": "Αριστερά", "pos.ac": "Κέντρο", "pos.ar": "Δεξιά", "pos.at": "Πάνω", "pos.am": "Μέση", "pos.ab": "Κάτω",
      "pos.layer": "Στρώση", "pos.align": "Στοίχιση στη σελίδα", "pos.alignSel": "Στοίχιση επιλογής", "pos.size": "Μέγεθος και θέση",
      "pos.x": "X", "pos.y": "Y", "pos.w": "Π", "pos.h": "Υ", "pos.rot": "Περιστροφή",
      "crop.hint": "Σύρε τη φωτογραφία για να τη μετακινήσεις μέσα στο πλαίσιο· τσίμπημα, ροδέλα ή ο ολισθητής για ζουμ.",
      "crop.zoom": "Ζουμ", "crop.reset": "Επαναφορά",
      "pg.add": "Νέα σελίδα", "pg.dup": "Διπλασιασμός σελίδας", "pg.del": "Διαγραφή σελίδας", "pg.left": "Μετακίνηση αριστερά", "pg.right": "Μετακίνηση δεξιά",
      "pg.n": "Σελίδα {n}", "pg.of": "Σελίδα {n} από {c}", "pg.lastOne": "Ένα σχέδιο κρατά τουλάχιστον μία σελίδα.",
      "pg.max": "Ένα σχέδιο έχει το πολύ {n} σελίδες.",
      "exp.title": "Λήψη", "exp.type": "Τύπος αρχείου", "exp.png": "PNG", "exp.jpg": "JPG", "exp.pdf": "PDF",
      "exp.pngHint": "Το καλύτερο για εικόνες με κείμενο ή διάφανο φόντο.", "exp.jpgHint": "Μικρότερα αρχεία για φωτογραφίες.",
      "exp.pdfHint": "Για εκτύπωση. Οι σελίδες γίνονται εικόνες υψηλής ανάλυσης, ώστε να μένουν ακριβώς όπως τις βλέπεις.",
      "exp.size": "Μέγεθος", "exp.scale1": "Κανονικό ({w} × {h} px)", "exp.scale2": "Μεγάλο ×2 ({w} × {h} px)", "exp.scale3": "Πολύ μεγάλο ×3 ({w} × {h} px)",
      "exp.dpi150": "150 dpi (οθόνη, εκτυπωτής σπιτιού)", "exp.dpi300": "300 dpi (τυπογραφείο)",
      "exp.transparent": "Διάφανο φόντο", "exp.pages": "Σελίδες", "exp.all": "Όλες οι σελίδες", "exp.cur": "Τρέχουσα σελίδα",
      "exp.go": "Λήψη", "exp.working": "Ετοιμάζω το αρχείο σου…", "exp.done": "Αποθηκεύτηκε", "exp.fail": "Το αρχείο δεν μπόρεσε να φτιαχτεί.",
      "exp.zipNote": "Κάθε σελίδα αποθηκεύεται ως ξεχωριστό αρχείο.", "exp.credits": "Το σχέδιο χρησιμοποιεί έργα άλλων: κράτα τις αναφορές μαζί του.",
      "pkg.done": "Το πακέτο αποθηκεύτηκε", "imp.done": "Το σχέδιο άνοιξε", "imp.bad": "Αυτό το αρχείο δεν ανοίγει. Το Ατελιέ ανοίγει τα δικά του πακέτα (.orosdesign), αρχεία PowerPoint (.pptx, π.χ. από το Canva) και εικόνες.",
      "imp.working": "Εισαγωγή…", "imp.partial": "Το σχέδιο άνοιξε. {n} στοιχεία δεν μεταφέρθηκαν (γραφήματα, πίνακες, βίντεο ή εικόνες που λείπουν).",
      "imp.imgFail": "{n} εικόνες δεν επανήλθαν.",
      "img.fail": "Αυτό το αρχείο δεν διαβάζεται ως εικόνα.", "img.nofs": "Ο δίσκος του orOS δεν είναι διαθέσιμος σε αυτή τη συσκευή.",
      "img.added": "Η εικόνα προστέθηκε", "img.missing": "Συγχρονίζεται…",
      "credits.title": "Αναφορές δημιουργών", "credits.none": "Όλα σε αυτό το σχέδιο είναι δικά σου ή από την ενσωματωμένη βιβλιοθήκη.",
      "credits.copy": "Αντιγραφή αναφορών", "credits.copied": "Οι αναφορές αντιγράφηκαν",
      "resize.title": "Αλλαγή μεγέθους", "resize.note": "Όλα κλιμακώνονται ώστε να χωρούν στο νέο μέγεθος.",
      "btn.cancel": "Άκυρο", "btn.ok": "OK", "btn.create": "Δημιουργία", "btn.close": "Κλείσιμο", "btn.undo": "Αναίρεση",
      "btn.apply": "Εφαρμογή", "btn.reset": "Επαναφορά",
      "toast.deleted": "Διαγράφηκε", "toast.docDeleted": "Το σχέδιο διαγράφηκε",
      "toast.save": "Ο χώρος γέμισε: οι τελευταίες αλλαγές δεν αποθηκεύτηκαν σε αυτή τη συσκευή.",
      "toast.big": "Το σχέδιο μεγαλώνει ({n} KB). Τα μεγάλα σχέδια γεμίζουν τον χώρο που μοιράζονται όλες οι εφαρμογές.",
      "toast.locked": "Αυτό το στοιχείο είναι κλειδωμένο.", "toast.gone": "Αυτό το σχέδιο διαγράφηκε σε άλλη συσκευή.",
      "toast.fontFail": "Οι γραμματοσειρές δεν φόρτωσαν.", "toast.maxItems": "Ένα σχέδιο έχει το πολύ {n} στοιχεία.",
      "toast.copied": "Αντιγράφηκε", "toast.pasted": "Επικολλήθηκε",
      "dlg.rename": "Μετονομασία", "a11y.canvas": "Καμβάς σχεδίου", "a11y.pages": "Σελίδες"
    }
  };
  AT.STRINGS = STRINGS;

  function t(key, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  AT.t = t;
  AT.lbl = function (o) { return o ? (LANG === "el" ? o.el : o.en) : ""; };

  // BOOT MARKER
  try { console.log("[orOS] atelier app v1.0.0 booted"); } catch (e) {}

  // ---------- 2. Helpers + toasts ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  AT.$ = $; AT.el = el;

  var ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    templates: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11"/>',
    elements: '<circle cx="8" cy="8" r="4"/><path d="M14 14h6v6h-6z"/><path d="M17 3l3.5 6h-7z"/>',
    text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    background: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15l5-5 5 5 3-3 5 5"/>',
    colour: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.4-1-2.4 0-.8.6-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="11" r="1"/>',
    effects: '<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    filters: '<circle cx="9" cy="9" r="5"/><circle cx="15" cy="9" r="5"/><circle cx="12" cy="15" r="5"/>',
    adjust: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
    flip: '<path d="M12 3v18"/><path d="M8 7L3 17h5z"/><path d="M16 7l5 10h-5z"/>',
    mask: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    position: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
    op: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
    caps: '<path d="M3 19l4-14 4 14M4.5 14h5"/><path d="M13 19l4-14 4 14M14.5 14h5"/>',
    al: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', ac: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
    ar: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>', aj: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
    spacing: '<path d="M8 4v16M4 8l4-4 4 4M4 16l4 4 4-4"/><path d="M15 8h6M15 12h6M15 16h6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    sources: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
    anim: '<path d="M4 12h3"/><path d="M5 7h4"/><path d="M5 17h4"/><circle cx="15" cy="12" r="6"/>',
    brand: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
    present: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M12 16v4M8 20h8"/>',
    replace: '<path d="M4 9a8 8 0 0 1 14-3l2 2"/><path d="M20 4v4h-4"/><path d="M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M4 20v-4h4"/>'
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
  AT.icon = icon; AT.iconBtn = iconBtn; AT.setIcon = setIcon;

  // Library icon (Tabler data) as an inline SVG built node by node:
  // the path strings are static data, never markup.
  var SVG_NS = "http://www.w3.org/2000/svg";
  AT.libIcon = function (entry, size) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size || 24)); svg.setAttribute("height", String(size || 24));
    svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    entry[4].forEach(function (d) {
      var p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  };
  AT.svgPath = function (d, w, h, fill) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", fill || "currentColor");
    svg.appendChild(p);
    return svg;
  };

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
  AT.toast = toast;
  AT.live = function (msg) {
    var n = $("live");
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  };

  // Design units: screen designs in px (= pt), print designs in mm.
  AT.isPrint = function (doc) { return (doc || AT.doc).setup.unit === "mm"; };
  AT.unitLbl = function (doc) { return AT.isPrint(doc) ? "mm" : "px"; };
  AT.fmtLen = function (pt, doc) {
    if (!AT.isPrint(doc)) return String(Math.round(pt));
    return String(Math.round(M.toUnit(pt, "mm") * 10) / 10);
  };
  AT.parseLen = function (s, doc) {
    var v = parseFloat(String(s).replace(",", "."));
    if (!isFinite(v)) return null;
    return AT.isPrint(doc) ? M.fromUnit(v, "mm") : v;
  };

  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  AT.dialogHost = dialogHost;

  // ---------- 3. Storage + prefs ----------
  var data = { ver: 1, docs: [], dt: {} };
  AT.doc = null;
  AT.prefs = { doc: null };

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.docs)) { data = M.normData(parsed); return; }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] atelier: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, docs: [], dt: {} };
  }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = p && typeof p === "object" ? p : {};
    AT.prefs = { doc: M.isId(p.doc) ? p.doc : null };
    // the user's own Pixabay / Pexels keys: this device only (R10)
    var k = p.keys && typeof p.keys === "object" ? p.keys : {}, keys = {};
    ["pixabay", "pexels"].forEach(function (id) {
      if (typeof k[id] === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(k[id])) keys[id] = k[id];
    });
    if (Object.keys(keys).length) AT.prefs.keys = keys;
    // recently used Fontsource families (fonts.js): this device only
    if (Array.isArray(p.fonts)) {
      var fl = p.fonts.filter(function (f) {
        return f && AX.isExtraFont(f.id) && typeof f.name === "string" && f.name.length <= 60;
      }).slice(0, 24).map(function (f) { return { id: f.id, name: f.name }; });
      if (fl.length) AT.prefs.fonts = fl;
    }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(AT.prefs)); } catch (e) {}
  }
  AT.savePrefs = savePrefs;

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
  AT.save = save; AT.flush = function () { if (saveTimer) saveNow(); };
  AT.data = function () { return data; };

  function findDoc(id) { return M.find(data.docs, id); }
  AT.findDoc = findDoc;

  // ---------- 4. Undo + mutations ----------
  // A mutation snapshots the open design first, runs fn(doc, now)
  // (which stamps what it changes, R27), normalizes, saves. Undo
  // re-applies a snapshot as NEW edits (fresh mtimes, tombstones),
  // so it syncs like any other change.
  var undoStack = [], redoStack = [], gesture = null;
  var listeners = {};
  AT.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  function emit(ev, arg) { (listeners[ev] || []).forEach(function (fn) { try { fn(arg); } catch (e) { console.error(e); } }); }
  AT.emit = emit;

  var lastNow = 0;
  function now() { lastNow = Math.max(Date.now(), lastNow + 1); return lastNow; }
  AT.now = now;

  function replaceDoc(nd) {
    var i = data.docs.indexOf(AT.doc);
    if (i < 0) return;
    data.docs[i] = nd;
    AT.doc = nd;
  }

  // fn returns false to cancel. During a gesture (drag, slider, live
  // typing) the doc changes without saving; endGesture saves once.
  function op(fn) {
    if (!AT.doc) return false;
    var before = gesture || JSON.stringify(AT.doc);
    var work = JSON.parse(JSON.stringify(AT.doc));
    var res = fn(work, now());
    if (res === false) return false;
    var nd = M.normDoc(work);
    var after = JSON.stringify(nd);
    if (after === JSON.stringify(AT.doc)) return false;
    if (!gesture) pushUndo(before);
    replaceDoc(nd);
    if (gesture) emit("doc");
    else commit();
    return true;
  }
  AT.op = op;
  AT.beginGesture = function () { if (!gesture && AT.doc) gesture = JSON.stringify(AT.doc); };
  AT.endGesture = function () {
    if (!gesture) return;
    var g = gesture; gesture = null;
    if (g !== JSON.stringify(AT.doc)) { pushUndo(g); commit(); }
  };
  AT.inGesture = function () { return !!gesture; };

  // Edit items by id: fn(item, doc, now) per item; stamps them.
  AT.editItems = function (ids, fn) {
    return op(function (doc, nw) {
      var any = false;
      ids.forEach(function (id) {
        var it = M.find(doc.items, id);
        if (!it) return;
        var before = JSON.stringify(it);
        if (fn(it, doc, nw) === false) return;
        if (it.ax && it.ax.k === "text") it.h = AX.textHeight(M.normItem(it) || it);
        if (JSON.stringify(it) !== before) { M.touch(it, nw); any = true; }
      });
      if (!any) return false;
    });
  };

  function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
  }

  function commit() {
    save();
    var bytes = M.docBytes(AT.doc);
    if (bytes > DOC_WARN && !bigWarned[AT.doc.id]) {
      bigWarned[AT.doc.id] = 1;
      toast(t("toast.big", { n: Math.round(bytes / 1024) }));
    }
    emit("doc");
  }
  AT.commit = commit;

  // Make the open doc look like `target` with fresh stamps.
  function withoutM(e) { var o = {}; Object.keys(e).forEach(function (k) { if (k !== "m" && k !== "h") o[k] = e[k]; }); return o; }
  function applyState(target) {
    var cur = AT.doc, t0 = now();
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
        if (ce && JSON.stringify(withoutM(ce)) === JSON.stringify(withoutM(e))) { list.push(ce); return; }
        var copy = JSON.parse(JSON.stringify(e));
        copy.m = Math.max(t0, (ce ? ce.m : 0) + 1, (nd.tombs[id] || 0) + 1);
        list.push(copy);
      });
      Object.keys(cmap).forEach(function (id) { if (!tmap[id]) nd.tombs[id] = Math.max(t0, cmap[id].m); });
      nd[c] = list;
    });
    return M.normDoc(nd);
  }

  AT.undo = function () {
    if (!AT.doc || !undoStack.length) return;
    AT.endGesture();
    if (!undoStack.length) return;
    var snap = undoStack.pop();
    redoStack.push(JSON.stringify(AT.doc));
    replaceDoc(applyState(JSON.parse(snap)));
    commit();
  };
  AT.redo = function () {
    if (!AT.doc || !redoStack.length) return;
    var snap = redoStack.pop();
    undoStack.push(JSON.stringify(AT.doc));
    replaceDoc(applyState(JSON.parse(snap)));
    commit();
  };
  AT.canUndo = function () { return undoStack.length > 0; };
  AT.canRedo = function () { return redoStack.length > 0; };

  // ---------- 5. Home ----------
  var thumbs = {};          // key → dataURL
  function docTitle(d) { return d.name || t("doc.untitled"); }
  AT.docTitle = docTitle;
  function fmtDate(ms) {
    var d = new Date(ms);
    var dd = ("0" + d.getDate()).slice(-2), mm = ("0" + (d.getMonth() + 1)).slice(-2);
    var hh = ("0" + d.getHours()).slice(-2), mi = ("0" + d.getMinutes()).slice(-2);
    return LANG === "el" ? dd + "/" + mm + "/" + d.getFullYear() + " " + hh + ":" + mi
      : d.getFullYear() + "-" + mm + "-" + dd + " " + hh + ":" + mi;
  }

  // First page as a small picture (cached per content).
  function thumbOf(d, box, key) {
    if (thumbs[key]) return thumbs[key];
    var pages = M.pagesInOrder(d);
    if (!pages.length || !T.isLoaded("sans-r")) return null;
    try {
      var scale = box / Math.max(d.setup.w, d.setup.h) * Math.min(2, window.devicePixelRatio || 1);
      var cv = AT.draw.renderPage(d, pages[0], scale, { maxSide: 600, background: "#ffffff" });
      return (thumbs[key] = cv.toDataURL("image/png"));
    } catch (e) { return null; }
  }
  AT.thumbOf = thumbOf;
  AT.dropThumbs = function () { thumbs = {}; };

  function presetSize(p) {
    var mm = p[6] === "mm";
    return { w: mm ? M.fromUnit(p[4], "mm") : p[4], h: mm ? M.fromUnit(p[5], "mm") : p[5], unit: p[6] };
  }
  AT.presetSize = presetSize;

  function sizeIcon(w, h) {
    var box = el("span", "size-ico");
    var r = w / h, bw = r >= 1 ? 30 : Math.max(8, 30 * r), bh = r >= 1 ? Math.max(8, 30 / r) : 30;
    var s = el("span", "size-box");
    s.style.width = bw + "px"; s.style.height = bh + "px";
    box.appendChild(s);
    return box;
  }

  var tplDocs = {};          // template id → design built once (thumbnails)
  function tplDoc(tpl) {
    if (!tplDocs[tpl.id]) tplDocs[tpl.id] = AX.fromTemplate(tpl, LANG, 1);
    return tplDocs[tpl.id];
  }
  AT.tplDoc = tplDoc;

  function renderHome() {
    // sizes
    var sizes = $("sizes");
    if (!sizes.childNodes.length) {
      AT.PRESETS.groups.forEach(function (g) {
        var sec = el("div", "size-group");
        sec.appendChild(el("h3", "size-h", LANG === "el" ? g[2] : g[1]));
        var row = el("div", "size-row");
        AT.PRESETS.list.filter(function (p) { return p[1] === g[0]; }).forEach(function (p) {
          var b = el("button", "size-card");
          b.type = "button";
          var sz = presetSize(p);
          b.appendChild(sizeIcon(sz.w, sz.h));
          var tx = el("span", "size-txt");
          tx.appendChild(el("span", "size-name", LANG === "el" ? p[3] : p[2]));
          tx.appendChild(el("span", "size-dim", p[4] + " × " + p[5] + " " + p[6]));
          b.appendChild(tx);
          b.addEventListener("click", function () {
            createDoc({ name: LANG === "el" ? p[3] : p[2], w: sz.w, h: sz.h, unit: p[6] });
          });
          row.appendChild(b);
        });
        sec.appendChild(row);
        sizes.appendChild(sec);
      });
    }
    // templates
    var tl = $("tpls");
    tl.innerHTML = "";
    AT.TEMPLATES.list.forEach(function (tpl) {
      var b = el("button", "tpl-card");
      b.type = "button";
      var th = el("span", "tpl-thumb");
      th.style.setProperty("--ratio", String(tpl.h / tpl.w));
      var url = thumbOf(tplDoc(tpl), 220, "tpl:" + tpl.id);
      if (url) { var img = el("img"); img.src = url; img.alt = ""; th.appendChild(img); }
      b.appendChild(th);
      b.appendChild(el("span", "tpl-name", LANG === "el" ? tpl.el : tpl.en));
      b.addEventListener("click", function () { addDoc(AX.fromTemplate(tpl, LANG, now())); });
      tl.appendChild(b);
    });
    // designs
    var host = $("docs");
    host.innerHTML = "";
    var q = ($("home-search").value || "").trim().toLocaleLowerCase();
    var docs = data.docs.slice().sort(function (a, b) { return M.maxM(b) - M.maxM(a) || M.cmpStr(a.id, b.id); });
    $("home-search").hidden = docs.length < 7;
    $("home-sub").textContent = docs.length === 1 ? t("home.count1") : docs.length ? t("home.count", { n: docs.length }) : "";
    $("home-empty").hidden = docs.length > 0;
    var shown = docs.filter(function (d) { return !q || docTitle(d).toLocaleLowerCase().indexOf(q) >= 0; });
    if (docs.length && !shown.length) host.appendChild(el("p", "hint", t("home.none")));
    shown.forEach(function (d) {
      var card = el("div", "doc-card");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      var th = el("div", "doc-thumb");
      th.style.setProperty("--ratio", String(Math.min(1.6, Math.max(0.4, d.setup.h / d.setup.w))));
      var url = thumbOf(d, 200, d.id + ":" + M.maxM(d) + ":" + d.items.length);
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
  AT.renderHome = renderHome;

  function cardMenu(d, anchor) {
    AT.menu(anchor, [
      { label: t("card.open"), fn: function () { openDoc(d.id); } },
      { label: t("card.rename"), fn: function () { renameDoc(d.id); } },
      { label: t("card.dup"), fn: function () { duplicateDoc(d.id); } },
      { label: t("card.pkg"), fn: function () { AT.io.exportPackage(d); } },
      { label: t("card.del"), danger: true, fn: function () { deleteDoc(d.id); } }
    ]);
  }

  function stampDoc(d, nowMs) { d.m = Math.max(nowMs, (d.m || 0) + 1); }

  function renameDoc(id) {
    var d = findDoc(id);
    if (!d) return;
    AT.prompt(t("dlg.rename"), docTitle(d), function (v) {
      v = String(v || "").trim().slice(0, 120);
      if (!v || v === d.name) return;
      if (AT.doc && AT.doc.id === id) {
        op(function (doc, nw) { doc.name = v; stampDoc(doc, nw); });
        $("ed-name").textContent = v;
      } else {
        d.name = v; stampDoc(d, now());
        save();
      }
      renderHome();
    });
  }
  AT.renameDoc = renameDoc;

  function duplicateDoc(id) {
    var d = findDoc(id);
    if (!d) return;
    var copy = JSON.parse(JSON.stringify(d));
    var nw = now();
    copy.id = M.newId("doc");
    copy.name = t("doc.copy", { name: docTitle(d) }).slice(0, 120);
    copy.m = nw;
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
    if (AT.prefs.doc === id) { AT.prefs.doc = null; savePrefs(); }
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
  function createDoc(opts) { addDoc(AX.newDesign(opts, now())); }
  AT.createDoc = createDoc; AT.addDoc = addDoc;

  function openDoc(id) {
    var d = findDoc(id);
    if (!d) return;
    AT.doc = d;
    undoStack = []; redoStack = []; gesture = null;
    AT.prefs.doc = id; savePrefs();
    $("home").hidden = true;
    $("editor").hidden = false;
    $("ed-name").textContent = docTitle(d);
    T.load(AT.draw.fontKeys(d)).then(function () { emit("fonts"); }, function () {});
    emit("open");
  }
  AT.openDoc = openDoc;

  function goHome() {
    AT.endGesture();
    emit("close");
    AT.doc = null;
    AT.prefs.doc = null; savePrefs();
    $("editor").hidden = true;
    $("home").hidden = false;
    renderHome();
  }
  AT.goHome = goHome;

  // ---------- Menus, popovers, dialogs ----------
  var menuClose = null;
  function place(m, anchor) {
    var r = anchor.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var x = Math.min(window.innerWidth - mw - 8, Math.max(8, r.left + r.width / 2 - mw / 2));
    var y = r.bottom + 6;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    m.style.left = x + "px"; m.style.top = y + "px";
  }
  function armClose(m) {
    setTimeout(function () {
      menuClose = function (e) {
        if (e.type === "keydown" && e.key !== "Escape") return;
        if (e.type !== "keydown" && m.contains(e.target)) return;
        closeMenu();
      };
      document.addEventListener("pointerdown", menuClose, true);
      document.addEventListener("keydown", menuClose, true);
    }, 0);
  }
  AT.menu = function (anchor, items) {
    closeMenu();
    var m = $("menu");
    m.innerHTML = "";
    m.className = "menu";
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
    place(m, anchor);
    var first = m.querySelector("button:not([disabled])");
    if (first) first.focus();
    armClose(m);
  };
  // A small panel next to a button (sliders, pickers).
  AT.popover = function (anchor, build) {
    closeMenu();
    var m = $("menu");
    m.innerHTML = "";
    m.className = "menu pop";
    build(m, closeMenu);
    m.hidden = false;
    place(m, anchor);
    armClose(m);
  };
  function closeMenu() {
    var m = $("menu");
    if (!m.hidden) { m.hidden = true; AT.endGesture(); }
    if (menuClose) {
      document.removeEventListener("pointerdown", menuClose, true);
      document.removeEventListener("keydown", menuClose, true);
      menuClose = null;
    }
  }
  AT.closeMenu = closeMenu;

  AT.openDialog = function (title, build, wide) {
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

  AT.prompt = function (title, value, done) {
    AT.openDialog(title, function (body, close) {
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

  AT.confirm = function (title, okLabel, done) {
    AT.openDialog(title, function (body, close) {
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var o = el("button", "btn primary", okLabel || t("btn.ok")); o.type = "button";
      c.addEventListener("click", close);
      o.addEventListener("click", function () { close(); done(); });
      act.appendChild(c); act.appendChild(o);
      body.appendChild(act);
    });
  };

  // Custom size: px for screens, mm for print.
  function customSize() {
    AT.openDialog(t("custom.title"), function (body, close) {
      var unit = "px";
      var seg = el("div", "seg");
      var row = el("div", "grid2");
      function fld(lbl, v) {
        var f = el("label", "fld");
        f.appendChild(el("span", "fld-lbl", lbl));
        var i = el("input", "inp num");
        i.type = "number"; i.inputMode = "decimal"; i.value = v;
        f.appendChild(i);
        row.appendChild(f);
        return i;
      }
      var w = fld(t("custom.w"), 1080), h = fld(t("custom.h"), 1080);
      var hint = el("p", "hint");
      function setUnit(u) {
        unit = u;
        [].forEach.call(seg.children, function (b) { b.classList.toggle("on", b.dataset.u === u); });
        var lim = AT.PRESETS.custom[u];
        hint.textContent = t("custom.range", { a: lim[0], b: lim[1], u: u });
        if (u === "mm") { w.value = 210; h.value = 297; } else { w.value = 1080; h.value = 1080; }
      }
      ["px", "mm"].forEach(function (u) {
        var b = el("button", "seg-btn", t("custom." + u));
        b.type = "button"; b.dataset.u = u;
        b.addEventListener("click", function () { setUnit(u); });
        seg.appendChild(b);
      });
      body.appendChild(seg); body.appendChild(row); body.appendChild(hint);
      setUnit("px");
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var o = el("button", "btn primary", t("btn.create")); o.type = "button";
      c.addEventListener("click", close);
      o.addEventListener("click", function () {
        var lim = AT.PRESETS.custom[unit];
        var wv = parseFloat(String(w.value).replace(",", ".")), hv = parseFloat(String(h.value).replace(",", "."));
        if (!(wv >= lim[0] && wv <= lim[1] && hv >= lim[0] && hv <= lim[1])) { hint.classList.add("warn"); return; }
        close();
        var mm = unit === "mm";
        createDoc({ name: t("doc.untitled"), w: mm ? M.fromUnit(wv, "mm") : wv, h: mm ? M.fromUnit(hv, "mm") : hv, unit: unit });
      });
      act.appendChild(c); act.appendChild(o);
      body.appendChild(act);
    });
  }

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
    api.registerSlice("atelier", sliceGet, sliceSet, STORAGE_KEY, M.mergeData);
  }

  function sliceGet() { return M.normData(data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.docs)) return;
    var before = JSON.stringify(data);
    var openId = AT.doc ? AT.doc.id : null;
    var openBefore = AT.doc ? JSON.stringify(AT.doc) : null;
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
      AT.doc = d;
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
    $("btn-custom").addEventListener("click", customSize);
    $("btn-import").addEventListener("click", function () {
      if (!AT.canva) { AT.io.importAny(); return; }
      AT.menu($("btn-import"), [
        { label: t("imp.file"), fn: AT.io.importAny },
        { label: t("imp.canva"), fn: AT.canva.open }
      ]);
    });
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
      if (document.visibilityState === "hidden") { AT.endGesture(); AT.flush(); }
    });
    window.addEventListener("pagehide", function () { AT.endGesture(); AT.flush(); });
    A.onChange(function () { thumbs = {}; if (!AT.doc) renderHome(); });
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
      if (AT.prefs.doc && findDoc(AT.prefs.doc)) openDoc(AT.prefs.doc);
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
  // Opens the design (leaving the one that is open through Home, so a
  // gesture in progress ends). Unknown id → no-op; nothing happens
  // while a dialog is open. Before the fonts are in, it waits.
  var searchReady = false, searchLater = null;
  function openSearchTarget(tg) {
    if (!searchReady) { searchLater = tg; return; }
    var id = tg && typeof tg.doc === "string" ? tg.doc : null;
    if (!id || !findDoc(id)) return;
    if (document.querySelector("dialog[open]")) return;
    if (AT.doc && AT.doc.id === id) return;
    if (AT.doc) goHome();
    openDoc(id);
  }
  window.__orosOpenAt = openSearchTarget;
  function takeSearchTarget() {
    searchReady = true;
    if (searchLater) { var later = searchLater; searchLater = null; openSearchTarget(later); return; }
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("atelier");
        if (pending) openSearchTarget(pending);
      }
    } catch (e) {}
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
