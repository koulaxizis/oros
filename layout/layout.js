// ============================================================
// orOS Layout — core (v1.3.0)
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
//   - documents: one file each in /internal/Layout ("<name> · <id>
//     .oroslayout", a JSON package), synced per file by Vault Drive
//     (designkit/docstore.js, LY-DISK, section 3b); without the orOS
//     disk they stay in oros-layout-data as before
//   - synced slice "layout" (oros-layout-data): LAYOUT v1, see
//     designkit/model.js (per-entity LWW + tombstones, canonical); with
//     the disk only the old devices' copy (merged in, never grown)
//   - device-local: oros-layout-index (the documents' list for search
//     and the Assistant), oros-layout-open (the open document, merged
//     back at the next start)
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
  LY.P = DK.pdf; LY.A = DK.assets; LY.F = DK.fonts;
  T.setFetcher(LY.F.fetcher);

  var STORAGE_KEY = "oros-layout-data";
  var PREFS_KEY   = "oros-layout-prefs";
  var UNDO_MAX    = 100;
  var DOC_WARN    = 400 * 1024;
  LY.STORAGE_KEY = STORAGE_KEY;

  // ---------- 1. Constants, i18n ----------
  // orosI18n (../i18n.js): the full language code, a pack language
  // (e.g. "de") included; the old en/el reading is the fallback.
  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
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
      "home.pages": "{n} pages", "home.pages1": "1 page", "unk.item": "Needs a newer orOS", "unk.doc": "This document needs a newer orOS. Update orOS to open it.", "home.none": "No document matches.",
      "doc.untitled": "Untitled", "doc.copy": "{name} (copy)",
      "card.open": "Open", "card.rename": "Rename", "card.dup": "Duplicate", "card.pkg": "Save as package", "card.del": "Delete",
      "ed.back": "Documents", "ed.undo": "Undo", "ed.redo": "Redo", "ed.zin": "Zoom in", "ed.zout": "Zoom out",
      "zoom.title": "Zoom", "zoom.page": "Fit page", "zoom.spread": "Fit spread", "ruler.hint": "Drag from a ruler to add a guide; drag a guide back onto the ruler to remove it.", "ed.preview": "Preview (hide guides and frames)", "ed.panel": "Panels", "ed.more": "More",
      "ed.export": "Export", "ed.rename": "Rename document",
      "more.merge": "Data merge (CSV)…", "exp.merge": "Data merge", "exp.mergeNote": "Many cards, labels or badges from a CSV file, as one PDF.",
      "props.mf": "Data field (merge)", "props.mfEg": "e.g. Photo", "props.mfHint": "The CSV column with this frame's picture file name.",
      "mg.title": "Data merge", "mg.hint": "Type {{Field}} in a text frame where a value goes: Field is a column name from the first row of the CSV file. Each row makes one card.",
      "mg.file": "Choose CSV file…", "mg.other": "Another file…", "mg.rows": "{name}: {n} rows", "mg.cut": "Only the first {n} rows are used.",
      "mg.bad": "This file has no rows to merge.", "mg.big": "The file is too large (at most 5 MB).",
      "mg.fields": "Fields", "mg.noFields": "No fields yet: type {{Field}} in a text frame, or give an image frame a data field.",
      "mg.missing": "not in the file", "mg.ok": "found", "mg.img": "picture",
      "mg.pages": "Each card", "mg.pg.cur": "This page", "mg.pg.all": "All pages",
      "mg.mode": "Output", "mg.one": "One per page", "mg.nup": "Several per sheet", "mg.sheet": "Sheet", "mg.gap": "Gap (mm)",
      "mg.per": "{n} per sheet · {s} sheets", "mg.per1": "{n} per sheet · 1 sheet", "mg.none": "The card does not fit on this sheet.", "mg.nupPage": "Several per sheet uses this page only.",
      "mg.pics": "Pictures", "mg.folder": "Folder on the orOS disk", "mg.device": "Add pictures from this device…",
      "mg.found": "Found {f} of {n} pictures.", "mg.looking": "Looking for pictures…",
      "mg.preview": "Preview", "mg.rec": "Row {i} of {n}", "mg.prev": "Previous row", "mg.next": "Next row",
      "mg.go": "Create PDF", "mg.working": "Making page {i} of {n}…", "mg.done": "PDF ready: {n} pages.",
      "mg.lost": "{n} pictures were not found: their frames stay empty.", "mg.need": "Choose a CSV file first.",
      "mg.letter": "Letter", "mg.over": "Some text does not fit its frame in this row.", "mg.overN": "Text does not fit its frame in {n} places.",
      "more.setup": "Document setup…", "more.compare": "Compare with a PDF…", "imp.port": "Port a folder of books (Scribus, InDesign)…", "port.title": "Port a folder of books", "port.none": "No Scribus or InDesign files in this folder.", "port.found": "{n} book files found, {p} of them with a PDF to compare with.", "port.more": "{n} more files were left out: port them from a smaller folder.", "port.hint": "Each file opens as a new document with the pictures of its own folder. Nothing in the folder changes.", "port.pics": "{n} pictures", "port.noPdf": "no PDF", "port.cmp": "Compare each book with its PDF", "port.go": "Port", "port.working": "Porting {i} of {n}: {f}…", "port.comparing": "Comparing {f} with its PDF…", "port.stop": "Stop", "port.done": "{n} books ported, {c} compared with their PDF.", "port.stopped": "Stopped after {n} of {t} files.", "port.avg": "On average {p} % of the pixels differ from the PDFs.", "port.row": "{p} pages · {m} pictures missing", "port.diff": "{p} % different, {o} pages over 2 %", "port.noCmp": "not compared", "port.shift": "The PDF has {n} pages more at the start; they were left out of the comparison.", "port.fail": "could not be opened", "port.open": "Open", "port.csv": "Save the report (CSV)…", "port.csvName": "Port report", "port.csvHead": "Book|File|Pages|Objects|Missing pictures|PDF|PDF pages before ours|Different % (mean)|Pages over 2 %|Most different page|Its %|Note", "cmp.title": "Compare with a PDF", "cmp.working": "Comparing the pages…", "cmp.fail": "The PDF could not be compared.", "cmp.sum": "{f}: {n} pages compared, {p} % of the pixels differ on average.", "cmp.count": "The PDF has {a} pages and the document {b}; the pages are compared in order, as many as both have.", "cmp.over": "{n} pages differ by more than 2 %. They are first below.", "cmp.over1": "One page differs by more than 2 %. It is first below.", "cmp.allOk": "No page differs by more than 2 %.", "cmp.hint": "Each page is cut to its trim and compared pixel by pixel at 50 dpi, softened by a pixel: the PDF's page, this document's, and the differences in red. A different font, a moved line or a picture of another size shows as red; the same letters a hair apart do not count.", "cmp.theirs": "The PDF's page", "cmp.ours": "This document's page", "cmp.diff": "Differences in red", "more.pkg": "Save as package (.oroslayout)", "more.text": "Place text or a document (Word, .odt, .txt)…",
      "more.story": "Story Editor", "more.selall": "Select all on this page", "more.rec": "Recovered text ({n})",
      "tool.select": "Select (V)", "tool.text": "Text frame (T)", "tool.image": "Image frame (F)",
      "tool.rect": "Rectangle (R)", "tool.ell": "Ellipse (E)", "tool.line": "Line (L)", "tool.hand": "Hand (H, or hold Space). Double-click: fit the spread",
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
      "props.path": "Shape", "props.grad": "Gradient", "props.grad.l": "Linear", "props.grad.r": "Radial", "props.grad.from": "Start colour", "props.grad.to": "End colour", "props.grad.ang": "Angle (°)",
      "props.text": "Text frame", "props.cols": "Columns", "props.gut": "Gutter", "props.ins": "Inset",
      "props.va": "Vertical align", "props.va.t": "Top", "props.va.c": "Centre", "props.va.b": "Bottom",
      "props.edit": "Edit text", "props.threadNext": "Continue in a new frame", "props.autoflow": "Autoflow: add pages until it fits",
      "props.unthread": "Break thread after this frame", "props.chain": "Frame {i} of {n} in this story",
      "props.image": "Image", "props.place": "Place image…", "props.replace": "Replace image…",
      "props.fit": "Fit", "props.fillf": "Fill", "props.scale": "Scale", "props.offx": "Offset X", "props.offy": "Offset Y",
      "props.ppi": "{n} ppi effective", "props.ppiLow": "{n} ppi: low for print", "props.missing": "Image file not on this device yet",
      "props.wrap": "Text wrap", "props.wrap.none": "None", "props.wrap.box": "Box", "props.wrap.ell": "Ellipse", "pp.menu": "Place a page of a PDF, Scribus or InDesign file…", "pp.title": "Which page?", "pp.which": "{f} has {n} pages. Which one goes in the frame?", "pp.page": "Page", "pp.place": "Place", "pp.working": "Reading the file…", "pp.done": "Page {p} of {f} placed.", "pp.bad": "This file could not be read. Pick a PDF, a Scribus .sla or an InDesign .idml file.", "pp.af": "Affinity pages cannot be drawn here. Export the page as a PDF from Affinity and place that.", "pp.from": "Page {p} of {f}", "anc.add": "Anchor in the text", "anc.on": "Anchored in the text: it moves with the text. If its place in the text is deleted, it stays where it is.", "anc.off": "Free from the text", "props.wc": "Wrap by", "props.wc.box": "Frame", "props.wc.shape": "Outline", "props.wc.alpha": "Transparent edges", "props.wc.opaque": "This picture has no transparent edges, so the text goes around its frame.", "props.wo": "Offset",
      "props.arrange": "Arrange", "props.front": "Bring to front", "props.fwd": "Bring forward", "props.bwd": "Send backward", "props.back": "Send to back",
      "props.align": "Align", "props.alignTo": "to margins", "props.alignSel": "to selection",
      "props.al": "Align left", "props.ac": "Align centre", "props.ar": "Align right",
      "props.at": "Align top", "props.am": "Align middle", "props.ab": "Align bottom",
      "props.dh": "Distribute horizontally", "props.dv": "Distribute vertically",
      "props.lock": "Lock position", "props.hide": "Hide", "hide.done": "Hidden. Show it again from the page panel (nothing selected).", "hide.show": "Show hidden objects ({n})", "props.group": "Group", "props.ungroup": "Ungroup",
      "props.dup": "Duplicate", "props.del": "Delete", "props.multi": "{n} objects",
      "bl.title": "Blend", "bl.steps": "Steps", "bl.make": "Blend", "bl.update": "Update", "bl.release": "Release",
      "bl.hint": "Shapes in even steps from one shape to the other: place, size, outline and colours. Changed one of the two? Press Update.",
      "bl.gone": "One of the two shapes of this blend is gone. Release keeps the steps as plain shapes.",
      "bl.made": "{n} steps added", "bl.released": "The steps are now plain shapes", "bl.full": "This document has too many objects for a blend.",
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
      "sty.b": "Bold", "sty.i": "Italic", "sty.u": "Underline", "sty.caps": "All caps", "sty.bul": "Bullet", "sty.kern": "Kerning", "sty.book": "Book typesetting", "sty.hyph": "Hyphenate Greek", "sty.kwn": "Keep with next", "sty.sec": "Running head title", "sty.orph": "Fewest lines before a column break", "sty.wid": "Fewest lines after a column break", "sty.brk": "Start", "sty.brkAny": "Anywhere", "sty.brkCol": "In the next column", "sty.brkPage": "On a new page", "sty.brkOdd": "On an odd page", "sty.brkEven": "On an even page", "sty.sink": "Sunk from the top of the page", "sty.nest": "Nested style from the start", "sty.nestNone": "None", "sty.nestTo": "Up to and including", "styles.play": "Styles for a play", "pages.secNew": "Start a section here…", "pages.secEdit": "Section…", "pages.secTitle": "Section", "pages.secStart": "Start at", "pages.secGoOn": "goes on", "pages.secStyle": "Numbers", "pages.secPrefix": "Prefix", "pages.secRemove": "Remove section", "pages.baseMaster": "Based on master…", "pages.baseNone": "None", "props.flipH": "Mirror left to right", "props.flipV": "Mirror top to bottom", "props.frameToPic": "Frame to picture", "adj.title": "Colour corrections", "adj.gray": "Black and white", "adj.bcT": "Brightness and contrast", "adj.b": "Brightness", "adj.c": "Contrast", "adj.hslT": "Hue, saturation, lightness", "adj.h": "Hue", "adj.s": "Saturation", "adj.l": "Lightness", "adj.levels": "Levels", "adj.ib": "Black point", "adj.iw": "White point", "adj.g": "Gamma", "adj.ob": "Output black", "adj.ow": "Output white", "adj.curves": "Curves", "adj.cs": "Shadows", "adj.cm": "Midtones", "adj.ch": "Highlights", "adj.balance": "Colour balance (midtones)", "adj.r": "Red", "adj.gr": "Green", "adj.bl": "Blue", "adj.off": "Remove the corrections", "adj.noLib": "The corrections cannot be shown here. Reload Layout.", "more.links": "Links (pictures)…", "links.title": "Links", "links.sum": "{n} pictures, {m} missing or empty.", "links.none": "This document has no pictures.", "links.noName": "(no name)", "links.page": "page {n}", "links.go": "Go to", "links.s.ok": "OK", "links.s.missing": "file missing", "links.s.empty": "empty frame", "links.s.low": "low resolution", "links.s.small": "smaller than in Scribus", "links.smallHint": "{n} pictures came from Scribus files opened before version 7.96.01 and are drawn smaller than in Scribus. Use Find pictures… with the original pictures to place them at their size.", "links.local": "embedded (from a local folder)", "pages.size": "Page size…", "pages.sizeOwn": "Page size (own)…", "pages.sizeTitle": "Page size", "pages.sizePages": "Pages", "pages.sizeDoc": "Document size", "pages.sizeBad": "The size must be between 13 mm and 5 m.", "exp.creep": "Creep in mm (saddle stitch)", "styles.playDone": "{n} play styles added.", "styles.playHave": "This document already has the play styles.",
      "sty.sb": "Space before", "sty.sa": "Space after", "sty.fi": "First-line indent", "sty.li": "Left indent", "sty.ri": "Right indent",
      "sty.track": "Tracking (1/1000 em)", "sty.color": "Colour", "sty.inherit": "As base",
      "font.sans": "Noto Sans", "font.serif": "Noto Serif", "font.mono": "Noto Sans Mono",
      "fp.more": "Other fonts…", "fp.cols": "Collections", "fp.docCol": "This document's collection (listed first)", "fp.docCol.none": "None", "fp.notHere": "not on this device yet", "fp.title": "Fonts", "fp.mine": "On this device", "fp.loading": "Loading…", "fp.add": "Add a font file…", "fp.addHint": "TTF, OTF, WOFF or WOFF2. The file is kept in Files › Fonts and syncs like any file; the documents that use it name it.", "fp.none": "No font files yet.", "fp.free": "Free fonts (Fontsource)", "fp.search": "Search fonts", "fp.greek": "Only fonts with Greek", "fp.offline": "The list of free fonts needs a connection the first time.", "fp.noMatch": "No font matches.", "fp.hasGreek": "Greek", "fp.moreHits": "{n} more: type more of the name.", "fp.v.r": "regular", "fp.v.b": "bold", "fp.v.i": "italic", "fp.v.bi": "bold italic", "fp.err.size": "That file is too big for a font (15 MB at most).", "fp.err.type": "That is not a font file Layout can read (TTF, OTF, WOFF or WOFF2).", "fp.err.outlines": "This font has PostScript (CFF) outlines, which PDF export cannot embed yet. Use its TTF version.", "fp.err.restricted": "The font's licence does not allow embedding it in documents.", "fp.err.disk": "The font could not be saved on the orOS disk.", "fp.added": "“{name}” added.",
      "colors.title": "Swatches", "colors.new": "New swatch", "colors.edit": "Edit swatch", "colors.del": "Delete swatch",
      "colors.mode": "Mode", "colors.rgb": "RGB", "colors.cmyk": "CMYK", "colors.hex": "Hex",
      "colors.keep": "Black and Paper cannot be deleted.", "colors.used": "Objects using it switch to Black.",
      "colors.note": "CMYK is shown on screen with a simple conversion (no colour profile); the PDF gets the exact CMYK values.",
      "cov.title": "Book cover", "cov.btn": "Book cover…", "cov.docName": "Cover: {title}",
      "cov.intro": "Back cover, spine and front cover on one page, with bleed, fold guides and the ISBN barcode. Ask your printer for the spine width: their figure is the one to use.",
      "cov.f.title": "Title", "cov.f.sub": "Subtitle", "cov.f.author": "Author", "cov.f.size": "Trim size", "cov.f.w": "Width (mm)", "cov.f.h": "Height (mm)",
      "cov.f.pages": "Pages", "cov.f.paper": "Paper", "cov.f.spine": "Spine (mm)", "cov.f.flap": "Flaps (mm, 0 = none)", "cov.f.bleed": "Bleed (mm)",
      "cov.f.blurb": "Back cover text", "cov.f.isbn": "ISBN", "cov.f.price": "Price (optional)", "cov.f.imprint": "Publisher", "cov.f.pic": "Front picture",
      "cov.pickPic": "Choose picture…", "cov.noPic": "None (a coloured cover; place one later)", "cov.f.logo": "Publisher logo", "cov.noLogo": "None",
      "cov.spineHint": "Spine: {mm} mm. Estimated from the pages and the paper; type the printer's figure to override it.",
      "cov.badSize": "The trim size must be between 50 and 500 mm wide and 50 and 700 mm high.", "cov.badIsbn": "This ISBN is not valid (check digit).",
      "cov.p.u70": "Uncoated 70 g/m²", "cov.p.u80": "Uncoated 80 g/m²", "cov.p.u90": "Uncoated 90 g/m²", "cov.p.u100": "Uncoated 100 g/m²",
      "cov.p.bulk80": "Bulky (book wove) 80 g/m²", "cov.p.bulk90": "Bulky (book wove) 90 g/m²",
      "cov.p.c115": "Coated 115 g/m²", "cov.p.c135": "Coated 135 g/m²", "cov.p.c150": "Coated 150 g/m²",
      "new.title": "New document", "new.from": "Start from", "new.blank": "Blank", "new.name": "Name", "new.size": "Page size", "new.custom": "Custom",
      "new.orient": "Orientation", "new.portrait": "Portrait", "new.landscape": "Landscape", "new.pages": "Pages",
      "new.facing": "Facing pages (spreads)", "new.pnStart": "First page number", "new.margins": "Margins", "new.cols": "Columns", "new.gut": "Gutter",
      "new.bleed": "Bleed", "new.unit": "Units", "new.top": "Top", "new.bottom": "Bottom", "new.inside": "Inside",
      "new.outside": "Outside", "new.left": "Left", "new.right": "Right", "new.w": "Width", "new.h": "Height",
      "setup.title": "Document setup", "setup.note": "Objects keep their place when the page size changes.",
      "preset.a4": "A4", "preset.a5": "A5", "preset.a3": "A3", "preset.a6": "A6", "preset.b5": "B5",
      "preset.letter": "US Letter", "preset.legal": "US Legal", "preset.card": "Business card", "preset.dl": "DL flyer",
      "preset.square": "Square post", "preset.poster": "Poster 50×70", "preset.bk120x190": "Book 120×190", "preset.bk140x210": "Book 140×210", "preset.bk170x240": "Book 170×240", "preset.bk180x250": "Book 180×250", "preset.bk215x215": "Square book 215×215", "preset.custom": "Custom",
      "unit.mm": "mm", "unit.pt": "pt", "unit.in": "in",
      "exp.title": "Export", "exp.img": "Image (PNG / JPG / SVG)", "svg.copy": "Copy as SVG", "svg.save": "Download as SVG", "svg.copied": "Copied as SVG. Paste it into a vector app or a text file.", "svg.noClip": "Copying did not work here. Use Download as SVG.", "svg.none": "Nothing here can go into an SVG.", "exp.page": "Page", "exp.format": "Format", "exp.res": "Resolution", "exp.imgGo": "Export image", "exp.capped": "Exported at {n} dpi (16 megapixel limit)", "exp.x4": "PDF/X-4 (300 ppi)", "exp.cmyk": "Colours in CMYK (Coated FOGRA39)", "exp.cmykHint": "Text, lines and shapes in the printer's CMYK, black and greys in black ink alone. Photos keep their sRGB profile; the printer converts them, as PDF/X-4 allows.", "exp.x4Bad": "Exported, but {n} PDF/X-4 checks failed. Open Preflight before you send it.", "exp.pdf": "PDF", "exp.pkg": "Package", "exp.range": "Pages", "exp.all": "All",
      "exp.cur": "Current page", "exp.custom": "Range", "exp.rangeHint": "e.g. 1-3, 5",
      "exp.spreads": "Spreads", "exp.bleed": "Include bleed", "exp.marks": "Crop marks",
      "out.title": "Editions", "out.go": "Export", "out.edit": "Edit editions…", "out.editTitle": "Editions of this document", "out.k.print": "Print PDF", "out.k.ebook": "E-book PDF", "out.k.epub": "EPUB", "out.pages": "{n} pages", "out.noIsbn": "no ISBN for this format in Publishing", "out.withCover": "with the cover", "out.pubOf": "ISBNs and prices come from the Publishing title “{t}”.", "out.noPub": "Link this document to a Publishing title (Document setup) and each edition takes its own ISBN.", "out.name": "Name", "out.kind": "Form", "out.fmt": "Publishing format", "out.fmtAuto": "Automatic", "out.fmtK.pb": "Paperback", "out.fmtK.hb": "Hardback", "out.fmtK.eb": "E-book", "out.fmtK.ab": "Audiobook", "out.fmtK.ot": "Other", "out.blank": "Leave out empty pages", "out.toc": "Leave out the contents pages", "out.drop": "Pages to leave out", "out.cover": "Cover (first page)", "out.coverNone": "None", "out.coverHint": "Make one with New document › Book cover; its front becomes the e-book's first page.", "out.remove": "Remove", "out.add": "Add an edition", "out.reset": "Defaults", "out.noPages": "No pages are left for this edition.", "out.doneIsbn": "Exported with ISBN {isbn}", "new.lang": "Language of the text", "new.langAuto": "Not set", "new.pub": "Publishing title", "new.pubNone": "None", "new.pubGone": "(a title that is no longer there)", "sty.lvl": "Heading level (e-book contents)", "sty.lvlAuto": "Automatic ({n})", "sty.lvl0": "Not a heading", "sty.lvlN": "Level {n}", "props.alt": "Description (alt text)", "props.altEg": "What the picture shows, for readers who cannot see it", "props.deco": "Decorative (no description needed)",
      "more.epubCheck": "Check an EPUB…", "ep.fonts": "Fonts inside the book", "ep.fx": "Layout", "ep.fx0": "Reflowable (text the reader can resize)", "ep.fx1": "Fixed: pages as in print, text as text", "ep.fx2": "Fixed: pages as pictures", "ep.fx1s": "fixed layout", "ep.fx2s": "fixed layout, page pictures", "ep.sumFx": "{p} pages, {h} headings, {i} pictures", "ep.rotated": "{n} rotated text frames stay part of the page picture", "ep.fixedNote": "Fixed layout: readers show each page as in print; good for picture books and comics, less so for novels", "ep.pageList": "Print page numbers (page-list)", "ep.noFonts": "without fonts (the reader's own)", "ep.fail": "The EPUB could not be made.", "ep.noDisk": "The orOS disk is not reachable from here.", "ep.savedAt": "Saved as {path}", "ep.tooBig": "That file is too large to check (300 MB at most).", "ep.title": "EPUB", "ep.working": "Making the EPUB…", "ep.checkTitle": "Check of {name}", "ep.errors": "{n} problems: e-book stores would refuse this file.", "ep.okWarn": "No errors, {n} things to look at.", "ep.okWarn1": "No errors, 1 thing to look at.", "ep.errors1": "1 problem: e-book stores would refuse this file.", "ep.s.badIsbn": "The e-book ISBN in Publishing has a wrong check digit: fix it there", "ep.ok": "No errors or warnings.", "ep.orosCheck": "This is orOS's own check of the rules most often broken, not the official EPUBCheck.", "ep.sum": "{c} chapters, {h} headings, {i} pictures, {p} print pages", "ep.noIsbn": "no e-book ISBN (a stable id instead)", "ep.noAlt": "Picture on page {n} has no description (alt text)", "ep.overset": "{n} paragraphs left out: they do not fit their frames in print either", "ep.shapes": "{n} shapes and lines left out (they are decoration in print)", "ep.fontMissing": "{name}: not inside (the font file is not on this device)", "ep.fontObf": "{name}: inside, obfuscated (your own font, not an open licence)", "ep.store": "What e-book stores usually ask for", "ep.s.cover": "Cover picture", "ep.s.coverSmall": "Cover picture smaller than 1600 px high", "ep.s.noCover": "No cover: pick a Book cover in Edit editions, or add a cover in Publishing", "ep.s.isbn": "E-book ISBN", "ep.s.noIsbn": "No e-book ISBN: give the e-book format one in Publishing", "ep.s.toc": "Contents from the headings", "ep.s.noToc": "No headings: set a heading level on the chapter style", "ep.s.lang": "Language: {l}", "ep.s.noLang": "No language: set it in Document setup", "ep.s.a11y": "Every picture has a description or is decorative", "ep.s.noA11y": "{n} pictures without a description", "ep.s.meta": "Title, people and description from Publishing", "ep.s.metaPart": "Publishing has no people or description for this title", "ep.s.noPub": "Not linked to a Publishing title (Document setup)", "ep.preview": "Preview in Library", "ep.markPub": "Mark ready in Publishing", "ep.save": "Save EPUB", "ep.noPub": "Publishing could not be opened from here.", "ep.noDoc": "No Layout document is linked to this title yet: link one in Document setup › Publishing title.", "ep.c.zip": "Not a ZIP file", "ep.c.mime": "The mimetype file must come first, uncompressed", "ep.c.container": "META-INF/container.xml is missing or names no package file", "ep.c.opf": "The package file cannot be read", "ep.c.xml": "Not well-formed XML", "ep.c.meta-title": "No title", "ep.c.meta-lang": "No language", "ep.c.meta-id": "No unique identifier", "ep.c.meta-mod": "No valid last-modified date (dcterms:modified)", "ep.c.isbn": "The ISBN's check digit is wrong", "ep.c.man-id": "A file id is missing or used twice", "ep.c.man-missing": "A listed file is missing", "ep.c.man-type": "Wrong file type in the list", "ep.c.man-extra": "A file that is not listed", "ep.c.spine": "The reading order names a file that is not listed", "ep.c.spine-type": "The reading order holds a file that is not a page", "ep.c.nav": "There must be exactly one navigation file", "ep.c.nav-toc": "The navigation has no contents", "ep.c.cover": "More than one cover picture, or a cover that is not a picture", "ep.c.link": "A link goes to a file that is not in the book", "ep.c.frag": "A link goes to a place that is not there", "ep.c.id-dup": "The same id twice in a page", "ep.c.svg-prop": "A page with SVG must say so (svg property)", "ep.c.remote": "A file from the internet (books must carry their files)", "ep.c.script": "A page with a script must say so (scripted)", "ep.c.fxl-vp": "A fixed-layout page has no viewport size", "ep.c.enc": "encryption.xml names a file that is not there", "ep.c.no-cover": "No cover picture", "ep.c.no-alt": "A picture without a description", "ep.c.big-file": "A page over 300 KB (split the chapter)", "ep.c.big-img": "A picture over 4 megapixels", "ep.c.big-book": "The book is over 100 MB", "ep.c.no-a11y": "No accessibility metadata",
      "exp.quality": "Images", "exp.print": "Print (300 ppi)", "exp.screen": "Screen (150 ppi)",
      "exp.go": "Export PDF", "exp.send": "Send the PDF to an app…", "exp.sentAt": "PDF saved in Files › {path}", "exp.working": "Building the PDF…", "exp.done": "PDF saved", "exp.fail": "The PDF could not be built.",
      "exp.badRange": "That page range is not valid.", "exp.pkgDone": "Package saved", "exp.pkgNote": "One file with the document and its images, to back up or open on another device.",
      "imp.done": "Document opened", "imp.file": "Files (.oroslayout or a .zip of them, .sla with its pictures and PDF, .idml, .pdf, .svg)…", "imp.disk": "A folder in Files (all its packages)…", "imp.diskTitle": "Open a folder from Files", "imp.diskUp": "Up", "imp.diskGo": "Open", "imp.diskLooking": "Looking for documents…", "imp.diskFound": "Documents (.oroslayout) here and in the folders inside: {n}", "imp.diskNone": "No documents (.oroslayout) here or in the folders inside.", "imp.manyWorking": "Opening the documents…", "imp.many": "Documents opened: {n}", "imp.manyBad": "Documents opened: {n}. Files that could not be opened: {bad}", "imp.full": "Storage is full. Documents opened: {n}; the rest did not fit. Delete documents you no longer need, then open the rest.", "imp.folder": "A folder: unzipped package or Scribus output…", "imp.newer": "This file was made by a newer orOS. Update orOS to open it.", "pdf.start": "Opening the PDF…", "pdf.working": "Reading the PDF… page {n} of {t}", "pdf.bad": "This PDF could not be opened.", "pdf.done": "PDF opened: {p} pages, {n} text frames, {i} pictures. Drawings and backgrounds are one locked picture per page, behind everything.", "pdf.cut": "Only the first {n} of {t} pages were opened.",
      "imp.rebuild": "Rebuild a print PDF (with its pictures)…", "rb.noPdf": "Pick the PDF too: the print PDF, with its pictures and texts if you have them.", "rb.bad": "This PDF could not be rebuilt.", "rb.start": "Rebuilding the PDF with {n} original files…", "rb.working": "Rebuilding… page {n} of {t}", "rb.stopped": "Rebuilding stopped. Nothing was added.", "rb.done": "Rebuilt: {p} pages.",
      "rb.title": "What the rebuild kept", "ocr.menu": "Text from the picture (OCR)…", "ocr.title": "Text from the picture", "ocr.ask": "Layout reads the text with the same recognition as Files and Scanner & PDF (Greek and English). The first time it downloads the engine once; the picture never leaves this device.", "ocr.yes": "Download and read", "ocr.working": "Reading the text of the picture…", "ocr.fail": "The text could not be read.", "ocr.offline": "The recognition engine could not be downloaded. Connect to the internet once and try again.", "ocr.none": "No text found in the picture.", "ocr.found": "{n} lines in {f} blocks of text.", "ocr.hidden": "Hidden, so the page looks as it does now", "ocr.hint": "Each block becomes a text frame where it is in the picture, with a style of its size. Hidden frames come back with Show hidden objects in Properties.", "ocr.copy": "Copy the text", "ocr.place": "Place as text frames", "ocr.copied": "Text copied.", "ocr.noClip": "Copying did not work here.", "ocr.style": "From the picture", "ocr.placed": "{n} text frames from the picture.", "ocr.placedHidden": "{n} hidden text frames from the picture.", "rb.drawn": "On these pages the text came as shapes (InDesign often outlines it), so it is part of the page's picture. Read it as text:", "rb.ocrPage": "Page {n}", "rb.lines": "{n} of {t} lines are where they were in the PDF ({p} %).", "rb.pics": "{n} pictures, {o} of them your original files (the rest come from the PDF).", "rb.gray": "{n} of your original pictures are in colour but the PDF prints them grey, so they are grey here too.", "rb.styles": "{n} paragraph styles.", "rb.frames": "Text frames", "rb.perPage": "Per page", "rb.thread": "Going on across pages", "rb.perPageHint": "Every page keeps its own text frames, so every line stays exactly where it was in the PDF.", "rb.threadHint": "An article's text goes on from frame to frame across the pages, so edits flow on. If one line comes out longer, the lines after it move too.", "rb.go": "Rebuild", "rb.threads": "{n} articles go on across pages, through {f} more frames.", "rb.af": "From the Affinity file: {n} original pictures and its words, for the hyphenated line ends.", "rb.afStyles": "Its styles: {s}.", "rb.afFonts": "Its fonts: {f}.", "rb.afBad": "The Affinity file could not be read, so the rebuild used the PDF alone.", "rb.fonts": "Fonts replaced with orOS fonts, with tracking that keeps each line as wide: {f}.", "rb.fontsSame": "The PDF's own fonts, from your font files or free fonts: {f}.", "rb.fontsTwin": "Free fonts with the same letter widths, in place of fonts that are not free: {f}.", "rb.numbers": "Page numbers start at {n}: they are page-number fields, so they follow when pages move. Change the first number in Document setup.", "rb.off": "Pages where lines moved. Check them before you print:", "rb.offLine": "{n} lines", "rb.back": "Back to the Assistant", "rb.noPage": "This document has no page {n}.",
      "idml.working": "Reading the InDesign file…", "idml.bad": "This file could not be read as an InDesign (.idml) document.", "idml.done": "InDesign document imported: {p} pages, {n} objects.",
      "sla.working": "Reading the Scribus file…", "sla.bad": "This file could not be read as a Scribus document.", "sla.done": "Scribus document imported: {p} pages, {n} objects.", "sla.linked": "{n} images were not inside the file: put them back with Place image.", "sla.find": "Find pictures…", "sla.fitting": "Lining up the lines with the PDF…", "sla.fit": "Line breaks as in the PDF: {n} of {t} lines.", "sla.fitBad": "The PDF's text did not match this file, so the lines break on their own.", "sla.fitStyle": "Line fit", "sla.relinked": "{n} pictures placed.", "sla.skipped": "{n} objects (mesh or pattern fills, render frames) became simple boxes, lost their special fill or were left out.", "idml.skipped": "{n} objects (buttons and other interactive objects) were left out.", "idml.tables": "{n} tables became rows of text set at tab stops on their columns (without borders).", "idml.notes": "{n} footnotes went after the end of their text.", "svg.working": "Reading the SVG files…", "svg.bad": "These files could not be read as SVG pages.", "svg.done": "SVG imported: {p} pages, {n} objects.", "svg.skipped": "{n} things (pattern fills, text on a path and other effects) were left out or simplified.", "imp.bad": "This file is not a Layout package.", "imp.imgFail": "{n} images could not be restored.", "imp.fontFail": "Document opened. {n} font files could not be restored: their text shows in a stand-in font.",
      "img.fail": "This file could not be read as an image.", "img.nofs": "The orOS disk is not available on this device.",
      "img.placed": "Image placed", "img.missing": "Syncing…", "img.sent": "Picture placed on the page",
      "txt.fail": "This file could not be read as text.", "txt.done": "Text imported",
      "wd.title": "Paragraph styles for the text", "wd.hint": "Each kind of paragraph in the file takes the style you choose here. The choice is kept with the document for the next time.",
      "wd.go": "Place", "wd.done": "Text placed: {n} paragraphs",
      "wd.h1": "Heading 1", "wd.h2": "Heading 2", "wd.h3": "Heading 3 and smaller", "wd.p1": "First paragraph after a heading or a blank line",
      "wd.p": "Other paragraphs", "wd.center": "Centred paragraphs", "wd.quote": "Quotations", "wd.li": "List items",
      "more.house": "House style…",
      "hs.badge": "House style",
      "hs.learn": "Learn a house style",
      "hs.learnHint": "Pick two or three earlier books of the same series (Layout documents, or files opened from Scribus, InDesign or a print PDF). Layout keeps what they share as a new house style document: a template you can change, with its rules.",
      "hs.name": "Name",
      "hs.defName": "House style",
      "hs.go": "Learn",
      "hs.none": "No text was found in these documents.",
      "hs.noNamed": "There is no house style called “{n}”.",
      "hs.done": "House style ready",
      "hs.repWorks": "Learned from {n} works.",
      "hs.repPages": "Kept {f} front matter pages and {b} back matter pages, with an empty body page between them.",
      "hs.repRoles": "Styles found: {list}",
      "hs.repRules": "{n} rules came from the works; the Greek typographic rules are added. Check them in the rules sheet.",
      "hs.repSkipped": "{n} documents had no text and were left out.",
      "hs.sheet": "Rules sheet",
      "hs.sheetHint": "Learned from {n} works. Turn rules on or off and add your own; Save puts them into the paragraph styles.",
      "hs.roles": "Styles for each part",
      "hs.noStyle": "(none)",
      "hs.src.works": "From the works",
      "hs.src.greek": "Greek typographic rules",
      "hs.src.own": "Your rules",
      "hs.del": "Remove",
      "hs.add": "Add a rule",
      "hs.addPh": "In plain words, e.g. poems are centred",
      "hs.addDoes": "What it sets",
      "hs.does.none": "Nothing: a reminder to check",
      "hs.does.titlePage": "Titles start on a new page",
      "hs.does.titleOdd": "Titles start on a right-hand page",
      "hs.does.kwn": "Titles stay with the next paragraph",
      "hs.does.firstFlush": "First paragraph without an indent",
      "hs.does.hyphOff": "No hyphenation in the body",
      "hs.addBtn": "Add",
      "hs.save": "Save",
      "hs.saved": "Rules saved; {n} styles changed",
      "hs.fixed": "{n} quotes, dashes or spaces fixed",
      "hs.role.body": "Body text",
      "hs.role.first": "First paragraph",
      "hs.role.title": "Title",
      "hs.role.subtitle": "Subtitle",
      "hs.role.center": "Centred",
      "hs.role.quote": "Quotation",
      "hs.role.note": "Small text",
      "hr.w.titlePage": "Titles start on a new page ({n} of {of}).",
      "hr.w.titleOdd": "Titles start on a new right-hand (odd) page ({n} of {of}).",
      "hr.w.firstFlush": "The first paragraph after a title has no indent ({n} of {of} works).",
      "hr.w.sink": "Titles start about {mm} mm below the top margin.",
      "hr.w.bodyDiff": "The body text differs between the works: {list}.",
      "hr.w.sizeDiff": "The page size differs between the works: {list}.",
      "hr.gr.hyph": "Greek words are hyphenated at their syllables.",
      "hr.gr.orph": "At least 2 lines of a paragraph at the foot of a page or column.",
      "hr.gr.wid": "At least 2 lines of a paragraph carried over to the next page or column.",
      "hr.gr.kwnTitle": "A title stays with the text after it.",
      "hr.gr.kwnSub": "A subtitle stays with the text after it.",
      "hr.gr.hyphTitle": "Titles are not hyphenated.",
      "hr.gr.hyphSub": "Subtitles are not hyphenated.",
      "hr.gr.quotes": "Quotation marks become « » (and “ ” inside them) when text is placed.",
      "hr.gr.dash": "A dialogue line starts with a dash (—), and a hyphen between spaces becomes an en dash (–), when text is placed.",
      "hr.gr.ellipsis": "Three dots become an ellipsis (…) when text is placed.",
      "hr.gr.spaces": "Double spaces become single when text is placed.",
      "more.auto": "Automatic layout…",
      "more.toc": "Update contents",
      "au.title": "Automatic layout",
      "au.noHouse": "There is no house style yet. Learn one from two or three earlier books first.",
      "au.hint": "Pick a house style and the manuscript (Word, OpenDocument, RTF, Markdown or text). Layout makes a new book in that style: its front and back matter, the text flowed on as many pages as it needs, the contents. The fields {title}, {subtitle}, {author}, {isbn}, {year} in the house style's pages take the details below.",
      "au.house": "House style",
      "au.noFile": "No manuscript chosen",
      "au.file": "Choose the manuscript…",
      "au.pub": "Details from Publishing",
      "au.pubNone": "(type them)",
      "au.f.title": "Title",
      "au.f.subtitle": "Subtitle",
      "au.f.author": "Author",
      "au.f.isbn": "ISBN",
      "au.f.year": "Year",
      "au.keepFront": "Keep the manuscript's own front matter (title page, contents…)",
      "au.go": "Lay out",
      "au.working": "Laying out the book…",
      "au.done": "First layout ready",
      "au.repPages": "{n} pages, {b} of them text.",
      "au.repTitles": "{n} titles.",
      "au.repGuessed": "{n} titles were found by their look (a short line in bold, or centred after empty lines): check them.",
      "au.repFixes": "Fixed: {q} quotes, {d} dashes, {e} ellipses, {s} double spaces. No words were changed.",
      "au.repFields": "{n} fields filled with the book's details.",
      "au.repToc": "Contents: {n} entries. After changes, use More › Update contents.",
      "au.repFront": "{n} paragraphs of the manuscript's own front matter were left out: the house style's are used.",
      "au.repDropped": "{n} empty paragraphs used for spacing were left out.",
      "au.repNoStyle": "The house style has no style of its own for: {list}. They took the body style.",
      "au.repPics": "{n} pictures in the manuscript were not placed: place them by hand.",
      "au.repCheck": "Check these pages:",
      "au.why.overset": "the text does not fit",
      "au.why.oversetOther": "a text frame overflows",
      "au.noToc": "This document has no contents to update.",
      "au.tocDone": "Contents updated: {n} entries",
      "more.sheet": "Book sheet…",
      "au.f.editor": "Editor",
      "au.f.publisher": "Publisher",
      "au.repMoved": "{n} sections of the manuscript were moved as the sheet says.",
      "au.repLeft": "{n} paragraphs went to pages of their own (dedication, motto) or were left out as the sheet says.",
      "au.repBare": "{n} pages where a title opens, or that are empty, have no page number.",
      "au.repNotes": "{n} notes from Word placed.",
      "au.repNotesLeft": "{n} note marks had no note text and were left out.",
      "in.title": "How should this book be set?",
      "in.hint": "The manuscript has {n} titles. Each answer starts as the series has it; change only what differs for this book. The answers are kept in the new book (More › Book sheet…).",
      "in.allSeries": "Everything as in the series",
      "in.g.page": "Page and structure",
      "in.g.front": "Front and back pages",
      "in.g.type": "Typography of each part",
      "in.g.text": "Text",
      "in.series": "As in the series ({v})",
      "in.asSeries": "As in the series",
      "in.mm": "{n} mm from the top",
      "in.none": "None",
      "in.yes": "Yes",
      "in.no": "No",
      "in.q.size": "Page size",
      "in.q.marg": "Margins (empty: as in the series)",
      "in.marg.t": "Top",
      "in.marg.b": "Bottom",
      "in.marg.i": "Inside",
      "in.marg.o": "Outside",
      "in.q.start": "Where each new chapter starts",
      "in.q.parts": "The parts (Part One…)",
      "in.q.sink": "How low a chapter title starts",
      "in.q.first": "The first paragraph of a chapter",
      "in.q.sep": "Scene breaks",
      "in.q.pn": "Page numbers",
      "in.q.pnHide": "Page numbers on chapter openings and empty pages",
      "in.q.pnStart": "Number of the first page",
      "in.q.toc": "Contents",
      "in.q.tocParts": "In the contents",
      "in.q.hyph": "Hyphenation",
      "in.q.widows": "Widows and orphans (at least two lines)",
      "in.q.fix": "Quotes, dashes and ellipses",
      "in.q.pages": "Pages of the series to keep",
      "in.q.at": "{s}: where",
      "in.q.ded": "Dedication (on a right-hand page of its own)",
      "in.q.motto": "Motto (on a right-hand page of its own)",
      "in.size.120x190": "120 × 190 mm",
      "in.size.140x210": "140 × 210 mm",
      "in.size.148x210": "148 × 210 mm (A5)",
      "in.size.170x240": "170 × 240 mm",
      "in.start.odd": "On a right-hand page",
      "in.start.even": "On a left-hand page",
      "in.start.page": "On a new page, wherever it falls",
      "in.start.run": "Right after the previous one",
      "in.parts.own": "On a page of their own",
      "in.parts.chap": "Like the chapters",
      "in.sink.top": "At the top of the page",
      "in.sink.third": "A third of the way down",
      "in.first.flush": "Without an indent",
      "in.first.indent": "With an indent",
      "in.sep.keep": "As in the manuscript",
      "in.sep.stars": "***",
      "in.sep.spaced": "* * *",
      "in.sep.aster": "⁂",
      "in.sep.blank": "An empty line",
      "in.pn.footC": "At the foot, centred",
      "in.pn.footOut": "At the foot, outer edge",
      "in.pn.footIn": "At the foot, inner edge",
      "in.pn.headOut": "At the head, outer edge",
      "in.pn.headC": "At the head, centred",
      "in.pn.headIn": "At the head, inner edge",
      "in.pn.none": "None",
      "in.pnHide.hide": "Hidden",
      "in.pnHide.show": "Shown",
      "in.q.rh": "Running heads",
      "in.rh.none": "None",
      "in.rh.titleChap": "The book's title on the left, the chapter's on the right",
      "in.rh.authorTitle": "The author on the left, the title on the right",
      "in.rh.own": "The series' own",
      "in.q.fnAt": "Word's notes",
      "in.fnAt.chap": "At the end of each chapter",
      "in.fnAt.book": "At the end of the book",
      "in.toc.start": "At the start",
      "in.toc.end": "At the end",
      "in.toc.none": "None",
      "in.tocParts.parts": "Parts and chapters",
      "in.tocParts.chap": "Chapters only",
      "in.hyph.on": "On",
      "in.hyph.off": "Off",
      "in.widows.on": "On",
      "in.widows.off": "Off",
      "in.fix.on": "Greek «», — and …",
      "in.fix.off": "As they are",
      "in.side.front": "front",
      "in.side.back": "back",
      "in.tocPage": "contents",
      "in.sec.prologue": "Prologue",
      "in.sec.thanks": "Acknowledgements",
      "in.sec.notes": "Notes",
      "in.sec.bio": "About the author",
      "in.sec.links": "Links",
      "in.at.s": "As in the manuscript",
      "in.at.front": "Before the first chapter",
      "in.at.back": "After the last chapter",
      "in.at.out": "Leave it out",
      "in.part.body": "Body text",
      "in.part.title": "Chapter titles",
      "in.part.part": "Part titles",
      "in.part.toc": "Contents",
      "in.part.colophon": "Publisher's page",
      "in.part.thanks": "Acknowledgements",
      "in.part.links": "Links",
      "in.part.ded": "Dedication and motto",
      "in.change": "Change…",
      "in.font": "Font",
      "in.size": "Size",
      "in.lead": "Leading",
      "in.alignQ": "Alignment",
      "in.track": "Tracking (1/1000 em)",
      "in.align.l": "left",
      "in.align.c": "centred",
      "in.align.r": "right",
      "in.align.j": "justified",
      "in.font.serif": "Serif",
      "in.font.sans": "Sans",
      "in.font.mono": "Mono",
      "in.keep": "Keep these answers as the series' own (not the pages, dedication or motto)",
      "in.n.part": "Part title",
      "in.n.open": "Chapter title (after a part)",
      "in.n.sep": "Scene break",
      "in.n.toc": "Contents entry",
      "in.n.tocHead": "Contents",
      "in.n.thanks": "Acknowledgements",
      "in.n.links": "Links",
      "in.n.ded": "Dedication",
      "in.n.pn": "Page number",
      "in.n.rh": "Running head",
      "in.n.rhL": "Running head (left)",
      "in.n.rhR": "Running head (right)",
      "in.n.note": "Note",
      "in.n.noteHead": "Notes heading",
      "in.n.notesHead": "Notes",
      "in.n.first": "First paragraph",
      "in.n.colophon": "Publisher's page",
      "in.g.pics": "Photos",
      "in.picsHint": "The manuscript has {n} photos. Each goes with the paragraph after it; a short paragraph right after a photo that reads as a caption becomes its caption.",
      "in.q.picAt": "Where the photos go",
      "in.picAt.page": "On a page of their own, before the page they belong to",
      "in.picAt.before": "At the top of the page, the text below them",
      "in.picAt.flow": "In the text, where they belong; the text goes on below them",
      "in.picAt.each": "I choose for each photo",
      "in.picAt.out": "Leave them out",
      "in.q.picSize": "Photo size",
      "in.picSize.text": "Within the margins",
      "in.picSize.page": "The whole page, to the bleed",
      "in.q.cap": "Captions",
      "in.cap.below": "Below the photo",
      "in.cap.above": "Above the photo",
      "in.cap.none": "No captions",
      "in.q.capSrc": "Caption text",
      "in.capSrc.para": "The paragraph after the photo",
      "in.capSrc.file": "The photo's name",
      "in.capSrc.typed": "I type them",
      "in.q.grey": "Colour",
      "in.grey.no": "As they are",
      "in.grey.yes": "Black and white",
      "in.extra": "Photos besides the manuscript…",
      "in.extraN": "{n} photos picked",
      "in.q.extraAt": "Where these photos go",
      "in.extraAt.end": "At the end of the book",
      "in.extraAt.after": "After “{t}”",
      "in.eachPic": "Each photo ({n})…",
      "in.picN": "Photo {n}",
      "in.capPh": "Caption (empty: as answered above)",
      "in.part.cap": "Captions",
      "in.n.cap": "Caption",
      "au.repPlaced": "{n} photos placed.",
      "au.repPicsOut": "{n} photos were left out, as answered or because they could not be read.",
      "au.repOverset": "The text does not fit yet: add pages or check the photos.",
      "inframe.aria": "Type into the text frame",
      "story.title": "Story Editor", "story.empty": "Type here…", "story.ps": "Paragraph style", "story.cs": "Character style",
      "story.b": "Bold", "story.i": "Italic", "story.u": "Underline", "story.pn": "Insert page number", "story.pc": "Insert page count", "story.sec": "Insert running head (the page's chapter title)",
      "story.chars": "{n} characters", "story.overset": "· overset", "story.none": "Select a text frame first.",
      "rec.title": "Recovered text", "rec.note": "Edited on two devices at the same time: the other version is kept here.",
      "rec.copy": "Copy", "rec.copied": "Copied", "rec.del": "Discard",
      "toast.deleted": "Deleted", "toast.docDeleted": "Document deleted", "toast.save": "Storage is full: recent changes could not be saved on this device.", "toast.diskSave": "Recent changes could not be written to Files › Layout yet. They are kept here and written at the next change.", "toast.diskRead": "Files that could not be read in Files › Layout: {n}. They stay as they are.", "toast.diskOff": "The orOS disk cannot be read right now: documents are kept in this browser until the next start.",
      "toast.big": "This document is getting large ({n} KB). Large documents fill the storage every app shares.",
      "toast.locked": "This object is locked.", "toast.gone": "This document was deleted on another device.",
      "toast.fontFail": "The fonts could not be loaded.", "toast.maxItems": "A document can have at most {n} objects.",
      "toast.flowDone": "Text placed on {n} new pages.", "toast.flowMax": "Stopped after {n} pages: the text still overflows.",
      "toast.copied": "Copied", "ed.paste": "Paste",
      "cb.title": "Selection tools", "cb.more": "More", "ruler.unit": "Rulers and sizes now in {u}.", "more.history": "History…", "more.keys": "Shortcuts and comfort…", "hist.title": "History", "hist.none": "No changes to go back to yet.", "hist.start": "When the history starts", "hist.now": "now", "hist.hint": "Click a step to go back to it, or forward again. A new change after going back drops the steps ahead.", "hist.add": "Add an object", "hist.addN": "Add {n} objects", "hist.del": "Delete an object", "hist.delN": "Delete {n} objects", "hist.move": "Move", "hist.moveN": "Move {n} objects", "hist.resize": "Resize", "hist.resizeN": "Resize {n} objects", "hist.rotate": "Rotate", "hist.rotateN": "Rotate {n} objects", "hist.change": "Change an object", "hist.changeN": "Change {n} objects", "hist.text": "Edit text", "hist.style": "Change styles", "hist.styleN": "Style “{name}”", "hist.colour": "Change colours", "hist.pages": "Change pages", "hist.master": "Change a master", "hist.setup": "Document setup", "hist.guide": "Guides", "hist.edit": "Several changes", "keys.title": "Shortcuts and comfort", "keys.press": "Press the keys…", "keys.none": "none", "keys.change": "Click to change", "keys.default": "Default", "keys.clear": "No shortcut", "keys.reserved": "{k} is kept for typing, copying or orOS itself.", "keys.clash": "{k} was the shortcut of “{a}”, which now has none.", "keys.hint": "Click a shortcut and press the new keys (Esc keeps the old one). Letters are the keys' places, so they work with a Greek keyboard too. Saved on this device.", "keys.comfort": "Comfort", "keys.nudge": "Arrow keys move by ({u})", "keys.nudgeHint": "Shift moves ten times as far, Alt a tenth as far. Click the corner of the rulers to change mm, pt or in.", "keys.smart": "Smart guides: snap to equal gaps", "keys.measure": "Show sizes and places while dragging", "keys.ctxbar": "Toolbar over the selection", "keys.resetAll": "All shortcuts back to default", "ka.tool.select": "Select", "ka.tool.text": "Text frame", "ka.tool.image": "Image frame", "ka.tool.rect": "Rectangle", "ka.tool.ell": "Ellipse", "ka.tool.line": "Line", "ka.tool.pen": "Pen", "ka.tool.hand": "Hand", "ka.preview": "Preview", "ka.undo": "Undo", "ka.redo": "Redo", "ka.dup": "Duplicate", "ka.selall": "Select all on this page", "ka.group": "Group", "ka.ungroup": "Ungroup", "ka.export": "Export", "ka.fit": "Fit page", "ka.zoom100": "Zoom 100 %", "ka.front": "Bring to front", "ka.back": "Send to back", "ka.fwd": "Bring forward", "ka.bwd": "Send backward", "ka.lock": "Lock position", "ka.history": "History", "ka.story": "Story Editor", "ka.keys": "Shortcuts and comfort", "ka.find": "Find/Change", "ka.spell": "Spelling", "pf.glyph": "Characters the font cannot draw: {c}", "more.hjOn": "Show loose and tight lines", "more.hjOff": "Hide loose and tight lines", "hj.on": "Loose lines are yellow, tight lines pink.", "hj.off": "Loose and tight lines hidden.", "sty.sc": "Small caps", "sty.posNone": "Normal position", "sty.posSup": "Superscript", "sty.posSub": "Subscript", "sty.comp": "Composition", "sty.composer": "Composer", "sty.compS": "Line by line", "sty.compP": "Whole paragraph", "sty.wsMin": "Word spacing, least (%)", "sty.wsMax": "Word spacing, most (%)", "sty.lsMax": "Letter spacing, most (1/1000 em)", "sty.dcN": "Drop cap: lines", "sty.dcC": "Drop cap: letters", "sty.opt": "Optical margins", "sty.bal": "Balance ragged lines", "sty.compHint": "Whole paragraph weighs every line of a paragraph together, for even spacing and fewer hyphens. Justified lines keep their spaces between the least and most word spacing, then add letter spacing up to its most. Optical margins let punctuation hang past the edge. More › Show loose and tight lines marks the lines outside the limits.", "note.menu": "Notes, cross-references and links", "note.ins": "Insert a note…", "note.edit": "Note", "note.empty": "An empty note", "note.text": "Text of the note", "note.hint": "The note is numbered by itself and set at the foot of the column (or after the text, with endnotes). A new line starts a new paragraph of the note. Click its number in the Story Editor to change or remove it.", "note.del": "Remove the note", "note.settings": "Notes…", "note.kind": "Notes go", "note.foot": "At the foot of the column (footnotes)", "note.end": "After the text (endnotes)", "note.ps": "Paragraph style of the notes", "note.psAuto": "Smaller body text", "note.num": "Numbers", "note.numDoc": "Through the whole document", "note.numStory": "From 1 in each story", "note.setHint": "A line that would leave its note behind moves on to the next column with it. In an EPUB the notes open as pop-ups, at the end of their chapter.", "xr.title": "Cross-reference", "xr.ins": "Insert a cross-reference…", "xr.show": "Show", "xr.k.p": "The page number", "xr.k.t": "The paragraph's text", "xr.k.tp": "Text and page", "xr.search": "Search the paragraphs", "xr.none": "No titles found. Type a few letters to search all paragraphs.", "xr.hint": "The number follows the page when the text moves. In a PDF it is a link to that page, in an EPUB to the paragraph.", "link.ins": "Link…", "link.title": "Link", "link.url": "Web or e-mail address", "link.hint": "On the selected words. In a PDF and an EPUB they open the address.", "link.bad": "This is not a web (https://) or e-mail (mailto:) address.", "link.remove": "Remove the link", "link.pick": "Select the words of the link first.", "more.contents": "Contents from styles…", "more.notes": "Notes…", "toc.title": "Contents", "toc.pick": "Choose the styles of the titles that go into the contents, and their level.", "toc.lv0": "Not in the contents", "toc.lv": "Level {n}", "toc.eps": "Style of level {n} entries", "toc.epsSame": "As the first entry", "toc.sep": "Between title and page", "toc.sepTab": "Tab", "toc.sepSpace": "Space", "toc.sepP": "Title | p. 12", "toc.sepSel": "Title | σελ. 12", "toc.hint": "With no contents yet, a new frame on this page takes them. More › Update contents brings the page numbers up to date after changes; in a PDF each line is a link.", "toc.go": "Make the contents", "toc.noStyles": "Choose at least one style.", "toc.head": "Contents", "sty.list": "List", "sty.listF": "Numbering", "sty.listNone": "No list", "sty.listEx": "{a} {b} {c}", "sty.listLv": "Level", "sty.listS": "Start at", "sty.listG": "List name", "sty.listGPh": "this style", "sty.listHint": "Paragraphs in this style are numbered one after the other. Styles with the same list name share the numbers, so a level 2 starts again under each level 1. A number hangs in the left indent.", "more.book": "Book…", "book.title": "Book", "book.none": "This document is in no book yet. A book keeps chapters in separate documents together: page numbers run on, styles stay the same, and one PDF holds them all.", "book.name": "Name of the book", "book.make": "Make a book", "book.pages": "pages {a}–{b}", "book.up": "Earlier in the book", "book.down": "Later in the book", "book.remove": "Take out of the book", "book.add": "Add a document", "book.addPick": "Choose…", "book.odd": "Each document starts on a right-hand (odd) page", "book.number": "Number the pages on", "book.numbered": "Page numbers set in {n} documents.", "book.sync": "Styles as the first document's", "book.synced": "{n} styles and colours made the same.", "book.pdf": "PDF of the book", "book.making": "Making the PDF of the book…", "book.made": "The PDF of the book is ready.", "book.failed": "The PDF of the book could not be made.", "book.hint": "The documents keep the book's name, so it syncs with them. Number the pages on after a document grows or shrinks.", "setup.fitH": "A new page size", "setup.fit": "Move the contents to fit the new size", "setup.fitText": "Text sizes in proportion too", "setup.fitHint": "Frames that run to the page edges still do, what sits in a margin keeps its edge, the rest keeps its place in the text area, and pictures and shapes keep their proportions. With only the size changed, the margins follow it in proportion.", "pf.ink": "Too much ink: {n} % (limit {m} %)", "pf.richBlack": "Small text in rich black (several inks): it may blur", "pf.hair": "A line thinner than 0.25 pt: it may not print", "pf.safe": "Text closer than {n} mm to the trim", "pf.opWhite": "White set to overprint: it will vanish", "more.print": "Print colours…", "pc.title": "Print colours", "pc.view": "Show the pages", "pc.v.off": "Normal", "pc.v.proof": "Proof", "pc.v.c": "Cyan", "pc.v.m": "Magenta", "pc.v.y": "Yellow", "pc.v.k": "Black", "pc.v.ink": "Total ink", "pc.viewHint": "Proof shows the colours as the print profile prints them. Cyan, Magenta, Yellow and Black show one ink plate each, dark where it prints. Total ink shows in pink where more ink than the limit would go. Colours that overprint show as they print. Click the label over the pages to go back.", "pc.off": "Back to normal colours", "pc.profile": "Print profile", "pc.own": "Own profile", "pc.ownBtn": "Own profile (.icc)…", "pc.builtIn": "Back to Coated FOGRA39", "pc.profileHint": "The printer's CMYK profile, if it gave you one (a v2 .icc with 16-bit tables). It travels with the document, in Files, and the PDF/X uses it.", "pc.badProfile": "This is not a CMYK printer profile that Layout can read (a v2 .icc with 16-bit tables).", "pc.noFiles": "Files is not open here, so the profile cannot be kept.", "pc.profileSet": "Print profile: {name}", "pc.noProfile": "The print profile could not be loaded.", "pc.ink": "Ink limit (%)", "pc.safe": "Text keeps from the trim (mm)", "pc.bop": "Black overprints (100 % black alone)", "pc.hint": "Preflight warns about colours over the ink limit, small text in rich black, lines thinner than 0.25 pt, text closer to the trim than this, and white that overprints. Ask the printer for its ink limit: 300 % suits coated paper, 260 % uncoated.", "exp.x1a": "PDF/X-1a (CMYK only)", "exp.x1aHint": "Everything in CMYK for {name}, pictures too, with no transparency: for printers that ask for PDF/X-1a. Transparent pictures go on white; Preflight and the report say what had to change.", "exp.x1aBad": "Exported, but {n} PDF/X-1a checks failed (transparency or pictures). Open Preflight before you send it.", "colors.tintOf": "Tint of", "colors.tintNone": "None (a colour of its own)", "colors.tint": "Tint", "colors.op": "Overprint", "colors.opShort": "overprint", "colors.opHint": "An overprinting colour prints over what is under it instead of leaving a hole, so thin text and lines never show a white gap. A tint follows its colour: change the colour and every tint of it changes.", "story.names": "Style names", "story.smaller": "Smaller text", "story.bigger": "Bigger text", "more.lib": "Library…", "lib.title": "Library", "lib.add": "Add the selection", "lib.import": "Import…", "lib.export": "Export…", "lib.empty": "Nothing in the library yet. Select objects on the page and add them.", "lib.place": "Place on this page", "lib.placed": "“{name}” placed.", "lib.name": "Name", "lib.del": "Remove from the library", "lib.nameN": "Item {n}", "lib.pick": "Select objects first.", "lib.big": "This selection is too big for the library.", "lib.full": "The library is full. Remove something first.", "lib.added": "Added to the library.", "lib.bad": "This is not an orOS library file.", "lib.imported": "{n} added from the file.", "lib.fileName": "Layout library", "lib.hint": "Objects to reuse in any document on this device: a logo, a running head, a chapter opener. They come with their text, colours and styles. Pictures are named, not copied, so they show where this device has them.", "swl.libs": "Libraries…", "swl.import": "Import .ase…", "swl.export": "Export .ase", "swl.title": "Swatch libraries", "swl.add": "Add", "swl.added": "{n} colours added.", "swl.none": "These colours are already in the document.", "swl.bad": "This is not a swatch file (.ase) that can be read.", "swl.lib.print": "Print basics (CMYK)", "swl.lib.sea": "Sea", "swl.lib.earth": "Earth", "swl.lib.pastel": "Pastel", "swl.lib.grey": "Greys (K)", "swl.hint": "Ready-made sets of colours. Import .ase reads swatch files from InDesign, Illustrator, Photoshop, Affinity or Scribus; colours already in the document are skipped.", "props.va.j": "Justify", "sty.bl": "Lock to baseline grid", "bg.title": "Baseline grid", "bg.start": "First line from the page top", "bg.every": "Every", "bg.off": "off", "bg.show": "Show the baseline grid", "bg.hint": "Paragraph styles with Lock to baseline grid put their lines on it, so lines line up across columns and facing pages. Leave Every empty for no grid.", "brk.col": "Next column", "brk.page": "Next page", "brk.odd": "Next odd page", "brk.even": "Next even page", "brk.menu": "Break", "brk.ins.col": "Column break (Numpad Enter)", "brk.ins.page": "Page break (Ctrl+Numpad Enter)", "brk.ins.odd": "Odd page break", "brk.ins.even": "Even page break", "os.title": "Object style", "os.none": "None", "os.new": "New from this", "os.nameN": "Object style {n}", "os.max": "A document holds at most {n} object styles.", "os.redefine": "Redefine from this", "os.name": "Name of the object style", "os.del": "Delete style", "os.hint": "Fill, stroke, corners, opacity, wrap and, for text frames, inset, columns and alignment, under one name. Redefine changes every object that uses it.", "more.find": "Find/Change…", "more.spell": "Spelling…", "fc.title": "Find/Change", "fc.queries": "Queries…", "fc.delQuery": "Delete the saved query", "fc.delPick": "Pick a saved query first.", "fc.find": "Find", "fc.change": "Change to", "fc.text": "Text", "fc.grep": "GREP", "fc.textHint": "Finds the text as typed. In Change to, $& is what was found.", "fc.grepHint": "A regular expression: \\d a digit, \\s a space, . any character, + one or more, ( ) a group. In Change to, $1 is the first group, $& all of it, \\n a new paragraph.", "fc.bad": "This expression has a mistake: {m}", "fc.long": "The search is too long (500 characters at most).", "fc.matchesEmpty": "This expression also matches nothing at all; make it find at least one character.", "fc.cs": "Match case", "fc.word": "Whole word", "fc.scope": "Search", "fc.inDoc": "The whole document", "fc.inStory": "This story", "fc.onlyPs": "Only in paragraphs of", "fc.anyPs": "Any style", "fc.toPs": "Paragraph style of changed paragraphs", "fc.toCs": "Character style of the change", "fc.keep": "Keep as it is", "fc.n": "{n} found.", "fc.nMany": "{n} or more found.", "fc.none": "Nothing found.", "fc.more": "The first {n} are listed.", "fc.noFrame": "This text is in no frame.", "fc.save": "Save query", "fc.saved": "Query saved.", "fc.findBtn": "Find", "fc.next": "Next", "fc.changeOne": "Change", "fc.all": "Change all", "fc.done": "{n} changed.", "fc.pre.dblspace": "Double spaces → one", "fc.pre.spacepunct": "Space before punctuation", "fc.pre.dash": "Hyphen between spaces → en dash", "fc.pre.quotes": "\"Straight\" → «Greek» quotes", "fc.pre.dots": "Three dots → ellipsis", "fc.pre.trail": "Spaces at the end of a paragraph", "sp.title": "Spelling", "sp.checking": "Checking the words… The dictionaries load the first time and then work offline.", "sp.n": "{n} words not in the dictionaries.", "sp.none": "No spelling mistakes found.", "sp.failed": "The dictionaries could not be loaded. Connect once to the internet and try again.", "sp.noLib": "Spelling cannot be checked here. Reload Layout.", "sp.go": "Show", "sp.suggest": "Suggestions", "sp.noSug": "No suggestions.", "sp.add": "Add to dictionary", "sp.ignore": "Ignore", "sp.hint": "Greek and English, with Writer's dictionaries. Added words go to this document's dictionary and travel with it; the words of your dictionary in Writer count too. A suggestion changes the word everywhere, as one undo step.", "sty.next": "Next style (after Enter)", "sty.nextSame": "Same style", "sty.grep": "GREP styles", "sty.grepAdd": "Add a GREP style", "sty.grepRe": "Regular expression", "sty.grepCs": "Character style", "sty.grepDel": "Remove this GREP style", "sty.grepBad": "This expression has a mistake or matches nothing.", "sty.grepHint": "A character style on everything an expression finds in these paragraphs, e.g. \\d+ for numbers or [A-ZΑ-Ω]{2,} for capitals. Up to 10; a later one wins where they overlap.",
      "dlg.rename": "Rename", "dlg.delDoc": "Delete this document?", "dlg.delDocSub": "You can undo right after.",
      "home.recipes": "Automations",
      "more.recipes": "Automations…",
      "rc.op.text": "Find and replace text",
      "rc.op.pstyle": "Paragraph style",
      "rc.op.master": "Master on pages",
      "rc.op.style": "Change a style",
      "rc.f.style.name": "Style",
      "rc.f.size": "Size (pt, 0 = as it is)",
      "rc.f.lead": "Leading (pt, 0 = as it is)",
      "rc.f.font": "Font",
      "rc.f.align": "Alignment",
      "rc.f.track": "Tracking (0 = as it is)",
      "rc.e.font.": "As it is", "rc.e.font.serif": "Serif", "rc.e.font.sans": "Sans", "rc.e.font.mono": "Mono",
      "rc.e.align.": "As it is", "rc.e.align.l": "Left", "rc.e.align.c": "Centre", "rc.e.align.r": "Right", "rc.e.align.j": "Justified",
      "rc.n.style": "Changes the style itself, so every paragraph in it changes. Fields left at 0 or “As it is” stay as they are.",
      "rc.op.margins": "Page margins",
      "rc.op.preflight": "Preflight check",
      "rc.op.export": "Export PDF",
      "rc.f.find": "Find",
      "rc.f.repl": "Replace with",
      "rc.f.cs": "Match case",
      "rc.f.word": "Whole words only",
      "rc.f.from": "Paragraphs in style",
      "rc.f.to": "Give them style",
      "rc.f.ms": "Master",
      "rc.f.on": "Pages",
      "rc.f.t": "Top (mm)",
      "rc.f.b": "Bottom (mm)",
      "rc.f.i": "Inside (mm)",
      "rc.f.o": "Outside (mm)",
      "rc.f.stop": "Do not export a document with errors",
      "rc.f.bleed": "Include bleed",
      "rc.f.marks": "Crop marks",
      "rc.f.spreads": "Spreads (facing pages)",
      "rc.f.q": "Pictures",
      "rc.e.on.all": "All pages",
      "rc.e.on.odd": "Odd pages",
      "rc.e.on.even": "Even pages",
      "rc.e.q.print": "Print (300 ppi)",
      "rc.e.q.screen": "Screen (150 ppi)",
      "rc.anyStyle": "Any style",
      "rc.noMaster": "None",
      "rc.n.text": "Text split across differently formatted parts is still found; the new text takes the formatting of the first part.",
      "rc.n.pstyle": "Styles are matched by name, so one automation works in every document that has a style of that name.",
      "rc.n.export": "One document: the usual Save dialog. Several: the PDFs go to Files, in the Layout folder.",
      "rc.on.this": "This document ({name})",
      "rc.on.all": "All documents ({n})",
      "rc.pv.none": "There are no documents yet.",
      "rc.pv.one": "Works on one document. You can undo it right after.",
      "rc.pv.many": "Works on {n} documents. You can undo it right after.",
      "rc.pv.pdfs": "The PDFs are saved in Files, in the Layout folder.",
      "rc.doing": "{i} of {n}: {name}",
      "rc.done": "{n} changes in {d} documents.",
      "rc.nochange": "Nothing needed changing.",
      "rc.pf": "Preflight: {e} errors, {w} warnings.",
      "rc.held": "{n} not exported because of preflight errors.",
      "rc.pdfs": "{n} PDFs saved in Files › Layout.",
      "rc.pdfs1": "1 PDF saved in Files › Layout.",
      "rc.undone": "Documents are back as they were.",
      "as.done": "The Assistant changed {n} things in {d} documents.", "as.done1": "The Assistant changed {n} things in the document.",
      "as.done0": "Nothing needed changing.", "as.made1": "The new document is ready.", "as.working": "Working on Claude's commands…", "as.busy": "Layout is still working on Claude's earlier commands.", "btn.stop": "Stop", "as.bad": "The Assistant's request could not be read. Nothing was changed.",
      "as.undone": "The Assistant's change was undone.", "as.changed": "These documents were changed since, so the Assistant's change was not undone.",
      "as.gone": "There is nothing left to undo.",
      "rc.op.pages": "Add pages",
      "rc.op.delpages": "Remove pages",
      "rc.op.numbering": "Page numbers",
      "rc.op.bleed": "Bleed",
      "rc.op.fit": "Fit the text",
      "rc.op.grey": "Black and white pictures",
      "rc.op.imgfit": "Pictures in their frames",
      "rc.f.pages.n": "How many pages",
      "rc.f.at": "Where",
      "rc.f.page": "Page (its position, 1 = the first)",
      "rc.f.flow": "Text that does not fit runs on into them",
      "rc.f.first": "From page (its position)",
      "rc.f.last": "To page (0 = only that one)",
      "rc.f.numbering.mode": "How",
      "rc.f.numbering.n": "Number",
      "rc.f.bleed.mm": "Bleed (mm)",
      "rc.f.pages": "Pages (empty = all; odd, even or e.g. 3-10,12)",
      "rc.f.imgfit.mode": "Picture",
      "rc.f.bold": "Bold",
      "rc.f.ital": "Italic",
      "rc.f.caps": "Capitals",
      "rc.f.sb": "Space before (pt, -1 = as it is)",
      "rc.f.sa": "Space after (pt, -1 = as it is)",
      "rc.f.fi": "First-line indent (pt, -1 = as it is)",
      "rc.f.brk": "Starts",
      "rc.f.hyph": "Greek hyphenation",
      "rc.e.onoff.": "As it is",
      "rc.e.onoff.on": "On",
      "rc.e.onoff.off": "Off",
      "rc.e.at.end": "At the end",
      "rc.e.at.before": "Before the page",
      "rc.e.at.after": "After the page",
      "rc.e.mode.set": "The first page gets the number",
      "rc.e.mode.shift": "Every number moves by",
      "rc.e.mode.fit": "The whole picture",
      "rc.e.mode.fill": "Fill the frame",
      "rc.e.brk.": "As it is",
      "rc.e.brk.any": "Anywhere",
      "rc.e.brk.col": "On a new column",
      "rc.e.brk.page": "On a new page",
      "rc.e.brk.odd": "On an odd page",
      "rc.e.brk.even": "On an even page",
      "rc.n.delpages": "The pages go with everything on them. You can undo it right after.",
      "rc.n.fit": "Text that does not fit gets as many new pages as it needs, after its last frame.",
      "rc.n.grey": "Black and white copies are made on this device; the colour pictures stay on the disk.",
      "rc.n.numbering": "For example, move by 2: every page number becomes two later.",
      "tab.learn": "Learn",
      "home.book": "New book",
      "start.open": "A book, step by step",
      "start.title": "New book",
      "start.step": "Step {n} of {of}",
      "start.s1": "What kind of book",
      "start.s2": "Size and margins",
      "start.s3": "Type",
      "start.s4": "Details and first pages",
      "start.back": "Back",
      "start.next": "Next",
      "start.make": "Make the book",
      "start.usual": "usual",
      "start.trim": "Trim size",
      "start.m.tight": "Tight",
      "start.m.normal": "Normal",
      "start.m.wide": "Generous",
      "start.trimHint": "Margins, type sizes and frames follow the size you pick. You can change all of it later in Document setup.",
      "start.pair.noto": "Noto Serif + Noto Sans (built in, works offline)",
      "start.pair.garamond": "EB Garamond + Fira Sans",
      "start.pair.literata": "Literata + Open Sans",
      "start.pair.alegreya": "Alegreya + Alegreya Sans",
      "start.pair.sans": "Fira Sans throughout",
      "start.pairHint": "All are free fonts with Greek. Apart from Noto, each one is downloaded the first time it is used and then works offline; until then the preview shows a stand-in.",
      "start.f.title": "Title",
      "start.f.author": "Author",
      "start.f.publisher": "Publisher",
      "start.f.year": "Year",
      "start.f.isbn": "ISBN",
      "start.front": "First pages",
      "start.fr.half": "Half-title",
      "start.fr.title": "Title page",
      "start.fr.copy": "Copyright page",
      "start.fr.ded": "Dedication",
      "start.fr.toc": "Contents",
      "start.later": "A field left empty keeps a sample text to type over.",
      "sk.novel": "Novel",
      "sk.d.novel": "Chapters of running text with running heads",
      "sk.stories": "Short stories",
      "sk.d.stories": "Each story opens on a right-hand page",
      "sk.poetry": "Poetry",
      "sk.d.poetry": "One poem per page, lines kept as written",
      "sk.essay": "Essay",
      "sk.d.essay": "Chapters with sections and quotations",
      "sk.study": "Study",
      "sk.d.study": "Numbered chapters, two levels of headings",
      "sk.children": "Picture book",
      "sk.d.children": "Full-page pictures and large text",
      "sk.photo": "Photo book",
      "sk.d.photo": "Landscape spreads, pictures to the edge",
      "sk.cookbook": "Cookbook",
      "sk.d.cookbook": "A photo opposite each recipe",
      "sk.catalogue": "Exhibition catalogue",
      "sk.d.catalogue": "One work per page with its caption",
      "sk.magazine": "Magazine",
      "sk.d.magazine": "Cover, contents and a feature in three columns",
      "sk.workbook": "Workbook",
      "sk.d.workbook": "Lessons with goals, tasks and pages to write on",
      "sk.zine": "Zine",
      "sk.d.zine": "Eight pages, bold and quick",
      "sk.st.first": "First paragraph",
      "sk.st.chap": "Chapter title",
      "sk.st.chno": "Chapter number",
      "sk.st.folio": "Page number",
      "sk.st.rh": "Running head",
      "sk.st.sep": "Scene break",
      "sk.st.half": "Half-title",
      "sk.st.ttitle": "Title",
      "sk.st.tauth": "Author",
      "sk.st.tpub": "Publisher",
      "sk.st.copy": "Copyright",
      "sk.st.ded": "Dedication",
      "sk.st.toch": "Contents heading",
      "sk.st.toc": "Contents entry",
      "sk.st.verse": "Verse",
      "sk.st.tale": "Story text",
      "sk.st.pcap": "Photo caption",
      "sk.st.rmeta": "Recipe details",
      "sk.st.ingr": "Ingredient",
      "sk.st.step": "Method step",
      "sk.st.artist": "Artist",
      "sk.st.work": "Work",
      "sk.st.mast": "Masthead",
      "sk.st.cline": "Cover line",
      "sk.st.stand": "Standfirst",
      "sk.st.pull": "Pull quote",
      "sk.st.goal": "Goal",
      "sk.st.task": "Task",
      "sk.st.ztitle": "Zine title",
      "sk.ms.a": "Body pages",
      "sk.ms.o": "Opening pages",
      "sk.sw.acc": "Accent",
      "sk.sw.tint": "Tint",
      "sx.title": "Title of the book",
      "sx.author": "Author's name",
      "sx.publisher": "Publisher",
      "sx.rights": "All rights reserved. No part of this book may be reproduced without the publisher's written permission.",
      "sx.isbn": "ISBN (add it in the book's details)",
      "sx.ded": "For someone dear",
      "sx.toc": "Contents",
      "sx.chap": "Chapter One",
      "sx.story": "The first story",
      "sx.poem": "Poem",
      "sx.sec": "A section",
      "sx.sec1": "1.1 The question",
      "sx.sec2": "1.1.1 A closer look",
      "sx.quote": "A quotation stands apart from the running text, indented on both sides.",
      "sx.p1": "This is where your text goes. Type over these lines or paste your manuscript: the text flows from frame to frame and from page to page on its own, and every paragraph takes the look of its style.",
      "sx.p2": "The margins, the size of the type and the space between the lines were worked out for this page size, so a long read stays easy on the eye. Change a style once and every paragraph that uses it follows.",
      "sx.p3": "Page numbers and running heads live on the masters, so new pages get them by themselves. When the text runs out of room, add pages and it carries on where it stopped.",
      "sx.v1": "Here the first line of the poem,",
      "sx.v2": "and here the second, as you wrote it.",
      "sx.v3": "An empty line starts a new stanza;",
      "sx.v4": "the lines never run together.",
      "sx.kid1": "Once upon a time, a small boat set out to see the sea.",
      "sx.kid2": "Every page is a new picture and a line or two of the story.",
      "sx.photos": "About these photographs",
      "sx.pcap": "Place, date: a few words about the picture.",
      "sx.course": "Starters",
      "sx.recipe": "Recipe",
      "sx.serves": "Serves 4 · 30 minutes",
      "sx.ingr": "Ingredients",
      "sx.ingr1": "500 g tomatoes",
      "sx.ingr2": "2 tablespoons olive oil",
      "sx.ingr3": "salt and pepper",
      "sx.method": "Method",
      "sx.step1": "Write each step on its own line.",
      "sx.step2": "Keep the steps short, one action each.",
      "sx.exhib": "About the exhibition",
      "sx.artist": "Artist's name",
      "sx.work": "Title of the work",
      "sx.medium": "Oil on canvas, 100 × 80 cm",
      "sx.mag": "MAGAZINE",
      "sx.cline1": "The big story of this issue",
      "sx.cline2": "Two more stories worth the cover",
      "sx.feat": "The feature",
      "sx.edit": "From the editor",
      "sx.lesson": "Lesson 1",
      "sx.goals": "In this lesson",
      "sx.goal1": "• What you will learn first",
      "sx.goal2": "• What you will be able to do at the end",
      "sx.task": "Task 1",
      "sx.notes": "Notes",
      "sx.zine": "ZINE",
      "hint.ok": "Got it",
      "hint.start": "Type over the sample text or paste yours: it flows from page to page. Styles change every paragraph that uses them at once; page numbers and running heads are on the masters (Pages tab).",
      "hint.editor": "Pick a tool on the left and drag on the page; double-click a text frame to type. The Learn tab on the right shows the basics.",
      "hint.master": "You are editing a master: what you place here shows on every page that uses it. Press Done to go back.",
      "learn.title": "Learn Layout",
      "learn.intro": "The basics in a few lines, each with a button that shows you where.",
      "learn.text": "Text that flows",
      "learn.text.d": "Text lives in frames, and one text can run through many frames and pages. Double-click a frame to type; the Story Editor shows the whole text at once.",
      "learn.styles": "Styles",
      "learn.styles.d": "A paragraph style holds the font, size, spacing and where a paragraph starts. Change the style and every paragraph with it follows; the chapter title style can open each chapter on a new page.",
      "learn.pages": "Pages and masters",
      "learn.pages.d": "The Pages tab adds, moves and removes pages. A master holds what repeats on many pages, such as page numbers and running heads; open it from the Pages tab to change it.",
      "learn.pics": "Pictures",
      "learn.pics.d": "Draw an image frame and place a picture in it; a picture that should reach the paper's edge goes over the bleed. Preflight warns when a picture is too small for print.",
      "learn.toc": "Contents",
      "learn.toc.d": "A book made with New book has a contents page. After you change chapters, Update contents writes it again with the right page numbers.",
      "learn.check": "Preflight",
      "learn.check.d": "Preflight lists what could go wrong at the printer: text that does not fit, pictures too small, fonts that are missing.",
      "learn.export": "Export",
      "learn.export.d": "Export makes the PDF for the printer (PDF/X-4, with bleed and crop marks when you want them), a PDF for screens or an EPUB.",
      "learn.show": "Show me",
      "learn.help": "The full guide",
      "learn.hints": "Show the hints again",
      "learn.hintsBack": "The hints will show again.",
      "learn.noHelp": "The guide opens from the ? in the top bar of orOS.",
      "learn.noToc": "This document has no contents page made by Layout.",
      "a11y.canvas": "Page canvas"
    },
    el: {
      "app.name": "Σελιδοποίηση", "loading": "Φόρτωση γραμματοσειρών…",
      "home.new": "Νέο έγγραφο", "home.import": "Άνοιγμα αρχείου", "home.search": "Αναζήτηση εγγράφων",
      "home.empty.title": "Δεν υπάρχουν έγγραφα ακόμα",
      "home.empty.sub": "Φυλλάδια, ενημερωτικά, αφίσες, κάρτες, βιβλιαράκια: ξεκίνα διαλέγοντας μέγεθος σελίδας.",
      "home.count": "{n} έγγραφα", "home.count1": "1 έγγραφο",
      "home.pages": "{n} σελίδες", "home.pages1": "1 σελίδα", "unk.item": "Χρειάζεται νεότερο orOS", "unk.doc": "Αυτό το έγγραφο χρειάζεται νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.", "home.none": "Κανένα έγγραφο δεν ταιριάζει.",
      "doc.untitled": "Χωρίς τίτλο", "doc.copy": "{name} (αντίγραφο)",
      "card.open": "Άνοιγμα", "card.rename": "Μετονομασία", "card.dup": "Διπλασιασμός", "card.pkg": "Αποθήκευση ως πακέτο", "card.del": "Διαγραφή",
      "ed.back": "Έγγραφα", "ed.undo": "Αναίρεση", "ed.redo": "Επανάληψη", "ed.zin": "Μεγέθυνση", "ed.zout": "Σμίκρυνση",
      "zoom.title": "Ζουμ", "zoom.page": "Προσαρμογή σελίδας", "zoom.spread": "Προσαρμογή δισέλιδου", "ruler.hint": "Σύρε από έναν χάρακα για να προσθέσεις οδηγό· σύρε τον οδηγό πίσω στον χάρακα για να τον σβήσεις.", "ed.preview": "Προεπισκόπηση (χωρίς οδηγούς και πλαίσια)", "ed.panel": "Πάνελ", "ed.more": "Περισσότερα",
      "ed.export": "Εξαγωγή", "ed.rename": "Μετονομασία εγγράφου",
      "more.merge": "Συγχώνευση δεδομένων (CSV)…", "exp.merge": "Συγχώνευση δεδομένων", "exp.mergeNote": "Πολλές κάρτες, ετικέτες ή κονκάρδες από αρχείο CSV, σε ένα PDF.",
      "props.mf": "Πεδίο δεδομένων (συγχώνευση)", "props.mfEg": "π.χ. Φωτογραφία", "props.mfHint": "Η στήλη του αρχείου CSV με το όνομα αρχείου της εικόνας αυτού του πλαισίου.",
      "mg.title": "Συγχώνευση δεδομένων", "mg.hint": "Γράψε {{Πεδίο}} σε πλαίσιο κειμένου εκεί που μπαίνει μια τιμή: Πεδίο είναι ένα όνομα στήλης από την πρώτη γραμμή του αρχείου CSV. Κάθε γραμμή φτιάχνει μία κάρτα.",
      "mg.file": "Επιλογή αρχείου CSV…", "mg.other": "Άλλο αρχείο…", "mg.rows": "{name}: {n} γραμμές", "mg.cut": "Χρησιμοποιούνται μόνο οι πρώτες {n} γραμμές.",
      "mg.bad": "Αυτό το αρχείο δεν έχει γραμμές για συγχώνευση.", "mg.big": "Το αρχείο είναι πολύ μεγάλο (έως 5 MB).",
      "mg.fields": "Πεδία", "mg.noFields": "Δεν υπάρχουν ακόμα πεδία: γράψε {{Πεδίο}} σε πλαίσιο κειμένου ή δώσε σε πλαίσιο εικόνας ένα πεδίο δεδομένων.",
      "mg.missing": "δεν υπάρχει στο αρχείο", "mg.ok": "βρέθηκε", "mg.img": "εικόνα",
      "mg.pages": "Κάθε κάρτα", "mg.pg.cur": "Αυτή η σελίδα", "mg.pg.all": "Όλες οι σελίδες",
      "mg.mode": "Αποτέλεσμα", "mg.one": "Μία ανά σελίδα", "mg.nup": "Πολλές ανά φύλλο", "mg.sheet": "Φύλλο", "mg.gap": "Κενό (mm)",
      "mg.per": "{n} ανά φύλλο · {s} φύλλα", "mg.per1": "{n} ανά φύλλο · 1 φύλλο", "mg.none": "Η κάρτα δεν χωράει σε αυτό το φύλλο.", "mg.nupPage": "Το «Πολλές ανά φύλλο» χρησιμοποιεί μόνο αυτή τη σελίδα.",
      "mg.pics": "Εικόνες", "mg.folder": "Φάκελος στον δίσκο του orOS", "mg.device": "Προσθήκη εικόνων από αυτή τη συσκευή…",
      "mg.found": "Βρέθηκαν {f} από {n} εικόνες.", "mg.looking": "Αναζήτηση εικόνων…",
      "mg.preview": "Προεπισκόπηση", "mg.rec": "Γραμμή {i} από {n}", "mg.prev": "Προηγούμενη γραμμή", "mg.next": "Επόμενη γραμμή",
      "mg.go": "Δημιουργία PDF", "mg.working": "Δημιουργία σελίδας {i} από {n}…", "mg.done": "Το PDF είναι έτοιμο: {n} σελίδες.",
      "mg.lost": "{n} εικόνες δεν βρέθηκαν: τα πλαίσιά τους μένουν κενά.", "mg.need": "Διάλεξε πρώτα αρχείο CSV.",
      "mg.letter": "Letter", "mg.over": "Σε αυτή τη γραμμή κάποιο κείμενο δεν χωράει στο πλαίσιό του.", "mg.overN": "Κείμενο δεν χωράει στο πλαίσιό του σε {n} σημεία.",
      "more.compare": "Σύγκριση με PDF…", "imp.port": "Μεταφορά φακέλου βιβλίων (Scribus, InDesign)…", "port.title": "Μεταφορά φακέλου βιβλίων", "port.none": "Δεν υπάρχουν αρχεία Scribus ή InDesign σε αυτόν τον φάκελο.", "port.found": "Βρέθηκαν {n} αρχεία βιβλίων, τα {p} με PDF για σύγκριση.", "port.more": "Άλλα {n} αρχεία έμειναν έξω: μετάφερέ τα από μικρότερο φάκελο.", "port.hint": "Κάθε αρχείο ανοίγει ως νέο έγγραφο με τις εικόνες του δικού του φακέλου. Τίποτα στον φάκελο δεν αλλάζει.", "port.pics": "{n} εικόνες", "port.noPdf": "χωρίς PDF", "port.cmp": "Σύγκριση κάθε βιβλίου με το PDF του", "port.go": "Μεταφορά", "port.working": "Μεταφορά {i} από {n}: {f}…", "port.comparing": "Σύγκριση του {f} με το PDF του…", "port.stop": "Διακοπή", "port.done": "Μεταφέρθηκαν {n} βιβλία, τα {c} συγκρίθηκαν με το PDF τους.", "port.stopped": "Σταμάτησε μετά από {n} από {t} αρχεία.", "port.avg": "Κατά μέσο όρο διαφέρει το {p} % των εικονοστοιχείων από τα PDF.", "port.row": "{p} σελίδες · λείπουν {m} εικόνες", "port.diff": "{p} % διαφορά, {o} σελίδες πάνω από 2 %", "port.noCmp": "δεν συγκρίθηκε", "port.shift": "Το PDF έχει {n} σελίδες περισσότερες στην αρχή· έμειναν έξω από τη σύγκριση.", "port.fail": "δεν άνοιξε", "port.open": "Άνοιγμα", "port.csv": "Αποθήκευση αναφοράς (CSV)…", "port.csvName": "Αναφορά μεταφοράς", "port.csvHead": "Βιβλίο|Αρχείο|Σελίδες|Αντικείμενα|Εικόνες που λείπουν|PDF|Σελίδες του PDF πριν από τις δικές μας|Διαφορά % (μέσος όρος)|Σελίδες πάνω από 2 %|Σελίδα με τη μεγαλύτερη διαφορά|Το % της|Σημείωση", "cmp.title": "Σύγκριση με PDF", "cmp.working": "Συγκρίνω τις σελίδες…", "cmp.fail": "Η σύγκριση με το PDF δεν έγινε.", "cmp.sum": "{f}: συγκρίθηκαν {n} σελίδες, κατά μέσο όρο διαφέρει το {p} % των εικονοστοιχείων.", "cmp.count": "Το PDF έχει {a} σελίδες και το έγγραφο {b}· οι σελίδες συγκρίνονται με τη σειρά, όσες έχουν και τα δύο.", "cmp.over": "{n} σελίδες διαφέρουν πάνω από 2 %. Είναι πρώτες παρακάτω.", "cmp.over1": "Μία σελίδα διαφέρει πάνω από 2 %. Είναι πρώτη παρακάτω.", "cmp.allOk": "Καμία σελίδα δεν διαφέρει πάνω από 2 %.", "cmp.hint": "Κάθε σελίδα κόβεται στο μέγεθος κοπής και συγκρίνεται εικονοστοιχείο προς εικονοστοιχείο στα 50 dpi, ελαφρά θολωμένη: η σελίδα του PDF, του εγγράφου και οι διαφορές με κόκκινο. Άλλη γραμματοσειρά, γραμμή που μετακινήθηκε ή εικόνα σε άλλο μέγεθος φαίνεται κόκκινη· τα ίδια γράμματα λίγο πιο δίπλα δεν μετρούν.", "cmp.theirs": "Η σελίδα του PDF", "cmp.ours": "Η σελίδα του εγγράφου", "cmp.diff": "Οι διαφορές με κόκκινο", "more.setup": "Ρυθμίσεις εγγράφου…", "more.pkg": "Αποθήκευση ως πακέτο (.oroslayout)", "more.text": "Τοποθέτηση κειμένου ή εγγράφου (Word, .odt, .txt)…",
      "more.story": "Επεξεργαστής κειμένου", "more.selall": "Επιλογή όλων στη σελίδα", "more.rec": "Ανακτημένο κείμενο ({n})",
      "tool.select": "Επιλογή (V)", "tool.text": "Πλαίσιο κειμένου (T)", "tool.image": "Πλαίσιο εικόνας (F)",
      "tool.rect": "Ορθογώνιο (R)", "tool.ell": "Έλλειψη (E)", "tool.line": "Γραμμή (L)", "tool.hand": "Χέρι (H, ή κράτα το Space). Διπλό κλικ: προσαρμογή δισέλιδου",
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
      "props.path": "Σχήμα", "props.grad": "Διαβάθμιση", "props.grad.l": "Γραμμική", "props.grad.r": "Ακτινική", "props.grad.from": "Αρχικό χρώμα", "props.grad.to": "Τελικό χρώμα", "props.grad.ang": "Γωνία (°)",
      "props.text": "Πλαίσιο κειμένου", "props.cols": "Στήλες", "props.gut": "Κενό στηλών", "props.ins": "Εσωτερικό περιθώριο",
      "props.va": "Κάθετη στοίχιση", "props.va.t": "Πάνω", "props.va.c": "Κέντρο", "props.va.b": "Κάτω",
      "props.edit": "Επεξεργασία κειμένου", "props.threadNext": "Συνέχεια σε νέο πλαίσιο", "props.autoflow": "Αυτόματη ροή: σελίδες μέχρι να χωρέσει",
      "props.unthread": "Αποσύνδεση μετά από αυτό το πλαίσιο", "props.chain": "Πλαίσιο {i} από {n} σε αυτό το κείμενο",
      "props.image": "Εικόνα", "props.place": "Τοποθέτηση εικόνας…", "props.replace": "Αντικατάσταση εικόνας…",
      "props.fit": "Ολόκληρη", "props.fillf": "Γέμισμα", "props.scale": "Κλίμακα", "props.offx": "Μετατόπιση X", "props.offy": "Μετατόπιση Y",
      "props.ppi": "{n} ppi πραγματική ανάλυση", "props.ppiLow": "{n} ppi: χαμηλή για εκτύπωση", "props.missing": "Το αρχείο της εικόνας δεν έχει έρθει ακόμα σε αυτή τη συσκευή",
      "props.wrap": "Αναδίπλωση κειμένου", "props.wrap.none": "Καμία", "props.wrap.box": "Ορθογώνιο", "props.wrap.ell": "Έλλειψη", "pp.menu": "Τοποθέτηση σελίδας από PDF, Scribus ή InDesign…", "pp.title": "Ποια σελίδα;", "pp.which": "Το {f} έχει {n} σελίδες. Ποια μπαίνει στο πλαίσιο;", "pp.page": "Σελίδα", "pp.place": "Τοποθέτηση", "pp.working": "Διαβάζεται το αρχείο…", "pp.done": "Τοποθετήθηκε η σελίδα {p} του {f}.", "pp.bad": "Αυτό το αρχείο δεν διαβάστηκε. Διάλεξε PDF, .sla του Scribus ή .idml του InDesign.", "pp.af": "Οι σελίδες του Affinity δεν σχεδιάζονται εδώ. Εξήγαγε τη σελίδα σε PDF από το Affinity και τοποθέτησε εκείνο.", "pp.from": "Σελίδα {p} του {f}", "anc.add": "Αγκύρωση στο κείμενο", "anc.on": "Αγκυρωμένο στο κείμενο: μετακινείται μαζί με το κείμενο. Αν σβήσεις τη θέση του στο κείμενο, μένει εκεί που είναι.", "anc.off": "Αποδέσμευση από το κείμενο", "props.wc": "Αναδίπλωση κατά", "props.wc.box": "Πλαίσιο", "props.wc.shape": "Περίγραμμα", "props.wc.alpha": "Διάφανες άκρες", "props.wc.opaque": "Αυτή η εικόνα δεν έχει διάφανες άκρες, οπότε το κείμενο περνά γύρω από το πλαίσιό της.", "props.wo": "Απόσταση",
      "props.arrange": "Σειρά", "props.front": "Μπροστά απ' όλα", "props.fwd": "Ένα μπροστά", "props.bwd": "Ένα πίσω", "props.back": "Πίσω απ' όλα",
      "props.align": "Στοίχιση", "props.alignTo": "στα περιθώρια", "props.alignSel": "στην επιλογή",
      "props.al": "Στοίχιση αριστερά", "props.ac": "Στοίχιση στο κέντρο", "props.ar": "Στοίχιση δεξιά",
      "props.at": "Στοίχιση πάνω", "props.am": "Στοίχιση στη μέση", "props.ab": "Στοίχιση κάτω",
      "props.dh": "Ισοκατανομή οριζόντια", "props.dv": "Ισοκατανομή κάθετα",
      "props.lock": "Κλείδωμα θέσης", "props.hide": "Απόκρυψη", "hide.done": "Κρύφτηκε. Εμφανίζεται ξανά από το πάνελ σελίδας (χωρίς επιλογή).", "hide.show": "Εμφάνιση κρυφών αντικειμένων ({n})", "props.group": "Ομαδοποίηση", "props.ungroup": "Κατάργηση ομάδας",
      "props.dup": "Διπλασιασμός", "props.del": "Διαγραφή", "props.multi": "{n} αντικείμενα",
      "bl.title": "Ανάμειξη", "bl.steps": "Βήματα", "bl.make": "Ανάμειξη", "bl.update": "Ενημέρωση", "bl.release": "Αποδέσμευση",
      "bl.hint": "Σχήματα σε ίσα βήματα από το ένα σχήμα στο άλλο: θέση, μέγεθος, περίγραμμα και χρώματα. Άλλαξες ένα από τα δύο; Πάτα Ενημέρωση.",
      "bl.gone": "Ένα από τα δύο σχήματα αυτής της ανάμειξης δεν υπάρχει πια. Η Αποδέσμευση κρατά τα βήματα ως απλά σχήματα.",
      "bl.made": "Προστέθηκαν {n} βήματα", "bl.released": "Τα βήματα είναι πλέον απλά σχήματα", "bl.full": "Αυτό το έγγραφο έχει πάρα πολλά αντικείμενα για ανάμειξη.",
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
      "sty.b": "Έντονα", "sty.i": "Πλάγια", "sty.u": "Υπογράμμιση", "sty.caps": "Κεφαλαία", "sty.bul": "Κουκκίδα", "sty.kern": "Kerning", "sty.book": "Στοιχειοθεσία βιβλίου", "sty.hyph": "Συλλαβισμός", "sty.kwn": "Μαζί με την επόμενη", "sty.sec": "Τίτλος για τις τρέχουσες επικεφαλίδες", "sty.orph": "Ελάχιστες γραμμές πριν την αλλαγή στήλης", "sty.wid": "Ελάχιστες γραμμές μετά την αλλαγή στήλης", "sty.brk": "Αρχή", "sty.brkAny": "Οπουδήποτε", "sty.brkCol": "Στην επόμενη στήλη", "sty.brkPage": "Σε νέα σελίδα", "sty.brkOdd": "Σε μονή σελίδα", "sty.brkEven": "Σε ζυγή σελίδα", "sty.sink": "Κατέβασμα από την κορυφή της σελίδας", "sty.nest": "Ένθετο στυλ από την αρχή", "sty.nestNone": "Κανένα", "sty.nestTo": "Ως και", "styles.play": "Στυλ για θεατρικό", "pages.secNew": "Νέα ενότητα από εδώ…", "pages.secEdit": "Ενότητα…", "pages.secTitle": "Ενότητα", "pages.secStart": "Αρχή από", "pages.secGoOn": "συνεχίζει", "pages.secStyle": "Αριθμοί", "pages.secPrefix": "Πρόθεμα", "pages.secRemove": "Αφαίρεση ενότητας", "pages.baseMaster": "Με βάση το μάστερ…", "pages.baseNone": "Κανένα", "props.flipH": "Καθρέφτης αριστερά-δεξιά", "props.flipV": "Καθρέφτης πάνω-κάτω", "props.frameToPic": "Πλαίσιο στο μέγεθος της εικόνας", "adj.title": "Διορθώσεις χρώματος", "adj.gray": "Ασπρόμαυρη", "adj.bcT": "Φωτεινότητα και αντίθεση", "adj.b": "Φωτεινότητα", "adj.c": "Αντίθεση", "adj.hslT": "Απόχρωση, κορεσμός, φωτεινότητα", "adj.h": "Απόχρωση", "adj.s": "Κορεσμός", "adj.l": "Φωτεινότητα", "adj.levels": "Επίπεδα", "adj.ib": "Σημείο μαύρου", "adj.iw": "Σημείο λευκού", "adj.g": "Γάμμα", "adj.ob": "Μαύρο εξόδου", "adj.ow": "Λευκό εξόδου", "adj.curves": "Καμπύλες", "adj.cs": "Σκιές", "adj.cm": "Μεσαίοι τόνοι", "adj.ch": "Φωτεινά", "adj.balance": "Ισορροπία χρωμάτων (μεσαίοι τόνοι)", "adj.r": "Κόκκινο", "adj.gr": "Πράσινο", "adj.bl": "Μπλε", "adj.off": "Αφαίρεση των διορθώσεων", "adj.noLib": "Οι διορθώσεις δεν φαίνονται εδώ. Ανοίξτε ξανά το Layout.", "more.links": "Σύνδεσμοι (εικόνες)…", "links.title": "Σύνδεσμοι", "links.sum": "{n} εικόνες, {m} λείπουν ή είναι κενές.", "links.none": "Το έγγραφο δεν έχει εικόνες.", "links.noName": "(χωρίς όνομα)", "links.page": "σελίδα {n}", "links.go": "Μετάβαση", "links.s.ok": "Εντάξει", "links.s.missing": "λείπει το αρχείο", "links.s.empty": "κενό πλαίσιο", "links.s.low": "χαμηλή ανάλυση", "links.s.small": "μικρότερη από ό,τι στο Scribus", "links.smallHint": "{n} εικόνες ήρθαν από αρχεία Scribus που άνοιξαν πριν από την έκδοση 7.96.01 και εμφανίζονται μικρότερες από ό,τι στο Scribus. Πάτα «Βρες τις εικόνες…» με τις αρχικές εικόνες για να μπουν στο μέγεθός τους.", "links.local": "ενσωματωμένο (από τοπικό φάκελο)", "pages.size": "Μέγεθος σελίδας…", "pages.sizeOwn": "Μέγεθος σελίδας (δικό της)…", "pages.sizeTitle": "Μέγεθος σελίδας", "pages.sizePages": "Σελίδες", "pages.sizeDoc": "Μέγεθος εγγράφου", "pages.sizeBad": "Το μέγεθος πρέπει να είναι από 13 mm ως 5 m.", "exp.creep": "Creep σε mm (καρφίτσα)", "styles.playDone": "Προστέθηκαν {n} στυλ θεατρικού.", "styles.playHave": "Το έγγραφο έχει ήδη τα στυλ θεατρικού.",
      "sty.sb": "Διάστημα πριν", "sty.sa": "Διάστημα μετά", "sty.fi": "Εσοχή πρώτης γραμμής", "sty.li": "Εσοχή αριστερά", "sty.ri": "Εσοχή δεξιά",
      "sty.track": "Αραίωση (1/1000 em)", "sty.color": "Χρώμα", "sty.inherit": "Όπως η βάση",
      "font.sans": "Noto Sans", "font.serif": "Noto Serif", "font.mono": "Noto Sans Mono",
      "fp.more": "Άλλες γραμματοσειρές…", "fp.cols": "Συλλογές", "fp.docCol": "Η συλλογή του εγγράφου (δείχνεται πρώτη)", "fp.docCol.none": "Καμία", "fp.notHere": "δεν έχει έρθει ακόμη σε αυτή τη συσκευή", "fp.title": "Γραμματοσειρές", "fp.mine": "Σε αυτή τη συσκευή", "fp.loading": "Φόρτωση…", "fp.add": "Προσθήκη αρχείου γραμματοσειράς…", "fp.addHint": "TTF, OTF, WOFF ή WOFF2. Το αρχείο μένει στα Αρχεία › Fonts και συγχρονίζεται όπως κάθε αρχείο· τα έγγραφα που το χρησιμοποιούν το αναφέρουν.", "fp.none": "Δεν υπάρχουν ακόμη αρχεία γραμματοσειρών.", "fp.free": "Ελεύθερες γραμματοσειρές (Fontsource)", "fp.search": "Αναζήτηση γραμματοσειράς", "fp.greek": "Μόνο με ελληνικά", "fp.offline": "Η λίστα με τις ελεύθερες γραμματοσειρές θέλει σύνδεση την πρώτη φορά.", "fp.noMatch": "Καμία γραμματοσειρά δεν ταιριάζει.", "fp.hasGreek": "Ελληνικά", "fp.moreHits": "Άλλες {n}: γράψε περισσότερο από το όνομα.", "fp.v.r": "κανονικά", "fp.v.b": "έντονα", "fp.v.i": "πλάγια", "fp.v.bi": "έντονα πλάγια", "fp.err.size": "Το αρχείο είναι πολύ μεγάλο για γραμματοσειρά (έως 15 MB).", "fp.err.type": "Δεν είναι αρχείο γραμματοσειράς που διαβάζει η Σελιδοποίηση (TTF, OTF, WOFF ή WOFF2).", "fp.err.outlines": "Η γραμματοσειρά έχει περιγράμματα PostScript (CFF), που η εξαγωγή PDF δεν ενσωματώνει ακόμη. Χρησιμοποίησε την έκδοση TTF της.", "fp.err.restricted": "Η άδεια της γραμματοσειράς δεν επιτρέπει την ενσωμάτωσή της σε έγγραφα.", "fp.err.disk": "Η γραμματοσειρά δεν αποθηκεύτηκε στον δίσκο του orOS.", "fp.added": "Προστέθηκε η «{name}».",
      "colors.title": "Δείγματα", "colors.new": "Νέο δείγμα", "colors.edit": "Επεξεργασία δείγματος", "colors.del": "Διαγραφή δείγματος",
      "colors.mode": "Τύπος", "colors.rgb": "RGB", "colors.cmyk": "CMYK", "colors.hex": "Hex",
      "colors.keep": "Το Μαύρο και το Χαρτί δεν διαγράφονται.", "colors.used": "Ό,τι το χρησιμοποιεί γίνεται Μαύρο.",
      "colors.note": "Το CMYK φαίνεται στην οθόνη με απλή μετατροπή (χωρίς προφίλ χρώματος)· το PDF παίρνει τις ακριβείς τιμές CMYK.",
      "cov.title": "Εξώφυλλο βιβλίου", "cov.btn": "Εξώφυλλο βιβλίου…", "cov.docName": "Εξώφυλλο: {title}",
      "cov.intro": "Οπισθόφυλλο, ράχη και εξώφυλλο σε μία σελίδα, με bleed, οδηγούς για τα διπλώματα και το barcode του ISBN. Ζήτα από το τυπογραφείο το πάχος της ράχης: ισχύει το δικό τους νούμερο.",
      "cov.f.title": "Τίτλος", "cov.f.sub": "Υπότιτλος", "cov.f.author": "Συγγραφέας", "cov.f.size": "Διάσταση βιβλίου", "cov.f.w": "Πλάτος (mm)", "cov.f.h": "Ύψος (mm)",
      "cov.f.pages": "Σελίδες", "cov.f.paper": "Χαρτί", "cov.f.spine": "Ράχη (mm)", "cov.f.flap": "Αυτιά (mm, 0 = χωρίς)", "cov.f.bleed": "Bleed (mm)",
      "cov.f.blurb": "Κείμενο οπισθόφυλλου", "cov.f.isbn": "ISBN", "cov.f.price": "Τιμή (προαιρετικά)", "cov.f.imprint": "Εκδότης", "cov.f.pic": "Εικόνα εξωφύλλου",
      "cov.pickPic": "Επιλογή εικόνας…", "cov.noPic": "Καμία (χρωματιστό εξώφυλλο· βάζεις εικόνα μετά)", "cov.f.logo": "Λογότυπο εκδότη", "cov.noLogo": "Κανένα",
      "cov.spineHint": "Ράχη: {mm} mm. Εκτίμηση από τις σελίδες και το χαρτί· γράψε το νούμερο του τυπογραφείου για να το αλλάξεις.",
      "cov.badSize": "Η διάσταση πρέπει να είναι 50 έως 500 mm πλάτος και 50 έως 700 mm ύψος.", "cov.badIsbn": "Αυτό το ISBN δεν είναι σωστό (ψηφίο ελέγχου).",
      "cov.p.u70": "Μάλλινο 70 γρ.", "cov.p.u80": "Μάλλινο 80 γρ.", "cov.p.u90": "Μάλλινο 90 γρ.", "cov.p.u100": "Μάλλινο 100 γρ.",
      "cov.p.bulk80": "Ογκώδες (βιβλιόχαρτο) 80 γρ.", "cov.p.bulk90": "Ογκώδες (βιβλιόχαρτο) 90 γρ.",
      "cov.p.c115": "Velvet/illustration 115 γρ.", "cov.p.c135": "Velvet/illustration 135 γρ.", "cov.p.c150": "Velvet/illustration 150 γρ.",
      "new.title": "Νέο έγγραφο", "new.from": "Ξεκίνα από", "new.blank": "Κενό", "new.name": "Όνομα", "new.size": "Μέγεθος σελίδας", "new.custom": "Προσαρμοσμένο",
      "new.orient": "Προσανατολισμός", "new.portrait": "Κάθετο", "new.landscape": "Οριζόντιο", "new.pages": "Σελίδες",
      "new.facing": "Αντικριστές σελίδες", "new.pnStart": "Αριθμός πρώτης σελίδας", "new.margins": "Περιθώρια", "new.cols": "Στήλες", "new.gut": "Κενό στηλών",
      "new.bleed": "Bleed (ξάκρισμα)", "new.unit": "Μονάδες", "new.top": "Πάνω", "new.bottom": "Κάτω", "new.inside": "Μέσα",
      "new.outside": "Έξω", "new.left": "Αριστερά", "new.right": "Δεξιά", "new.w": "Πλάτος", "new.h": "Ύψος",
      "setup.title": "Ρυθμίσεις εγγράφου", "setup.note": "Τα αντικείμενα μένουν στη θέση τους όταν αλλάζει το μέγεθος.",
      "preset.a4": "A4", "preset.a5": "A5", "preset.a3": "A3", "preset.a6": "A6", "preset.b5": "B5",
      "preset.letter": "US Letter", "preset.legal": "US Legal", "preset.card": "Επαγγελματική κάρτα", "preset.dl": "Φυλλάδιο DL",
      "preset.square": "Τετράγωνο post", "preset.poster": "Αφίσα 50×70", "preset.bk120x190": "Βιβλίο 120×190", "preset.bk140x210": "Βιβλίο 140×210", "preset.bk170x240": "Βιβλίο 170×240", "preset.bk180x250": "Βιβλίο 180×250", "preset.bk215x215": "Τετράγωνο βιβλίο 215×215", "preset.custom": "Προσαρμοσμένο",
      "unit.mm": "mm", "unit.pt": "pt", "unit.in": "in",
      "exp.title": "Εξαγωγή", "exp.img": "Εικόνα (PNG / JPG / SVG)", "svg.copy": "Αντιγραφή ως SVG", "svg.save": "Λήψη ως SVG", "svg.copied": "Αντιγράφηκε ως SVG. Επικόλλησέ το σε εφαρμογή vector ή σε αρχείο κειμένου.", "svg.noClip": "Η αντιγραφή δεν δούλεψε εδώ. Χρησιμοποίησε τη Λήψη ως SVG.", "svg.none": "Τίποτα εδώ δεν μπορεί να γίνει SVG.", "exp.page": "Σελίδα", "exp.format": "Μορφή", "exp.res": "Ανάλυση", "exp.imgGo": "Εξαγωγή εικόνας", "exp.capped": "Εξήχθη στα {n} dpi (όριο 16 megapixel)", "exp.x4": "PDF/X-4 (300 ppi)", "exp.cmyk": "Χρώματα σε CMYK (Coated FOGRA39)", "exp.cmykHint": "Κείμενο, γραμμές και σχήματα στο CMYK του τυπογραφείου, το μαύρο και τα γκρι μόνο με μαύρο μελάνι. Οι φωτογραφίες κρατούν το προφίλ sRGB τους· τις μετατρέπει το τυπογραφείο, όπως επιτρέπει το PDF/X-4.", "exp.x4Bad": "Εξήχθη, αλλά {n} έλεγχοι του PDF/X-4 απέτυχαν. Άνοιξε τον Προέλεγχο εκτύπωσης πριν το στείλεις.", "exp.pdf": "PDF", "exp.pkg": "Πακέτο", "exp.range": "Σελίδες", "exp.all": "Όλες",
      "exp.cur": "Τρέχουσα σελίδα", "exp.custom": "Εύρος", "exp.rangeHint": "π.χ. 1-3, 5",
      "exp.spreads": "Ανά ζεύγος σελίδων", "exp.bleed": "Με bleed", "exp.marks": "Σημάδια κοπής",
      "out.title": "Εκδόσεις", "out.go": "Εξαγωγή", "out.edit": "Επεξεργασία εκδόσεων…", "out.editTitle": "Εκδόσεις αυτού του εγγράφου", "out.k.print": "PDF τυπογραφείου", "out.k.ebook": "PDF για e-book", "out.k.epub": "EPUB", "out.pages": "{n} σελίδες", "out.noIsbn": "χωρίς ISBN για αυτή τη μορφή στις Εκδόσεις", "out.withCover": "με το εξώφυλλο", "out.pubOf": "Τα ISBN και οι τιμές έρχονται από τον τίτλο «{t}» των Εκδόσεων.", "out.noPub": "Σύνδεσε το έγγραφο με έναν τίτλο των Εκδόσεων (Ρύθμιση εγγράφου) και κάθε έκδοση παίρνει το δικό της ISBN.", "out.name": "Όνομα", "out.kind": "Μορφή", "out.fmt": "Μορφή στις Εκδόσεις", "out.fmtAuto": "Αυτόματα", "out.fmtK.pb": "Χαρτόδετο", "out.fmtK.hb": "Σκληρόδετο", "out.fmtK.eb": "E-book", "out.fmtK.ab": "Audiobook", "out.fmtK.ot": "Άλλο", "out.blank": "Χωρίς τις κενές σελίδες", "out.toc": "Χωρίς τις σελίδες περιεχομένων", "out.drop": "Σελίδες που μένουν έξω", "out.cover": "Εξώφυλλο (πρώτη σελίδα)", "out.coverNone": "Κανένα", "out.coverHint": "Φτιάξε ένα από Νέο έγγραφο › Εξώφυλλο βιβλίου· το μπροστινό του γίνεται η πρώτη σελίδα του e-book.", "out.remove": "Αφαίρεση", "out.add": "Προσθήκη έκδοσης", "out.reset": "Προεπιλογές", "out.noPages": "Δεν μένουν σελίδες για αυτή την έκδοση.", "out.doneIsbn": "Εξήχθη με ISBN {isbn}", "new.lang": "Γλώσσα του κειμένου", "new.langAuto": "Δεν έχει οριστεί", "new.pub": "Τίτλος στις Εκδόσεις", "new.pubNone": "Κανένας", "new.pubGone": "(τίτλος που δεν υπάρχει πια)", "sty.lvl": "Επίπεδο επικεφαλίδας (περιεχόμενα e-book)", "sty.lvlAuto": "Αυτόματα ({n})", "sty.lvl0": "Όχι επικεφαλίδα", "sty.lvlN": "Επίπεδο {n}", "props.alt": "Περιγραφή (alt text)", "props.altEg": "Τι δείχνει η εικόνα, για όσους δεν τη βλέπουν", "props.deco": "Διακοσμητική (δεν χρειάζεται περιγραφή)",
      "more.epubCheck": "Έλεγχος EPUB…", "ep.fonts": "Γραμματοσειρές μέσα στο βιβλίο", "ep.fx": "Διάταξη", "ep.fx0": "Ελεύθερη ροή (κείμενο που μεγαλώνει ο αναγνώστης)", "ep.fx1": "Σταθερή: σελίδες όπως στο έντυπο, κείμενο ως κείμενο", "ep.fx2": "Σταθερή: σελίδες ως εικόνες", "ep.fx1s": "σταθερή διάταξη", "ep.fx2s": "σταθερή διάταξη, σελίδες ως εικόνες", "ep.sumFx": "{p} σελίδες, {h} επικεφαλίδες, {i} εικόνες", "ep.rotated": "{n} περιστραμμένα πλαίσια κειμένου μένουν μέρος της εικόνας της σελίδας", "ep.fixedNote": "Σταθερή διάταξη: οι αναγνώστες δείχνουν κάθε σελίδα όπως στο έντυπο· καλή για εικονογραφημένα βιβλία και κόμικς, λιγότερο για μυθιστορήματα", "ep.pageList": "Αριθμοί σελίδων του έντυπου (page-list)", "ep.noFonts": "χωρίς γραμματοσειρές (του αναγνώστη)", "ep.fail": "Το EPUB δεν έγινε.", "ep.noDisk": "Ο δίσκος του orOS δεν είναι προσβάσιμος από εδώ.", "ep.savedAt": "Αποθηκεύτηκε ως {path}", "ep.tooBig": "Το αρχείο είναι πολύ μεγάλο για έλεγχο (έως 300 MB).", "ep.title": "EPUB", "ep.working": "Φτιάχνω το EPUB…", "ep.checkTitle": "Έλεγχος του {name}", "ep.errors": "{n} προβλήματα: τα καταστήματα e-book θα απέρριπταν αυτό το αρχείο.", "ep.okWarn": "Κανένα σφάλμα, {n} πράγματα να δεις.", "ep.okWarn1": "Κανένα σφάλμα, 1 πράγμα να δεις.", "ep.errors1": "1 πρόβλημα: τα καταστήματα e-book θα απέρριπταν αυτό το αρχείο.", "ep.s.badIsbn": "Το ISBN του e-book στις Εκδόσεις έχει λάθος ψηφίο ελέγχου: διόρθωσέ το εκεί", "ep.ok": "Κανένα σφάλμα ή προειδοποίηση.", "ep.orosCheck": "Αυτός είναι ο έλεγχος του orOS για τους κανόνες που σπάνε πιο συχνά, όχι το επίσημο EPUBCheck.", "ep.sum": "{c} κεφάλαια, {h} επικεφαλίδες, {i} εικόνες, {p} σελίδες του έντυπου", "ep.noIsbn": "χωρίς ISBN e-book (με σταθερό αναγνωριστικό)", "ep.noAlt": "Η εικόνα στη σελίδα {n} δεν έχει περιγραφή (alt text)", "ep.overset": "{n} παράγραφοι έμειναν έξω: δεν χωράνε στα πλαίσιά τους ούτε στο έντυπο", "ep.shapes": "{n} σχήματα και γραμμές έμειναν έξω (στο έντυπο είναι διακόσμηση)", "ep.fontMissing": "{name}: δεν μπήκε (το αρχείο της δεν είναι σε αυτή τη συσκευή)", "ep.fontObf": "{name}: μπήκε κρυπτογραφημένη (δική σου γραμματοσειρά, όχι ανοιχτή άδεια)", "ep.store": "Τι ζητούν συνήθως τα καταστήματα e-book", "ep.s.cover": "Εικόνα εξωφύλλου", "ep.s.coverSmall": "Εικόνα εξωφύλλου μικρότερη από 1600 px ύψος", "ep.s.noCover": "Χωρίς εξώφυλλο: διάλεξε Εξώφυλλο βιβλίου στην Επεξεργασία εκδόσεων ή βάλε εξώφυλλο στις Εκδόσεις", "ep.s.isbn": "ISBN e-book", "ep.s.noIsbn": "Χωρίς ISBN e-book: δώσε ένα στη μορφή e-book στις Εκδόσεις", "ep.s.toc": "Περιεχόμενα από τις επικεφαλίδες", "ep.s.noToc": "Χωρίς επικεφαλίδες: όρισε επίπεδο επικεφαλίδας στο style των κεφαλαίων", "ep.s.lang": "Γλώσσα: {l}", "ep.s.noLang": "Χωρίς γλώσσα: όρισέ τη στη Ρύθμιση εγγράφου", "ep.s.a11y": "Κάθε εικόνα έχει περιγραφή ή είναι διακοσμητική", "ep.s.noA11y": "{n} εικόνες χωρίς περιγραφή", "ep.s.meta": "Τίτλος, πρόσωπα και περίληψη από τις Εκδόσεις", "ep.s.metaPart": "Οι Εκδόσεις δεν έχουν πρόσωπα ή περίληψη για αυτόν τον τίτλο", "ep.s.noPub": "Δεν συνδέεται με τίτλο των Εκδόσεων (Ρύθμιση εγγράφου)", "ep.preview": "Προεπισκόπηση στη Βιβλιοθήκη", "ep.markPub": "Σημείωσέ το έτοιμο στις Εκδόσεις", "ep.save": "Αποθήκευση EPUB", "ep.noPub": "Οι Εκδόσεις δεν άνοιξαν από εδώ.", "ep.noDoc": "Κανένα έγγραφο του Layout δεν συνδέεται ακόμη με αυτόν τον τίτλο: σύνδεσε ένα από Ρύθμιση εγγράφου › Τίτλος στις Εκδόσεις.", "ep.c.zip": "Δεν είναι αρχείο ZIP", "ep.c.mime": "Το αρχείο mimetype πρέπει να είναι πρώτο και ασυμπίεστο", "ep.c.container": "Το META-INF/container.xml λείπει ή δεν δείχνει αρχείο πακέτου", "ep.c.opf": "Το αρχείο πακέτου δεν διαβάζεται", "ep.c.xml": "Λάθος XML", "ep.c.meta-title": "Χωρίς τίτλο", "ep.c.meta-lang": "Χωρίς γλώσσα", "ep.c.meta-id": "Χωρίς μοναδικό αναγνωριστικό", "ep.c.meta-mod": "Χωρίς σωστή ημερομηνία τελευταίας αλλαγής (dcterms:modified)", "ep.c.isbn": "Λάθος ψηφίο ελέγχου στο ISBN", "ep.c.man-id": "Αναγνωριστικό αρχείου λείπει ή υπάρχει δύο φορές", "ep.c.man-missing": "Λείπει αρχείο της λίστας", "ep.c.man-type": "Λάθος τύπος αρχείου στη λίστα", "ep.c.man-extra": "Αρχείο που δεν είναι στη λίστα", "ep.c.spine": "Η σειρά ανάγνωσης δείχνει αρχείο εκτός λίστας", "ep.c.spine-type": "Η σειρά ανάγνωσης έχει αρχείο που δεν είναι σελίδα", "ep.c.nav": "Πρέπει να υπάρχει ακριβώς ένα αρχείο πλοήγησης", "ep.c.nav-toc": "Η πλοήγηση δεν έχει περιεχόμενα", "ep.c.cover": "Πάνω από μία εικόνα εξωφύλλου, ή εξώφυλλο που δεν είναι εικόνα", "ep.c.link": "Σύνδεσμος σε αρχείο που δεν είναι στο βιβλίο", "ep.c.frag": "Σύνδεσμος σε σημείο που δεν υπάρχει", "ep.c.id-dup": "Το ίδιο id δύο φορές σε μια σελίδα", "ep.c.svg-prop": "Σελίδα με SVG πρέπει να το δηλώνει (svg)", "ep.c.remote": "Αρχείο από το internet (το βιβλίο πρέπει να έχει τα αρχεία του)", "ep.c.script": "Σελίδα με script πρέπει να το δηλώνει (scripted)", "ep.c.fxl-vp": "Σελίδα fixed layout χωρίς μέγεθος viewport", "ep.c.enc": "Το encryption.xml δείχνει αρχείο που δεν υπάρχει", "ep.c.no-cover": "Χωρίς εικόνα εξωφύλλου", "ep.c.no-alt": "Εικόνα χωρίς περιγραφή", "ep.c.big-file": "Σελίδα πάνω από 300 KB (χώρισε το κεφάλαιο)", "ep.c.big-img": "Εικόνα πάνω από 4 megapixel", "ep.c.big-book": "Το βιβλίο είναι πάνω από 100 MB", "ep.c.no-a11y": "Χωρίς μεταδεδομένα προσβασιμότητας",
      "exp.quality": "Εικόνες", "exp.print": "Εκτύπωση (300 ppi)", "exp.screen": "Οθόνη (150 ppi)",
      "exp.go": "Εξαγωγή PDF", "exp.send": "Στείλε το PDF σε εφαρμογή…", "exp.sentAt": "Το PDF αποθηκεύτηκε στα Αρχεία › {path}", "exp.working": "Φτιάχνω το PDF…", "exp.done": "Το PDF αποθηκεύτηκε", "exp.fail": "Το PDF δεν μπόρεσε να φτιαχτεί.",
      "exp.badRange": "Αυτό το εύρος σελίδων δεν είναι σωστό.", "exp.pkgDone": "Το πακέτο αποθηκεύτηκε", "exp.pkgNote": "Ένα αρχείο με το έγγραφο και τις εικόνες του, για αντίγραφο ή για άνοιγμα σε άλλη συσκευή.",
      "imp.done": "Το έγγραφο άνοιξε", "imp.file": "Αρχεία (.oroslayout ή ένα .zip με αυτά, .sla με τις εικόνες και το PDF του, .idml, .pdf, .svg)…", "imp.disk": "Έναν φάκελο στα Αρχεία (όλα τα πακέτα του)…", "imp.diskTitle": "Άνοιγμα φακέλου από τα Αρχεία", "imp.diskUp": "Πάνω", "imp.diskGo": "Άνοιγμα", "imp.diskLooking": "Ψάχνω για έγγραφα…", "imp.diskFound": "Έγγραφα (.oroslayout) εδώ και στους φακέλους μέσα: {n}", "imp.diskNone": "Κανένα έγγραφο (.oroslayout) εδώ ή στους φακέλους μέσα.", "imp.manyWorking": "Ανοίγω τα έγγραφα…", "imp.many": "Έγγραφα που άνοιξαν: {n}", "imp.manyBad": "Έγγραφα που άνοιξαν: {n}. Αρχεία που δεν άνοιξαν: {bad}", "imp.full": "Ο χώρος γέμισε. Έγγραφα που άνοιξαν: {n}· τα υπόλοιπα δεν χωρούν. Σβήσε όσα δεν χρειάζεσαι και άνοιξε τα υπόλοιπα.", "imp.folder": "Έναν φάκελο: αποσυμπιεσμένο πακέτο ή έξοδο του Scribus…", "imp.newer": "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.", "pdf.start": "Ανοίγω το PDF…", "pdf.working": "Διαβάζω το PDF… σελίδα {n} από {t}", "pdf.bad": "Αυτό το PDF δεν άνοιξε.", "pdf.done": "Το PDF άνοιξε: {p} σελίδες, {n} πλαίσια κειμένου, {i} εικόνες. Σχέδια και φόντα είναι μία κλειδωμένη εικόνα ανά σελίδα, πίσω από όλα.", "pdf.cut": "Άνοιξαν μόνο οι πρώτες {n} από τις {t} σελίδες.",
      "imp.rebuild": "Αναδημιουργία PDF τυπογραφείου (με τις εικόνες του)…", "rb.noPdf": "Διάλεξε και το PDF: το PDF του τυπογραφείου, με τις εικόνες και τα κείμενά του αν τα έχεις.", "rb.bad": "Αυτό το PDF δεν αναδημιουργήθηκε.", "rb.start": "Αναδημιουργώ το PDF με {n} πρωτότυπα αρχεία…", "rb.working": "Αναδημιουργία… σελίδα {n} από {t}", "rb.stopped": "Η αναδημιουργία σταμάτησε. Δεν προστέθηκε τίποτα.", "rb.done": "Έτοιμο: {p} σελίδες.",
      "rb.title": "Τι κράτησε η αναδημιουργία", "ocr.menu": "Κείμενο από την εικόνα (OCR)…", "ocr.title": "Κείμενο από την εικόνα", "ocr.ask": "Το Layout διαβάζει το κείμενο με την ίδια αναγνώριση που έχουν τα Αρχεία και ο Σαρωτής & PDF (ελληνικά και αγγλικά). Την πρώτη φορά κατεβάζει μία φορά τη μηχανή· η εικόνα δεν φεύγει ποτέ από τη συσκευή.", "ocr.yes": "Λήψη και ανάγνωση", "ocr.working": "Διαβάζω το κείμενο της εικόνας…", "ocr.fail": "Το κείμενο δεν διαβάστηκε.", "ocr.offline": "Η μηχανή αναγνώρισης δεν κατέβηκε. Συνδέσου μία φορά στο διαδίκτυο και δοκίμασε ξανά.", "ocr.none": "Δεν βρέθηκε κείμενο στην εικόνα.", "ocr.found": "{n} γραμμές σε {f} κομμάτια κειμένου.", "ocr.hidden": "Κρυφά, ώστε η σελίδα να μείνει όπως είναι", "ocr.hint": "Κάθε κομμάτι γίνεται πλαίσιο κειμένου εκεί που είναι στην εικόνα, με στυλ στο μέγεθός του. Τα κρυφά πλαίσια εμφανίζονται με την Εμφάνιση κρυφών αντικειμένων στις Ιδιότητες.", "ocr.copy": "Αντιγραφή κειμένου", "ocr.place": "Τοποθέτηση ως πλαίσια κειμένου", "ocr.copied": "Το κείμενο αντιγράφηκε.", "ocr.noClip": "Η αντιγραφή δεν έγινε εδώ.", "ocr.style": "Από την εικόνα", "ocr.placed": "{n} πλαίσια κειμένου από την εικόνα.", "ocr.placedHidden": "{n} κρυφά πλαίσια κειμένου από την εικόνα.", "rb.drawn": "Σε αυτές τις σελίδες το κείμενο ήρθε ως σχήματα (το InDesign συχνά το κάνει περιγράμματα), άρα είναι μέρος της εικόνας της σελίδας. Διάβασέ το ως κείμενο:", "rb.ocrPage": "Σελίδα {n}", "rb.lines": "{n} από {t} γραμμές είναι εκεί που ήταν στο PDF ({p} %).", "rb.pics": "{n} εικόνες, οι {o} από τα πρωτότυπα αρχεία σου (οι υπόλοιπες από το PDF).", "rb.gray": "{n} από τις πρωτότυπες εικόνες σου είναι έγχρωμες, αλλά το PDF τις τυπώνει γκρι, οπότε είναι γκρι κι εδώ.", "rb.styles": "{n} στυλ παραγράφου.", "rb.frames": "Πλαίσια κειμένου", "rb.perPage": "Ανά σελίδα", "rb.thread": "Συνεχίζουν στις σελίδες", "rb.perPageHint": "Κάθε σελίδα κρατά τα δικά της πλαίσια, οπότε κάθε γραμμή μένει ακριβώς εκεί που ήταν στο PDF.", "rb.threadHint": "Το κείμενο κάθε άρθρου συνεχίζει από πλαίσιο σε πλαίσιο στις επόμενες σελίδες, έτσι οι διορθώσεις ρέουν. Αν μια γραμμή βγει μεγαλύτερη, μετακινούνται και όσες ακολουθούν.", "rb.go": "Αναδημιουργία", "rb.threads": "{n} άρθρα συνεχίζουν από σελίδα σε σελίδα, μέσα από {f} ακόμη πλαίσια.", "rb.af": "Από το αρχείο του Affinity: {n} πρωτότυπες εικόνες και οι λέξεις του, για τις λέξεις που κόβονται στο τέλος της γραμμής.", "rb.afStyles": "Τα στυλ του: {s}.", "rb.afFonts": "Οι γραμματοσειρές του: {f}.", "rb.afBad": "Το αρχείο του Affinity δεν διαβάστηκε, οπότε η αναδημιουργία έγινε μόνο από το PDF.", "rb.fonts": "Οι γραμματοσειρές έγιναν γραμματοσειρές του orOS, με αραίωση που κρατά κάθε γραμμή στο ίδιο πλάτος: {f}.", "rb.fontsSame": "Οι ίδιες γραμματοσειρές με το PDF, από τα αρχεία σου ή τις ελεύθερες γραμματοσειρές: {f}.", "rb.fontsTwin": "Ελεύθερες γραμματοσειρές με τα ίδια πλάτη γραμμάτων, στη θέση γραμματοσειρών που δεν είναι ελεύθερες: {f}.", "rb.numbers": "Η αρίθμηση ξεκινά από το {n}: οι αριθμοί είναι πεδία αριθμού σελίδας και ακολουθούν όταν μετακινούνται σελίδες. Τον πρώτο αριθμό τον αλλάζεις στις Ρυθμίσεις εγγράφου.", "rb.off": "Σελίδες όπου μετακινήθηκαν γραμμές. Έλεγξέ τες πριν τυπώσεις:", "rb.offLine": "{n} γραμμές", "rb.back": "Πίσω στον Βοηθό", "rb.noPage": "Αυτό το έγγραφο δεν έχει σελίδα {n}.",
      "idml.working": "Διαβάζω το αρχείο InDesign…", "idml.bad": "Αυτό το αρχείο δεν διαβάζεται ως έγγραφο InDesign (.idml).", "idml.done": "Εισαγωγή από InDesign: {p} σελίδες, {n} αντικείμενα.",
      "sla.working": "Διαβάζω το αρχείο Scribus…", "sla.bad": "Αυτό το αρχείο δεν διαβάζεται ως έγγραφο Scribus.", "sla.done": "Εισαγωγή από Scribus: {p} σελίδες, {n} αντικείμενα.", "sla.linked": "{n} εικόνες δεν ήταν μέσα στο αρχείο: βάλ’ τες ξανά με «Τοποθέτηση εικόνας».", "sla.find": "Βρες τις εικόνες…", "sla.fitting": "Ευθυγραμμίζω τις γραμμές με το PDF…", "sla.fit": "Αλλαγές γραμμής όπως στο PDF: {n} από {t} γραμμές.", "sla.fitBad": "Το κείμενο του PDF δεν ταίριαξε με αυτό το αρχείο, οπότε οι γραμμές σπάνε μόνες τους.", "sla.fitStyle": "Ταίριασμα γραμμής", "sla.relinked": "Τοποθετήθηκαν {n} εικόνες.", "sla.skipped": "{n} αντικείμενα (γεμίσματα πλέγματος ή μοτίβου, πλαίσια απόδοσης) έγιναν απλά πλαίσια, έχασαν το ειδικό γέμισμά τους ή παραλείφθηκαν.", "idml.skipped": "{n} αντικείμενα (κουμπιά και άλλα διαδραστικά) παραλείφθηκαν.", "idml.tables": "{n} πίνακες έγιναν γραμμές κειμένου με στηλοθέτες στις στήλες τους (χωρίς περιγράμματα).", "idml.notes": "{n} υποσημειώσεις μπήκαν μετά το τέλος του κειμένου τους.", "svg.working": "Διαβάζω τα αρχεία SVG…", "svg.bad": "Αυτά τα αρχεία δεν διαβάζονται ως σελίδες SVG.", "svg.done": "Εισαγωγή SVG: {p} σελίδες, {n} αντικείμενα.", "svg.skipped": "{n} στοιχεία (γεμίσματα μοτίβου, κείμενο σε διαδρομή και άλλα εφέ) παραλείφθηκαν ή απλοποιήθηκαν.", "imp.bad": "Αυτό το αρχείο δεν είναι πακέτο της Σελιδοποίησης.", "imp.imgFail": "{n} εικόνες δεν επανήλθαν.", "imp.fontFail": "Το έγγραφο άνοιξε. {n} αρχεία γραμματοσειρών δεν επανήλθαν: το κείμενό τους φαίνεται με γραμματοσειρά αντικατάστασης.",
      "img.fail": "Αυτό το αρχείο δεν διαβάζεται ως εικόνα.", "img.nofs": "Ο δίσκος του orOS δεν είναι διαθέσιμος σε αυτή τη συσκευή.",
      "img.placed": "Η εικόνα τοποθετήθηκε", "img.missing": "Συγχρονίζεται…", "img.sent": "Η εικόνα μπήκε στη σελίδα",
      "txt.fail": "Αυτό το αρχείο δεν διαβάζεται ως κείμενο.", "txt.done": "Το κείμενο εισήχθη",
      "wd.title": "Στυλ παραγράφων για το κείμενο", "wd.hint": "Κάθε είδος παραγράφου του αρχείου παίρνει το στυλ που διαλέγεις εδώ. Η επιλογή μένει στο έγγραφο για την επόμενη φορά.",
      "wd.go": "Τοποθέτηση", "wd.done": "Το κείμενο τοποθετήθηκε: {n} παράγραφοι",
      "wd.h1": "Επικεφαλίδα 1", "wd.h2": "Επικεφαλίδα 2", "wd.h3": "Επικεφαλίδα 3 και μικρότερες", "wd.p1": "Πρώτη παράγραφος μετά από επικεφαλίδα ή κενή γραμμή",
      "wd.p": "Οι άλλες παράγραφοι", "wd.center": "Στοιχισμένες στο κέντρο", "wd.quote": "Παραθέματα", "wd.li": "Στοιχεία λίστας",
      "more.house": "Ύφος έκδοσης…",
      "hs.badge": "Ύφος έκδοσης",
      "hs.learn": "Εκμάθηση ύφους έκδοσης",
      "hs.learnHint": "Διάλεξε δύο ή τρία προηγούμενα βιβλία της ίδιας σειράς (έγγραφα της Σελιδοποίησης ή αρχεία που άνοιξες από Scribus, InDesign ή PDF τυπογραφείου). Η Σελιδοποίηση κρατά ό,τι έχουν κοινό ως νέο έγγραφο ύφους: ένα πρότυπο που αλλάζεις, μαζί με τους κανόνες του.",
      "hs.name": "Όνομα",
      "hs.defName": "Ύφος έκδοσης",
      "hs.go": "Εκμάθηση",
      "hs.none": "Δεν βρέθηκε κείμενο σε αυτά τα έγγραφα.",
      "hs.noNamed": "Δεν υπάρχει ύφος έκδοσης με το όνομα «{n}».",
      "hs.done": "Το ύφος είναι έτοιμο",
      "hs.repWorks": "Μαθεύτηκε από {n} έργα.",
      "hs.repPages": "Κρατήθηκαν {f} αρχικές και {b} τελικές σελίδες, με μια κενή σελίδα κειμένου ανάμεσα.",
      "hs.repRoles": "Στυλ που βρέθηκαν: {list}",
      "hs.repRules": "{n} κανόνες ήρθαν από τα έργα και προστέθηκαν οι ελληνικοί τυπογραφικοί κανόνες. Έλεγξέ τους στο φύλλο κανόνων.",
      "hs.repSkipped": "{n} έγγραφα δεν είχαν κείμενο και έμειναν έξω.",
      "hs.sheet": "Φύλλο κανόνων",
      "hs.sheetHint": "Μαθεύτηκε από {n} έργα. Άναψε ή σβήσε κανόνες και πρόσθεσε δικούς σου. Η Αποθήκευση τους περνά στα στυλ παραγράφου.",
      "hs.roles": "Στυλ για κάθε μέρος",
      "hs.noStyle": "(κανένα)",
      "hs.src.works": "Από τα έργα",
      "hs.src.greek": "Ελληνικοί τυπογραφικοί κανόνες",
      "hs.src.own": "Οι δικοί σου κανόνες",
      "hs.del": "Αφαίρεση",
      "hs.add": "Νέος κανόνας",
      "hs.addPh": "Με απλά λόγια, π.χ. τα ποιήματα στο κέντρο",
      "hs.addDoes": "Τι ρυθμίζει",
      "hs.does.none": "Τίποτα: υπενθύμιση για έλεγχο",
      "hs.does.titlePage": "Οι τίτλοι ξεκινούν σε νέα σελίδα",
      "hs.does.titleOdd": "Οι τίτλοι ξεκινούν σε μονή σελίδα",
      "hs.does.kwn": "Οι τίτλοι μένουν με την επόμενη παράγραφο",
      "hs.does.firstFlush": "Η πρώτη παράγραφος χωρίς εσοχή",
      "hs.does.hyphOff": "Χωρίς συλλαβισμό στο σώμα",
      "hs.addBtn": "Προσθήκη",
      "hs.save": "Αποθήκευση",
      "hs.saved": "Οι κανόνες αποθηκεύτηκαν· άλλαξαν {n} στυλ",
      "hs.fixed": "διορθώθηκαν {n} εισαγωγικά, παύλες ή κενά",
      "hs.role.body": "Σώμα κειμένου",
      "hs.role.first": "Πρώτη παράγραφος",
      "hs.role.title": "Τίτλος",
      "hs.role.subtitle": "Υπότιτλος",
      "hs.role.center": "Στο κέντρο",
      "hs.role.quote": "Παράθεμα",
      "hs.role.note": "Μικρό κείμενο",
      "hr.w.titlePage": "Οι τίτλοι ξεκινούν σε νέα σελίδα ({n} από {of}).",
      "hr.w.titleOdd": "Οι τίτλοι ξεκινούν σε νέα μονή σελίδα ({n} από {of}).",
      "hr.w.firstFlush": "Η πρώτη παράγραφος μετά τον τίτλο δεν έχει εσοχή ({n} από {of} έργα).",
      "hr.w.sink": "Οι τίτλοι ξεκινούν περίπου {mm} mm κάτω από το πάνω περιθώριο.",
      "hr.w.bodyDiff": "Το σώμα κειμένου διαφέρει ανάμεσα στα έργα: {list}.",
      "hr.w.sizeDiff": "Το μέγεθος σελίδας διαφέρει ανάμεσα στα έργα: {list}.",
      "hr.gr.hyph": "Οι ελληνικές λέξεις συλλαβίζονται στο τέλος της γραμμής.",
      "hr.gr.orph": "Τουλάχιστον 2 γραμμές παραγράφου στο κάτω μέρος σελίδας ή στήλης.",
      "hr.gr.wid": "Τουλάχιστον 2 γραμμές παραγράφου περνούν στην επόμενη σελίδα ή στήλη.",
      "hr.gr.kwnTitle": "Ο τίτλος μένει μαζί με το κείμενο που ακολουθεί.",
      "hr.gr.kwnSub": "Ο υπότιτλος μένει μαζί με το κείμενο που ακολουθεί.",
      "hr.gr.hyphTitle": "Οι τίτλοι δεν συλλαβίζονται.",
      "hr.gr.hyphSub": "Οι υπότιτλοι δεν συλλαβίζονται.",
      "hr.gr.quotes": "Τα εισαγωγικά γίνονται « » (και “ ” μέσα σε αυτά) όταν μπαίνει κείμενο.",
      "hr.gr.dash": "Η γραμμή διαλόγου ξεκινά με παύλα (—) και το ενωτικό ανάμεσα σε κενά γίνεται μεσαία παύλα (–), όταν μπαίνει κείμενο.",
      "hr.gr.ellipsis": "Οι τρεις τελείες γίνονται αποσιωπητικά (…) όταν μπαίνει κείμενο.",
      "hr.gr.spaces": "Τα διπλά κενά γίνονται μονά όταν μπαίνει κείμενο.",
      "more.auto": "Αυτόματη σελιδοποίηση…",
      "more.toc": "Ενημέρωση περιεχομένων",
      "au.title": "Αυτόματη σελιδοποίηση",
      "au.noHouse": "Δεν υπάρχει ακόμα ύφος έκδοσης. Μάθε πρώτα ένα από δύο ή τρία προηγούμενα βιβλία.",
      "au.hint": "Διάλεξε ύφος έκδοσης και χειρόγραφο (Word, OpenDocument, RTF, Markdown ή κείμενο). Η Σελιδοποίηση φτιάχνει νέο βιβλίο σε αυτό το ύφος: αρχικές και τελικές σελίδες, το κείμενο σε όσες σελίδες χρειάζεται, τα περιεχόμενα. Τα πεδία {τίτλος}, {υπότιτλος}, {συγγραφέας}, {isbn}, {έτος} (ή {title}, {author}, {year}) στις σελίδες του ύφους παίρνουν τα στοιχεία από κάτω.",
      "au.house": "Ύφος έκδοσης",
      "au.noFile": "Δεν διάλεξες χειρόγραφο",
      "au.file": "Επιλογή χειρογράφου…",
      "au.pub": "Στοιχεία από τις Εκδόσεις",
      "au.pubNone": "(τα γράφω)",
      "au.f.title": "Τίτλος",
      "au.f.subtitle": "Υπότιτλος",
      "au.f.author": "Συγγραφέας",
      "au.f.isbn": "ISBN",
      "au.f.year": "Έτος",
      "au.keepFront": "Κράτα τις αρχικές σελίδες του χειρογράφου (τίτλο, περιεχόμενα…)",
      "au.go": "Σελιδοποίηση",
      "au.working": "Σελιδοποιώ το βιβλίο…",
      "au.done": "Η πρώτη σελιδοποίηση είναι έτοιμη",
      "au.repPages": "{n} σελίδες, οι {b} με κείμενο.",
      "au.repTitles": "{n} τίτλοι.",
      "au.repGuessed": "{n} τίτλοι βρέθηκαν από την εμφάνισή τους (σύντομη γραμμή με έντονα ή στο κέντρο μετά από κενές γραμμές): έλεγξέ τους.",
      "au.repFixes": "Διορθώθηκαν: {q} εισαγωγικά, {d} παύλες, {e} αποσιωπητικά, {s} διπλά κενά. Καμία λέξη δεν άλλαξε.",
      "au.repFields": "{n} πεδία συμπληρώθηκαν με τα στοιχεία του βιβλίου.",
      "au.repToc": "Περιεχόμενα: {n} εγγραφές. Μετά από αλλαγές, Περισσότερα › Ενημέρωση περιεχομένων.",
      "au.repFront": "{n} παράγραφοι από τις αρχικές σελίδες του χειρογράφου έμειναν έξω: μπαίνουν του ύφους.",
      "au.repDropped": "{n} κενές παράγραφοι που έκαναν απόσταση έμειναν έξω.",
      "au.repNoStyle": "Το ύφος δεν έχει δικό του στυλ για: {list}. Πήραν το στυλ του σώματος.",
      "au.repPics": "{n} εικόνες του χειρογράφου δεν μπήκαν: βάλε τες με το χέρι.",
      "au.repCheck": "Έλεγξε αυτές τις σελίδες:",
      "au.why.overset": "το κείμενο δεν χωράει",
      "au.why.oversetOther": "ένα πλαίσιο κειμένου ξεχειλίζει",
      "au.noToc": "Αυτό το έγγραφο δεν έχει περιεχόμενα για ενημέρωση.",
      "au.tocDone": "Τα περιεχόμενα ενημερώθηκαν: {n} εγγραφές",
      "more.sheet": "Φύλλο βιβλίου…",
      "au.f.editor": "Επιμέλεια",
      "au.f.publisher": "Εκδότης",
      "au.repMoved": "{n} ενότητες του χειρογράφου μετακινήθηκαν όπως λέει το φύλλο.",
      "au.repLeft": "{n} παράγραφοι πήγαν σε δική τους σελίδα (αφιέρωση, μότο) ή έμειναν έξω, όπως λέει το φύλλο.",
      "au.repBare": "{n} σελίδες, όπου ανοίγει τίτλος ή που είναι κενές, δεν έχουν αριθμό σελίδας.",
      "au.repNotes": "Μπήκαν {n} σημειώσεις από το Word.",
      "au.repNotesLeft": "{n} σημάδια σημειώσεων δεν είχαν κείμενο σημείωσης και παραλείφθηκαν.",
      "in.title": "Πώς να στηθεί αυτό το βιβλίο;",
      "in.hint": "Το χειρόγραφο έχει {n} τίτλους. Κάθε απάντηση ξεκινά όπως είναι στη σειρά· άλλαξε μόνο ό,τι διαφέρει σε αυτό το βιβλίο. Οι απαντήσεις μένουν στο νέο βιβλίο (Περισσότερα › Φύλλο βιβλίου…).",
      "in.allSeries": "Όλα όπως στη σειρά",
      "in.g.page": "Σελίδα και δομή",
      "in.g.front": "Αρχικές και τελικές σελίδες",
      "in.g.type": "Τυπογραφία ανά μέρος",
      "in.g.text": "Κείμενο",
      "in.series": "Όπως στη σειρά ({v})",
      "in.asSeries": "Όπως στη σειρά",
      "in.mm": "{n} mm από πάνω",
      "in.none": "Καμία",
      "in.yes": "Ναι",
      "in.no": "Όχι",
      "in.q.size": "Μέγεθος σελίδας",
      "in.q.marg": "Περιθώρια (κενό: όπως στη σειρά)",
      "in.marg.t": "Πάνω",
      "in.marg.b": "Κάτω",
      "in.marg.i": "Μέσα",
      "in.marg.o": "Έξω",
      "in.q.start": "Πού ξεκινά κάθε νέο κεφάλαιο",
      "in.q.parts": "Τα μέρη (Μέρος πρώτο…)",
      "in.q.sink": "Πόσο χαμηλά ξεκινά ο τίτλος κεφαλαίου",
      "in.q.first": "Η πρώτη παράγραφος του κεφαλαίου",
      "in.q.sep": "Αλλαγή σκηνής",
      "in.q.pn": "Αριθμοί σελίδας",
      "in.q.pnHide": "Αριθμοί στις αρχές κεφαλαίων και στις κενές σελίδες",
      "in.q.pnStart": "Αριθμός της πρώτης σελίδας",
      "in.q.toc": "Περιεχόμενα",
      "in.q.tocParts": "Στα περιεχόμενα",
      "in.q.hyph": "Συλλαβισμός",
      "in.q.widows": "Χήρες και ορφανές (τουλάχιστον δύο γραμμές)",
      "in.q.fix": "Εισαγωγικά, παύλες και αποσιωπητικά",
      "in.q.pages": "Σελίδες της σειράς που κρατάς",
      "in.q.at": "{s}: πού μπαίνει",
      "in.q.ded": "Αφιέρωση (σε δική της δεξιά σελίδα)",
      "in.q.motto": "Μότο (σε δική του δεξιά σελίδα)",
      "in.size.120x190": "120 × 190 mm",
      "in.size.140x210": "140 × 210 mm",
      "in.size.148x210": "148 × 210 mm (A5)",
      "in.size.170x240": "170 × 240 mm",
      "in.start.odd": "Σε δεξιά σελίδα",
      "in.start.even": "Σε αριστερή σελίδα",
      "in.start.page": "Σε νέα σελίδα, όπου πέσει",
      "in.start.run": "Αμέσως μετά το προηγούμενο",
      "in.parts.own": "Σε δική τους σελίδα",
      "in.parts.chap": "Όπως τα κεφάλαια",
      "in.sink.top": "Στην κορυφή της σελίδας",
      "in.sink.third": "Στο ένα τρίτο της σελίδας",
      "in.first.flush": "Χωρίς εσοχή",
      "in.first.indent": "Με εσοχή",
      "in.sep.keep": "Όπως στο χειρόγραφο",
      "in.sep.stars": "***",
      "in.sep.spaced": "* * *",
      "in.sep.aster": "⁂",
      "in.sep.blank": "Κενή γραμμή",
      "in.pn.footC": "Κάτω, στο κέντρο",
      "in.pn.footOut": "Κάτω, στην εξωτερική άκρη",
      "in.pn.footIn": "Κάτω, στην εσωτερική άκρη",
      "in.pn.headOut": "Πάνω, στην εξωτερική άκρη",
      "in.pn.headC": "Πάνω, στο κέντρο",
      "in.pn.headIn": "Πάνω, στην εσωτερική άκρη",
      "in.pn.none": "Χωρίς αριθμούς",
      "in.pnHide.hide": "Κρυφοί",
      "in.pnHide.show": "Φαίνονται",
      "in.q.rh": "Τρέχουσες επικεφαλίδες",
      "in.rh.none": "Χωρίς",
      "in.rh.titleChap": "Ο τίτλος του βιβλίου αριστερά, του κεφαλαίου δεξιά",
      "in.rh.authorTitle": "Ο συγγραφέας αριστερά, ο τίτλος δεξιά",
      "in.rh.own": "Όπως τις έχει η σειρά",
      "in.q.fnAt": "Σημειώσεις του Word",
      "in.fnAt.chap": "Στο τέλος κάθε κεφαλαίου",
      "in.fnAt.book": "Στο τέλος του βιβλίου",
      "in.toc.start": "Στην αρχή",
      "in.toc.end": "Στο τέλος",
      "in.toc.none": "Χωρίς περιεχόμενα",
      "in.tocParts.parts": "Μέρη και κεφάλαια",
      "in.tocParts.chap": "Μόνο κεφάλαια",
      "in.hyph.on": "Ναι",
      "in.hyph.off": "Όχι",
      "in.widows.on": "Ναι",
      "in.widows.off": "Όχι",
      "in.fix.on": "Ελληνικά «», — και …",
      "in.fix.off": "Όπως είναι",
      "in.side.front": "αρχή",
      "in.side.back": "τέλος",
      "in.tocPage": "περιεχόμενα",
      "in.sec.prologue": "Πρόλογος",
      "in.sec.thanks": "Ευχαριστίες",
      "in.sec.notes": "Σημειώσεις",
      "in.sec.bio": "Βιογραφικό",
      "in.sec.links": "Σύνδεσμοι",
      "in.at.s": "Όπως στο χειρόγραφο",
      "in.at.front": "Πριν το πρώτο κεφάλαιο",
      "in.at.back": "Μετά το τελευταίο κεφάλαιο",
      "in.at.out": "Να μη μπει",
      "in.part.body": "Κυρίως κείμενο",
      "in.part.title": "Τίτλοι κεφαλαίων",
      "in.part.part": "Τίτλοι μερών",
      "in.part.toc": "Περιεχόμενα",
      "in.part.colophon": "Σελίδα εκδότη",
      "in.part.thanks": "Ευχαριστίες",
      "in.part.links": "Σύνδεσμοι",
      "in.part.ded": "Αφιέρωση και μότο",
      "in.change": "Αλλαγή…",
      "in.font": "Γραμματοσειρά",
      "in.size": "Μέγεθος",
      "in.lead": "Διάστιχο",
      "in.alignQ": "Στοίχιση",
      "in.track": "Αραίωση (1/1000 em)",
      "in.align.l": "αριστερή",
      "in.align.c": "στο κέντρο",
      "in.align.r": "δεξιά",
      "in.align.j": "πλήρης",
      "in.font.serif": "Serif",
      "in.font.sans": "Sans",
      "in.font.mono": "Mono",
      "in.keep": "Κράτα αυτές τις απαντήσεις ως κανόνες της σειράς (όχι τις σελίδες, την αφιέρωση ή το μότο)",
      "in.n.part": "Τίτλος μέρους",
      "in.n.open": "Τίτλος κεφαλαίου (μετά από μέρος)",
      "in.n.sep": "Αλλαγή σκηνής",
      "in.n.toc": "Γραμμή περιεχομένων",
      "in.n.tocHead": "Περιεχόμενα",
      "in.n.thanks": "Ευχαριστίες",
      "in.n.links": "Σύνδεσμοι",
      "in.n.ded": "Αφιέρωση",
      "in.n.pn": "Αριθμός σελίδας",
      "in.n.rh": "Τρέχουσα επικεφαλίδα",
      "in.n.rhL": "Τρέχουσα επικεφαλίδα (αριστερά)",
      "in.n.rhR": "Τρέχουσα επικεφαλίδα (δεξιά)",
      "in.n.note": "Σημείωση",
      "in.n.noteHead": "Τίτλος σημειώσεων",
      "in.n.notesHead": "Σημειώσεις",
      "in.n.first": "Πρώτη παράγραφος",
      "in.n.colophon": "Σελίδα εκδότη",
      "in.g.pics": "Φωτογραφίες",
      "in.picsHint": "Το χειρόγραφο έχει {n} φωτογραφίες. Η καθεμία πηγαίνει με την παράγραφο που ακολουθεί· μια σύντομη παράγραφος αμέσως μετά, που μοιάζει με λεζάντα, γίνεται η λεζάντα της.",
      "in.q.picAt": "Πού μπαίνουν οι φωτογραφίες",
      "in.picAt.page": "Σε δική τους σελίδα, πριν από τη σελίδα όπου ανήκουν",
      "in.picAt.before": "Στην κορυφή της σελίδας, με το κείμενο από κάτω",
      "in.picAt.flow": "Μέσα στο κείμενο, εκεί όπου ανήκουν· το κείμενο συνεχίζει από κάτω",
      "in.picAt.each": "Διαλέγω για κάθε φωτογραφία",
      "in.picAt.out": "Να μη μπουν",
      "in.q.picSize": "Μέγεθος φωτογραφίας",
      "in.picSize.text": "Μέσα στα περιθώρια",
      "in.picSize.page": "Όλη η σελίδα, ως το ξάκρισμα",
      "in.q.cap": "Λεζάντες",
      "in.cap.below": "Κάτω από τη φωτογραφία",
      "in.cap.above": "Πάνω από τη φωτογραφία",
      "in.cap.none": "Χωρίς λεζάντες",
      "in.q.capSrc": "Κείμενο λεζάντας",
      "in.capSrc.para": "Η παράγραφος μετά τη φωτογραφία",
      "in.capSrc.file": "Το όνομα της φωτογραφίας",
      "in.capSrc.typed": "Τις γράφω εγώ",
      "in.q.grey": "Χρώμα",
      "in.grey.no": "Όπως είναι",
      "in.grey.yes": "Ασπρόμαυρες",
      "in.extra": "Φωτογραφίες εκτός χειρογράφου…",
      "in.extraN": "{n} φωτογραφίες επιλέχθηκαν",
      "in.q.extraAt": "Πού μπαίνουν αυτές οι φωτογραφίες",
      "in.extraAt.end": "Στο τέλος του βιβλίου",
      "in.extraAt.after": "Μετά το «{t}»",
      "in.eachPic": "Κάθε φωτογραφία ({n})…",
      "in.picN": "Φωτογραφία {n}",
      "in.capPh": "Λεζάντα (κενό: όπως απαντήθηκε πιο πάνω)",
      "in.part.cap": "Λεζάντες",
      "in.n.cap": "Λεζάντα",
      "au.repPlaced": "Μπήκαν {n} φωτογραφίες.",
      "au.repPicsOut": "{n} φωτογραφίες δεν μπήκαν, όπως απαντήθηκε ή επειδή δεν διαβάστηκαν.",
      "au.repOverset": "Το κείμενο δεν χωράει ακόμη: πρόσθεσε σελίδες ή δες τις φωτογραφίες.",
      "inframe.aria": "Πληκτρολόγηση στο πλαίσιο κειμένου",
      "story.title": "Επεξεργαστής κειμένου", "story.empty": "Γράψε εδώ…", "story.ps": "Στυλ παραγράφου", "story.cs": "Στυλ χαρακτήρων",
      "story.b": "Έντονα", "story.i": "Πλάγια", "story.u": "Υπογράμμιση", "story.pn": "Αριθμός σελίδας", "story.pc": "Σύνολο σελίδων", "story.sec": "Τρέχουσα επικεφαλίδα (ο τίτλος κεφαλαίου της σελίδας)",
      "story.chars": "{n} χαρακτήρες", "story.overset": "· περισσεύει", "story.none": "Διάλεξε πρώτα ένα πλαίσιο κειμένου.",
      "rec.title": "Ανακτημένο κείμενο", "rec.note": "Άλλαξε σε δύο συσκευές ταυτόχρονα: η άλλη εκδοχή φυλάγεται εδώ.",
      "rec.copy": "Αντιγραφή", "rec.copied": "Αντιγράφηκε", "rec.del": "Απόρριψη",
      "toast.deleted": "Διαγράφηκε", "toast.docDeleted": "Το έγγραφο διαγράφηκε", "toast.save": "Ο χώρος γέμισε: οι τελευταίες αλλαγές δεν αποθηκεύτηκαν σε αυτή τη συσκευή.", "toast.diskSave": "Οι τελευταίες αλλαγές δεν γράφτηκαν ακόμη στα Αρχεία › Layout. Κρατιούνται εδώ και γράφονται με την επόμενη αλλαγή.", "toast.diskRead": "Αρχεία που δεν διαβάστηκαν στα Αρχεία › Layout: {n}. Μένουν όπως είναι.", "toast.diskOff": "Ο δίσκος του orOS δεν διαβάζεται τώρα: τα έγγραφα μένουν σε αυτόν τον browser μέχρι την επόμενη εκκίνηση.",
      "toast.big": "Το έγγραφο μεγαλώνει ({n} KB). Τα μεγάλα έγγραφα γεμίζουν τον χώρο που μοιράζονται όλες οι εφαρμογές.",
      "toast.locked": "Αυτό το αντικείμενο είναι κλειδωμένο.", "toast.gone": "Αυτό το έγγραφο διαγράφηκε σε άλλη συσκευή.",
      "toast.fontFail": "Οι γραμματοσειρές δεν φόρτωσαν.", "toast.maxItems": "Ένα έγγραφο έχει το πολύ {n} αντικείμενα.",
      "toast.flowDone": "Το κείμενο μπήκε σε {n} νέες σελίδες.", "toast.flowMax": "Σταμάτησα στις {n} σελίδες: το κείμενο ακόμα περισσεύει.",
      "toast.copied": "Αντιγράφηκε", "ed.paste": "Επικόλληση",
      "cb.title": "Εργαλεία επιλογής", "cb.more": "Περισσότερα", "ruler.unit": "Χάρακες και μεγέθη τώρα σε {u}.", "more.history": "Ιστορικό…", "more.keys": "Συντομεύσεις και άνεση…", "hist.title": "Ιστορικό", "hist.none": "Δεν υπάρχουν ακόμη αλλαγές για επιστροφή.", "hist.start": "Αρχή του ιστορικού", "hist.now": "τώρα", "hist.hint": "Πάτα ένα βήμα για να γυρίσεις σε αυτό, ή ξανά μπροστά. Μια νέα αλλαγή αφού γυρίσεις πίσω σβήνει τα βήματα που ήταν μπροστά.", "hist.add": "Προσθήκη αντικειμένου", "hist.addN": "Προσθήκη {n} αντικειμένων", "hist.del": "Διαγραφή αντικειμένου", "hist.delN": "Διαγραφή {n} αντικειμένων", "hist.move": "Μετακίνηση", "hist.moveN": "Μετακίνηση {n} αντικειμένων", "hist.resize": "Αλλαγή μεγέθους", "hist.resizeN": "Αλλαγή μεγέθους {n} αντικειμένων", "hist.rotate": "Περιστροφή", "hist.rotateN": "Περιστροφή {n} αντικειμένων", "hist.change": "Αλλαγή αντικειμένου", "hist.changeN": "Αλλαγή {n} αντικειμένων", "hist.text": "Επεξεργασία κειμένου", "hist.style": "Αλλαγή στυλ", "hist.styleN": "Στυλ «{name}»", "hist.colour": "Αλλαγή χρωμάτων", "hist.pages": "Αλλαγή σελίδων", "hist.master": "Αλλαγή master", "hist.setup": "Ρυθμίσεις εγγράφου", "hist.guide": "Οδηγοί", "hist.edit": "Πολλές αλλαγές", "keys.title": "Συντομεύσεις και άνεση", "keys.press": "Πάτα τα πλήκτρα…", "keys.none": "καμία", "keys.change": "Πάτα για αλλαγή", "keys.default": "Αρχική", "keys.clear": "Χωρίς συντόμευση", "keys.reserved": "Το {k} μένει για πληκτρολόγηση, αντιγραφή ή για το ίδιο το orOS.", "keys.clash": "Το {k} ήταν η συντόμευση του «{a}», που τώρα δεν έχει καμία.", "keys.hint": "Πάτα μια συντόμευση και μετά τα νέα πλήκτρα (το Esc κρατά την παλιά). Τα γράμματα είναι οι θέσεις των πλήκτρων, άρα δουλεύουν και με ελληνικό πληκτρολόγιο. Αποθηκεύονται σε αυτή τη συσκευή.", "keys.comfort": "Άνεση", "keys.nudge": "Τα βελάκια μετακινούν κατά ({u})", "keys.nudgeHint": "Με Shift δέκα φορές πιο μακριά, με Alt το ένα δέκατο. Πάτα τη γωνία των χαράκων για mm, pt ή in.", "keys.smart": "Έξυπνοι οδηγοί: έλξη σε ίσες αποστάσεις", "keys.measure": "Μεγέθη και θέσεις την ώρα που σέρνεις", "keys.ctxbar": "Γραμμή εργαλείων πάνω από την επιλογή", "keys.resetAll": "Όλες οι συντομεύσεις στις αρχικές", "ka.tool.select": "Επιλογή", "ka.tool.text": "Πλαίσιο κειμένου", "ka.tool.image": "Πλαίσιο εικόνας", "ka.tool.rect": "Ορθογώνιο", "ka.tool.ell": "Έλλειψη", "ka.tool.line": "Γραμμή", "ka.tool.pen": "Πένα", "ka.tool.hand": "Χέρι", "ka.preview": "Προεπισκόπηση", "ka.undo": "Αναίρεση", "ka.redo": "Επανάληψη", "ka.dup": "Διπλασιασμός", "ka.selall": "Επιλογή όλων στη σελίδα", "ka.group": "Ομαδοποίηση", "ka.ungroup": "Κατάργηση ομάδας", "ka.export": "Εξαγωγή", "ka.fit": "Προσαρμογή σελίδας", "ka.zoom100": "Ζουμ 100 %", "ka.front": "Μπροστά απ' όλα", "ka.back": "Πίσω απ' όλα", "ka.fwd": "Ένα μπροστά", "ka.bwd": "Ένα πίσω", "ka.lock": "Κλείδωμα θέσης", "ka.history": "Ιστορικό", "ka.story": "Επεξεργαστής κειμένου", "ka.keys": "Συντομεύσεις και άνεση", "ka.find": "Εύρεση/Αλλαγή", "ka.spell": "Ορθογραφία", "pf.glyph": "Χαρακτήρες που η γραμματοσειρά δεν έχει: {c}", "more.hjOn": "Εμφάνιση αραιών και πυκνών γραμμών", "more.hjOff": "Απόκρυψη αραιών και πυκνών γραμμών", "hj.on": "Οι αραιές γραμμές είναι κίτρινες, οι πυκνές ροζ.", "hj.off": "Οι αραιές και πυκνές γραμμές κρύφτηκαν.", "sty.sc": "Μικρά κεφαλαία", "sty.posNone": "Κανονική θέση", "sty.posSup": "Εκθέτης", "sty.posSub": "Δείκτης", "sty.comp": "Στοιχειοθεσία", "sty.composer": "Στοιχειοθέτης", "sty.compS": "Γραμμή γραμμή", "sty.compP": "Όλη η παράγραφος", "sty.wsMin": "Διάστημα λέξεων, ελάχιστο (%)", "sty.wsMax": "Διάστημα λέξεων, μέγιστο (%)", "sty.lsMax": "Διάστημα γραμμάτων, μέγιστο (1/1000 em)", "sty.dcN": "Αρχίγραμμα: γραμμές", "sty.dcC": "Αρχίγραμμα: γράμματα", "sty.opt": "Οπτικά περιθώρια", "sty.bal": "Ισορροπημένες γραμμές", "sty.compHint": "Το «Όλη η παράγραφος» ζυγίζει μαζί όλες τις γραμμές μιας παραγράφου, για ομοιόμορφα διαστήματα και λιγότερους συλλαβισμούς. Οι πλήρως στοιχισμένες γραμμές κρατούν τα κενά ανάμεσα στο ελάχιστο και το μέγιστο διάστημα λέξεων και μετά ανοίγουν τα γράμματα έως το μέγιστό τους. Τα οπτικά περιθώρια αφήνουν τα σημεία στίξης να κρέμονται έξω από την άκρη. Το Περισσότερα › Εμφάνιση αραιών και πυκνών γραμμών σημαδεύει όσες βγαίνουν από τα όρια.", "note.menu": "Σημειώσεις, παραπομπές και σύνδεσμοι", "note.ins": "Εισαγωγή σημείωσης…", "note.edit": "Σημείωση", "note.empty": "Κενή σημείωση", "note.text": "Κείμενο της σημείωσης", "note.hint": "Η σημείωση αριθμείται μόνη της και μπαίνει στο κάτω μέρος της στήλης (ή μετά το κείμενο, με σημειώσεις τέλους). Μια νέα γραμμή ξεκινά νέα παράγραφο της σημείωσης. Πάτα τον αριθμό της στον Επεξεργαστή κειμένου για να την αλλάξεις ή να την αφαιρέσεις.", "note.del": "Αφαίρεση της σημείωσης", "note.settings": "Σημειώσεις…", "note.kind": "Οι σημειώσεις μπαίνουν", "note.foot": "Στο κάτω μέρος της στήλης (υποσημειώσεις)", "note.end": "Μετά το κείμενο (σημειώσεις τέλους)", "note.ps": "Στυλ παραγράφου των σημειώσεων", "note.psAuto": "Μικρότερο κείμενο σώματος", "note.num": "Αρίθμηση", "note.numDoc": "Σε όλο το έγγραφο", "note.numStory": "Από το 1 σε κάθε κείμενο", "note.setHint": "Μια γραμμή που θα άφηνε πίσω τη σημείωσή της πηγαίνει μαζί της στην επόμενη στήλη. Στο EPUB οι σημειώσεις ανοίγουν σε αναδυόμενο παράθυρο, στο τέλος του κεφαλαίου τους.", "xr.title": "Παραπομπή", "xr.ins": "Εισαγωγή παραπομπής…", "xr.show": "Εμφάνιση", "xr.k.p": "Ο αριθμός σελίδας", "xr.k.t": "Το κείμενο της παραγράφου", "xr.k.tp": "Κείμενο και σελίδα", "xr.search": "Αναζήτηση στις παραγράφους", "xr.none": "Δεν βρέθηκαν τίτλοι. Γράψε λίγα γράμματα για να ψάξεις σε όλες τις παραγράφους.", "xr.hint": "Ο αριθμός ακολουθεί τη σελίδα όταν μετακινείται το κείμενο. Στο PDF είναι σύνδεσμος προς εκείνη τη σελίδα, στο EPUB προς την παράγραφο.", "link.ins": "Σύνδεσμος…", "link.title": "Σύνδεσμος", "link.url": "Διεύθυνση ιστού ή e-mail", "link.hint": "Στις επιλεγμένες λέξεις. Στο PDF και στο EPUB ανοίγουν τη διεύθυνση.", "link.bad": "Αυτή δεν είναι διεύθυνση ιστού (https://) ή e-mail (mailto:).", "link.remove": "Αφαίρεση του συνδέσμου", "link.pick": "Επίλεξε πρώτα τις λέξεις του συνδέσμου.", "more.contents": "Περιεχόμενα από στυλ…", "more.notes": "Σημειώσεις…", "toc.title": "Περιεχόμενα", "toc.pick": "Διάλεξε τα στυλ των τίτλων που μπαίνουν στα περιεχόμενα και το επίπεδό τους.", "toc.lv0": "Όχι στα περιεχόμενα", "toc.lv": "Επίπεδο {n}", "toc.eps": "Στυλ των γραμμών επιπέδου {n}", "toc.epsSame": "Όπως η πρώτη γραμμή", "toc.sep": "Ανάμεσα σε τίτλο και σελίδα", "toc.sepTab": "Στηλοθέτης", "toc.sepSpace": "Κενό", "toc.sepP": "Τίτλος | p. 12", "toc.sepSel": "Τίτλος | σελ. 12", "toc.hint": "Αν δεν υπάρχουν ακόμη περιεχόμενα, μπαίνουν σε νέο πλαίσιο σε αυτή τη σελίδα. Το Περισσότερα › Ενημέρωση περιεχομένων φέρνει τους αριθμούς σελίδων στα σωστά μετά από αλλαγές· στο PDF κάθε γραμμή είναι σύνδεσμος.", "toc.go": "Δημιουργία περιεχομένων", "toc.noStyles": "Διάλεξε τουλάχιστον ένα στυλ.", "toc.head": "Περιεχόμενα", "sty.list": "Λίστα", "sty.listF": "Αρίθμηση", "sty.listNone": "Χωρίς λίστα", "sty.listEx": "{a} {b} {c}", "sty.listLv": "Επίπεδο", "sty.listS": "Αρχή από", "sty.listG": "Όνομα λίστας", "sty.listGPh": "αυτό το στυλ", "sty.listHint": "Οι παράγραφοι αυτού του στυλ αριθμούνται η μία μετά την άλλη. Στυλ με το ίδιο όνομα λίστας μοιράζονται τους αριθμούς, ώστε το επίπεδο 2 να ξεκινά ξανά κάτω από κάθε επίπεδο 1. Ο αριθμός κρέμεται στην αριστερή εσοχή.", "more.book": "Βιβλίο…", "book.title": "Βιβλίο", "book.none": "Αυτό το έγγραφο δεν ανήκει ακόμη σε βιβλίο. Ένα βιβλίο κρατά μαζί κεφάλαια σε χωριστά έγγραφα: οι αριθμοί σελίδων συνεχίζουν, τα στυλ μένουν ίδια και ένα PDF τα έχει όλα.", "book.name": "Όνομα του βιβλίου", "book.make": "Δημιουργία βιβλίου", "book.pages": "σελίδες {a}–{b}", "book.up": "Νωρίτερα στο βιβλίο", "book.down": "Αργότερα στο βιβλίο", "book.remove": "Έξω από το βιβλίο", "book.add": "Προσθήκη εγγράφου", "book.addPick": "Διάλεξε…", "book.odd": "Κάθε έγγραφο ξεκινά σε δεξιά (μονή) σελίδα", "book.number": "Συνεχής αρίθμηση σελίδων", "book.numbered": "Οι αριθμοί σελίδων μπήκαν σε {n} έγγραφα.", "book.sync": "Στυλ όπως του πρώτου εγγράφου", "book.synced": "Έγιναν ίδια {n} στυλ και χρώματα.", "book.pdf": "PDF του βιβλίου", "book.making": "Φτιάχνω το PDF του βιβλίου…", "book.made": "Το PDF του βιβλίου είναι έτοιμο.", "book.failed": "Το PDF του βιβλίου δεν έγινε.", "book.hint": "Τα έγγραφα κρατούν το όνομα του βιβλίου, οπότε συγχρονίζεται μαζί τους. Ξανακάνε τη συνεχή αρίθμηση όταν ένα έγγραφο μεγαλώσει ή μικρύνει.", "setup.fitH": "Νέο μέγεθος σελίδας", "setup.fit": "Τα περιεχόμενα να ακολουθήσουν το νέο μέγεθος", "setup.fitText": "Και τα μεγέθη των γραμμάτων αναλογικά", "setup.fitHint": "Ό,τι φτάνει ως τις άκρες της σελίδας φτάνει πάλι, ό,τι είναι σε περιθώριο κρατά την άκρη του, τα υπόλοιπα κρατούν τη θέση τους στο πλαίσιο κειμένου, και οι εικόνες και τα σχήματα κρατούν τις αναλογίες τους. Αν αλλάξει μόνο το μέγεθος, τα περιθώρια το ακολουθούν αναλογικά.", "pf.ink": "Πολύ μελάνι: {n} % (όριο {m} %)", "pf.richBlack": "Μικρό κείμενο σε πλούσιο μαύρο (πολλά μελάνια): μπορεί να θολώσει", "pf.hair": "Γραμμή λεπτότερη από 0,25 pt: μπορεί να μην τυπωθεί", "pf.safe": "Κείμενο πιο κοντά από {n} mm στην κοπή", "pf.opWhite": "Λευκό με επιτύπωση: θα εξαφανιστεί", "more.print": "Χρώματα εκτύπωσης…", "pc.title": "Χρώματα εκτύπωσης", "pc.view": "Δείξε τις σελίδες", "pc.v.off": "Κανονικά", "pc.v.proof": "Δοκίμιο", "pc.v.c": "Κυανό", "pc.v.m": "Ματζέντα", "pc.v.y": "Κίτρινο", "pc.v.k": "Μαύρο", "pc.v.ink": "Σύνολο μελανιού", "pc.viewHint": "Το Δοκίμιο δείχνει τα χρώματα όπως τα τυπώνει το προφίλ εκτύπωσης. Κυανό, Ματζέντα, Κίτρινο και Μαύρο δείχνουν έναν τσίγκο το καθένα, σκούρα όπου τυπώνει. Το Σύνολο μελανιού δείχνει με ροζ όπου θα έπεφτε περισσότερο μελάνι από το όριο. Τα χρώματα με επιτύπωση φαίνονται όπως τυπώνονται. Πάτα την ετικέτα πάνω από τις σελίδες για επιστροφή.", "pc.off": "Πίσω στα κανονικά χρώματα", "pc.profile": "Προφίλ εκτύπωσης", "pc.own": "Δικό σου προφίλ", "pc.ownBtn": "Δικό σου προφίλ (.icc)…", "pc.builtIn": "Πίσω στο Coated FOGRA39", "pc.profileHint": "Το CMYK προφίλ του τυπογραφείου, αν σου έδωσε (ένα .icc v2 με πίνακες 16-bit). Ταξιδεύει με το έγγραφο, στα Αρχεία, και το χρησιμοποιεί το PDF/X.", "pc.badProfile": "Αυτό δεν είναι CMYK προφίλ εκτυπωτή που διαβάζει η Σελιδοποίηση (ένα .icc v2 με πίνακες 16-bit).", "pc.noFiles": "Τα Αρχεία δεν είναι ανοιχτά εδώ, οπότε το προφίλ δεν μπορεί να κρατηθεί.", "pc.profileSet": "Προφίλ εκτύπωσης: {name}", "pc.noProfile": "Το προφίλ εκτύπωσης δεν φορτώθηκε.", "pc.ink": "Όριο μελανιού (%)", "pc.safe": "Το κείμενο απέχει από την κοπή (mm)", "pc.bop": "Το μαύρο κάνει επιτύπωση (μόνο 100 % μαύρο)", "pc.hint": "Ο Προέλεγχος προειδοποιεί για χρώματα πάνω από το όριο μελανιού, μικρό κείμενο σε πλούσιο μαύρο, γραμμές λεπτότερες από 0,25 pt, κείμενο πιο κοντά στην κοπή από αυτό και λευκό με επιτύπωση. Ρώτα το τυπογραφείο για το όριο μελανιού του: 300 % για χαρτί με επίστρωση, 260 % χωρίς.", "exp.x1a": "PDF/X-1a (μόνο CMYK)", "exp.x1aHint": "Όλα σε CMYK για {name}, και οι φωτογραφίες, χωρίς διαφάνειες: για τυπογραφεία που ζητούν PDF/X-1a. Οι διάφανες εικόνες μπαίνουν σε λευκό· ο Προέλεγχος και η αναφορά λένε τι χρειάστηκε να αλλάξει.", "exp.x1aBad": "Εξήχθη, αλλά {n} έλεγχοι του PDF/X-1a απέτυχαν (διαφάνεια ή εικόνες). Άνοιξε τον Προέλεγχο εκτύπωσης πριν το στείλεις.", "colors.tintOf": "Απόχρωση του", "colors.tintNone": "Κανενός (δικό του χρώμα)", "colors.tint": "Απόχρωση", "colors.op": "Επιτύπωση", "colors.opShort": "επιτύπωση", "colors.opHint": "Ένα χρώμα με επιτύπωση τυπώνεται πάνω σε ό,τι έχει από κάτω αντί να αφήνει κενό, έτσι λεπτά γράμματα και γραμμές δεν δείχνουν ποτέ λευκή χαραμάδα. Μια απόχρωση ακολουθεί το χρώμα της: άλλαξε το χρώμα και αλλάζουν όλες οι αποχρώσεις του.", "story.names": "Ονόματα στυλ", "story.smaller": "Μικρότερα γράμματα", "story.bigger": "Μεγαλύτερα γράμματα", "more.lib": "Βιβλιοθήκη…", "lib.title": "Βιβλιοθήκη", "lib.add": "Προσθήκη της επιλογής", "lib.import": "Εισαγωγή…", "lib.export": "Εξαγωγή…", "lib.empty": "Η βιβλιοθήκη είναι άδεια. Επίλεξε αντικείμενα στη σελίδα και πρόσθεσέ τα.", "lib.place": "Τοποθέτηση σε αυτή τη σελίδα", "lib.placed": "Μπήκε το «{name}».", "lib.name": "Όνομα", "lib.del": "Αφαίρεση από τη βιβλιοθήκη", "lib.nameN": "Στοιχείο {n}", "lib.pick": "Επίλεξε πρώτα αντικείμενα.", "lib.big": "Η επιλογή είναι πολύ μεγάλη για τη βιβλιοθήκη.", "lib.full": "Η βιβλιοθήκη γέμισε. Αφαίρεσε πρώτα κάτι.", "lib.added": "Μπήκε στη βιβλιοθήκη.", "lib.bad": "Αυτό δεν είναι αρχείο βιβλιοθήκης του orOS.", "lib.imported": "Προστέθηκαν {n} από το αρχείο.", "lib.fileName": "Βιβλιοθήκη Σελιδοποίησης", "lib.hint": "Αντικείμενα για ξανά σε κάθε έγγραφο αυτής της συσκευής: λογότυπο, τρέχων τίτλος, αρχή κεφαλαίου. Έρχονται με το κείμενο, τα χρώματα και τα στυλ τους. Οι εικόνες αναφέρονται, δεν αντιγράφονται, οπότε φαίνονται όπου τις έχει η συσκευή.", "swl.libs": "Βιβλιοθήκες…", "swl.import": "Εισαγωγή .ase…", "swl.export": "Εξαγωγή .ase", "swl.title": "Βιβλιοθήκες χρωμάτων", "swl.add": "Προσθήκη", "swl.added": "Προστέθηκαν {n} χρώματα.", "swl.none": "Αυτά τα χρώματα υπάρχουν ήδη στο έγγραφο.", "swl.bad": "Αυτό δεν είναι αρχείο χρωμάτων (.ase) που διαβάζεται.", "swl.lib.print": "Βασικά τυπογραφείου (CMYK)", "swl.lib.sea": "Θάλασσα", "swl.lib.earth": "Γη", "swl.lib.pastel": "Παστέλ", "swl.lib.grey": "Γκρι (K)", "swl.hint": "Έτοιμα σύνολα χρωμάτων. Η εισαγωγή .ase διαβάζει αρχεία χρωμάτων από InDesign, Illustrator, Photoshop, Affinity ή Scribus· όσα χρώματα υπάρχουν ήδη στο έγγραφο παραλείπονται.", "props.va.j": "Πλήρης", "sty.bl": "Κλείδωμα στο πλέγμα γραμμών βάσης", "bg.title": "Πλέγμα γραμμών βάσης", "bg.start": "Πρώτη γραμμή από την κορυφή της σελίδας", "bg.every": "Κάθε", "bg.off": "κλειστό", "bg.show": "Εμφάνιση του πλέγματος γραμμών βάσης", "bg.hint": "Τα στυλ παραγράφου με «Κλείδωμα στο πλέγμα» βάζουν πάνω του τις γραμμές τους, ώστε να ευθυγραμμίζονται σε στήλες και αντικριστές σελίδες. Άφησε κενό το «Κάθε» για χωρίς πλέγμα.", "brk.col": "Επόμενη στήλη", "brk.page": "Επόμενη σελίδα", "brk.odd": "Επόμενη μονή σελίδα", "brk.even": "Επόμενη ζυγή σελίδα", "brk.menu": "Αλλαγή", "brk.ins.col": "Αλλαγή στήλης (Enter αριθμητικού)", "brk.ins.page": "Αλλαγή σελίδας (Ctrl+Enter αριθμητικού)", "brk.ins.odd": "Αλλαγή σε μονή σελίδα", "brk.ins.even": "Αλλαγή σε ζυγή σελίδα", "os.title": "Στυλ αντικειμένου", "os.none": "Κανένα", "os.new": "Νέο από αυτό", "os.nameN": "Στυλ αντικειμένου {n}", "os.max": "Ένα έγγραφο έχει έως {n} στυλ αντικειμένων.", "os.redefine": "Επαναορισμός από αυτό", "os.name": "Όνομα του στυλ αντικειμένου", "os.del": "Διαγραφή στυλ", "os.hint": "Γέμισμα, περίγραμμα, γωνίες, αδιαφάνεια, αναδίπλωση και, σε πλαίσια κειμένου, εσοχή, στήλες και στοίχιση, με ένα όνομα. Ο επαναορισμός αλλάζει κάθε αντικείμενο που το χρησιμοποιεί.", "more.find": "Εύρεση/Αλλαγή…", "more.spell": "Ορθογραφία…", "fc.title": "Εύρεση/Αλλαγή", "fc.queries": "Αναζητήσεις…", "fc.delQuery": "Διαγραφή της αποθηκευμένης αναζήτησης", "fc.delPick": "Διάλεξε πρώτα μια αποθηκευμένη αναζήτηση.", "fc.find": "Εύρεση", "fc.change": "Αλλαγή σε", "fc.text": "Κείμενο", "fc.grep": "GREP", "fc.textHint": "Βρίσκει το κείμενο όπως γράφτηκε. Στο «Αλλαγή σε», το $& είναι ό,τι βρέθηκε.", "fc.grepHint": "Κανονική έκφραση: \\d ψηφίο, \\s κενό, . οποιοσδήποτε χαρακτήρας, + ένα ή περισσότερα, ( ) ομάδα. Στο «Αλλαγή σε», το $1 είναι η πρώτη ομάδα, το $& όλο, το \\n νέα παράγραφος.", "fc.bad": "Η έκφραση έχει λάθος: {m}", "fc.long": "Η αναζήτηση είναι πολύ μεγάλη (έως 500 χαρακτήρες).", "fc.matchesEmpty": "Η έκφραση ταιριάζει και με το τίποτα· κάν’ τη να βρίσκει τουλάχιστον έναν χαρακτήρα.", "fc.cs": "Πεζά/κεφαλαία όπως γράφτηκαν", "fc.word": "Ολόκληρη λέξη", "fc.scope": "Αναζήτηση σε", "fc.inDoc": "Όλο το έγγραφο", "fc.inStory": "Αυτό το κείμενο", "fc.onlyPs": "Μόνο σε παραγράφους με", "fc.anyPs": "Οποιοδήποτε στυλ", "fc.toPs": "Στυλ παραγράφου όσων αλλάζουν", "fc.toCs": "Στυλ χαρακτήρων της αλλαγής", "fc.keep": "Ως έχει", "fc.n": "Βρέθηκαν {n}.", "fc.nMany": "Βρέθηκαν {n} ή περισσότερα.", "fc.none": "Δεν βρέθηκε τίποτα.", "fc.more": "Φαίνονται τα πρώτα {n}.", "fc.noFrame": "Αυτό το κείμενο δεν είναι σε κανένα πλαίσιο.", "fc.save": "Αποθήκευση αναζήτησης", "fc.saved": "Η αναζήτηση αποθηκεύτηκε.", "fc.findBtn": "Εύρεση", "fc.next": "Επόμενο", "fc.changeOne": "Αλλαγή", "fc.all": "Αλλαγή όλων", "fc.done": "Άλλαξαν {n}.", "fc.pre.dblspace": "Διπλά κενά → ένα", "fc.pre.spacepunct": "Κενό πριν από σημείο στίξης", "fc.pre.dash": "Ενωτικό ανάμεσα σε κενά → παύλα", "fc.pre.quotes": "\"Ίσια\" → «ελληνικά» εισαγωγικά", "fc.pre.dots": "Τρεις τελείες → αποσιωπητικά", "fc.pre.trail": "Κενά στο τέλος παραγράφου", "sp.title": "Ορθογραφία", "sp.checking": "Ελέγχω τις λέξεις… Τα λεξικά φορτώνουν την πρώτη φορά και μετά δουλεύουν χωρίς σύνδεση.", "sp.n": "{n} λέξεις δεν είναι στα λεξικά.", "sp.none": "Δεν βρέθηκαν ορθογραφικά λάθη.", "sp.failed": "Τα λεξικά δεν φόρτωσαν. Συνδέσου μία φορά στο διαδίκτυο και δοκίμασε ξανά.", "sp.noLib": "Ο έλεγχος ορθογραφίας δεν γίνεται εδώ. Φόρτωσε ξανά τη Σελιδοποίηση.", "sp.go": "Δείξε", "sp.suggest": "Προτάσεις", "sp.noSug": "Καμία πρόταση.", "sp.add": "Στο λεξικό", "sp.ignore": "Αγνόηση", "sp.hint": "Ελληνικά και αγγλικά, με τα λεξικά του Writer. Οι λέξεις που προσθέτεις μπαίνουν στο λεξικό αυτού του εγγράφου και ταξιδεύουν μαζί του· μετράνε και οι λέξεις του λεξικού σου στον Writer. Μια πρόταση αλλάζει τη λέξη παντού, σε ένα βήμα αναίρεσης.", "sty.next": "Επόμενο στυλ (μετά το Enter)", "sty.nextSame": "Το ίδιο στυλ", "sty.grep": "Στυλ GREP", "sty.grepAdd": "Προσθήκη στυλ GREP", "sty.grepRe": "Κανονική έκφραση", "sty.grepCs": "Στυλ χαρακτήρων", "sty.grepDel": "Αφαίρεση αυτού του στυλ GREP", "sty.grepBad": "Η έκφραση έχει λάθος ή δεν βρίσκει τίποτα.", "sty.grepHint": "Ένα στυλ χαρακτήρων σε ό,τι βρίσκει μια έκφραση σε αυτές τις παραγράφους, π.χ. \\d+ για αριθμούς ή [A-ZΑ-Ω]{2,} για κεφαλαία. Έως 10· όπου επικαλύπτονται, κερδίζει το επόμενο.",
      "dlg.rename": "Μετονομασία", "dlg.delDoc": "Διαγραφή αυτού του εγγράφου;", "dlg.delDocSub": "Μπορείς να το αναιρέσεις αμέσως μετά.",
      "home.recipes": "Αυτοματισμοί",
      "more.recipes": "Αυτοματισμοί…",
      "rc.op.text": "Εύρεση και αντικατάσταση κειμένου",
      "rc.op.pstyle": "Στυλ παραγράφου",
      "rc.op.master": "Master στις σελίδες",
      "rc.op.style": "Αλλαγή στυλ",
      "rc.f.style.name": "Στυλ",
      "rc.f.size": "Μέγεθος (pt, 0 = ως έχει)",
      "rc.f.lead": "Διάστιχο (pt, 0 = ως έχει)",
      "rc.f.font": "Γραμματοσειρά",
      "rc.f.align": "Στοίχιση",
      "rc.f.track": "Αραίωση (0 = ως έχει)",
      "rc.e.font.": "Ως έχει", "rc.e.font.serif": "Serif", "rc.e.font.sans": "Sans", "rc.e.font.mono": "Mono",
      "rc.e.align.": "Ως έχει", "rc.e.align.l": "Αριστερά", "rc.e.align.c": "Στο κέντρο", "rc.e.align.r": "Δεξιά", "rc.e.align.j": "Πλήρης",
      "rc.n.style": "Αλλάζει το ίδιο το στυλ, οπότε αλλάζει κάθε παράγραφος που το έχει. Ό,τι μένει στο 0 ή «Ως έχει» δεν αλλάζει.",
      "rc.op.margins": "Περιθώρια σελίδας",
      "rc.op.preflight": "Έλεγχος preflight",
      "rc.op.export": "Εξαγωγή PDF",
      "rc.f.find": "Εύρεση",
      "rc.f.repl": "Αντικατάσταση με",
      "rc.f.cs": "Ταίριασμα πεζών/κεφαλαίων",
      "rc.f.word": "Μόνο ολόκληρες λέξεις",
      "rc.f.from": "Παράγραφοι με στυλ",
      "rc.f.to": "Παίρνουν το στυλ",
      "rc.f.ms": "Master",
      "rc.f.on": "Σελίδες",
      "rc.f.t": "Πάνω (mm)",
      "rc.f.b": "Κάτω (mm)",
      "rc.f.i": "Μέσα (mm)",
      "rc.f.o": "Έξω (mm)",
      "rc.f.stop": "Να μη γίνεται εξαγωγή εγγράφου με σφάλματα",
      "rc.f.bleed": "Με περιθώριο κοπής (bleed)",
      "rc.f.marks": "Σημάδια κοπής",
      "rc.f.spreads": "Δισέλιδα (αντικριστές σελίδες)",
      "rc.f.q": "Εικόνες",
      "rc.e.on.all": "Όλες οι σελίδες",
      "rc.e.on.odd": "Μονές σελίδες",
      "rc.e.on.even": "Ζυγές σελίδες",
      "rc.e.q.print": "Εκτύπωση (300 ppi)",
      "rc.e.q.screen": "Οθόνη (150 ppi)",
      "rc.anyStyle": "Οποιοδήποτε στυλ",
      "rc.noMaster": "Κανένα",
      "rc.n.text": "Βρίσκει και κείμενο που χωρίζεται σε κομμάτια με διαφορετική μορφή· το νέο κείμενο παίρνει τη μορφή του πρώτου κομματιού.",
      "rc.n.pstyle": "Τα στυλ ταιριάζουν με το όνομα, οπότε ένας αυτοματισμός δουλεύει σε κάθε έγγραφο που έχει στυλ με αυτό το όνομα.",
      "rc.n.export": "Ένα έγγραφο: το συνηθισμένο παράθυρο αποθήκευσης. Πολλά: τα PDF πάνε στα Αρχεία, στον φάκελο Layout.",
      "rc.on.this": "Αυτό το έγγραφο ({name})",
      "rc.on.all": "Όλα τα έγγραφα ({n})",
      "rc.pv.none": "Δεν υπάρχουν έγγραφα ακόμα.",
      "rc.pv.one": "Δουλεύει σε ένα έγγραφο. Μπορείς να το αναιρέσεις αμέσως μετά.",
      "rc.pv.many": "Δουλεύει σε {n} έγγραφα. Μπορείς να το αναιρέσεις αμέσως μετά.",
      "rc.pv.pdfs": "Τα PDF αποθηκεύονται στα Αρχεία, στον φάκελο Layout.",
      "rc.doing": "{i} από {n}: {name}",
      "rc.done": "{n} αλλαγές σε {d} έγγραφα.",
      "rc.nochange": "Δεν χρειάστηκε καμία αλλαγή.",
      "rc.pf": "Preflight: {e} σφάλματα, {w} προειδοποιήσεις.",
      "rc.held": "{n} χωρίς εξαγωγή λόγω σφαλμάτων preflight.",
      "rc.pdfs": "{n} PDF αποθηκεύτηκαν στα Αρχεία › Layout.",
      "rc.pdfs1": "1 PDF αποθηκεύτηκε στα Αρχεία › Layout.",
      "rc.undone": "Τα έγγραφα γύρισαν όπως ήταν.",
      "as.done": "Ο Βοηθός άλλαξε {n} στοιχεία σε {d} έγγραφα.", "as.done1": "Ο Βοηθός άλλαξε {n} στοιχεία στο έγγραφο.",
      "as.done0": "Δεν χρειάστηκε καμία αλλαγή.", "as.made1": "Το νέο έγγραφο είναι έτοιμο.", "as.working": "Εκτελώ τις εντολές του Claude…", "as.busy": "Η Σελιδοποίηση εκτελεί ακόμα τις προηγούμενες εντολές του Claude.", "btn.stop": "Διακοπή", "as.bad": "Το αίτημα του Βοηθού δεν διαβάστηκε. Δεν άλλαξε τίποτα.",
      "as.undone": "Η αλλαγή του Βοηθού αναιρέθηκε.", "as.changed": "Τα έγγραφα άλλαξαν στο μεταξύ, γι' αυτό η αλλαγή του Βοηθού δεν αναιρέθηκε.",
      "as.gone": "Δεν έμεινε κάτι για αναίρεση.",
      "rc.op.pages": "Προσθήκη σελίδων",
      "rc.op.delpages": "Αφαίρεση σελίδων",
      "rc.op.numbering": "Αρίθμηση σελίδων",
      "rc.op.bleed": "Bleed",
      "rc.op.fit": "Να χωρέσει το κείμενο",
      "rc.op.grey": "Ασπρόμαυρες εικόνες",
      "rc.op.imgfit": "Εικόνες στα πλαίσιά τους",
      "rc.f.pages.n": "Πόσες σελίδες",
      "rc.f.at": "Πού",
      "rc.f.page": "Σελίδα (η θέση της, 1 = η πρώτη)",
      "rc.f.flow": "Το κείμενο που δεν χωράει συνεχίζει σε αυτές",
      "rc.f.first": "Από τη σελίδα (η θέση της)",
      "rc.f.last": "Έως τη σελίδα (0 = μόνο αυτή)",
      "rc.f.numbering.mode": "Πώς",
      "rc.f.numbering.n": "Αριθμός",
      "rc.f.bleed.mm": "Bleed (mm)",
      "rc.f.pages": "Σελίδες (κενό = όλες· μονές, ζυγές ή π.χ. 3-10,12)",
      "rc.f.imgfit.mode": "Εικόνα",
      "rc.f.bold": "Έντονα",
      "rc.f.ital": "Πλάγια",
      "rc.f.caps": "Κεφαλαία",
      "rc.f.sb": "Κενό πριν (pt, -1 = ως έχει)",
      "rc.f.sa": "Κενό μετά (pt, -1 = ως έχει)",
      "rc.f.fi": "Εσοχή πρώτης γραμμής (pt, -1 = ως έχει)",
      "rc.f.brk": "Ξεκινά",
      "rc.f.hyph": "Ελληνικός συλλαβισμός",
      "rc.e.onoff.": "Ως έχει",
      "rc.e.onoff.on": "Ναι",
      "rc.e.onoff.off": "Όχι",
      "rc.e.at.end": "Στο τέλος",
      "rc.e.at.before": "Πριν τη σελίδα",
      "rc.e.at.after": "Μετά τη σελίδα",
      "rc.e.mode.set": "Η πρώτη σελίδα παίρνει τον αριθμό",
      "rc.e.mode.shift": "Κάθε αριθμός μετακινείται κατά",
      "rc.e.mode.fit": "Ολόκληρη η εικόνα",
      "rc.e.mode.fill": "Να γεμίσει το πλαίσιο",
      "rc.e.brk.": "Ως έχει",
      "rc.e.brk.any": "Οπουδήποτε",
      "rc.e.brk.col": "Σε νέα στήλη",
      "rc.e.brk.page": "Σε νέα σελίδα",
      "rc.e.brk.odd": "Σε μονή σελίδα",
      "rc.e.brk.even": "Σε ζυγή σελίδα",
      "rc.n.delpages": "Οι σελίδες φεύγουν μαζί με ό,τι έχουν πάνω τους. Μπορείς να το αναιρέσεις αμέσως μετά.",
      "rc.n.fit": "Το κείμενο που δεν χωράει παίρνει όσες νέες σελίδες χρειάζεται, μετά το τελευταίο του πλαίσιο.",
      "rc.n.grey": "Τα ασπρόμαυρα αντίγραφα φτιάχνονται σε αυτή τη συσκευή· οι έγχρωμες εικόνες μένουν στον δίσκο.",
      "rc.n.numbering": "Για παράδειγμα, μετακίνηση κατά 2: κάθε αριθμός σελίδας γίνεται δύο μεγαλύτερος.",
      "tab.learn": "Μάθε",
      "home.book": "Νέο βιβλίο",
      "start.open": "Ένα βιβλίο, βήμα βήμα",
      "start.title": "Νέο βιβλίο",
      "start.step": "Βήμα {n} από {of}",
      "start.s1": "Τι είδους βιβλίο",
      "start.s2": "Μέγεθος και περιθώρια",
      "start.s3": "Γραμματοσειρές",
      "start.s4": "Στοιχεία και πρώτες σελίδες",
      "start.back": "Πίσω",
      "start.next": "Επόμενο",
      "start.make": "Φτιάξε το βιβλίο",
      "start.usual": "συνηθισμένο",
      "start.trim": "Μέγεθος σελίδας (κοπή)",
      "start.m.tight": "Στενά",
      "start.m.normal": "Κανονικά",
      "start.m.wide": "Άνετα",
      "start.trimHint": "Τα περιθώρια, τα μεγέθη των γραμμάτων και τα πλαίσια ακολουθούν το μέγεθος που διαλέγεις. Όλα αλλάζουν και αργότερα από τις Ρυθμίσεις εγγράφου.",
      "start.pair.noto": "Noto Serif + Noto Sans (ενσωματωμένες, χωρίς σύνδεση)",
      "start.pair.garamond": "EB Garamond + Fira Sans",
      "start.pair.literata": "Literata + Open Sans",
      "start.pair.alegreya": "Alegreya + Alegreya Sans",
      "start.pair.sans": "Fira Sans παντού",
      "start.pairHint": "Όλες είναι ελεύθερες γραμματοσειρές με ελληνικά. Εκτός από τις Noto, η καθεμία κατεβαίνει την πρώτη φορά που χρησιμοποιείται και μετά δουλεύει χωρίς σύνδεση· ως τότε η προεπισκόπηση δείχνει μια αντικατάσταση.",
      "start.f.title": "Τίτλος",
      "start.f.author": "Συγγραφέας",
      "start.f.publisher": "Εκδότης",
      "start.f.year": "Έτος",
      "start.f.isbn": "ISBN",
      "start.front": "Πρώτες σελίδες",
      "start.fr.half": "Ψευδότιτλος",
      "start.fr.title": "Σελίδα τίτλου",
      "start.fr.copy": "Σελίδα ταυτότητας",
      "start.fr.ded": "Αφιέρωση",
      "start.fr.toc": "Περιεχόμενα",
      "start.later": "Ένα πεδίο που μένει κενό κρατά ένα κείμενο-δείγμα για να γράψεις από πάνω.",
      "sk.novel": "Μυθιστόρημα",
      "sk.d.novel": "Κεφάλαια με συνεχές κείμενο και τρέχοντες τίτλους",
      "sk.stories": "Διηγήματα",
      "sk.d.stories": "Κάθε διήγημα ανοίγει σε δεξιά σελίδα",
      "sk.poetry": "Ποίηση",
      "sk.d.poetry": "Ένα ποίημα ανά σελίδα, οι στίχοι όπως γράφτηκαν",
      "sk.essay": "Δοκίμιο",
      "sk.d.essay": "Κεφάλαια με ενότητες και παραθέματα",
      "sk.study": "Μελέτη",
      "sk.d.study": "Αριθμημένα κεφάλαια, δύο επίπεδα επικεφαλίδων",
      "sk.children": "Εικονογραφημένο παιδικό",
      "sk.d.children": "Εικόνες σε όλη τη σελίδα και μεγάλα γράμματα",
      "sk.photo": "Λεύκωμα φωτογραφιών",
      "sk.d.photo": "Οριζόντια δισέλιδα, εικόνες ως την άκρη",
      "sk.cookbook": "Βιβλίο συνταγών",
      "sk.d.cookbook": "Μια φωτογραφία απέναντι από κάθε συνταγή",
      "sk.catalogue": "Κατάλογος έκθεσης",
      "sk.d.catalogue": "Ένα έργο ανά σελίδα με τη λεζάντα του",
      "sk.magazine": "Περιοδικό",
      "sk.d.magazine": "Εξώφυλλο, περιεχόμενα και θέμα σε τρεις στήλες",
      "sk.workbook": "Βιβλίο ασκήσεων",
      "sk.d.workbook": "Μαθήματα με στόχους, ασκήσεις και σελίδες για γράψιμο",
      "sk.zine": "Fanzine",
      "sk.d.zine": "Οκτώ σελίδες, έντονο και γρήγορο",
      "sk.st.first": "Πρώτη παράγραφος",
      "sk.st.chap": "Τίτλος κεφαλαίου",
      "sk.st.chno": "Αριθμός κεφαλαίου",
      "sk.st.folio": "Αριθμός σελίδας",
      "sk.st.rh": "Τρέχων τίτλος",
      "sk.st.sep": "Αλλαγή σκηνής",
      "sk.st.half": "Ψευδότιτλος",
      "sk.st.ttitle": "Τίτλος",
      "sk.st.tauth": "Συγγραφέας",
      "sk.st.tpub": "Εκδότης",
      "sk.st.copy": "Ταυτότητα",
      "sk.st.ded": "Αφιέρωση",
      "sk.st.toch": "Τίτλος περιεχομένων",
      "sk.st.toc": "Γραμμή περιεχομένων",
      "sk.st.verse": "Στίχος",
      "sk.st.tale": "Κείμενο ιστορίας",
      "sk.st.pcap": "Λεζάντα φωτογραφίας",
      "sk.st.rmeta": "Στοιχεία συνταγής",
      "sk.st.ingr": "Υλικό",
      "sk.st.step": "Βήμα εκτέλεσης",
      "sk.st.artist": "Καλλιτέχνης",
      "sk.st.work": "Έργο",
      "sk.st.mast": "Τίτλος περιοδικού",
      "sk.st.cline": "Τίτλος εξωφύλλου",
      "sk.st.stand": "Εισαγωγή άρθρου",
      "sk.st.pull": "Απόσπασμα",
      "sk.st.goal": "Στόχος",
      "sk.st.task": "Άσκηση",
      "sk.st.ztitle": "Τίτλος fanzine",
      "sk.ms.a": "Σελίδες κειμένου",
      "sk.ms.o": "Σελίδες έναρξης",
      "sk.sw.acc": "Χρώμα έμφασης",
      "sk.sw.tint": "Απαλό φόντο",
      "sx.title": "Ο τίτλος του βιβλίου",
      "sx.author": "Όνομα συγγραφέα",
      "sx.publisher": "Εκδόσεις",
      "sx.rights": "Με επιφύλαξη παντός δικαιώματος. Απαγορεύεται η αναπαραγωγή μέρους ή του συνόλου του βιβλίου χωρίς τη γραπτή άδεια του εκδότη.",
      "sx.isbn": "ISBN (πρόσθεσέ το στα στοιχεία του βιβλίου)",
      "sx.ded": "Σε κάποιον αγαπημένο",
      "sx.toc": "Περιεχόμενα",
      "sx.chap": "Κεφάλαιο πρώτο",
      "sx.story": "Το πρώτο διήγημα",
      "sx.poem": "Ποίημα",
      "sx.sec": "Μια ενότητα",
      "sx.sec1": "1.1 Το ερώτημα",
      "sx.sec2": "1.1.1 Πιο κοντά",
      "sx.quote": "Ένα παράθεμα ξεχωρίζει από το κείμενο, με εσοχή και από τις δύο πλευρές.",
      "sx.p1": "Εδώ μπαίνει το κείμενό σου. Γράψε πάνω από αυτές τις γραμμές ή επικόλλησε το χειρόγραφό σου: το κείμενο περνά μόνο του από πλαίσιο σε πλαίσιο και από σελίδα σε σελίδα, και κάθε παράγραφος παίρνει την εμφάνιση του στυλ της.",
      "sx.p2": "Τα περιθώρια, το μέγεθος των γραμμάτων και το διάστιχο υπολογίστηκαν για αυτό το μέγεθος σελίδας, ώστε το πολύ διάβασμα να ξεκουράζει το μάτι. Άλλαξε ένα στυλ μία φορά και ακολουθεί κάθε παράγραφος που το χρησιμοποιεί.",
      "sx.p3": "Οι αριθμοί σελίδων και οι τρέχοντες τίτλοι βρίσκονται στις master, οπότε οι νέες σελίδες τους παίρνουν μόνες τους. Όταν το κείμενο δεν χωράει, πρόσθεσε σελίδες και συνεχίζει από εκεί που σταμάτησε.",
      "sx.v1": "Εδώ ο πρώτος στίχος του ποιήματος,",
      "sx.v2": "κι εδώ ο δεύτερος, όπως τον έγραψες.",
      "sx.v3": "Μια κενή γραμμή ανοίγει νέα στροφή·",
      "sx.v4": "οι στίχοι δεν ενώνονται ποτέ.",
      "sx.kid1": "Μια φορά κι έναν καιρό, μια μικρή βαρκούλα ξεκίνησε να δει τη θάλασσα.",
      "sx.kid2": "Κάθε σελίδα είναι μια νέα εικόνα και μία-δύο γραμμές της ιστορίας.",
      "sx.photos": "Για αυτές τις φωτογραφίες",
      "sx.pcap": "Τόπος, ημερομηνία: λίγα λόγια για την εικόνα.",
      "sx.course": "Ορεκτικά",
      "sx.recipe": "Συνταγή",
      "sx.serves": "Για 4 άτομα · 30 λεπτά",
      "sx.ingr": "Υλικά",
      "sx.ingr1": "500 γρ. ντομάτες",
      "sx.ingr2": "2 κουταλιές ελαιόλαδο",
      "sx.ingr3": "αλάτι και πιπέρι",
      "sx.method": "Εκτέλεση",
      "sx.step1": "Γράψε κάθε βήμα σε δική του γραμμή.",
      "sx.step2": "Κράτα τα βήματα σύντομα, μία ενέργεια το καθένα.",
      "sx.exhib": "Για την έκθεση",
      "sx.artist": "Όνομα καλλιτέχνη",
      "sx.work": "Τίτλος του έργου",
      "sx.medium": "Λάδι σε μουσαμά, 100 × 80 εκ.",
      "sx.mag": "ΠΕΡΙΟΔΙΚΟ",
      "sx.cline1": "Το μεγάλο θέμα του τεύχους",
      "sx.cline2": "Άλλα δύο θέματα για το εξώφυλλο",
      "sx.feat": "Το κεντρικό θέμα",
      "sx.edit": "Σημείωμα της σύνταξης",
      "sx.lesson": "Μάθημα 1",
      "sx.goals": "Σε αυτό το μάθημα",
      "sx.goal1": "• Τι θα μάθεις πρώτα",
      "sx.goal2": "• Τι θα μπορείς να κάνεις στο τέλος",
      "sx.task": "Άσκηση 1",
      "sx.notes": "Σημειώσεις",
      "sx.zine": "FANZINE",
      "hint.ok": "Εντάξει",
      "hint.start": "Γράψε πάνω από το κείμενο-δείγμα ή επικόλλησε το δικό σου: περνά μόνο του από σελίδα σε σελίδα. Τα στυλ αλλάζουν μαζί όλες τις παραγράφους που τα χρησιμοποιούν· οι αριθμοί σελίδων και οι τρέχοντες τίτλοι είναι στις master (καρτέλα Σελίδες).",
      "hint.editor": "Διάλεξε εργαλείο αριστερά και σύρε πάνω στη σελίδα· διπλό κλικ σε πλαίσιο κειμένου για να γράψεις. Η καρτέλα Μάθε δεξιά δείχνει τα βασικά.",
      "hint.master": "Επεξεργάζεσαι μια master: ό,τι βάζεις εδώ φαίνεται σε κάθε σελίδα που τη χρησιμοποιεί. Πάτα Τέλος για να γυρίσεις.",
      "learn.title": "Μάθε τη Σελιδοποίηση",
      "learn.intro": "Τα βασικά σε λίγες γραμμές, το καθένα με κουμπί που σου δείχνει πού.",
      "learn.text": "Κείμενο που ρέει",
      "learn.text.d": "Το κείμενο ζει σε πλαίσια, και ένα κείμενο μπορεί να περνά από πολλά πλαίσια και σελίδες. Διπλό κλικ σε πλαίσιο για να γράψεις· ο Επεξεργαστής κειμένου δείχνει όλο το κείμενο μαζί.",
      "learn.styles": "Στυλ",
      "learn.styles.d": "Ένα στυλ παραγράφου κρατά γραμματοσειρά, μέγεθος, αποστάσεις και πού ξεκινά η παράγραφος. Άλλαξε το στυλ και ακολουθεί κάθε παράγραφος που το έχει· το στυλ του τίτλου κεφαλαίου μπορεί να ανοίγει κάθε κεφάλαιο σε νέα σελίδα.",
      "learn.pages": "Σελίδες και master",
      "learn.pages.d": "Η καρτέλα Σελίδες προσθέτει, μετακινεί και αφαιρεί σελίδες. Μια master κρατά ό,τι επαναλαμβάνεται σε πολλές σελίδες, όπως αριθμούς σελίδων και τρέχοντες τίτλους· άνοιξέ τη από την καρτέλα Σελίδες για να την αλλάξεις.",
      "learn.pics": "Εικόνες",
      "learn.pics.d": "Σχεδίασε πλαίσιο εικόνας και βάλε μέσα μια εικόνα· μια εικόνα που πρέπει να φτάνει ως την άκρη του χαρτιού περνά πάνω από το bleed. Ο Προέλεγχος εκτύπωσης προειδοποιεί όταν μια εικόνα είναι μικρή για εκτύπωση.",
      "learn.toc": "Περιεχόμενα",
      "learn.toc.d": "Ένα βιβλίο από το Νέο βιβλίο έχει σελίδα περιεχομένων. Όταν αλλάξεις κεφάλαια, η Ενημέρωση περιεχομένων τη γράφει ξανά με τους σωστούς αριθμούς σελίδων.",
      "learn.check": "Προέλεγχος εκτύπωσης",
      "learn.check.d": "Ο Προέλεγχος εκτύπωσης δείχνει τι μπορεί να πάει στραβά στο τυπογραφείο: κείμενο που δεν χωράει, εικόνες πολύ μικρές, γραμματοσειρές που λείπουν.",
      "learn.export": "Εξαγωγή",
      "learn.export.d": "Η Εξαγωγή φτιάχνει το PDF για το τυπογραφείο (PDF/X-4, με bleed και σημάδια κοπής όταν τα θέλεις), PDF για οθόνες ή EPUB.",
      "learn.show": "Δείξε μου",
      "learn.help": "Ο πλήρης οδηγός",
      "learn.hints": "Δείξε ξανά τις υποδείξεις",
      "learn.hintsBack": "Οι υποδείξεις θα εμφανιστούν ξανά.",
      "learn.noHelp": "Ο οδηγός ανοίγει από το ? στην πάνω μπάρα του orOS.",
      "learn.noToc": "Αυτό το έγγραφο δεν έχει σελίδα περιεχομένων φτιαγμένη από τη Σελιδοποίηση.",
      "a11y.canvas": "Καμβάς σελίδας"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "layout", LANG);
  LY.STRINGS = STRINGS;
  // "el" or "en" for the shared designkit modules (seed names {en, el}).
  LY.BASE = LANG === "el" ? "el" : "en";

  function t(key, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  LY.t = t;
  LY.label = function (name) { return M.label(name, LY.BASE); };

  // BOOT MARKER
  try { console.log("[orOS] layout app v1.3.0 booted"); } catch (e) {}

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
    pen: '<path d="M12 19l7-7 3 3-7 7z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="M2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
    ops: '<rect x="3" y="3" width="12" height="12" rx="1"/><circle cx="15" cy="15" r="6"/>',
    outline: '<path d="M7 21l14-14-3-3L4 18z"/><path d="M4 18l3 3"/>',
    textpath: '<path d="M3 19c4-10 14-10 18 0" stroke-dasharray="2 2"/><path d="M7 11l-1-4h6M9 7v6M14 6l2 6 2-6"/>',
    nodes: '<path d="M4 18C6 8 18 8 20 18"/><rect x="2" y="16" width="4" height="4"/><rect x="18" y="16" width="4" height="4"/><path d="M12 10.5V5M8 5h8"/><circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/>',
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
    // the one-time hints already dismissed (LY-N1, startui.js)
    if (p.hints && typeof p.hints === "object") {
      var hs = {};
      Object.keys(p.hints).slice(0, 40).forEach(function (k) { if (/^[a-z]{1,20}$/.test(k) && p.hints[k] === 1) hs[k] = 1; });
      LY.prefs.hints = hs;
    }
    // working comfort (LY-N2, smart.js / comfort.js): changed shortcuts,
    // the arrow-key step, and 0 = off for smart guides, measurements, the toolbar
    if (p.keys && typeof p.keys === "object" && window.LY_SMART) {
      var ks = window.LY_SMART.normKeys(p.keys);
      if (Object.keys(ks).length) LY.prefs.keys = ks;
    }
    var nv = Number(p.nudge);
    if (p.nudge !== undefined && isFinite(nv) && nv > 0 && nv <= 100) LY.prefs.nudge = nv;
    ["smart", "measure", "ctxbar"].forEach(function (k) { if (p[k] === 0) LY.prefs[k] = 0; });
    if (p.bgShow === 1) LY.prefs.bgShow = 1;   // the baseline grid shown (LY-W5b)
    if (p.hjShow === 1) LY.prefs.hjShow = 1;   // loose and tight lines shown (LY-W6)
    // the Story Editor: style names, text size (LY-N3)
    if (p.stNames === 1) LY.prefs.stNames = 1;
    var sz = Number(p.stZoom);
    if (p.stZoom !== undefined && sz >= 0.8 && sz <= 1.6) LY.prefs.stZoom = sz;
    // saved Find/Change queries (LY-W5, findchange.js)
    if (Array.isArray(p.queries) && window.LY_FIND) {
      var qs = window.LY_FIND.normQueries(p.queries);
      if (qs.length) LY.prefs.queries = qs;
    }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(LY.prefs)); } catch (e) {}
  }
  LY.savePrefs = savePrefs;

  // ---------- 3b. Documents on the orOS disk (LY-DISK) ----------
  // With the orOS disk, every document is a file in Files › Layout
  // (designkit/docstore.js): loaded at boot, written when it changes,
  // synced by Vault Drive like any file. oros-layout-data stays as the
  // old slice for devices that still run an older orOS (merged in, never
  // grown). Without the disk (a page opened on its own) everything stays
  // in localStorage as before.
  var INDEX_KEY = "oros-layout-index", OPEN_KEY = "oros-layout-open", DISK_DIR = "/internal/Layout";
  var disk = null, diskStore = null, diskReady = false, diskPulls = [], diskFailShown = false;
  function diskFs() {
    try { return (window.parent && window.parent !== window && window.parent.orosFS) || null; }
    catch (e) { return null; }
  }
  function storyTextOf(d) {
    var parts = [], n = 0;
    (d.stories || []).some(function (st) {
      (st.paras || []).forEach(function (p) {
        (p.runs || []).forEach(function (r) { if (typeof r.t === "string" && n < 1000) { parts.push(r.t); n += r.t.length; } });
        parts.push(" ");
      });
      return n >= 1000;
    });
    return parts.join("").replace(/\s+/g, " ").trim().slice(0, 1000);
  }
  function startDisk() {
    var fs = diskFs();
    if (!fs || !window.orosDocStore || !window.OrosFilesCore) return null;
    var store = diskStore = window.orosDocStore.create({ dir: DISK_DIR, ext: ".oroslayout", kind: "oros-layout-package", ver: 1, fs: fs, M: M, core: window.OrosFilesCore });
    return window.orosDocStore.open({
      store: store, M: M, fs: fs, ls: window.localStorage, rescue: "layout-data",
      keys: { legacy: STORAGE_KEY, index: INDEX_KEY, open: OPEN_KEY },
      entry: function (d) { return { tx: storyTextOf(d) }; }
    });
  }
  function diskSaved(res) {
    if (res && res.failed && !diskFailShown) { diskFailShown = true; toast(t("toast.diskSave")); }
    if (res && !res.failed) diskFailShown = false;
    return res;
  }
  // after a pull or a disk change: the documents that changed
  function diskApply(next, changed) {
    if (!changed.length) return;
    var openId = LY.doc ? LY.doc.id : null;
    data = next;
    disk.save(data).then(diskSaved);
    if (openId) {
      var d = findDoc(openId);
      if (!d) { toast(t("toast.gone")); goHome(); return; }
      var was = LY.doc;
      LY.doc = d;
      if (changed.indexOf(openId) >= 0 && JSON.stringify(d) !== JSON.stringify(was)) emit("remote");
    } else renderHome();
  }
  var rescanning = false, rescanAgain = false;
  function diskRescan() {
    if (!disk || !diskReady) return;
    if (rescanning) { rescanAgain = true; return; }
    rescanning = true;
    LY.flushStory && LY.flushStory();
    var openBefore = LY.doc ? JSON.stringify(LY.doc) : null;
    disk.rescan(data).then(function (r) {
      rescanning = false;
      // an edit made while the files were read is merged, never lost
      var now2 = r.data;
      if (LY.doc && JSON.stringify(LY.doc) !== openBefore) now2 = M.mergeData(now2, { docs: [LY.doc], dt: {} });
      diskApply(now2, r.changed);
      if (rescanAgain) { rescanAgain = false; diskRescan(); }
    }, function () { rescanning = false; });
  }
  function watchVault() {
    var v = null;
    try { v = window.parent && window.parent !== window ? window.parent.orosVault : null; } catch (e) { v = null; }
    if (!v || typeof v.onStatus !== "function") return;
    var off = v.onStatus(function (kind, detail) {
      if (kind === "stats" && detail && (detail.downloaded > 0 || detail.deleted > 0 || detail.conflicts > 0)) diskRescan();
    });
    window.addEventListener("pagehide", function () { if (typeof off === "function") off(); });
  }
  // A document's own file opened from Files (or "Open with"): that
  // document opens, it is not imported again as a copy.
  LY.openStored = function (name, pkg) {
    var p = disk && diskStore ? diskStore.parse(name) : null;
    if (!p || p.conflict || !pkg || !pkg.doc || pkg.doc.id !== p.id || !findDoc(p.id)) return false;
    openDoc(p.id);
    return true;
  };
  // → Promise: the documents from the disk (or the local copy)
  function loadDisk() {
    disk = startDisk();
    if (!disk) return Promise.resolve();
    return disk.load().then(function (res) {
      data = res.data;
      diskReady = true;
      diskSaved({ failed: res.writeFailed });
      if (res.failed) toast(t("toast.diskRead", { n: res.failed }));
      diskPulls.splice(0).forEach(function (inc) { var r = disk.absorb(data, inc); diskApply(r.data, r.changed); });
      watchVault();
      disk.sweepRescue();
    }, function () {
      // the disk cannot be read now: this session works as before, in
      // localStorage; the next start reads the disk again
      disk = null;
      toast(t("toast.diskOff"));
    });
  }

  var saveTimer = null, saveFailShown = false, bigWarned = {}, lastSave = null;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (disk) {
      if (diskReady) lastSave = disk.save(data, LY.doc).then(diskSaved);
      if (window.__orosSyncApi) window.__orosSyncApi.dirty();
      return;
    }
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
  // GL-4 (book item 26): saves now and → Promise once the files and the
  // index hold it (at most ms), so a read right after an edit is current
  LY.settled = function (ms) {
    LY.flushStory && LY.flushStory();
    if (saveTimer) saveNow();
    var p = lastSave || Promise.resolve();
    return Promise.race([p.then(null, function () {}), new Promise(function (ok) { setTimeout(ok, ms || 20000); })]);
  };
  LY.data = function () { return data; };

  function findDoc(id) { return M.find(data.docs, id); }
  LY.findDoc = findDoc;
  LY.allDocs = function () { return data.docs.slice(); };   // the Book dialog (LY-W7)

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

  // Undo steps are { s: the document before the change (JSON), at: when
  // it changed }; the named history (LY-N2) reads them, naming each step
  // only when it is shown (smart.js describe).
  function pushUndo(snap) {
    undoStack.push({ s: snap, at: Date.now() });
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
  function applyState(target, cur) {
    cur = cur || LY.doc;
    var t0 = now();
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

  // back = how many steps (1 = one undo); the steps in between move to
  // the redo stack in order, so Redo walks them again.
  function undoSteps(back) {
    if (!LY.doc || !undoStack.length || back < 1) return;
    back = Math.min(back, undoStack.length);
    LY.flushStory && LY.flushStory();
    var e = null, next = JSON.stringify(LY.doc);
    for (var i = 0; i < back; i++) {
      e = undoStack.pop();
      redoStack.push({ s: next, at: e.at });
      next = e.s;
    }
    replaceDoc(applyState(JSON.parse(e.s)));
    commit();
  }
  function redoSteps(fwd) {
    if (!LY.doc || !redoStack.length || fwd < 1) return;
    fwd = Math.min(fwd, redoStack.length);
    var e = null, prev = JSON.stringify(LY.doc);
    for (var i = 0; i < fwd; i++) {
      e = redoStack.pop();
      undoStack.push({ s: prev, at: e.at });
      prev = e.s;
    }
    replaceDoc(applyState(JSON.parse(e.s)));
    commit();
  }
  LY.undo = function () { undoSteps(1); };
  LY.redo = function () { redoSteps(1); };
  // The named history: the states the undo steps lead through, oldest
  // first, at most `max` (default 40) before now and every one after:
  // [{ i (0 = now, -n = n steps back, +n = n steps forward), at, d: { k, n, name } }]
  LY.history = function (max) {
    if (!LY.doc) return [];
    max = max || 40;
    var states = [], from = Math.max(0, undoStack.length - max);
    for (var a = from; a < undoStack.length; a++) states.push({ s: undoStack[a].s, at: undoStack[a].at, i: a - undoStack.length });
    states.push({ s: null, i: 0 });
    for (var b = redoStack.length - 1; b >= 0; b--) states.push({ s: redoStack[b].s, at: redoStack[b].at, i: redoStack.length - b });
    var S = window.LY_SMART, parsed = states.map(function (st) { try { return st.s ? JSON.parse(st.s) : LY.doc; } catch (e) { return null; } });
    var out = [];
    states.forEach(function (st, k) {
      if (!k) { if (from === 0) out.push({ i: st.i, start: true }); return; }
      // the step from the state before to this one; it happened at the earlier state's time
      out.push({ i: st.i, at: st.i > 0 ? st.at : states[k - 1].at, d: S ? S.describe(parsed[k - 1], parsed[k]) : { k: "edit", n: 0 } });
    });
    return out;
  };
  LY.historyGo = function (i) { if (i < 0) undoSteps(-i); else if (i > 0) redoSteps(i); };
  // Data-level edits of any stored document (automations, recipes.js).
  // putDoc: an edited copy replaces a document that is not open.
  // restoreDoc: a document goes back to a snapshot with fresh stamps
  // (as undo does), so it syncs like any other change; the open one
  // takes it as one more undo step.
  LY.putDoc = function (nd) {
    if (LY.doc && LY.doc.id === nd.id) return false;
    var i = data.docs.findIndex(function (d) { return d.id === nd.id; });
    if (i < 0) return false;
    data.docs[i] = M.normDoc(nd);
    save();
    return true;
  };
  LY.restoreDoc = function (snap) {
    var cur = findDoc(snap.id);
    if (!cur) return false;
    var nd = applyState(snap, cur);
    if (cur === LY.doc) {
      LY.flushStory && LY.flushStory();
      pushUndo(JSON.stringify(cur));
      replaceDoc(nd);
      commit();
    } else {
      data.docs[data.docs.indexOf(cur)] = nd;
      save();
    }
    return true;
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
    if (LANG === "de") return dd + "." + mm + "." + d.getFullYear() + " " + hh + ":" + mi;
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
      if (M.needsNewer(d)) meta.appendChild(el("span", "doc-sub", t("unk.item")));
      else if (d.setup.ext && d.setup.ext.house) meta.appendChild(el("span", "doc-sub", t("hs.badge")));
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
  LY.docTitle = docTitle;

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
    var copy = M.copyDoc(d, now());
    copy.name = t("doc.copy", { name: docTitle(d) }).slice(0, 120);
    data.docs.push(copy);
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
  // a document from a batch import (io.js importMany): kept only when it
  // fits in storage now (R30); → false, and taken back, when it does not
  function addDocQuiet(d) {
    data.docs.push(d);
    data = M.normData(data);
    clearTimeout(saveTimer); saveTimer = null;
    if (disk) {
      // kept once its file is written (and read back)
      return disk.persist(data, true).then(function () {
        if (disk.pathOf(d.id)) { disk.writeIndex(data); return true; }
        data.docs = data.docs.filter(function (x) { return x.id !== d.id; });
        data = M.normData(data);
        return false;
      });
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      data.docs = data.docs.filter(function (x) { return x.id !== d.id; });
      data = M.normData(data);
      save();
      return false;
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    return true;
  }
  // a new document kerns (LY-KERN) and hyphenates Greek (LY-BK);
  // older ones keep their line breaks
  function hyphOn(d) {
    var base = M.find(d.pstyles, "ps-base");
    if (base) { base.ext = base.ext || {}; base.ext.hyph = 1; }
    return d;
  }
  function createDoc(opts) {
    var d = M.newDoc(opts, now()), base = M.find(d.pstyles, "ps-base");
    if (base) base.ext = { kern: 1 };
    addDoc(hyphOn(d));
  }
  LY.createDoc = createDoc; LY.addDoc = addDoc; LY.addDocQuiet = addDocQuiet; LY.hyphOn = hyphOn;
  // a document made by the Assistant or orOS Gate (LY-PRO W1 create):
  // kerned and hyphenated as a new one; dropDoc takes it back (Undo),
  // with a tombstone so the removal syncs
  LY.addNewDoc = function (d) {
    var base = M.find(d.pstyles, "ps-base");
    if (base) { base.ext = base.ext || {}; base.ext.kern = 1; }
    addDoc(hyphOn(d));
    return !!findDoc(d.id);
  };
  LY.dropDoc = function (id) {
    var d = findDoc(id);
    if (!d) return false;
    if (LY.doc && LY.doc.id === id && LY.goHome) LY.goHome();
    data.dt[id] = Math.max(now(), M.maxM(d));
    data = M.normData(data);
    save();
    if (LY.prefs.doc === id) { LY.prefs.doc = null; savePrefs(); }
    if (!LY.doc) renderHome();
    return true;
  };

  function openDoc(id) {
    var d = findDoc(id);
    if (!d) return;
    // A newer model level (setup.ext.mv): never opened, so never written here.
    if (M.needsNewer(d)) { toast(t("unk.doc")); return; }
    LY.doc = d;
    undoStack = []; redoStack = []; gesture = null;
    LY.prefs.doc = id; savePrefs();
    $("home").hidden = true;
    $("editor").hidden = false;
    $("ed-name").textContent = docTitle(d);
    emit("open");
    contNote();
  }
  LY.openDoc = openDoc;

  // CONT-1 W3: tell the shell which document is open (continue.js keeps
  // the reference and the name only, never the pages). On opening, and
  // once at the first tap or key after the start; nothing before that, so
  // a restored document never hides the one from the other device.
  var contLive = false;
  function contNote() {
    if (!contLive) return;
    try {
      var C = window.parent !== window ? window.parent.orosContinue : null;
      if (C && LY.doc) C.note("layout", { target: { doc: LY.doc.id }, title: docTitle(LY.doc) });
    } catch (e) {}
  }
  (function () {
    if (typeof document === "undefined") return;   // Node tests load parts of this file
    var once = function () {
      document.removeEventListener("pointerdown", once, true);
      document.removeEventListener("keydown", once, true);
      contLive = true;
      contNote();
    };
    document.addEventListener("pointerdown", once, true);
    document.addEventListener("keydown", once, true);
  })();

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
                  "--accent", "--accent-hover", "--accent-soft", "--accent-ink",
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

  function sliceGet() { return disk ? disk.sliceGet(data) : M.normData(data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.docs)) return;
    if (disk) {
      // R6: a pull never marks dirty (the files are Vault's)
      if (!diskReady) { diskPulls.push(incoming); return; }
      var r = disk.absorb(data, incoming);
      diskApply(r.data, r.changed);
      return;
    }
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
    // the guided New book (LY-N1) is wired by startui.js
    $("btn-import").addEventListener("click", function () {
      LY.menu($("btn-import"), [
        { label: t("imp.file"), fn: function () { LY.io.importPackage(); } },
        { label: t("imp.disk"), fn: function () { LY.io.importDisk(); } },
        { label: t("imp.folder"), fn: function () { LY.io.importFolder(); } },
        { label: t("imp.port"), fn: function () { LY.io.portFolder(); } },
        { label: t("imp.rebuild"), fn: function () { LY.io.rebuildPdf(); } }
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
    loadDisk().then(function () { return T.load(T.allKeys()); }).then(function () {
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
  // { placeImage: { path, name? } } from the "Send to…" sheet: a
  // picture on the orOS disk (only under /internal/, .png .jpg .jpeg
  // .webp .gif) becomes a new image frame on the current page, or on
  // page 1 of a new document when none is open (io.js placeFromBlob).
  var searchReady = false, searchLater = null;   // fonts first (boot)
  function openSearchTarget(tg) {
    if (!searchReady) { searchLater = tg; return; }
    // { openFile: { token } }: a file from the system's "Open with"
    // (shell fileopen.js), taken once, then the Open button's import.
    if (tg && tg.openFile) {
      if (document.querySelector("dialog[open]")) return;
      var f = takeOpenFile(tg.openFile);
      if (!f) return;
      if (LY.doc) goHome();
      LY.io.openFile(f);
      return;
    }
    // { rebuild: { pdf, src, folder, thread, key, chat } } from the Assistant's
    // card (AS-RB): the PDF and the originals as one-shot tokens
    // ({ token, name }) or paths on the orOS disk (only under
    // /internal/), plus a disk folder of originals; the report goes
    // back to the Assistant under `key`. With `sla` (a Scribus file,
    // the same way) that file opens instead, with its pictures and,
    // when pdf is there, its print PDF's line breaks.
    if (tg && tg.rebuild && typeof tg.rebuild === "object") {
      if (document.querySelector("dialog[open]")) return;
      if (LY.doc) goHome();
      rebuildFor(tg.rebuild);
      return;
    }
    // { house: { op, … key } } from the Assistant's house style cards
    // (AS-HS): learn a house style from documents by name, lay out a
    // manuscript (a one-shot token or a path under /internal/) in one,
    // or add an own rule to one; the report goes back under `key`.
    if (tg && tg.house && typeof tg.house === "object" && /^(learn|book|rule)$/.test(tg.house.op)) {
      if (document.querySelector("dialog[open]")) return;
      if (LY.doc) goHome();
      houseFor(tg.house);
      return;
    }
    // { epub: { title, fmt? } } from Publishing's "EPUB from Layout"
    // (LY-EPUB): the document linked to that title (setup.ext.pub; the
    // last changed one) opens with its Export dialog; nothing is made
    // before the person picks an edition there.
    if (tg && tg.epub && typeof tg.epub === "object" && typeof tg.epub.title === "string") {
      if (document.querySelector("dialog[open]")) return;
      var mine = data.docs.filter(function (d) { return !d.del && d.setup && d.setup.ext && d.setup.ext.pub === tg.epub.title && !M.needsNewer(d); })
        .sort(function (a, b) { return M.maxM(b) - M.maxM(a); })[0];
      if (!mine) { toast(t("ep.noDoc")); return; }
      if (!LY.doc || LY.doc.id !== mine.id) openDoc(mine.id);
      setTimeout(function () { if (LY.doc && LY.doc.id === mine.id && LY.dlg) LY.dlg.exportDlg(); }, 150);
      return;
    }
    // { epubOut: { key, chat, doc?, title?, edition?, layout?, ready? } }
    // from the Assistant's export_epub card or orOS Gate (LY-EPUB E4):
    // the named document (or the one linked to the Publishing title)
    // opens, its EPUB edition is made and checked, a copy goes to
    // /internal/Layout/EPUB/, the report shows on the screen and its
    // numbers (never the book's text) go back under `key`.
    if (tg && tg.epubOut && typeof tg.epubOut === "object") {
      if (document.querySelector("dialog[open]")) { assistBack(tg.epubOut)({ failed: 1, why: "busy" }); return; }
      var epBack = assistBack(tg.epubOut), epRq = tg.epubOut;
      // loaded on first use (layout/epubout.js)
      LY.io.script("epubout.js", "LY_EPUBOUT").then(function (E) { E.run(epRq, epBack); }, function () { toast(t("ep.fail")); epBack({ failed: 1, why: "error" }); });
      return;
    }
    // { pdfOut: { key, chat, doc, preset, pages, bleed, marks, spreads,
    // down } } from the Assistant's export_pdf card or orOS Gate (LY-PRO
    // W1): the named document's PDF (PDF/X-4, print or screen) goes to
    // /internal/Layout/PDF/; numbers, boxes and check codes go back.
    if (tg && tg.pdfOut && typeof tg.pdfOut === "object") {
      if (document.querySelector("dialog[open]")) { assistBack(tg.pdfOut)({ failed: 1, why: "busy" }); return; }
      var pdBack = assistBack(tg.pdfOut), pdRq = tg.pdfOut;
      // loaded on first use (layout/pdfout.js)
      LY.io.script("pdfout.js", "LY_PDFOUT").then(function (E) { E.run(pdRq, pdBack); }, function () { toast(t("exp.fail")); pdBack({ failed: 1, why: "error" }); });
      return;
    }
    // { page: n } (the Assistant's do_action open): page n of the open
    // document, counted from 1.
    if (tg && typeof tg.page === "number") {
      var order = LY.doc ? M.pagesInOrder(LY.doc) : [], pg = order[Math.floor(tg.page) - 1];
      // after the editor has its size (it may have opened just now)
      if (pg && LY.ed && LY.ed.scrollToPage) setTimeout(function () { if (LY.doc) LY.ed.scrollToPage(pg.id); }, 120);
      else toast(t("rb.noPage", { n: Math.floor(tg.page) }));
      return;
    }
    // { newRecipe: { app, nm, steps } }: an automation drafted by the
    // Assistant or sent from another app (recipes/share.js) opens in
    // the editor; it is saved only on Save and runs only on Run.
    if (tg && tg.newRecipe) {
      if (LY.recipes && LY.recipes.draft) LY.recipes.draft(tg.newRecipe);
      return;
    }
    // { edit: { key, chat, docs, steps } } / { editUndo: { key, tok } }:
    // the Assistant's commands after the user pressed Apply on its card
    // (assist.js, AS-EDIT), and their Undo
    if (tg && (tg.edit || tg.editUndo)) {
      if (LY.assist) { if (tg.edit) LY.assist.edit(tg.edit); else LY.assist.undo(tg.editUndo); }
      return;
    }
    // { cover: { title, author, …, img } }: the Book cover dialog,
    // filled in (Publishing, the Assistant); nothing is made until
    // Create. img: a picture on the orOS disk, only under /internal/.
    if (tg && tg.cover && typeof tg.cover === "object") {
      if (document.querySelector("dialog[open]") || !LY.cover) return;
      if (LY.doc) goHome();
      LY.cover.open(tg.cover);
      return;
    }
    if (tg && tg.placeImage) {
      if (document.querySelector("dialog[open]")) return;
      var pi = tg.placeImage, fs = diskFs();
      var path = pi && typeof pi.path === "string" ? pi.path : "";
      if (!fs || path.indexOf("/internal/") !== 0 || /(^|\/)\.\.(\/|$)/.test(path) || !PLACE_EXT.test(path)) return;
      var nm = typeof pi.name === "string" && pi.name.trim() ? pi.name.trim() : path.split("/").pop();
      Promise.resolve(fs.read(path)).then(function (blob) {
        if (!blob) { toast(t("img.fail")); return; }
        return LY.io.placeFromBlob(blob, nm);
      }).then(null, function () { toast(t("img.fail")); });
      return;
    }
    var id = tg && typeof tg.doc === "string" ? tg.doc : null;
    if (!id || !findDoc(id)) return;
    if (document.querySelector("dialog[open]")) return;
    if (LY.doc && LY.doc.id === id) return;
    if (LY.doc) goHome();
    openDoc(id);
  }
  var PLACE_EXT = /\.(png|jpe?g|webp|gif)$/i;
  var RB_SRC = /\.(jpe?g|png|webp|tiff?|gif|txt|md|markdown|html?)$/i, RB_FOLDER_MAX = 400;
  // LOCAL-1: local:<root>/<path> through the shell's local-folder bridge
  function localApi() { try { var p = window.parent; return p && p !== window && p.orosLocal ? p.orosLocal : null; } catch (e) { return null; } }
  function isLocalPath(v) { return typeof v === "string" && /^local:/i.test(v.trim()); }
  function diskPath(v) {
    if (isLocalPath(v)) return v.trim().replace(/[\\/]+$/, "");
    return typeof v === "string" && v.indexOf("/internal/") === 0 && !/(^|\/)\.\.(\/|$)/.test(v) ? v.replace(/\/+$/, "") : "";
  }
  function diskFile(path) {
    if (isLocalPath(path)) {
      var L = localApi();
      return L ? L.read(path, "layout").then(function (f) { return f; }, function () { return null; }) : Promise.resolve(null);
    }
    var fs = diskFs();
    if (!fs || !diskPath(path)) return Promise.resolve(null);
    return Promise.resolve(fs.read(path)).then(function (b) {
      return b ? new File([b], path.split("/").pop(), { type: b.type || "" }) : null;
    }, function () { return null; });
  }
  // the originals in a disk folder and its subfolders, in name order
  function folderFiles(path) {
    var fs = diskFs(), out = [];
    if (isLocalPath(path)) {
      var L = localApi();
      if (!L) return Promise.resolve(out);
      return L.ls(path, 3, "layout").then(function (rows) {
        return rows.filter(function (e) { return !e.dir && RB_SRC.test(e.name); }).slice(0, RB_FOLDER_MAX).reduce(function (p, e) {
          return p.then(function () { return L.read(e.path, "layout").then(function (f) { out.push(f); }, function () {}); });
        }, Promise.resolve());
      }, function () {}).then(function () { return out; });
    }
    if (!fs || !diskPath(path)) return Promise.resolve(out);
    function walk(dir, depth) {
      return Promise.resolve(fs.ls(dir)).then(function (list) {
        var chain = Promise.resolve();
        (list || []).forEach(function (e) {
          chain = chain.then(function () {
            if (out.length >= RB_FOLDER_MAX) return;
            var full = dir + "/" + e.name;
            if (e.dir) return depth < 3 ? walk(full, depth + 1) : null;
            if (!RB_SRC.test(e.name)) return;
            return diskFile(full).then(function (f) { if (f && out.length < RB_FOLDER_MAX) out.push(f); });
          });
        });
        return chain;
      }, function () {});
    }
    return walk(diskPath(path), 0).then(function () { return out; });
  }
  function rbTake(o) {
    if (!o || typeof o !== "object") return Promise.resolve(null);
    if (typeof o.token === "string") return Promise.resolve(takeOpenFile(o));
    return diskFile(o.path);
  }
  // A report for the Assistant's card under its key (orosAssistAtt.rb)
  function assistBack(rq) {
    var key = typeof rq.key === "string" ? rq.key.slice(0, 80) : "";
    return function (rep) {
      if (!key) return;
      try {
        var st = window.parent && window.parent !== window ? window.parent.orosAssistAtt : null;
        if (!st) return;
        if (!st.rb) st.rb = {};
        st.rb[key] = rep;
        if (typeof st.onRb === "function") st.onRb(key);
      } catch (e) {}
    };
  }
  function rebuildFor(rq) {
    var chat = typeof rq.chat === "string" ? rq.chat.slice(0, 80) : "";
    var back = assistBack(rq);
    var src = Array.isArray(rq.src) ? rq.src.slice(0, 400) : [];
    var files = [];
    var chain = Promise.resolve();
    src.forEach(function (o) { chain = chain.then(function () { return rbTake(o); }).then(function (f) { if (f) files.push(f); }); });
    var pdfP = rbTake(rq.pdf), slaP = rq.sla ? rbTake(rq.sla) : Promise.resolve(null);
    return Promise.all([pdfP, chain, rq.folder ? folderFiles(rq.folder) : [], slaP]).then(function (r) {
      var pdf = r[0], sla = r[3];
      if (rq.sla) {
        if (!sla) { toast(t("sla.bad")); back({ failed: 1 }); return; }
        return LY.io.openSla(sla, files.concat(r[2]).filter(LY.io.isPicture), pdf || null).then(function (rep) { back(rep || { failed: 1 }); });
      }
      if (!pdf) { toast(t("rb.noPdf")); back({ failed: 1 }); return; }
      return LY.io.rebuild(pdf, files.concat(r[2]), { chat: chat, thread: rq.thread === 1 }).then(function (rep) {
        back(rep || { failed: 1 });
      });
    }).then(null, function () { toast(t("rb.bad")); back({ failed: 1 }); });
  }
  function houseFor(rq) {
    var back = assistBack(rq);
    if (rq.op !== "book") { LY.house.run(rq, null, back); return; }
    // the photos besides the manuscript (LY-IN): one that cannot be
    // taken is left out and the report counts it
    var photos = [], missed = 0, chain = Promise.resolve();
    (Array.isArray(rq.photos) ? rq.photos.slice(0, 500) : []).forEach(function (o) {
      chain = chain.then(function () { return rbTake(o); }).then(function (f) { if (f) photos.push(f); else missed++; }, function () { missed++; });
    });
    Promise.all([rbTake(rq.doc), chain]).then(function (r) {
      var f = r[0];
      if (!f) { toast(t("txt.fail")); back({ failed: 1, why: "read" }); return; }
      LY.house.run(rq, f, back, photos, missed);
    }, function () { toast(t("txt.fail")); back({ failed: 1, why: "read" }); });
  }
  function diskFs() {
    try { var p = window.parent; return p && p !== window && p.orosFS ? p.orosFS : null; }
    catch (e) { return null; }
  }
  function takeOpenFile(o) {
    try {
      var p = window.parent;
      if (!o || typeof o.token !== "string" || !p || p === window || typeof p.__orosTakeFile !== "function") return null;
      return p.__orosTakeFile(o.token);
    } catch (e) { return null; }
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
