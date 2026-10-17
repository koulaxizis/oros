// ============================================================
// orOS Scanner & PDF — App logic (v1.3.0, waves 1-4: PDF tools,
// signing, page numbers, watermark, compress, camera scan, OCR)
// Everything happens on this device: nothing is uploaded.
//   - Add PDFs and pictures (picker, drag and drop, Files › Open
//     with, the shell's file-open). Every page shows as a card with
//     a thumbnail (PDF.js renders, vendor/pdfjs; pictures are drawn).
//   - Edit the page list: select (tap, Shift+click for a run), move
//     earlier / later or drag, rotate, duplicate, delete; Undo/Redo.
//   - Save PDF: every page in list order as one PDF (merge); Extract:
//     the selected pages as a new PDF; Split: each page, every N
//     pages or ranges ("1-3, 5, 8-") into several PDFs (.zip or a
//     folder in Files). Pictures become pages (A4, Letter or the
//     picture's shape; margins). pdf-lib (vendor/pdf-lib, MIT) writes.
//   - Save to the device (orosDialog.saveFile, R33) or into Files
//     (/internal/PDF/).
//   - Wave 2: the page editor puts signatures (drawn, typed or from a
//     photo), text and the date on pages (p.ov, see core.js); Options
//     add page numbers, a watermark, title and author; Save can make
//     the PDF smaller (pages rendered to JPEG). Text is drawn with
//     Noto Sans through @pdf-lib/fontkit (vendor/pdf-lib, MIT), both
//     loaded only when needed.
// Your files are never changed. Encrypted PDFs are refused (their
// pages can't be copied without the password).
// Data: nothing synced. Device-local (R10): oros-scanpdf-prefs
// { size, orient, margin, dest, cmp }, oros-scanpdf-sigs (saved
// signatures, at most 6, PNG data: URLs; never synced on purpose). Sync exemption: the app keeps no
// user data of its own; results live in Files (Vault Drive when on)
// or wherever the user saves them.
// Notifications: none (exemption, Checklist B item 9): the work is
// done while the app is open.
// Deep link: __orosOpenAt("scanpdf", { paths: [orOS disk paths] }) or
// { openFile: { token } } (a File held by the shell); { files: [File] }
// when called on this window directly.
// Sections:
//   1. Constants, i18n, helpers
//   2. Prefs
//   3. Sources: adding PDFs and pictures
//   4. Thumbnails
//   5. Page list: render, select, edit, drag
//   6. Building and saving PDFs
//   7. Dialogs: save, split, options, clear
//   7b. Page editor: signatures, text, date
//   7c. Signatures: the library and making one
//   8. Toast + busy
//   9. Keyboard (Contract Β)
//  10. Palette + deep link
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.ScanPdfCore;
  var OPS = window.ScanPdfOps;
  var O = window.ScanPdfOcr;

  // ---------- 1. Constants, i18n, helpers ----------
  var SCRIPT_V = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  })();

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
      "app.name": "Scanner & PDF",
      "app.sub": "Scan, merge, split, sign and arrange PDF pages",
      "btn.add": "Add PDFs or pictures", "btn.addMore": "Add more", "btn.split": "Split", "btn.save": "Save PDF",
      "btn.cancel": "Cancel", "btn.undo": "Undo", "btn.redo": "Redo", "btn.addIcon": "Add files",
      "btn.clear": "Clear the list", "btn.selAll": "Select all", "btn.selNone": "Select none",
      "btn.left": "Move earlier", "btn.right": "Move later", "btn.rotl": "Rotate left", "btn.rotr": "Rotate right",
      "btn.dup": "Duplicate", "btn.extract": "Save the selected pages as a new PDF", "btn.del": "Delete",
      "btn.saveIt": "Save", "btn.splitIt": "Split", "btn.done": "Done", "btn.clearIt": "Clear",
      "drop.title": "Drop PDFs or pictures here",
      "drop.hint": "Merge PDFs, split them, take pages out, put them in another order or turn them, sign them, number the pages, make them smaller, read the text of scans so they can be searched, and make a PDF from pictures (JPEG, PNG, WebP, GIF, BMP, AVIF).",
      "drop.local": "Everything happens on this device. Nothing is uploaded and your files are never changed.",
      "drop.veil": "Drop to add",
      "pages.hint": "Tap pages to select them, then use the buttons above. Drag a page to move it. The pen on a page signs it or adds text.",
      "info.pages": "{n} pages", "info.pages.one": "1 page",
      "info.sel": "{n} pages · {s} selected", "info.sel.one": "1 page · {s} selected",
      "foot.files": "{n} files · {size}", "foot.files.one": "1 file · {size}",
      "card": "Page {n}, from {file}, page {p}", "card.img": "Page {n}, the picture {file}",
      "card.rot": "turned {deg}°", "card.sel": "selected",
      "pic.title": "Picture pages",
      "pic.hint": "How a picture becomes a PDF page. PDF pages and scanned pages stay as they are.",
      "pic.size": "Page size", "pic.a4": "A4", "pic.letter": "Letter", "pic.fit": "The picture's shape",
      "pic.orient": "Orientation", "pic.auto": "As the picture", "pic.portrait": "Portrait", "pic.landscape": "Landscape",
      "pic.margin": "Margin", "pic.none": "None", "pic.small": "Small", "pic.normal": "Normal",
      "save.title": "Save PDF", "save.extract": "Save the selected pages",
      "save.name": "File name", "save.where": "Where", "save.device": "On this device",
      "save.files": "In Files › {dir}", "save.filesOff": "Files is not available here.",
      "save.pages": "{n} pages go into the PDF.", "save.pages.one": "1 page goes into the PDF.",
      "split.title": "Split into several PDFs",
      "split.each": "Each page on its own", "split.every": "Every", "split.everyN": "pages",
      "split.ranges": "Page ranges", "split.rangesHint": "For example 1-3, 5, 8-",
      "split.out": "The PDFs go", "split.zip": "Into one .zip on this device", "split.folder": "Into a folder in Files › {dir}",
      "split.preview": "{n} PDFs: {list}", "split.preview.one": "1 PDF: {list}",
      "split.err.empty": "Type the pages, for example 1-3, 5.",
      "split.err.syntax": "“{at}” is not a page or a range.",
      "split.err.range": "“{at}” is outside pages 1 to {n}.",
      "split.err.number": "Type how many pages go into each PDF.",
      "clear.title": "Clear the list?",
      "clear.body": "Every page leaves the list. Your files are not changed.",
      "busy.read": "Reading {name}…", "busy.build": "Making the PDF…", "busy.split": "Making PDF {i} of {n}…",
      "busy.save": "Saving…",
      "err.locked": "{name} is locked with a password, so its pages can't be copied.",
      "err.bad": "{name} could not be read: it is damaged, or not a PDF.",
      "err.img": "{name} could not be read as a picture here.",
      "err.type": "{name} is not a PDF or a picture.",
      "err.big": "{name} is too big ({size}).",
      "err.full": "The list is full ({n} pages).",
      "err.build": "The PDF could not be made.",
      "err.write": "Could not save it in Files.",
      "err.read": "The file could not be read from Files.",
      "err.zip": "The .zip could not be made.",
      "toast.added": "{n} pages added", "toast.added.one": "1 page added",
      "toast.saved": "Saved", "toast.savedFiles": "Saved in Files › {dir}",
      "toast.split": "{n} PDFs made", "toast.undo": "Undone", "toast.redo": "Redone",
      "toast.deleted": "{n} pages deleted", "toast.deleted.one": "1 page deleted",
      "live.moved": "Moved to place {to}",
      "btn.options": "Options", "btn.edit": "Sign or add text", "btn.use": "Use it", "btn.close": "Close without keeping the changes",
      "card.ov": "{n} additions", "card.ov.one": "1 addition",
      "ed.title": "Page {n} of {total}", "ed.prev": "Previous page", "ed.next": "Next page",
      "ed.sig": "Signature", "ed.text": "Text", "ed.date": "Date",
      "ed.hint": "Add a signature, text or the date, then drag it into place. Drag its corner to make it bigger or smaller.",
      "ed.newText": "Your text", "ed.textLabel": "The text", "ed.color": "Colour",
      "color.black": "Black", "color.blue": "Blue", "color.red": "Red",
      "ed.all": "Put on every page", "ed.del": "Remove", "ed.resize": "Resize",
      "ed.itemImg": "Signature", "ed.itemText": "Text: {text}",
      "ed.leaveTitle": "Leave without keeping the changes?", "ed.leaveBody": "What you added on these pages since you opened them is let go.", "ed.leave": "Leave",
      "toast.allPages": "Put on {n} more pages", "toast.allPages.one": "Put on 1 more page",
      "sig.title": "Signature", "sig.pick": "Choose a signature, or make a new one.", "sig.new": "New signature",
      "sig.delete": "Delete this signature", "sig.saved": "Saved signature {n}", "sig.make": "Make a signature",
      "sig.draw": "Draw", "sig.type": "Type", "sig.photo": "Photo", "sig.how": "How",
      "sig.drawHint": "Sign in the box with your finger, a pen or the mouse.", "sig.pad": "Signature box", "sig.clearPad": "Start again",
      "sig.name": "Your name", "sig.photoHint": "A photo of your signature on white paper: the paper becomes see-through.",
      "sig.photoBtn": "Choose a photo", "sig.ink": "Ink", "sig.keep": "Keep it on this device for next time",
      "sig.local": "Saved signatures stay on this device only and are never synced.",
      "sig.empty": "Draw, type or choose a photo first.", "sig.photoBad": "No signature was found in that photo.",
      "opt.title": "Options", "opt.hint": "Page numbers, the watermark and the details go into every PDF you save or split.",
      "num.title": "Page numbers", "num.on": "Number the pages", "num.pos": "Where", "num.fmt": "Style", "num.start": "First number",
      "num.bc": "Bottom, centre", "num.br": "Bottom, right", "num.bl": "Bottom, left", "num.tc": "Top, centre", "num.tr": "Top, right",
      "num.n": "3", "num.nt": "3 / 12",
      "wm.title": "Watermark", "wm.on": "Write a watermark across every page", "wm.text": "Text", "wm.def": "COPY",
      "wm.op": "Strength", "wm.light": "Light", "wm.medium": "Medium", "wm.strong": "Strong",
      "doc.title": "Document details", "doc.name": "Title", "doc.author": "Author", "doc.hint": "Shown in the PDF's properties.",
      "cmp.label": "Make it smaller", "cmp.off": "No", "cmp.light": "A little (sharpest)", "cmp.medium": "Medium", "cmp.strong": "A lot (for email)",
      "cmp.hint": "Pages become pictures, so their own text can no longer be selected. Text read by Make it searchable is kept.",
      "busy.compress": "Making it smaller: page {i} of {n}…", "busy.font": "Loading the font…",
      "toast.smaller": "Saved: {a} → {b}", "toast.smallerFiles": "Saved in Files › {dir}: {a} → {b}",
      "toast.notSmaller": "It was already small, so it was saved as it was.",
      "err.font": "The font for the text could not be loaded.",
      "btn.scan": "Scan with the camera", "btn.scanIcon": "Scan with the camera",
      "sc.title": "Scan", "sc.done": "Add {n} pages", "sc.done.one": "Add 1 page", "sc.close": "Close the scanner",
      "sc.shoot": "Take the picture", "sc.photos": "Choose photos", "sc.auto": "Auto", "sc.autoHint": "Take the picture by itself when the page is held still",
      "sc.torchOn": "Turn the light on", "sc.torchOff": "Turn the light off",
      "sc.find": "Point the camera at a page.", "sc.hold": "Hold still…",
      "sc.denied": "The camera is not allowed here. You can still choose photos of your pages.",
      "sc.nocam": "No camera was found. You can still choose photos of your pages.",
      "sc.adjust": "Drag each corner onto a corner of the page.", "sc.whole": "Whole picture", "sc.retake": "Take again",
      "sc.next": "Next", "sc.corners": "Corners", "sc.keep": "Keep page", "sc.delete": "Delete this page",
      "sc.corner.0": "Top-left corner", "sc.corner.1": "Top-right corner", "sc.corner.2": "Bottom-right corner", "sc.corner.3": "Bottom-left corner",
      "sc.f.color": "Document", "sc.f.gray": "Grey", "sc.f.bw": "Black & white", "sc.f.photo": "Photo", "sc.filter": "Look",
      "sc.page": "Scanned page {n}", "sc.name": "Scan {n}.jpg", "sc.working": "Straightening the page…",
      "sc.leaveTitle": "Leave the scanner?", "sc.leaveBody": "The pages scanned so far are let go.", "sc.leave": "Leave",
      "sc.kept": "Page {n} kept", "sc.bad": "That picture could not be read.",
      "btn.read": "Read text", "card.txt": "text read", "btn.closeIt": "Close",
      "ocr.title": "Read the text",
      "ocr.hint": "The app reads the words on scanned pages and pictures, so the PDF you save can be searched and its text copied. Pages that already have text in the PDF are not read again.",
      "ocr.dl": "The first time, the text recognition engine (Tesseract, about 7 MB with Greek and English) is downloaded from orOS's own site; after that it works offline. Nothing leaves this device.",
      "ocr.lang": "Language", "ocr.both": "Greek and English", "ocr.ell": "Greek", "ocr.eng": "English",
      "ocr.scope": "Pages", "ocr.all": "All {n} pages", "ocr.all.one": "The page", "ocr.sel": "The {n} selected pages", "ocr.sel.one": "The selected page",
      "ocr.go": "Read", "ocr.stop": "Stop",
      "ocr.load": "Loading the text recognition engine… {p}%", "ocr.page": "Reading page {i} of {n}… {p}%",
      "ocr.stopped": "Stopped: {n} pages were read.", "ocr.stopped.one": "Stopped: 1 page was read.",
      "ocr.err": "The text could not be read: the text recognition engine did not load.",
      "ocr.errSave": "The text could not be read, so the PDF is saved without it.",
      "ocr.notSaved": "Stopped, so nothing was saved.",
      "ocr.none": "No text was found on these pages.",
      "txt.title": "Text of the pages", "txt.page": "Page {n}", "txt.empty": "No text was found on this page.",
      "txt.copy": "Copy the text", "txt.send": "Send to an app", "txt.copied": "Text copied", "txt.noCopy": "The text could not be copied here.",
      "save.read": "Make it searchable", "save.readHint": "The text of scanned pages and pictures is read first and put under each page, so the PDF can be searched and copied.",
      "idx.title": "Search", "idx.hint": "PDFs you save into Files can be found in orOS search by their name and text. This list stays on this device: {n} documents.",
      "idx.hint.one": "PDFs you save into Files can be found in orOS search by their name and text. This list stays on this device: 1 document.",
      "idx.forget": "Forget them", "idx.forgot": "The list for search is empty now."
    },
    el: {
      "app.name": "Σαρωτής & PDF",
      "app.sub": "Σάρωση, ένωση, διαχωρισμός, υπογραφή και τακτοποίηση σελίδων PDF",
      "btn.add": "Προσθήκη PDF ή εικόνων", "btn.addMore": "Προσθήκη κι άλλων", "btn.split": "Διαχωρισμός", "btn.save": "Αποθήκευση PDF",
      "btn.cancel": "Ακύρωση", "btn.undo": "Αναίρεση", "btn.redo": "Επανάληψη", "btn.addIcon": "Προσθήκη αρχείων",
      "btn.clear": "Καθαρισμός της λίστας", "btn.selAll": "Επιλογή όλων", "btn.selNone": "Καμία επιλογή",
      "btn.left": "Μετακίνηση νωρίτερα", "btn.right": "Μετακίνηση αργότερα", "btn.rotl": "Περιστροφή αριστερά", "btn.rotr": "Περιστροφή δεξιά",
      "btn.dup": "Διπλασιασμός", "btn.extract": "Αποθήκευση των επιλεγμένων σελίδων ως νέο PDF", "btn.del": "Διαγραφή",
      "btn.saveIt": "Αποθήκευση", "btn.splitIt": "Διαχωρισμός", "btn.done": "Εντάξει", "btn.clearIt": "Καθαρισμός",
      "drop.title": "Άφησε εδώ PDF ή εικόνες",
      "drop.hint": "Ένωσε PDF, χώρισέ τα, βγάλε σελίδες, άλλαξε τη σειρά τους ή γύρισέ τες, υπόγραψέ τα, αρίθμησε τις σελίδες, κάνε τα μικρότερα, διάβασε το κείμενο των σαρώσεων ώστε να βρίσκεται στην αναζήτηση, και φτιάξε PDF από εικόνες (JPEG, PNG, WebP, GIF, BMP, AVIF).",
      "drop.local": "Όλα γίνονται σε αυτή τη συσκευή. Τίποτα δεν ανεβαίνει και τα αρχεία σου δεν αλλάζουν ποτέ.",
      "drop.veil": "Άφησέ τα για προσθήκη",
      "pages.hint": "Πάτησε σελίδες για να τις επιλέξεις και μετά χρησιμοποίησε τα κουμπιά επάνω. Σύρε μια σελίδα για να τη μετακινήσεις. Η πένα σε μια σελίδα την υπογράφει ή προσθέτει κείμενο.",
      "info.pages": "{n} σελίδες", "info.pages.one": "1 σελίδα",
      "info.sel": "{n} σελίδες · {s} επιλεγμένες", "info.sel.one": "1 σελίδα · {s} επιλεγμένες",
      "foot.files": "{n} αρχεία · {size}", "foot.files.one": "1 αρχείο · {size}",
      "card": "Σελίδα {n}, από το {file}, σελίδα {p}", "card.img": "Σελίδα {n}, η εικόνα {file}",
      "card.rot": "γυρισμένη {deg}°", "card.sel": "επιλεγμένη",
      "pic.title": "Σελίδες εικόνων",
      "pic.hint": "Πώς μια εικόνα γίνεται σελίδα PDF. Οι σελίδες των PDF και οι σαρωμένες σελίδες μένουν όπως είναι.",
      "pic.size": "Μέγεθος σελίδας", "pic.a4": "A4", "pic.letter": "Letter", "pic.fit": "Το σχήμα της εικόνας",
      "pic.orient": "Προσανατολισμός", "pic.auto": "Όπως η εικόνα", "pic.portrait": "Κατακόρυφος", "pic.landscape": "Οριζόντιος",
      "pic.margin": "Περιθώριο", "pic.none": "Χωρίς", "pic.small": "Μικρό", "pic.normal": "Κανονικό",
      "save.title": "Αποθήκευση PDF", "save.extract": "Αποθήκευση των επιλεγμένων σελίδων",
      "save.name": "Όνομα αρχείου", "save.where": "Πού", "save.device": "Σε αυτή τη συσκευή",
      "save.files": "Στα Αρχεία › {dir}", "save.filesOff": "Τα Αρχεία δεν είναι διαθέσιμα εδώ.",
      "save.pages": "Στο PDF μπαίνουν {n} σελίδες.", "save.pages.one": "Στο PDF μπαίνει 1 σελίδα.",
      "split.title": "Διαχωρισμός σε πολλά PDF",
      "split.each": "Κάθε σελίδα χωριστά", "split.every": "Ανά", "split.everyN": "σελίδες",
      "split.ranges": "Εύρη σελίδων", "split.rangesHint": "Για παράδειγμα 1-3, 5, 8-",
      "split.out": "Τα PDF πάνε", "split.zip": "Σε ένα .zip σε αυτή τη συσκευή", "split.folder": "Σε φάκελο στα Αρχεία › {dir}",
      "split.preview": "{n} PDF: {list}", "split.preview.one": "1 PDF: {list}",
      "split.err.empty": "Γράψε τις σελίδες, για παράδειγμα 1-3, 5.",
      "split.err.syntax": "Το «{at}» δεν είναι σελίδα ή εύρος.",
      "split.err.range": "Το «{at}» είναι έξω από τις σελίδες 1 έως {n}.",
      "split.err.number": "Γράψε πόσες σελίδες μπαίνουν σε κάθε PDF.",
      "clear.title": "Καθαρισμός της λίστας;",
      "clear.body": "Όλες οι σελίδες βγαίνουν από τη λίστα. Τα αρχεία σου δεν αλλάζουν.",
      "busy.read": "Διάβασμα του {name}…", "busy.build": "Δημιουργία του PDF…", "busy.split": "Δημιουργία PDF {i} από {n}…",
      "busy.save": "Αποθήκευση…",
      "err.locked": "Το {name} είναι κλειδωμένο με κωδικό, οπότε οι σελίδες του δεν αντιγράφονται.",
      "err.bad": "Το {name} δεν διαβάστηκε: είναι κατεστραμμένο ή δεν είναι PDF.",
      "err.img": "Το {name} δεν διαβάζεται εδώ ως εικόνα.",
      "err.type": "Το {name} δεν είναι PDF ούτε εικόνα.",
      "err.big": "Το {name} είναι πολύ μεγάλο ({size}).",
      "err.full": "Η λίστα γέμισε ({n} σελίδες).",
      "err.build": "Το PDF δεν φτιάχτηκε.",
      "err.write": "Δεν αποθηκεύτηκε στα Αρχεία.",
      "err.read": "Το αρχείο δεν διαβάστηκε από τα Αρχεία.",
      "err.zip": "Το .zip δεν φτιάχτηκε.",
      "toast.added": "Προστέθηκαν {n} σελίδες", "toast.added.one": "Προστέθηκε 1 σελίδα",
      "toast.saved": "Αποθηκεύτηκε", "toast.savedFiles": "Αποθηκεύτηκε στα Αρχεία › {dir}",
      "toast.split": "Φτιάχτηκαν {n} PDF", "toast.undo": "Αναιρέθηκε", "toast.redo": "Επαναλήφθηκε",
      "toast.deleted": "Διαγράφηκαν {n} σελίδες", "toast.deleted.one": "Διαγράφηκε 1 σελίδα",
      "live.moved": "Μετακινήθηκε στη θέση {to}",
      "btn.options": "Επιλογές", "btn.edit": "Υπογραφή ή κείμενο", "btn.use": "Χρήση", "btn.close": "Κλείσιμο χωρίς τις αλλαγές",
      "card.ov": "{n} προσθήκες", "card.ov.one": "1 προσθήκη",
      "ed.title": "Σελίδα {n} από {total}", "ed.prev": "Προηγούμενη σελίδα", "ed.next": "Επόμενη σελίδα",
      "ed.sig": "Υπογραφή", "ed.text": "Κείμενο", "ed.date": "Ημερομηνία",
      "ed.hint": "Πρόσθεσε υπογραφή, κείμενο ή την ημερομηνία και σύρε τα στη θέση τους. Σύρε τη γωνία τους για να τα μεγαλώσεις ή να τα μικρύνεις.",
      "ed.newText": "Το κείμενό σου", "ed.textLabel": "Το κείμενο", "ed.color": "Χρώμα",
      "color.black": "Μαύρο", "color.blue": "Μπλε", "color.red": "Κόκκινο",
      "ed.all": "Σε κάθε σελίδα", "ed.del": "Αφαίρεση", "ed.resize": "Αλλαγή μεγέθους",
      "ed.itemImg": "Υπογραφή", "ed.itemText": "Κείμενο: {text}",
      "ed.leaveTitle": "Έξοδος χωρίς τις αλλαγές;", "ed.leaveBody": "Ό,τι πρόσθεσες σε αυτές τις σελίδες από τη στιγμή που τις άνοιξες χάνεται.", "ed.leave": "Έξοδος",
      "toast.allPages": "Μπήκε σε {n} ακόμη σελίδες", "toast.allPages.one": "Μπήκε σε 1 ακόμη σελίδα",
      "sig.title": "Υπογραφή", "sig.pick": "Διάλεξε μια υπογραφή ή φτιάξε νέα.", "sig.new": "Νέα υπογραφή",
      "sig.delete": "Διαγραφή αυτής της υπογραφής", "sig.saved": "Αποθηκευμένη υπογραφή {n}", "sig.make": "Φτιάξε υπογραφή",
      "sig.draw": "Σχεδίασε", "sig.type": "Πληκτρολόγησε", "sig.photo": "Φωτογραφία", "sig.how": "Πώς",
      "sig.drawHint": "Υπόγραψε στο πλαίσιο με το δάχτυλο, γραφίδα ή το ποντίκι.", "sig.pad": "Πλαίσιο υπογραφής", "sig.clearPad": "Από την αρχή",
      "sig.name": "Το όνομά σου", "sig.photoHint": "Φωτογραφία της υπογραφής σου σε λευκό χαρτί: το χαρτί γίνεται διάφανο.",
      "sig.photoBtn": "Διάλεξε φωτογραφία", "sig.ink": "Μελάνι", "sig.keep": "Κράτησέ την σε αυτή τη συσκευή για την επόμενη φορά",
      "sig.local": "Οι αποθηκευμένες υπογραφές μένουν μόνο σε αυτή τη συσκευή και δεν συγχρονίζονται ποτέ.",
      "sig.empty": "Πρώτα σχεδίασε, γράψε ή διάλεξε φωτογραφία.", "sig.photoBad": "Δεν βρέθηκε υπογραφή σε αυτή τη φωτογραφία.",
      "opt.title": "Επιλογές", "opt.hint": "Η αρίθμηση, το υδατογράφημα και τα στοιχεία μπαίνουν σε κάθε PDF που αποθηκεύεις ή χωρίζεις.",
      "num.title": "Αρίθμηση σελίδων", "num.on": "Αρίθμησε τις σελίδες", "num.pos": "Πού", "num.fmt": "Μορφή", "num.start": "Πρώτος αριθμός",
      "num.bc": "Κάτω, στη μέση", "num.br": "Κάτω, δεξιά", "num.bl": "Κάτω, αριστερά", "num.tc": "Πάνω, στη μέση", "num.tr": "Πάνω, δεξιά",
      "num.n": "3", "num.nt": "3 / 12",
      "wm.title": "Υδατογράφημα", "wm.on": "Γράψε υδατογράφημα σε κάθε σελίδα", "wm.text": "Κείμενο", "wm.def": "ΑΝΤΙΓΡΑΦΟ",
      "wm.op": "Ένταση", "wm.light": "Αχνό", "wm.medium": "Μέτριο", "wm.strong": "Έντονο",
      "doc.title": "Στοιχεία εγγράφου", "doc.name": "Τίτλος", "doc.author": "Συγγραφέας", "doc.hint": "Φαίνονται στις ιδιότητες του PDF.",
      "cmp.label": "Μικρότερο αρχείο", "cmp.off": "Όχι", "cmp.light": "Λίγο (πιο καθαρό)", "cmp.medium": "Μέτρια", "cmp.strong": "Πολύ (για email)",
      "cmp.hint": "Οι σελίδες γίνονται εικόνες, οπότε το δικό τους κείμενο δεν επιλέγεται πια. Το κείμενο που διαβάστηκε με το «Να γίνει αναζητήσιμο» μένει.",
      "busy.compress": "Σμίκρυνση: σελίδα {i} από {n}…", "busy.font": "Φόρτωση της γραμματοσειράς…",
      "toast.smaller": "Αποθηκεύτηκε: {a} → {b}", "toast.smallerFiles": "Αποθηκεύτηκε στα Αρχεία › {dir}: {a} → {b}",
      "toast.notSmaller": "Ήταν ήδη μικρό, οπότε αποθηκεύτηκε όπως ήταν.",
      "err.font": "Η γραμματοσειρά για το κείμενο δεν φορτώθηκε.",
      "btn.scan": "Σάρωση με την κάμερα", "btn.scanIcon": "Σάρωση με την κάμερα",
      "sc.title": "Σάρωση", "sc.done": "Προσθήκη {n} σελίδων", "sc.done.one": "Προσθήκη 1 σελίδας", "sc.close": "Κλείσιμο του σαρωτή",
      "sc.shoot": "Λήψη φωτογραφίας", "sc.photos": "Διάλεξε φωτογραφίες", "sc.auto": "Αυτόματα", "sc.autoHint": "Η φωτογραφία τραβιέται μόνη της όταν η σελίδα μένει ακίνητη",
      "sc.torchOn": "Άναψε το φως", "sc.torchOff": "Σβήσε το φως",
      "sc.find": "Στρέψε την κάμερα σε μια σελίδα.", "sc.hold": "Μείνε ακίνητος…",
      "sc.denied": "Η κάμερα δεν επιτρέπεται εδώ. Μπορείς ακόμη να διαλέξεις φωτογραφίες των σελίδων σου.",
      "sc.nocam": "Δεν βρέθηκε κάμερα. Μπορείς ακόμη να διαλέξεις φωτογραφίες των σελίδων σου.",
      "sc.adjust": "Σύρε κάθε γωνία πάνω σε μια γωνία της σελίδας.", "sc.whole": "Όλη η εικόνα", "sc.retake": "Ξανά λήψη",
      "sc.next": "Επόμενο", "sc.corners": "Γωνίες", "sc.keep": "Κράτα τη σελίδα", "sc.delete": "Διαγραφή αυτής της σελίδας",
      "sc.corner.0": "Πάνω αριστερή γωνία", "sc.corner.1": "Πάνω δεξιά γωνία", "sc.corner.2": "Κάτω δεξιά γωνία", "sc.corner.3": "Κάτω αριστερή γωνία",
      "sc.f.color": "Έγγραφο", "sc.f.gray": "Γκρι", "sc.f.bw": "Ασπρόμαυρο", "sc.f.photo": "Φωτογραφία", "sc.filter": "Εμφάνιση",
      "sc.page": "Σαρωμένη σελίδα {n}", "sc.name": "Σάρωση {n}.jpg", "sc.working": "Ίσιωμα της σελίδας…",
      "sc.leaveTitle": "Έξοδος από τον σαρωτή;", "sc.leaveBody": "Οι σελίδες που σάρωσες ως τώρα χάνονται.", "sc.leave": "Έξοδος",
      "sc.kept": "Κρατήθηκε η σελίδα {n}", "sc.bad": "Αυτή η εικόνα δεν διαβάστηκε.",
      "btn.read": "Ανάγνωση κειμένου", "card.txt": "το κείμενο διαβάστηκε", "btn.closeIt": "Κλείσιμο",
      "ocr.title": "Ανάγνωση του κειμένου",
      "ocr.hint": "Η εφαρμογή διαβάζει τις λέξεις στις σαρωμένες σελίδες και τις εικόνες, ώστε στο PDF που αποθηκεύεις να γίνεται αναζήτηση και να αντιγράφεται το κείμενό του. Οι σελίδες που έχουν ήδη κείμενο στο PDF δεν διαβάζονται ξανά.",
      "ocr.dl": "Την πρώτη φορά η μηχανή αναγνώρισης κειμένου (Tesseract, περίπου 7 MB με ελληνικά και αγγλικά) κατεβαίνει από τον δικό ιστότοπο του orOS· μετά δουλεύει και χωρίς σύνδεση. Τίποτα δεν φεύγει από αυτή τη συσκευή.",
      "ocr.lang": "Γλώσσα", "ocr.both": "Ελληνικά και αγγλικά", "ocr.ell": "Ελληνικά", "ocr.eng": "Αγγλικά",
      "ocr.scope": "Σελίδες", "ocr.all": "Και οι {n} σελίδες", "ocr.all.one": "Η σελίδα", "ocr.sel": "Οι {n} επιλεγμένες σελίδες", "ocr.sel.one": "Η επιλεγμένη σελίδα",
      "ocr.go": "Ανάγνωση", "ocr.stop": "Διακοπή",
      "ocr.load": "Φόρτωση της μηχανής αναγνώρισης κειμένου… {p}%", "ocr.page": "Ανάγνωση σελίδας {i} από {n}… {p}%",
      "ocr.stopped": "Διακόπηκε: διαβάστηκαν {n} σελίδες.", "ocr.stopped.one": "Διακόπηκε: διαβάστηκε 1 σελίδα.",
      "ocr.err": "Το κείμενο δεν διαβάστηκε: η μηχανή αναγνώρισης κειμένου δεν φόρτωσε.",
      "ocr.errSave": "Το κείμενο δεν διαβάστηκε, οπότε το PDF αποθηκεύεται χωρίς αυτό.",
      "ocr.notSaved": "Διακόπηκε, οπότε δεν αποθηκεύτηκε τίποτα.",
      "ocr.none": "Δεν βρέθηκε κείμενο σε αυτές τις σελίδες.",
      "txt.title": "Το κείμενο των σελίδων", "txt.page": "Σελίδα {n}", "txt.empty": "Δεν βρέθηκε κείμενο σε αυτή τη σελίδα.",
      "txt.copy": "Αντιγραφή του κειμένου", "txt.send": "Αποστολή σε εφαρμογή", "txt.copied": "Το κείμενο αντιγράφηκε", "txt.noCopy": "Το κείμενο δεν αντιγράφηκε εδώ.",
      "save.read": "Να γίνει αναζητήσιμο", "save.readHint": "Το κείμενο των σαρωμένων σελίδων και των εικόνων διαβάζεται πρώτα και μπαίνει κάτω από κάθε σελίδα, ώστε στο PDF να γίνεται αναζήτηση και αντιγραφή.",
      "idx.title": "Αναζήτηση", "idx.hint": "Τα PDF που αποθηκεύεις στα Αρχεία βρίσκονται στην αναζήτηση του orOS με το όνομα και το κείμενό τους. Η λίστα μένει σε αυτή τη συσκευή: {n} έγγραφα.",
      "idx.hint.one": "Τα PDF που αποθηκεύεις στα Αρχεία βρίσκονται στην αναζήτηση του orOS με το όνομα και το κείμενό τους. Η λίστα μένει σε αυτή τη συσκευή: 1 έγγραφο.",
      "idx.forget": "Ξέχασέ τα", "idx.forgot": "Η λίστα για την αναζήτηση άδειασε."
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
  // Singular / plural pair: "<key>.one" for 1, "<key>" otherwise.
  function tn(key, n, params) {
    var p = params || {};
    p.n = n;
    return t(n === 1 && (STRINGS.en[key + ".one"] !== undefined) ? key + ".one" : key, p);
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }

  function parentWin() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  function dialogHost() {
    try { if (window.orosDialog) return window.orosDialog; } catch (e) {}
    try { var p = parentWin(); return p && p.orosDialog ? p.orosDialog : null; } catch (e) { return null; }
  }
  function fsApi() {
    try {
      var p = parentWin(), fs = p ? p.orosFS : null;
      return fs && typeof fs.writeBlob === "function" && typeof fs.readBlob === "function" &&
             typeof fs.stat === "function" ? fs : null;
    } catch (e) { return null; }
  }
  function codeErr(code) { var e = new Error(code); e.code = code; return e; }

  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICON = {
    undo: SVG + '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
    redo: SVG + '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>',
    plus: SVG + '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    clear: SVG + '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    all: SVG + '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    left: SVG + '<polyline points="15 18 9 12 15 6"/></svg>',
    right: SVG + '<polyline points="9 18 15 12 9 6"/></svg>',
    rotl: SVG + '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    rotr: SVG + '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    dup: SVG + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    extract: SVG + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    del: SVG + '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    check: SVG + '<polyline points="20 6 9 17 4 12"/></svg>',
    pen: SVG + '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    text: SVG + '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    date: SVG + '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    sig: SVG + '<path d="M3 17c3-1 4-9 6-9s1 7 3 7 2-4 4-4 1 3 3 3"/><line x1="3" y1="21" x2="21" y2="21"/></svg>',
    close: SVG + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    camera: SVG + '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    image: SVG + '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    torch: SVG + '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    copy: SVG + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>'
  };

  // BOOT MARKER
  (function () {
    document.documentElement.lang = LANG;
    console.log("scanpdf.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Prefs ----------
  var prefs = C.readPrefs(null);
  // Page numbers, watermark, title, author: for this session only.
  var docOpts = C.readDocOpts(null);
  function loadPrefs() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(C.PREFS_KEY) || "null"); } catch (e) {}
    prefs = C.readPrefs(raw);
  }
  function savePrefs() {
    try { localStorage.setItem(C.PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. Sources: adding PDFs and pictures ----------
  // source: { id, name, size, kind "pdf"|"image", hue, bytes (pdf),
  //   doc (pdf-lib document), pages (count), img { bytes, type, w, h } }
  var sources = {};
  var srcOrder = [];
  var pages = [];
  var sel = {};
  var hist = C.history();
  var lastClicked = null;
  var nextSrc = 1, nextKey = 1;
  var adding = Promise.resolve();
  function mkKey() { return "p" + (nextKey++); }

  function readBytes(blob) {
    return blob.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  // Queue: files are read one after the other, in the order given.
  function addBlobs(list) {
    list = (list || []).filter(function (it) { return it && it.blob && it.name; });
    if (!list.length) return adding;
    adding = adding.then(function () {
      toastShown = false;
      var added = 0, before = pages.length, recorded = false;
      return list.reduce(function (c, it) {
        return c.then(function () {
          if (pages.length >= C.MAX_PAGES) return;
          return readOne(it).then(function (src) {
            if (!src) return;
            if (!recorded) { C.record(hist, pages); recorded = true; }
            var room = C.MAX_PAGES - pages.length;
            var n = src.kind === "pdf" ? Math.min(src.pages, room) : 1;
            sources[src.id] = src;
            srcOrder.push(src.id);
            pages = pages.concat(C.pagesOf(src.id, n, mkKey));
            added += n;
            if (n < (src.pages || 1)) showToast(t("err.full", { n: C.MAX_PAGES }));
            renderAll();
          });
        });
      }, Promise.resolve()).then(function () {
        hideBusy();
        if (added && pages.length > before) {
          say(tn("toast.added", added));
          if (!toastShown) showToast(tn("toast.added", added));
        }
        toastShown = false;
      });
    });
    return adding;
  }

  function readOne(it) {
    var name = String(it.name), blob = it.blob, kind = C.kindOf(name, blob.type);
    if (!kind) { errToast("err.type", name); return Promise.resolve(null); }
    if (blob.size > C.MAX_FILE) { errToast("err.big", name, C.sizeLabel(blob.size, LANG)); return Promise.resolve(null); }
    showBusy(t("busy.read", { name: name }));
    return readBytes(blob).then(function (bytes) {
      var real = C.sniff(bytes);
      if (real === "pdf") return readPdf(name, blob.size, bytes);
      if (kind === "pdf") { errToast("err.bad", name); return null; }
      return readImage(name, blob, bytes, real).then(function (src) {
        if (src && it.scan) src.scan = true;
        return src;
      });
    }).then(null, function () { errToast(kind === "pdf" ? "err.bad" : "err.img", name); return null; });
  }

  function newSource(name, size, kind) {
    var id = "s" + (nextSrc++);
    return { id: id, name: name, size: size, kind: kind, hue: (srcOrder.length * 67 + 30) % 360 };
  }

  function readPdf(name, size, bytes) {
    return OPS.load(window.PDFLib, bytes).then(function (res) {
      if (res.err) { errToast(res.err === "locked" ? "err.locked" : "err.bad", name); return null; }
      var src = newSource(name, size, "pdf");
      src.bytes = bytes;
      src.doc = res.doc;
      src.pages = res.pages;
      return src;
    });
  }

  // A JPEG that stands upright and a PNG go into the PDF as they are;
  // any other picture (WebP, GIF, BMP, AVIF, a sideways phone photo)
  // is drawn upright on a canvas first: PNG when it has see-through
  // parts, else JPEG.
  var MAX_SIDE = 8000;
  function readImage(name, blob, bytes, real) {
    if (typeof createImageBitmap !== "function") return Promise.reject(codeErr("img"));
    return createImageBitmap(blob).then(function (bmp) {
      var src = newSource(name, blob.size, "image");
      var asIs = (real === "jpeg" && C.exifOrientation(bytes) === 1) || real === "png";
      if (asIs) {
        src.img = { bytes: bytes, type: real === "png" ? "png" : "jpg", w: bmp.width, h: bmp.height };
        src.thumb = thumbOf(bmp);
        return src;
      }
      var s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var ctx = cv.getContext("2d");
      ctx.drawImage(bmp, 0, 0, w, h);
      var alpha = real !== "jpeg" && hasAlpha(ctx, w, h);
      return new Promise(function (res, rej) {
        cv.toBlob(function (b) { b ? res(b) : rej(codeErr("img")); }, alpha ? "image/png" : "image/jpeg", 0.92);
      }).then(readBytes).then(function (out) {
        src.img = { bytes: out, type: alpha ? "png" : "jpg", w: w, h: h };
        src.thumb = thumbOf(bmp);
        return src;
      });
    });
  }
  // A small copy for the card; the full bitmap is let go.
  function thumbOf(bmp) {
    var s = Math.min(1, 400 / Math.max(bmp.width, bmp.height));
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    try { bmp.close(); } catch (e) {}
    return cv;
  }
  // Any see-through pixel? Checked on a small copy, so it stays quick.
  function hasAlpha(ctx, w, h) {
    try {
      var sw = Math.min(w, 256), sh = Math.min(h, 256);
      var c2 = document.createElement("canvas");
      c2.width = sw; c2.height = sh;
      var x = c2.getContext("2d");
      x.drawImage(ctx.canvas, 0, 0, sw, sh);
      var d = x.getImageData(0, 0, sw, sh).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (e) {}
    return false;
  }

  function addFiles(files) {
    addBlobs([].slice.call(files || []).map(function (f) { return { name: f.name, blob: f }; }));
  }
  // Disk paths from Files: read one at a time.
  function addPaths(paths) {
    var fs = fsApi();
    if (!fs || !paths.length) return;
    paths.forEach(function (p) {
      adding = adding.then(function () {
        return fs.readBlob(p).then(function (b) {
          return addBlobs([{ name: p.slice(p.lastIndexOf("/") + 1), blob: b }]);
        }, function () { showToast(t("err.read")); });
      });
    });
  }

  function pickFiles() {
    var acc = C.PDF_EXT.concat(C.IMAGE_EXT).join(",") + ",application/pdf,image/*";
    var dlg = dialogHost();
    if (dlg && typeof dlg.openFiles === "function") {
      dlg.openFiles(acc).then(function (files) { if (files && files.length) addFiles(files); });
      return;
    }
    var inp = document.createElement("input");
    inp.type = "file"; inp.multiple = true; inp.accept = acc;
    inp.addEventListener("change", function () { if (inp.files && inp.files.length) addFiles(inp.files); inp.value = ""; });
    inp.click();
  }

  // ---------- 4. Thumbnails ----------
  // One upright picture per source page ("<src>:<idx>"), drawn turned
  // into each card's canvas, so rotating never renders again.
  var THUMB_W = 180;
  var base = {};            // "<src>:<idx>" -> canvas | ImageBitmap
  var pjsDocs = {};         // src id -> Promise<PDF.js document>
  var queue = [], rendering = false;

  var LIBSRC = "../vendor/pdfjs/pdf.min.js", WORKER = "../vendor/pdfjs/pdf.worker.min.js";
  var pdfjsP = null;
  function pdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsP) return pdfjsP;
    pdfjsP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.type = "module"; s.src = LIBSRC;
      s.onload = function () {
        if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; res(window.pdfjsLib); }
        else rej(new Error("pdfjs"));
      };
      s.onerror = function () { pdfjsP = null; rej(new Error("pdfjs")); };
      document.head.appendChild(s);
    });
    return pdfjsP;
  }
  function pjsDoc(src) {
    if (!pjsDocs[src.id]) {
      pjsDocs[src.id] = pdfjs().then(function (lib) {
        // PDF.js takes over (detaches) the buffer it gets: hand it a copy
        return lib.getDocument({ data: src.bytes.slice(), isEvalSupported: false, enableXfa: false,
                                 disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise;
      });
      pjsDocs[src.id].then(null, function () { delete pjsDocs[src.id]; });
    }
    return pjsDocs[src.id];
  }

  function baseKey(p) { return p.src + ":" + p.idx; }

  function wantThumb(p) {
    var k = baseKey(p);
    if (base[k] || queue.indexOf(k) !== -1) return;
    queue.push(k);
    pump();
  }
  function pump() {
    if (rendering || !queue.length) return;
    rendering = true;
    var k = queue.shift(), i = k.lastIndexOf(":"), src = sources[k.slice(0, i)], idx = +k.slice(i + 1);
    var job = !src ? Promise.resolve() : src.kind === "image" ? Promise.resolve(src.thumb).then(function (b) { base[k] = b; })
      : pjsDoc(src).then(function (doc) { return doc.getPage(idx + 1); }).then(function (pg) {
          var dpr = Math.min(2, window.devicePixelRatio || 1);
          var v1 = pg.getViewport({ scale: 1 });
          var vp = pg.getViewport({ scale: (THUMB_W * dpr) / Math.max(v1.width, v1.height) * 1.3 });
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.floor(vp.width)); cv.height = Math.max(1, Math.floor(vp.height));
          var ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
          return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
            base[k] = cv;
            try { pg.cleanup(); } catch (e) {}
          });
        });
    job.then(null, function () { base[k] = "bad"; }).then(function () {
      rendering = false;
      [].forEach.call(document.querySelectorAll('canvas[data-base="' + k + '"]'), drawThumb);
      pump();
    });
  }

  // Draw the base picture of a card turned by its rotation.
  function drawThumb(cv) {
    var k = cv.getAttribute("data-base"), rot = +cv.getAttribute("data-rot") || 0, b = base[k];
    var card = cv.closest(".card");
    if (!b || !card) return;
    if (b === "bad") { card.classList.add("thumb-bad"); return; }
    var k0 = k.slice(0, k.lastIndexOf(":")), src = sources[k0];
    if (src && src.kind === "image") b = picturePage(src, b, 400);
    var bw = b.width, bh = b.height, turned = rot === 90 || rot === 270;
    var w = turned ? bh : bw, h = turned ? bw : bh;
    var s = 400 / Math.max(w, h);
    cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
    var ctx = cv.getContext("2d");
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    var dw = bw * s, dh = bh * s;
    ctx.drawImage(b, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    var i = indexOf(card.getAttribute("data-key"));
    if (i !== -1) drawMarks(ctx, pages[i], i, pages.length, cv.width, cv.height, function () { drawThumb(cv); });
    card.classList.add("thumb-ok");
  }

  // What the PDF gets on top of a page, drawn on a picture of the
  // turned page (cw × ch pixels): additions, watermark, page number.
  var ovImgs = {};
  function ovImage(src, redraw) {
    var im = ovImgs[src];
    if (!im) { im = new Image(); im.src = src; ovImgs[src] = im; }
    if (!im.complete && redraw) im.addEventListener("load", redraw, { once: true });
    return im;
  }
  var CSS_COLOR = { black: "#121217", blue: "#1a3b99", red: "#bf1a1f" };
  var SANS = '"ScanPdfSans", "Noto Sans", sans-serif';
  function drawMarks(ctx, p, i, total, cw, ch, redraw) {
    var g = geomOf(p);
    if (!g) return;
    var d = C.dispSize(g.W, g.H, g.R), k = cw / d[0], S = Math.min(g.W, g.H);
    (p.ov || []).forEach(function (o) {
      var v = C.ovDisp(o, g.W, g.H, g.R);
      ctx.save();
      ctx.translate(v.fx * cw, v.fy * ch);
      ctx.rotate(v.turn * Math.PI / 180);
      if (o.t === "img") {
        var im = ovImage(o.src, redraw), w = o.w * S * k, h = o.h * S * k;
        if (im.complete && im.naturalWidth) ctx.drawImage(im, -w / 2, -h / 2, w, h);
      } else {
        var fs = o.fs * S * k;
        ctx.font = fs + "px " + SANS;
        ctx.fillStyle = CSS_COLOR[o.color] || CSS_COLOR.black;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(o.text, 0, C.BASELINE * fs);
      }
      ctx.restore();
    });
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (docOpts.wm.on) {
      var text = docOpts.wm.text.trim();
      ctx.font = "100px " + SANS;
      var ws = C.wmSize(ctx.measureText(text).width / 100, d[0], d[1]) * k;
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.font = ws + "px " + SANS;
      ctx.globalAlpha = C.WM_OP[docOpts.wm.op];
      ctx.fillStyle = "#808080";
      ctx.fillText(text, 0, C.BASELINE * ws);
      ctx.restore();
    }
    if (docOpts.num.on) {
      var ns = C.numSize(S), c = C.numCenter(docOpts.num.pos, d[0], d[1], ns);
      ctx.font = ns * k + "px " + SANS;
      ctx.fillStyle = "#333";
      ctx.fillText(C.numText(docOpts, i, total), c[0] * k, (c[1] + C.BASELINE * ns) * k);
    }
    ctx.restore();
  }

  // A picture's card shows the page it becomes (size and margin from
  // the Picture pages choices), white around the picture; `side` is
  // the long side in pixels.
  function picturePage(src, thumb, side) {
    var pp = C.prefsFor(src, prefs), size = C.pageFor(src.img.w, src.img.h, pp);
    var sc = side / Math.max(size[0], size[1]);
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(size[0] * sc)); cv.height = Math.max(1, Math.round(size[1] * sc));
    var ctx = cv.getContext("2d"), r = C.fitRect(src.img.w, src.img.h, size[0], size[1], pp.margin);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(thumb, r.x * sc, (size[1] - r.y - r.h) * sc, r.w * sc, r.h * sc);
    return cv;
  }

  var io = typeof IntersectionObserver === "function" ? new IntersectionObserver(function (ents) {
    ents.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      var key = e.target.getAttribute("data-key");
      var p = pages.filter(function (x) { return x.key === key; })[0];
      if (p) wantThumb(p);
    });
  }, { rootMargin: "300px" }) : null;

  // ---------- 5. Page list: render, select, edit, drag ----------
  function selKeys() { return pages.filter(function (p) { return sel[p.key]; }).map(function (p) { return p.key; }); }
  function pruneSel() {
    var live = {};
    pages.forEach(function (p) { live[p.key] = true; });
    Object.keys(sel).forEach(function (k) { if (!live[k]) delete sel[k]; });
  }

  function cardLabel(p, i) {
    var src = sources[p.src], parts = [];
    parts.push(src.kind === "image" ? t("card.img", { n: i + 1, file: src.name })
                                    : t("card", { n: i + 1, file: src.name, p: p.idx + 1 }));
    if (p.rot) parts.push(t("card.rot", { deg: p.rot }));
    if (p.ov && p.ov.length) parts.push(tn("card.ov", p.ov.length));
    if (hasText(p)) parts.push(t("card.txt"));
    return parts.join(", ");
  }

  function renderGrid() {
    var grid = $("grid"), focusKey = document.activeElement && document.activeElement.getAttribute &&
               document.activeElement.getAttribute("data-key");
    if (io) io.disconnect();
    grid.textContent = "";
    var multi = Object.keys(C.usedSources(pages)).length > 1;
    pages.forEach(function (p, i) {
      var src = sources[p.src];
      var li = el("li", "card" + (sel[p.key] ? " sel" : "") + (p.ov && p.ov.length ? " has-ov" : "") + (hasText(p) ? " has-txt" : ""));
      li.setAttribute("data-key", p.key);
      li.style.setProperty("--src-hue", String(src.hue));
      var b = el("button", "card-main");
      b.type = "button";
      b.setAttribute("data-key", p.key);
      b.setAttribute("aria-pressed", sel[p.key] ? "true" : "false");
      b.setAttribute("aria-label", cardLabel(p, i));
      var box = el("span", "thumb");
      var cv = document.createElement("canvas");
      cv.setAttribute("data-base", baseKey(p));
      cv.setAttribute("data-rot", String(p.rot));
      box.appendChild(cv);
      b.appendChild(box);
      var tick = el("span", "tick");
      tick.innerHTML = ICON.check;
      b.appendChild(tick);
      var cap = el("span", "cap");
      cap.appendChild(el("span", "num", String(i + 1)));
      if (hasText(p)) { var tm = el("span", "txt-mark"); tm.innerHTML = ICON.text; cap.appendChild(tm); }
      if (multi || src.kind === "image") {
        var from = el("span", "from", src.kind === "image" ? src.name : src.name + " · " + (p.idx + 1));
        cap.appendChild(from);
      }
      b.appendChild(cap);
      li.appendChild(b);
      var grip = el("span", "grip");
      grip.innerHTML = ICON.grip;
      grip.setAttribute("aria-hidden", "true");
      li.appendChild(grip);
      var pen = el("button", "pen");
      pen.type = "button";
      pen.setAttribute("data-key", p.key);
      pen.innerHTML = ICON.pen;
      setLabel(pen, t("btn.edit") + " · " + (i + 1));
      li.appendChild(pen);
      grid.appendChild(li);
      if (base[baseKey(p)]) drawThumb(cv);
      else if (io) io.observe(li);
      else wantThumb(p);
    });
    if (focusKey) {
      var f = grid.querySelector('button[data-key="' + focusKey + '"]');
      if (f) f.focus({ preventScroll: true });
    }
  }

  function renderBars() {
    var has = pages.length > 0, n = selKeys().length;
    $("drop").hidden = has;
    $("pages-sec").hidden = !has;
    $("selbar").hidden = !has;
    $("foot").hidden = !has;
    $("clear-btn").hidden = !has;
    $("undo-btn").disabled = !hist.past.length;
    $("redo-btn").disabled = !hist.future.length;
    $("sel-info").textContent = n ? tn("info.sel", pages.length, { s: n }) : tn("info.pages", pages.length);
    var all = n === pages.length && n > 0;
    setLabel($("sel-all"), all ? t("btn.selNone") : t("btn.selAll"));
    $("sel-all").classList.toggle("on", all);
    ["sel-left", "sel-right", "sel-rotl", "sel-rotr", "sel-dup", "sel-extract", "sel-del"].forEach(function (id) {
      $(id).disabled = !n;
    });
    var used = C.usedSources(pages), size = 0, files = 0;
    Object.keys(used).forEach(function (id) { files++; size += sources[id].size; });
    $("foot-info").textContent = tn("foot.files", files, { size: C.sizeLabel(size, LANG) });
    $("opt-btn").classList.toggle("on", docOpts.num.on || docOpts.wm.on);
  }
  function renderAll() { pruneSel(); renderGrid(); renderBars(); }
  function renderSel() {
    [].forEach.call(document.querySelectorAll("#grid .card"), function (li) {
      var k = li.getAttribute("data-key"), on = !!sel[k];
      li.classList.toggle("sel", on);
      li.firstChild.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderBars();
  }

  // An edit of the list: remember the old one for Undo.
  function edit(next) {
    C.record(hist, pages);
    pages = next;
    renderAll();
  }

  function toggle(key, range) {
    if (range && lastClicked && lastClicked !== key) {
      var a = indexOf(lastClicked), b = indexOf(key);
      if (a !== -1 && b !== -1) {
        var lo = Math.min(a, b), hi = Math.max(a, b);
        for (var i = lo; i <= hi; i++) sel[pages[i].key] = true;
        renderSel();
        return;
      }
    }
    if (sel[key]) delete sel[key]; else sel[key] = true;
    lastClicked = key;
    renderSel();
  }
  function indexOf(key) {
    for (var i = 0; i < pages.length; i++) if (pages[i].key === key) return i;
    return -1;
  }

  function selectAll() {
    var all = selKeys().length === pages.length;
    sel = {};
    if (!all) pages.forEach(function (p) { sel[p.key] = true; });
    renderSel();
  }
  function actMove(delta) { var k = selKeys(); if (k.length) edit(C.moveStep(pages, k, delta)); }
  function actRotate(deg) { var k = selKeys(); if (k.length) edit(C.rotate(pages, k, deg)); }
  function actDup() { var k = selKeys(); if (k.length) edit(C.duplicate(pages, k, mkKey)); }
  function actDelete(keys) {
    var k = keys || selKeys();
    if (!k.length) return;
    edit(C.remove(pages, k));
    showToast(tn("toast.deleted", k.length));
  }
  function actUndo() {
    var prev = C.undo(hist, pages);
    if (!prev) return;
    pages = prev; renderAll(); say(t("toast.undo"));
  }
  function actRedo() {
    var next = C.redo(hist, pages);
    if (!next) return;
    pages = next; renderAll(); say(t("toast.redo"));
  }

  // Drag to move: mouse and pen from anywhere on a card, touch from
  // the grip (so the page still scrolls). The selected pages move
  // together when the dragged one is selected, else only that one.
  var drag = null;
  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    var li = e.target.closest && e.target.closest(".card");
    if (!li || e.target.closest(".pen")) return;
    var onGrip = !!e.target.closest(".grip");
    if (e.pointerType === "touch" && !onGrip) return;
    var key = li.getAttribute("data-key");
    drag = { key: key, x: e.clientX, y: e.clientY, id: e.pointerId, on: false, li: li, at: -1, grip: onGrip };
    if (onGrip) { e.preventDefault(); startDrag(); }
  }
  function startDrag() {
    drag.on = true;
    drag.keys = sel[drag.key] ? selKeys() : [drag.key];
    document.body.classList.add("dragging");
    drag.keys.forEach(function (k) {
      var n = document.querySelector('#grid .card[data-key="' + k + '"]');
      if (n) n.classList.add("lifted");
    });
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 8) return;
      startDrag();
    }
    e.preventDefault();
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    var li = hit && hit.closest ? hit.closest("#grid .card") : null;
    clearMarks();
    if (!li) { drag.at = -1; autoScroll(e.clientY); return; }
    var r = li.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
    var i = indexOf(li.getAttribute("data-key"));
    drag.at = i + (after ? 1 : 0);
    li.classList.add(after ? "mark-after" : "mark-before");
    autoScroll(e.clientY);
  }
  function autoScroll(y) {
    var m = $("main"), r = m.getBoundingClientRect();
    if (y < r.top + 40) m.scrollTop -= 14;
    else if (y > r.bottom - 40) m.scrollTop += 14;
  }
  function clearMarks() {
    [].forEach.call(document.querySelectorAll("#grid .mark-before, #grid .mark-after"), function (n) {
      n.classList.remove("mark-before", "mark-after");
    });
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (!d.on) return;
    document.body.classList.remove("dragging");
    clearMarks();
    [].forEach.call(document.querySelectorAll("#grid .lifted"), function (n) { n.classList.remove("lifted"); });
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 0);
    if (d.at < 0) return;
    var next = C.moveTo(pages, d.keys, d.at);
    var same = next.every(function (p, i) { return p.key === pages[i].key; });
    if (same) return;
    edit(next);
    say(t("live.moved", { to: indexOf(d.keys[0]) + 1 }));
  }
  var suppressClick = false;

  // ---------- 6. Building and saving PDFs ----------
  // Page geometry (unturned size, turn, box) from pdf-lib; null when
  // the page can't be read.
  function geomOf(p) {
    try { return OPS.geom(window.PDFLib, sources, p, prefs); } catch (e) { return null; }
  }

  // Text in a PDF needs a font with Greek: Noto Sans through fontkit,
  // both fetched the first time they are needed (precached).
  var fontP = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.src = src;
      sc.onload = res;
      sc.onerror = function () { sc.remove(); rej(codeErr("font")); };
      document.head.appendChild(sc);
    });
  }
  function pdfFont() {
    if (!fontP) {
      var kit = window.fontkit ? Promise.resolve() : loadScript("../vendor/pdf-lib/fontkit.umd.min.js");
      var bytes = fetch("../vendor/noto/NotoSans-Regular.ttf").then(function (r) {
        if (!r.ok) throw codeErr("font");
        return r.arrayBuffer();
      });
      fontP = Promise.all([kit, bytes]).then(function (a) {
        if (!window.fontkit) throw codeErr("font");
        return { fontkit: window.fontkit, bytes: new Uint8Array(a[1]) };
      });
      fontP.then(null, function () { fontP = null; });
    }
    return fontP.then(null, function () { throw codeErr("font"); });
  }
  function needsFont(list) {
    return docOpts.num.on || docOpts.wm.on ||
           list.some(function (p) {
             var r = ocrBy[baseKey(p)];
             return (r && r.words && r.words.length) || (p.ov || []).some(function (o) { return o.t === "text"; });
           });
  }

  function buildPdf(list, title) {
    var f = needsFont(list) ? pdfFont() : Promise.resolve(null);
    return f.then(function (font) {
      return OPS.build(window.PDFLib, sources, list, prefs, { title: title, opts: docOpts, font: font, ocr: ocrRecords() });
    }).then(function (bytes) {
      return new Blob([bytes], { type: "application/pdf" });
    });
  }

  // Make a PDF smaller: every page rendered (PDF.js) at the level's
  // resolution, saved as JPEG, and the JPEGs put into a new PDF.
  // The text read from the pages (wave 4) stays: it is put back on the
  // pictures, so a smaller scan can still be searched.
  function compressPdf(blob, level, title, src) {
    var L = C.COMPRESS[level], recs = ocrRecords(true), font = null;
    var keep = src.some(function (p) { return recs[baseKey(p)]; });
    return Promise.all([pdfjs(), readBytes(blob), keep ? pdfFont() : null]).then(function (a) {
      font = a[2];
      return a[0].getDocument({ data: a[1], isEvalSupported: false, enableXfa: false,
                                disableAutoFetch: true, disableStream: true }).promise;
    }).then(function (doc) {
      var list = [], n = doc.numPages;
      var chain = Promise.resolve();
      for (var i = 1; i <= n; i++) {
        (function (i) {
          chain = chain.then(function () {
            showBusy(t("busy.compress", { i: i, n: n }));
            return doc.getPage(i).then(function (pg) {
              var v1 = pg.getViewport({ scale: 1 });
              var vp = pg.getViewport({ scale: C.renderScale(v1.width, v1.height, L.dpi) });
              var cv = document.createElement("canvas");
              cv.width = Math.max(1, Math.floor(vp.width)); cv.height = Math.max(1, Math.floor(vp.height));
              var ctx = cv.getContext("2d");
              ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
              return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                return new Promise(function (res, rej) {
                  cv.toBlob(function (b) { b ? res(b) : rej(codeErr("build")); }, "image/jpeg", L.q);
                });
              }).then(readBytes).then(function (bytes) {
                var p = src[i - 1], words = p ? OPS.wordsFor(window.PDFLib, sources, p, prefs, recs[baseKey(p)] || null, true) : [];
                list.push({ bytes: bytes, w: v1.width, h: v1.height, words: words });
                cv.width = cv.height = 0;
                try { pg.cleanup(); } catch (e) {}
              });
            });
          });
        })(i);
      }
      return chain.then(function () {
        try { doc.destroy(); } catch (e) {}
        return OPS.fromImages(window.PDFLib, list, { title: title, opts: docOpts, font: font });
      });
    }).then(function (bytes) { return new Blob([bytes], { type: "application/pdf" }); });
  }

  function defaultBase() {
    var used = C.usedSources(pages);
    var first = srcOrder.filter(function (id) { return used[id]; })[0];
    return first ? C.baseName(sources[first].name) : "Document";
  }

  function saveBlob(blob, name) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      return dlg.saveFile({ blob: blob, filename: name, mime: blob.type || "application/pdf",
                            types: [{ description: name, accept: blob.type === "application/zip" ? { "application/zip": [".zip"] } : { "application/pdf": [".pdf"] } }] });
    }
    // Standalone: a plain download.
    var a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
    return Promise.resolve({ ok: true, mode: "download" });
  }

  // Files: a free name in the folder ("Name (2).pdf" when taken).
  function freeDiskPath(fs, dir, name) {
    var m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(name), b = m[1], ext = m[2] || "";
    function tryN(n) {
      var p = dir + "/" + b + (n > 1 ? " (" + n + ")" : "") + ext;
      return fs.stat(p).then(function (st) { return st && n < 999 ? tryN(n + 1) : p; }, function () { return p; });
    }
    return tryN(1);
  }
  function writeToFiles(blob, dir, name) {
    var fs = fsApi();
    if (!fs) return Promise.reject(codeErr("write"));
    return freeDiskPath(fs, dir, name).then(function (p) {
      return fs.writeBlob(p, blob).then(function () { return p; });
    }).then(null, function () { throw codeErr("write"); });
  }
  function shortDir(dir) { return dir.slice(C.ROOT.length + 1).split("/").join(" › "); }

  function doSave(list, name, dest, cmp, read) {
    var sizes = null, stopped = false;
    var first = read ? readPages(list, prefs.ocr, !!C.COMPRESS[cmp]).then(function (r) { stopped = r.stopped; }, function () {
      showToast(t("ocr.errSave"));
    }) : Promise.resolve();
    return first.then(function () {
      if (stopped) return null;              // Stop: nothing is saved
      showBusy(t(needsFont(list) && !fontP ? "busy.font" : "busy.build"));
      return buildPdf(list, C.baseName(name));
    }).then(function (blob) {
      if (!blob || !C.COMPRESS[cmp]) return blob;
      return compressPdf(blob, cmp, C.baseName(name), list).then(function (small) {
        // A PDF of text is often smaller than its pictures: keep it then
        if (small.size >= blob.size) { sizes = "same"; return blob; }
        sizes = { a: C.sizeLabel(blob.size, LANG), b: C.sizeLabel(small.size, LANG) };
        return small;
      });
    }).then(function (blob) {
      if (!blob) { showToast(t("ocr.notSaved")); return; }
      showBusy(t("busy.save"));
      if (dest === "files") {
        return writeToFiles(blob, C.diskDir(), name).then(function (path) {
          indexDoc(path, name, list);
          var dir = shortDir(C.diskDir());
          showToast(sizes && sizes.a ? t("toast.smallerFiles", { dir: dir, a: sizes.a, b: sizes.b })
                    : sizes ? t("toast.notSmaller") : t("toast.savedFiles", { dir: dir }));
        });
      }
      hideBusy();
      return saveBlob(blob, name).then(function (res) {
        if (res && res.ok) showToast(sizes && sizes.a ? t("toast.smaller", sizes) : sizes ? t("toast.notSmaller") : t("toast.saved"));
      });
    }).then(hideBusy, function (e) {
      hideBusy();
      try { console.error("[orOS] scanpdf save:", e); } catch (x) {}
      showToast(t(e && e.code === "write" ? "err.write" : e && e.code === "font" ? "err.font" : "err.build"));
    });
  }

  function doSplit(ranges, dest) {
    var b = defaultBase(), made = [], taken = {};
    var chain = ranges.reduce(function (c, r, i) {
      return c.then(function () {
        showBusy(t("busy.split", { i: i + 1, n: ranges.length }));
        return buildPdf(pages.slice(r[0] - 1, r[1]), b).then(function (blob) {
          made.push({ name: C.uniqueName(C.outName(b, C.rangeLabel(r)), taken), blob: blob });
        });
      });
    }, Promise.resolve());
    return chain.then(function () {
      showBusy(t("busy.save"));
      if (dest === "files") {
        var dir = C.diskDir() + "/" + (C.cleanName(b) || "Document");
        return made.reduce(function (c, f) {
          return c.then(function () { return writeToFiles(f.blob, dir, f.name); });
        }, Promise.resolve()).then(function () {
          showToast(t("toast.savedFiles", { dir: shortDir(dir) }));
        });
      }
      var B = window.OrosBundle;
      if (!B || typeof B._zip !== "function") throw codeErr("zip");
      return Promise.all(made.map(function (f) { return readBytes(f.blob); })).then(function (bytes) {
        var entries = made.map(function (f, i) { return { name: f.name, data: bytes[i] }; });
        return B._zip(entries, new Date());
      }).then(function (zipBytes) {
        hideBusy();
        return saveBlob(new Blob([zipBytes], { type: "application/zip" }), C.zipName(b)).then(function (res) {
          if (res && res.ok) showToast(t("toast.split", { n: made.length }));
        });
      });
    }).then(hideBusy, function (e) {
      hideBusy();
      try { console.error("[orOS] scanpdf split:", e); } catch (x) {}
      showToast(t(e && e.code === "write" ? "err.write" : e && e.code === "zip" ? "err.zip" : e && e.code === "font" ? "err.font" : "err.build"));
    });
  }

  // ---------- 7. Dialogs: save, split, picture pages, clear ----------
  var modalOk = null, modalReturn = null;
  function openModal(title, body, okText, onOk, danger) {
    modalReturn = document.activeElement;
    $("modal-title").textContent = title;
    var mb = $("modal-body");
    mb.textContent = "";
    mb.appendChild(body);
    var ok = $("modal-ok");
    $("modal-cancel").textContent = t("btn.cancel");
    ok.textContent = okText;
    ok.classList.toggle("danger", !!danger);
    ok.disabled = false;
    modalOk = onOk;
    $("modal-veil").hidden = false;
    var first = mb.querySelector("input:not([type=radio]), input[type=radio]:checked, select") || ok;
    setTimeout(function () { first.focus(); if (first.select && first.type === "text") first.select(); }, 0);
  }
  function closeModal() {
    $("modal-veil").hidden = true;
    modalOk = null;
    if (modalReturn && modalReturn.focus) { try { modalReturn.focus({ preventScroll: true }); } catch (e) {} }
  }
  function field(labelText, control) {
    var lab = el("label", "field");
    lab.appendChild(el("span", "field-l", labelText));
    lab.appendChild(control);
    return lab;
  }
  function radio(name, value, text, checked, disabled) {
    var lab = el("label", "opt");
    var inp = document.createElement("input");
    inp.type = "radio"; inp.name = name; inp.value = value; inp.checked = !!checked; inp.disabled = !!disabled;
    lab.appendChild(inp);
    lab.appendChild(el("span", "opt-t", text));
    return lab;
  }
  function radioVal(root, name) {
    var c = root.querySelector('input[name="' + name + '"]:checked');
    return c ? c.value : "";
  }
  function select(opts, value) {
    var s = document.createElement("select");
    opts.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1]; op.selected = o[0] === value;
      s.appendChild(op);
    });
    return s;
  }

  function saveDialog(extract) {
    var list = extract ? pages.filter(function (p) { return sel[p.key]; }) : pages.slice();
    if (!list.length) return;
    var body = el("div", "form");
    var name = document.createElement("input");
    name.type = "text"; name.maxLength = 120; name.spellcheck = false;
    name.value = defaultBase() + (extract ? " (" + list.length + ")" : "");
    body.appendChild(field(t("save.name"), name));
    body.appendChild(el("p", "hint small", tn("save.pages", list.length)));
    body.appendChild(whereChoice("dest", prefs.dest, "save.device", "save.files"));
    var cmp = select([["off", t("cmp.off")], ["light", t("cmp.light")], ["medium", t("cmp.medium")], ["strong", t("cmp.strong")]], prefs.cmp);
    body.appendChild(field(t("cmp.label"), cmp));
    var cHint = el("p", "hint small", t("cmp.hint"));
    body.appendChild(cHint);
    function syncCmp() { cHint.hidden = cmp.value === "off"; }
    cmp.addEventListener("change", syncCmp);
    syncCmp();
    // Make it searchable: read the text of the pages first (wave 4)
    var read = check(t("save.read"), wantsRead(list)), lang = langChoice(prefs.ocr);
    var rFields = el("div", "opt-fields");
    rFields.appendChild(field(t("ocr.lang"), lang));
    rFields.appendChild(el("p", "hint small", t("save.readHint")));
    body.appendChild(read.row);
    body.appendChild(rFields);
    function syncRead() { rFields.hidden = !read.box.checked; }
    read.box.addEventListener("change", syncRead);
    syncRead();
    openModal(t(extract ? "save.extract" : "save.title"), body, t("btn.saveIt"), function () {
      var dest = radioVal(body, "dest") || "device";
      var P = C.readPrefs({ cmp: cmp.value, ocr: lang.value });
      prefs.dest = dest; prefs.cmp = P.cmp; prefs.ocr = P.ocr;
      // remember a choice that differs from what "auto" would pick
      if (read.box.checked !== wantsRead(list) || prefs.read !== "auto") prefs.read = read.box.checked ? "on" : "off";
      savePrefs();
      closeModal();
      doSave(list, C.withPdf(name.value || defaultBase()), dest, prefs.cmp, read.box.checked);
    });
  }
  function whereChoice(nm, value, devKey, filesKey) {
    var box = el("fieldset", "seg");
    box.appendChild(el("legend", "field-l", t(nm === "dest" ? "save.where" : "split.out")));
    var canFiles = !!fsApi();
    box.appendChild(radio(nm, "device", t(devKey), value !== "files" || !canFiles));
    box.appendChild(radio(nm, "files", t(filesKey, { dir: shortDir(C.diskDir()) }), value === "files" && canFiles, !canFiles));
    if (!canFiles) box.appendChild(el("p", "hint small", t("save.filesOff")));
    return box;
  }

  function splitDialog() {
    if (!pages.length) return;
    var body = el("div", "form");
    var box = el("fieldset", "seg");
    box.appendChild(radio("mode", "each", t("split.each"), true));
    var everyRow = radio("mode", "every", t("split.every"), false);
    var n = document.createElement("input");
    n.type = "number"; n.min = "1"; n.max = String(pages.length); n.value = "2"; n.className = "num-in";
    n.setAttribute("aria-label", t("split.everyN"));
    everyRow.appendChild(n);
    everyRow.appendChild(el("span", "opt-t", t("split.everyN")));
    box.appendChild(everyRow);
    var rRow = radio("mode", "ranges", t("split.ranges"), false);
    box.appendChild(rRow);
    var rng = document.createElement("input");
    rng.type = "text"; rng.placeholder = t("split.rangesHint"); rng.className = "rng-in"; rng.spellcheck = false;
    rng.setAttribute("aria-label", t("split.ranges"));
    box.appendChild(rng);
    body.appendChild(box);
    var preview = el("p", "hint small preview");
    preview.setAttribute("aria-live", "polite");
    body.appendChild(preview);
    body.appendChild(whereChoice("out", prefs.dest, "split.zip", "split.folder"));
    var plan = null;
    function update() {
      var mode = radioVal(body, "mode");
      plan = C.splitPlan(mode, pages.length, mode === "every" ? n.value : rng.value);
      preview.classList.toggle("bad", !plan.ok);
      if (plan.ok) {
        var labels = plan.ranges.map(C.rangeLabel), shown = labels.slice(0, 8).join(", ") + (labels.length > 8 ? ", …" : "");
        preview.textContent = tn("split.preview", plan.ranges.length, { list: shown });
      } else {
        preview.textContent = t("split.err." + plan.err, { at: plan.at || "", n: pages.length });
      }
      $("modal-ok").disabled = !plan.ok;
    }
    n.addEventListener("input", function () { body.querySelector('input[value="every"]').checked = true; update(); });
    rng.addEventListener("input", function () { body.querySelector('input[value="ranges"]').checked = true; update(); });
    [].forEach.call(body.querySelectorAll('input[name="mode"]'), function (r) { r.addEventListener("change", update); });
    openModal(t("split.title"), body, t("btn.splitIt"), function () {
      if (!plan || !plan.ok) return;
      var dest = radioVal(body, "out") || "device";
      prefs.dest = dest; savePrefs();
      closeModal();
      doSplit(plan.ranges, dest);
    });
    update();
  }

  function check(text, on) {
    var lab = el("label", "opt");
    var inp = document.createElement("input");
    inp.type = "checkbox"; inp.checked = !!on;
    lab.appendChild(inp);
    lab.appendChild(el("span", "opt-t", text));
    return { row: lab, box: inp };
  }
  function textIn(value, max) {
    var inp = document.createElement("input");
    inp.type = "text"; inp.maxLength = max; inp.value = value || ""; inp.spellcheck = false;
    return inp;
  }

  function optionsDialog() {
    var body = el("div", "form");
    body.appendChild(el("p", "hint small", t("opt.hint")));
    // Picture pages: only when the list has pictures
    var hasPic = pages.some(function (p) { return sources[p.src].kind === "image"; });
    var size = select([["a4", t("pic.a4")], ["letter", t("pic.letter")], ["fit", t("pic.fit")]], prefs.size);
    var orient = select([["auto", t("pic.auto")], ["portrait", t("pic.portrait")], ["landscape", t("pic.landscape")]], prefs.orient);
    var margin = select([["none", t("pic.none")], ["small", t("pic.small")], ["normal", t("pic.normal")]], prefs.margin);
    var oField = field(t("pic.orient"), orient);
    if (hasPic) {
      var picSec = el("section", "opt-sec");
      picSec.appendChild(el("h3", "", t("pic.title")));
      picSec.appendChild(el("p", "hint small", t("pic.hint")));
      picSec.appendChild(field(t("pic.size"), size));
      picSec.appendChild(oField);
      picSec.appendChild(field(t("pic.margin"), margin));
      body.appendChild(picSec);
    }
    function syncPic() { oField.hidden = size.value === "fit"; }
    size.addEventListener("change", syncPic);
    syncPic();

    var N = docOpts.num, numSec = el("section", "opt-sec");
    numSec.appendChild(el("h3", "", t("num.title")));
    var numOn = check(t("num.on"), N.on);
    numSec.appendChild(numOn.row);
    var pos = select(C.NUM_POS.map(function (k) { return [k, t("num." + k)]; }), N.pos);
    var fmt = select([["n", t("num.n")], ["nt", t("num.nt")]], N.fmt);
    var startIn = document.createElement("input");
    startIn.type = "number"; startIn.min = "0"; startIn.max = "99999"; startIn.value = String(N.start);
    var numFields = el("div", "opt-fields");
    numFields.appendChild(field(t("num.pos"), pos));
    numFields.appendChild(field(t("num.fmt"), fmt));
    numFields.appendChild(field(t("num.start"), startIn));
    numSec.appendChild(numFields);
    body.appendChild(numSec);

    var W = docOpts.wm, wmSec = el("section", "opt-sec");
    wmSec.appendChild(el("h3", "", t("wm.title")));
    var wmOn = check(t("wm.on"), W.on);
    wmSec.appendChild(wmOn.row);
    var wmText = textIn(W.text || t("wm.def"), 60);
    var wmOp = select([["light", t("wm.light")], ["medium", t("wm.medium")], ["strong", t("wm.strong")]], W.op);
    var wmFields = el("div", "opt-fields");
    wmFields.appendChild(field(t("wm.text"), wmText));
    wmFields.appendChild(field(t("wm.op"), wmOp));
    wmSec.appendChild(wmFields);
    body.appendChild(wmSec);

    var docSec = el("section", "opt-sec");
    docSec.appendChild(el("h3", "", t("doc.title")));
    docSec.appendChild(el("p", "hint small", t("doc.hint")));
    var title = textIn(docOpts.title, 200), author = textIn(docOpts.author, 200);
    docSec.appendChild(field(t("doc.name"), title));
    docSec.appendChild(field(t("doc.author"), author));
    body.appendChild(docSec);

    // Universal search: the device-local list of PDFs saved into Files
    var idxSec = el("section", "opt-sec"), idxN = indexCount();
    idxSec.appendChild(el("h3", "", t("idx.title")));
    var idxHint = el("p", "hint small", tn("idx.hint", idxN));
    idxSec.appendChild(idxHint);
    var forget = el("button", "btn", t("idx.forget"));
    forget.type = "button";
    forget.disabled = !idxN;
    forget.addEventListener("click", function () {
      try { localStorage.removeItem(O.INDEX_KEY); } catch (e) {}
      idxHint.textContent = tn("idx.hint", 0);
      forget.disabled = true;
      say(t("idx.forgot"));
    });
    idxSec.appendChild(forget);
    body.appendChild(idxSec);

    function syncOn() {
      numFields.hidden = !numOn.box.checked;
      wmFields.hidden = !wmOn.box.checked;
    }
    numOn.box.addEventListener("change", syncOn);
    wmOn.box.addEventListener("change", syncOn);
    syncOn();

    openModal(t("opt.title"), body, t("btn.done"), function () {
      prefs = C.readPrefs(Object.assign({}, prefs, { size: size.value, orient: orient.value, margin: margin.value }));
      savePrefs();
      docOpts = C.readDocOpts({
        num: { on: numOn.box.checked, pos: pos.value, fmt: fmt.value, start: startIn.value },
        wm: { on: wmOn.box.checked, text: wmText.value, op: wmOp.value },
        title: title.value.trim(), author: author.value.trim()
      });
      closeModal();
      renderAll();
    });
  }

  function clearDialog() {
    var body = el("p", "", t("clear.body"));
    openModal(t("clear.title"), body, t("btn.clearIt"), function () {
      closeModal();
      Object.keys(pjsDocs).forEach(function (id) {
        pjsDocs[id].then(function (d) { try { d.destroy(); } catch (e) {} }, function () {});
      });
      sources = {}; srcOrder = []; pages = []; sel = {}; base = {}; pjsDocs = {}; queue = []; ocrBy = {};
      hist = C.history();
      renderAll();
      $("add-files").focus();
    }, true);
  }

  // ---------- 7b. Page editor: signatures, text, date ----------
  // Works on a copy of the additions of every page ({ key: [ov] });
  // Done puts the changed pages on the list as ONE undoable edit.
  var ed = null;          // { keys, at, ov: {}, changed: {}, sel, g, w, h, job }
  var nextOv = 1;
  function ovId() { return "o" + Date.now().toString(36) + (nextOv++); }

  function openEditor(key) {
    if (!pages.length || !window.PDFLib) return;
    var at = Math.max(0, indexOf(key));
    ed = { keys: pages.map(function (p) { return p.key; }), at: at, ov: {}, changed: {}, sel: null, job: 0, back: document.activeElement };
    pages.forEach(function (p) { ed.ov[p.key] = C.cloneOv(p.ov); });
    $("editor").hidden = false;
    document.body.classList.add("editing");
    showEdPage();
    setTimeout(function () { $("ed-sig").focus(); }, 0);
  }
  function edPage() { return pages[indexOf(ed.keys[ed.at])]; }
  function edList() { return ed.ov[ed.keys[ed.at]]; }
  function closeEditor(keep) {
    if (!ed) return;
    var e = ed, keys = Object.keys(e.changed);
    ed = null;
    $("editor").hidden = true;
    document.body.classList.remove("editing");
    $("ed-layer").textContent = "";
    if (keep && keys.length) {
      var map = {};
      keys.forEach(function (k) { map[k] = e.ov[k]; });
      edit(C.setOverlays(pages, map));
    }
    if (e.back && e.back.isConnected && e.back.focus) { try { e.back.focus({ preventScroll: true }); } catch (x) {} }
    else refocus(e.keys[e.at]);
  }
  function cancelEditor() {
    if (!ed) return;
    if (!Object.keys(ed.changed).length) { closeEditor(false); return; }
    openModal(t("ed.leaveTitle"), el("p", "", t("ed.leaveBody")), t("ed.leave"), function () {
      closeModal();
      closeEditor(false);
    }, true);
  }
  function edGo(d) {
    var i = ed.at + d;
    if (i < 0 || i >= ed.keys.length) return;
    ed.at = i; ed.sel = null;
    showEdPage();
  }

  // Lay the page out as large as the stage allows and render it.
  function showEdPage() {
    var p = edPage(), g = p && geomOf(p);
    if (!g) return;
    ed.g = g;
    $("ed-title").textContent = t("ed.title", { n: ed.at + 1, total: ed.keys.length });
    $("ed-prev").disabled = ed.at === 0;
    $("ed-next").disabled = ed.at === ed.keys.length - 1;
    var st = $("ed-stage"), d = C.dispSize(g.W, g.H, g.R);
    var aw = Math.max(80, st.clientWidth - 24), ah = Math.max(80, st.clientHeight - 24);
    var k = Math.min(aw / d[0], ah / d[1]);
    ed.w = Math.floor(d[0] * k); ed.h = Math.floor(d[1] * k);
    var pg = $("ed-page");
    pg.style.width = ed.w + "px"; pg.style.height = ed.h + "px";
    var cv = $("ed-canvas"), job = ++ed.job;
    pg.classList.add("loading");
    renderDisplay(p, ed.w, ed.h).then(function (img) {
      if (!ed || job !== ed.job) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(ed.w * dpr); cv.height = Math.round(ed.h * dpr);
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      pg.classList.remove("loading");
    }, function () { if (ed && job === ed.job) pg.classList.remove("loading"); });
    drawLayer();
  }

  // A picture of the page as it shows (turned), about w × h pixels.
  function renderDisplay(p, w, h) {
    var src = sources[p.src], dpr = Math.min(2, window.devicePixelRatio || 1);
    if (src.kind === "image") {
      return createImageBitmap(new Blob([src.img.bytes])).then(function (bmp) {
        var side = Math.max(w, h) * dpr, pp = picturePage(src, bmp, side);
        try { bmp.close(); } catch (e) {}
        var cv = document.createElement("canvas"), turned = p.rot % 180 !== 0;
        cv.width = turned ? pp.height : pp.width; cv.height = turned ? pp.width : pp.height;
        var ctx = cv.getContext("2d");
        ctx.translate(cv.width / 2, cv.height / 2);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.drawImage(pp, -pp.width / 2, -pp.height / 2);
        return cv;
      });
    }
    return pjsDoc(src).then(function (doc) { return doc.getPage(p.idx + 1); }).then(function (pg) {
      var rot = (pg.rotate + p.rot) % 360, v1 = pg.getViewport({ scale: 1, rotation: rot });
      var vp = pg.getViewport({ scale: (w * dpr) / v1.width, rotation: rot });
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.floor(vp.width)); cv.height = Math.max(1, Math.floor(vp.height));
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return cv; });
    });
  }

  // The additions as elements over the page.
  function drawLayer() {
    var layer = $("ed-layer");
    layer.textContent = "";
    edList().forEach(function (o) { layer.appendChild(ovEl(o)); });
    syncProps();
  }
  function ovEl(o) {
    var n = el("div", "ov ov-" + o.t + (ed.sel === o.id ? " on" : ""));
    n.setAttribute("data-id", o.id);
    n.tabIndex = 0;
    n.setAttribute("role", "button");
    if (o.t === "img") {
      var im = document.createElement("img");
      im.src = o.src; im.alt = ""; im.draggable = false;
      n.appendChild(im);
      n.setAttribute("aria-label", t("ed.itemImg"));
    } else {
      n.appendChild(el("span", "ov-txt", o.text));
      n.setAttribute("aria-label", t("ed.itemText", { text: o.text }));
    }
    var hd = el("span", "ov-h");
    hd.setAttribute("aria-hidden", "true");
    hd.title = t("ed.resize");
    n.appendChild(hd);
    placeOv(n, o);
    return n;
  }
  function placeOv(n, o) {
    var g = ed.g, v = C.ovDisp(o, g.W, g.H, g.R), d = C.dispSize(g.W, g.H, g.R);
    var k = ed.w / d[0], S = Math.min(g.W, g.H);
    n.style.left = (v.fx * 100) + "%";
    n.style.top = (v.fy * 100) + "%";
    n.style.transform = "translate(-50%, -50%) rotate(" + v.turn + "deg)";
    if (o.t === "img") {
      n.style.width = (o.w * S * k) + "px";
      n.style.height = (o.h * S * k) + "px";
    } else {
      n.style.fontSize = (o.fs * S * k) + "px";
      n.style.color = CSS_COLOR[o.color] || CSS_COLOR.black;
    }
  }
  function ovById(id) { return edList().filter(function (o) { return o.id === id; })[0] || null; }
  function ovNode(id) { return $("ed-layer").querySelector('[data-id="' + id + '"]'); }
  function touched() { ed.changed[ed.keys[ed.at]] = true; }

  function selectOv(id) {
    ed.sel = id;
    [].forEach.call($("ed-layer").children, function (n) { n.classList.toggle("on", n.getAttribute("data-id") === id); });
    syncProps();
  }
  // The bar under the tools: the text and colour of a text addition,
  // Put on every page, Remove.
  function syncProps() {
    var o = ed && ed.sel ? ovById(ed.sel) : null;
    $("ed-props").hidden = !o;
    if (!o) return;
    var isText = o.t === "text";
    $("ed-input").hidden = !isText;
    $("ed-colors").hidden = !isText;
    if (isText) {
      if (document.activeElement !== $("ed-input")) $("ed-input").value = o.text;
      [].forEach.call($("ed-colors").children, function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-color") === o.color ? "true" : "false");
      });
    }
  }

  // New additions go where they are most often wanted, upright on the
  // page as it shows now.
  function addOv(o, fx, fy) {
    var g = ed.g, list0 = edList();
    // not right on top of one already there
    for (var tries = 0; tries < 8; tries++) {
      var busy = list0.some(function (q) {
        var v = C.ovDisp(q, g.W, g.H, g.R);
        return Math.abs(v.fx - fx) < 0.03 && Math.abs(v.fy - fy) < 0.03;
      });
      if (!busy) break;
      fy = fy > 0.5 ? fy - 0.07 : fy + 0.07;
    }
    var at = C.ovAt(fx, fy, g.W, g.H, g.R);
    o.id = ovId(); o.cx = at.cx; o.cy = at.cy; o.A = g.R;
    var list = edList();
    if (list.length >= C.MAX_OV) return;
    list.push(o);
    touched();
    $("ed-layer").appendChild(ovEl(o));
    selectOv(o.id);
    return o;
  }
  function addSig() {
    pickSig(function (sig) {
      if (!ed) return;
      var g = ed.g, d = C.dispSize(g.W, g.H, g.R), S = Math.min(g.W, g.H);
      var w = 0.3, h = w * sig.h / sig.w;
      if (h > 0.15) { w *= 0.15 / h; h = 0.15; }
      // keep it inside the page width
      if (w * S > d[0] * 0.9) { var f = d[0] * 0.9 / (w * S); w *= f; h *= f; }
      addOv({ t: "img", src: sig.src, w: w, h: Math.max(0.005, h) }, 0.68, 0.84);
      focusOv(ed.sel);
    });
  }
  function addText(text, fs, fx, fy, focusInput) {
    var o = addOv({ t: "text", text: text, fs: fs, color: "black" }, fx, fy);
    if (o && focusInput) { var i = $("ed-input"); i.focus(); i.select(); }
    else if (o) focusOv(o.id);
  }
  function today() {
    try { return new Date().toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB"); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function focusOv(id) { var n = id && ovNode(id); if (n) n.focus({ preventScroll: true }); }
  function removeOv(id) {
    var list = edList(), i = list.map(function (o) { return o.id; }).indexOf(id);
    if (i === -1) return;
    list.splice(i, 1);
    touched();
    var n = ovNode(id);
    if (n) n.remove();
    ed.sel = null;
    syncProps();
    $("ed-sig").focus();
  }
  // The same addition, at the same place of the page as it shows, on
  // every other page of the list (each page's own turn and size).
  function ovToAll(id) {
    var o = ovById(id), g = ed.g;
    if (!o) return;
    var v = C.ovDisp(o, g.W, g.H, g.R), n = 0;
    ed.keys.forEach(function (k, i) {
      if (i === ed.at) return;
      var q = pages[indexOf(k)], gq = q && geomOf(q);
      if (!gq || ed.ov[k].length >= C.MAX_OV) return;
      var at = C.ovAt(v.fx, v.fy, gq.W, gq.H, gq.R), c = Object.assign({}, o);
      c.id = ovId(); c.cx = at.cx; c.cy = at.cy; c.A = C.normRot(gq.R - v.turn);
      ed.ov[k].push(c);
      ed.changed[k] = true;
      n++;
    });
    showToast(tn("toast.allPages", n));
  }

  // Drag to move, drag the corner to resize (both sides kept in step).
  var ovDrag = null;
  function onOvDown(e) {
    var n = e.target.closest && e.target.closest(".ov");
    if (!n) { if (e.target === $("ed-layer")) selectOv(null); return; }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    var id = n.getAttribute("data-id"), o = ovById(id);
    if (!o) return;
    selectOv(id);
    n.focus({ preventScroll: true });
    var r = $("ed-page").getBoundingClientRect(), g = ed.g, v = C.ovDisp(o, g.W, g.H, g.R);
    var cx = r.left + v.fx * r.width, cy = r.top + v.fy * r.height;
    ovDrag = { id: id, pid: e.pointerId, x: e.clientX, y: e.clientY, fx: v.fx, fy: v.fy, r: r,
               resize: !!e.target.closest(".ov-h"), cx: cx, cy: cy,
               d0: Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy)), w: o.w, h: o.h, fs: o.fs };
    try { n.setPointerCapture(e.pointerId); } catch (x) {}
  }
  function onOvMove(e) {
    if (!ovDrag || e.pointerId !== ovDrag.pid || !ed) return;
    e.preventDefault();
    var o = ovById(ovDrag.id), n = ovNode(ovDrag.id), g = ed.g;
    if (!o || !n) return;
    if (ovDrag.resize) {
      var f = Math.max(0.1, Math.min(10, Math.hypot(e.clientX - ovDrag.cx, e.clientY - ovDrag.cy) / ovDrag.d0));
      if (o.t === "img") {
        var c = C.cleanOv({ t: "img", src: o.src, w: ovDrag.w * f, h: ovDrag.h * f });
        if (c && Math.abs(c.w / c.h - ovDrag.w / ovDrag.h) < 0.01) { o.w = c.w; o.h = c.h; }
      } else {
        o.fs = C.cleanOv({ t: "text", text: "x", fs: ovDrag.fs * f }).fs;
      }
    } else {
      var at = C.ovAt(ovDrag.fx + (e.clientX - ovDrag.x) / ovDrag.r.width,
                      ovDrag.fy + (e.clientY - ovDrag.y) / ovDrag.r.height, g.W, g.H, g.R);
      o.cx = at.cx; o.cy = at.cy;
    }
    touched();
    placeOv(n, o);
  }
  function onOvUp(e) {
    if (ovDrag && e.pointerId === ovDrag.pid) ovDrag = null;
  }
  // Arrows move the chosen addition (Shift: further); + and - resize.
  function edKey(e) {
    if (!$("modal-veil").hidden) return false;
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === "Escape") {
      e.preventDefault();
      if (ed.sel && !typing) { var id = ed.sel; selectOv(null); focusOv(id); } else cancelEditor();
      return true;
    }
    if (e.key === "Tab") { trapIn($("editor"), e); return true; }
    if (typing) return true;
    var o = ed.sel ? ovById(ed.sel) : null, g = ed.g;
    if (e.key === "PageUp") { e.preventDefault(); edGo(-1); return true; }
    if (e.key === "PageDown") { e.preventDefault(); edGo(1); return true; }
    if (!o) return true;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeOv(o.id); return true; }
    var step = e.shiftKey ? 0.05 : 0.005, dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step; else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step; else if (e.key === "ArrowDown") dy = step;
    var grow = e.key === "+" || e.key === "=" ? 1.1 : e.key === "-" ? 1 / 1.1 : 0;
    if (!dx && !dy && !grow) return true;
    e.preventDefault();
    if (grow) {
      if (o.t === "img") {
        var c = C.cleanOv({ t: "img", src: o.src, w: o.w * grow, h: o.h * grow });
        if (c && Math.abs(c.w / c.h - o.w / o.h) < 0.01) { o.w = c.w; o.h = c.h; }
      } else o.fs = C.cleanOv({ t: "text", text: "x", fs: o.fs * grow }).fs;
    } else {
      var v = C.ovDisp(o, g.W, g.H, g.R), at = C.ovAt(v.fx + dx, v.fy + dy, g.W, g.H, g.R);
      o.cx = at.cx; o.cy = at.cy;
    }
    touched();
    placeOv(ovNode(o.id), o);
    return true;
  }

  // ---------- 7c. Signatures: the library and making one ----------
  function loadSigs() {
    try { return C.readSigs(JSON.parse(localStorage.getItem(C.SIGS_KEY) || "[]")); } catch (e) { return []; }
  }
  function storeSigs(list) {
    try { localStorage.setItem(C.SIGS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  // The saved signatures to choose from; OK makes a new one.
  function pickSig(onPick) {
    var sigs = loadSigs();
    if (!sigs.length) { makeSig(onPick); return; }
    var body = el("div", "form");
    body.appendChild(el("p", "hint small", t("sig.pick")));
    var grid = el("div", "sig-grid");
    sigs.forEach(function (sg, i) {
      var cell = el("div", "sig-cell");
      var b = el("button", "sig-pick");
      b.type = "button";
      setLabel(b, t("sig.saved", { n: i + 1 }));
      var im = document.createElement("img");
      im.src = sg.src; im.alt = "";
      b.appendChild(im);
      b.addEventListener("click", function () { closeModal(); onPick(sg); });
      var del = el("button", "icon-btn sig-del");
      del.type = "button";
      del.innerHTML = ICON.del;
      setLabel(del, t("sig.delete"));
      del.addEventListener("click", function () {
        storeSigs(C.removeSig(loadSigs(), sg.id));
        cell.remove();
        if (!grid.children.length) { closeModal(); makeSig(onPick); }
        else grid.querySelector(".sig-pick").focus();
      });
      cell.appendChild(b);
      cell.appendChild(del);
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    body.appendChild(el("p", "hint small", t("sig.local")));
    openModal(t("sig.title"), body, t("sig.new"), function () { closeModal(); makeSig(onPick); });
  }

  // Make one: draw it, type it (Noto Serif Italic) or take a photo of
  // it on paper (the paper turns see-through). The result is cropped
  // to the ink and kept as a PNG.
  var PAD_W = 900, PAD_H = 300;
  var INK = { black: [18, 18, 23], blue: [26, 59, 153] };
  function makeSig(onPick) {
    var body = el("div", "form sig-make");
    var how = el("fieldset", "seg seg-row");
    how.appendChild(el("legend", "field-l", t("sig.how")));
    ["draw", "type", "photo"].forEach(function (m, i) { how.appendChild(radio("sig-how", m, t("sig." + m), i === 0)); });
    body.appendChild(how);
    var ink = el("fieldset", "seg seg-row");
    ink.appendChild(el("legend", "field-l", t("sig.ink")));
    ink.appendChild(radio("sig-ink", "black", t("color.black"), true));
    ink.appendChild(radio("sig-ink", "blue", t("color.blue"), false));
    body.appendChild(ink);

    var pad = document.createElement("canvas");
    pad.width = PAD_W; pad.height = PAD_H; pad.className = "sig-pad";
    pad.setAttribute("role", "img");
    pad.setAttribute("aria-label", t("sig.pad"));
    var hint = el("p", "hint small", t("sig.drawHint"));
    var again = el("button", "btn small", t("sig.clearPad"));
    again.type = "button";
    var name = textIn("", 60);
    var nameField = field(t("sig.name"), name);
    var photoBtn = el("button", "btn small", t("sig.photoBtn"));
    photoBtn.type = "button";
    var padRow = el("div", "sig-row");
    padRow.appendChild(again);
    padRow.appendChild(photoBtn);
    body.appendChild(nameField);
    body.appendChild(pad);
    body.appendChild(hint);
    body.appendChild(padRow);
    var keep = check(t("sig.keep"), true);
    body.appendChild(keep.row);
    body.appendChild(el("p", "hint small", t("sig.local")));

    var ctx = pad.getContext("2d");
    var drawn = false, photo = null, mode = "draw";
    function inkRgb() { return INK[radioVal(body, "sig-ink")] || INK.black; }
    function inkCss() { var c = inkRgb(); return "rgb(" + c.join(",") + ")"; }
    function clearPad() { ctx.clearRect(0, 0, PAD_W, PAD_H); drawn = false; }
    function typed() {
      clearPad();
      var txt = name.value.trim();
      if (!txt) return;
      var size = 150;
      ctx.font = "italic " + size + 'px "ScanPdfSig", "Noto Serif", serif';
      var w = ctx.measureText(txt).width;
      if (w > PAD_W - 60) { size = Math.max(20, size * (PAD_W - 60) / w); ctx.font = "italic " + size + 'px "ScanPdfSig", "Noto Serif", serif'; }
      ctx.fillStyle = inkCss();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(txt, PAD_W / 2, PAD_H / 2);
      drawn = true;
    }
    function showPhoto() {
      clearPad();
      if (!photo) return;
      var s = Math.min(PAD_W / photo.width, PAD_H / photo.height);
      var w = photo.width * s, h = photo.height * s;
      // the ink in the chosen colour
      var c2 = document.createElement("canvas");
      c2.width = photo.width; c2.height = photo.height;
      var x2 = c2.getContext("2d");
      x2.drawImage(photo, 0, 0);
      x2.globalCompositeOperation = "source-in";
      x2.fillStyle = inkCss();
      x2.fillRect(0, 0, c2.width, c2.height);
      ctx.drawImage(c2, (PAD_W - w) / 2, (PAD_H - h) / 2, w, h);
      drawn = true;
    }
    function setMode() {
      mode = radioVal(body, "sig-how") || "draw";
      nameField.hidden = mode !== "type";
      again.hidden = mode !== "draw";
      photoBtn.hidden = mode !== "photo";
      hint.textContent = mode === "photo" ? t("sig.photoHint") : mode === "draw" ? t("sig.drawHint") : "";
      hint.hidden = mode === "type";
      pad.classList.toggle("drawable", mode === "draw");
      if (mode === "type") {
        var go = function () { typed(); };
        try { document.fonts.load('italic 150px "ScanPdfSig"').then(go, go); } catch (e) { go(); }
        setTimeout(function () { name.focus(); }, 0);
      } else if (mode === "photo") showPhoto();
      else clearPad();
    }
    [].forEach.call(body.querySelectorAll('input[name="sig-how"]'), function (r) { r.addEventListener("change", setMode); });
    [].forEach.call(body.querySelectorAll('input[name="sig-ink"]'), function (r) {
      r.addEventListener("change", function () {
        if (mode === "type") typed();
        else if (mode === "photo") showPhoto();
        else recolor();
      });
    });
    function recolor() {
      if (!drawn) return;
      ctx.save();
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = inkCss();
      ctx.fillRect(0, 0, PAD_W, PAD_H);
      ctx.restore();
    }
    name.addEventListener("input", typed);
    again.addEventListener("click", clearPad);
    photoBtn.addEventListener("click", function () {
      pickImage(function (file) {
        sigFromPhoto(file).then(function (cv) {
          if (!cv) { showToast(t("sig.photoBad")); return; }
          photo = cv;
          showPhoto();
        }, function () { showToast(t("sig.photoBad")); });
      });
    });

    // Drawing: smooth strokes, a little thinner when the pen moves fast.
    var last = null, pid = null;
    function padPt(e) {
      var r = pad.getBoundingClientRect();
      return { x: (e.clientX - r.left) * PAD_W / r.width, y: (e.clientY - r.top) * PAD_H / r.height, t: e.timeStamp };
    }
    pad.addEventListener("pointerdown", function (e) {
      if (mode !== "draw") return;
      e.preventDefault();
      pid = e.pointerId;
      try { pad.setPointerCapture(pid); } catch (x) {}
      last = padPt(e);
      ctx.fillStyle = inkCss();
      ctx.beginPath(); ctx.arc(last.x, last.y, 4, 0, Math.PI * 2); ctx.fill();
      drawn = true;
    });
    pad.addEventListener("pointermove", function (e) {
      if (mode !== "draw" || e.pointerId !== pid || !last) return;
      e.preventDefault();
      var pt = padPt(e), dist = Math.hypot(pt.x - last.x, pt.y - last.y);
      if (dist < 1.5) return;
      var speed = dist / Math.max(1, pt.t - last.t);
      ctx.strokeStyle = inkCss();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(5, Math.min(10, 10 - speed * 2));
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.quadraticCurveTo(last.x, last.y, (last.x + pt.x) / 2, (last.y + pt.y) / 2);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      last = pt;
    });
    function penUp(e) { if (e.pointerId === pid) { pid = null; last = null; } }
    pad.addEventListener("pointerup", penUp);
    pad.addEventListener("pointercancel", penUp);

    openModal(t("sig.make"), body, t("btn.use"), function () {
      var sig = drawn ? sigFromCanvas(pad) : null;
      if (!sig) { showToast(t("sig.empty")); return; }
      if (keep.box.checked) storeSigs(C.addSig(loadSigs(), sig));
      closeModal();
      onPick(sig);
    });
    setMode();
  }

  function pickImage(cb) {
    var acc = C.IMAGE_EXT.join(",") + ",image/*";
    var dlg = dialogHost();
    if (dlg && typeof dlg.openFiles === "function") {
      dlg.openFiles(acc).then(function (files) { if (files && files[0]) cb(files[0]); });
      return;
    }
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = acc;
    inp.addEventListener("change", function () { if (inp.files && inp.files[0]) cb(inp.files[0]); });
    inp.click();
  }
  // A photo of a signature → a canvas of see-through ink, cropped.
  function sigFromPhoto(file) {
    return createImageBitmap(file).then(function (bmp) {
      var s = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var x = cv.getContext("2d");
      x.drawImage(bmp, 0, 0, w, h);
      try { bmp.close(); } catch (e) {}
      var img = x.getImageData(0, 0, w, h);
      C.inkFromPhoto(img.data, INK.black);
      x.putImageData(img, 0, 0);
      return crop(cv, 6);
    });
  }
  // The ink of a canvas, cropped (null when there is none).
  function crop(cv, pad) {
    var x = cv.getContext("2d"), d = x.getImageData(0, 0, cv.width, cv.height);
    var b = C.inkBox(d.data, cv.width, cv.height, pad, 20);
    if (!b || b.w < 4 || b.h < 4) return null;
    var out = document.createElement("canvas");
    out.width = b.w; out.height = b.h;
    out.getContext("2d").drawImage(cv, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    return out;
  }
  function sigFromCanvas(pad) {
    var cv = crop(pad, 8);
    if (!cv) return null;
    // within the size a saved signature may have
    for (var s = 1; s > 0.1; s *= 0.75) {
      var c2 = cv;
      if (s < 1) {
        c2 = document.createElement("canvas");
        c2.width = Math.max(4, Math.round(cv.width * s)); c2.height = Math.max(4, Math.round(cv.height * s));
        c2.getContext("2d").drawImage(cv, 0, 0, c2.width, c2.height);
      }
      var url = c2.toDataURL("image/png");
      var sig = C.readSigs([{ id: "g" + Date.now().toString(36), src: url, w: c2.width, h: c2.height }])[0];
      if (sig) return sig;
    }
    return null;
  }

  // ---------- 7d. Camera scan ----------
  // Camera (rear, torch when it has one) or photos → find the page
  // (scan.js) → straighten it → a look (Document, Grey, Black & white,
  // Photo) → kept pages in a strip → Add: they join the list as
  // pictures marked `scan` (their own shape, no margin). The camera
  // stops whenever the scanner closes. Nothing is stored.
  var SC = window.ScanPdfScan;
  var sc = null;   // { stream, track, torch, pages: [], cur, queue, hist, timer, view, cool }
  var MAX_RAW_SIDE = 4000;

  function openScanner() {
    if (!SC || sc) return;
    sc = { pages: [], cur: null, queue: [], hist: [], view: "cam", back: document.activeElement, cool: 0 };
    $("scanner").hidden = false;
    document.body.classList.add("editing");
    try { $("sc-auto").checked = localStorage.getItem("oros-scanpdf-auto") !== "0"; } catch (e) {}
    scView("cam");
    renderStrip();
    startCamera();
    setTimeout(function () { $("sc-shoot").focus(); }, 0);
  }
  function closeScanner(add) {
    if (!sc) return;
    var s0 = sc;
    sc = null;
    stopCamera(s0);
    $("scanner").hidden = true;
    document.body.classList.remove("editing");
    $("sc-strip").textContent = "";
    if (add && s0.pages.length) {
      addBlobs(s0.pages.map(function (pg, i) {
        return { name: t("sc.name", { n: srcOrder.length + i + 1 }), blob: pg.blob, scan: true };
      }));
    }
    if (s0.back && s0.back.isConnected && s0.back.focus) { try { s0.back.focus({ preventScroll: true }); } catch (e) {} }
  }
  function leaveScanner() {
    if (!sc) return;
    if (!sc.pages.length) { closeScanner(false); return; }
    openModal(t("sc.leaveTitle"), el("p", "", t("sc.leaveBody")), t("sc.leave"), function () {
      closeModal();
      closeScanner(false);
    }, true);
  }
  function scView(v) {
    sc.view = v;
    ["cam", "adjust", "review"].forEach(function (k) { $("sc-" + k).hidden = k !== v; });
    $("sc-done").hidden = !sc.pages.length;
    $("sc-done").textContent = tn("sc.done", sc.pages.length);
    if (v === "cam") detectSoon();
  }

  // --- the camera ---
  function startCamera() {
    var md = navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== "function") { camMsg("sc.nocam"); return; }
    md.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(function (stream) {
        if (!sc) { stream.getTracks().forEach(function (tr) { tr.stop(); }); return; }
        sc.stream = stream;
        sc.track = stream.getVideoTracks()[0];
        var v = $("sc-video");
        v.srcObject = stream;
        var pl = v.play();
        if (pl && pl.then) pl.then(null, function () {});
        var caps = {};
        try { caps = sc.track.getCapabilities ? sc.track.getCapabilities() : {}; } catch (e) {}
        $("sc-torch").hidden = !caps.torch;
        $("sc-msg").hidden = true;
        $("sc-shoot").disabled = false;
        tip("sc.find");
        detectSoon();
      }, function (e) {
        camMsg(e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "sc.denied" : "sc.nocam");
      });
  }
  function stopCamera(s0) {
    s0 = s0 || sc;
    if (!s0) return;
    clearTimeout(s0.timer);
    if (s0.stream) s0.stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
    s0.stream = null; s0.track = null;
    var v = $("sc-video");
    try { v.pause(); } catch (e) {}
    v.srcObject = null;
    clearOutline();
  }
  function camMsg(key) {
    $("sc-msg-text").textContent = t(key);
    $("sc-msg").hidden = false;
    $("sc-shoot").disabled = true;
    $("sc-auto-l").hidden = true;
    tip(null);
  }
  function tip(key) { $("sc-tip").textContent = key ? t(key) : ""; $("sc-tip").hidden = !key; }
  function setTorch(on) {
    if (!sc || !sc.track) return;
    sc.track.applyConstraints({ advanced: [{ torch: on }] }).then(function () {
      sc.torch = on;
      $("sc-torch").classList.toggle("on", on);
      setLabel($("sc-torch"), t(on ? "sc.torchOff" : "sc.torchOn"));
    }, function () {});
  }

  // The video as it shows: the box it fills inside the stage (contain).
  function videoBox() {
    var v = $("sc-video"), st = $("sc-camstage"), vw = v.videoWidth, vh = v.videoHeight;
    var W = st.clientWidth, H = st.clientHeight;
    if (!vw || !vh) return null;
    var k = Math.min(W / vw, H / vh);
    return { x: (W - vw * k) / 2, y: (H - vh * k) / 2, w: vw * k, h: vh * k };
  }
  var detCanvas = null;
  function smallFrame(src, sw, sh) {
    var k = SC.DETECT_SIDE / Math.max(sw, sh);
    if (!detCanvas) detCanvas = document.createElement("canvas");
    detCanvas.width = Math.max(1, Math.round(sw * k)); detCanvas.height = Math.max(1, Math.round(sh * k));
    var x = detCanvas.getContext("2d", { willReadFrequently: true });
    x.drawImage(src, 0, 0, detCanvas.width, detCanvas.height);
    return x.getImageData(0, 0, detCanvas.width, detCanvas.height);
  }
  // Find the page about six times a second; draw its outline; when Auto
  // is on and the outline holds still, take the picture.
  function detectSoon() {
    if (!sc) return;
    clearTimeout(sc.timer);
    sc.timer = setTimeout(detectTick, 160);
  }
  function detectTick() {
    if (!sc || sc.view !== "cam" || !sc.stream) return;
    var v = $("sc-video");
    if (v.readyState >= 2 && v.videoWidth) {
      var img = smallFrame(v, v.videoWidth, v.videoHeight), r = null;
      try { r = SC.detectQuad(img); } catch (e) { r = null; }
      var q = r && r.area > 0.15 ? r.quad.map(function (p) { return [p[0] / img.width, p[1] / img.height]; }) : null;
      sc.hist.push(q);
      if (sc.hist.length > 10) sc.hist.shift();
      drawOutline(q);
      var auto = $("sc-auto").checked;
      if (q && auto && Date.now() > sc.cool && SC.steady(sc.hist, 7, 0.018)) { capture(); return; }
      tip(q ? (auto ? "sc.hold" : null) : "sc.find");
    }
    detectSoon();
  }
  function drawOutline(q) {
    var cv = $("sc-outline"), st = $("sc-camstage"), b = videoBox();
    cv.width = st.clientWidth; cv.height = st.clientHeight;
    var x = cv.getContext("2d");
    x.clearRect(0, 0, cv.width, cv.height);
    if (!q || !b) return;
    x.beginPath();
    q.forEach(function (p, i) { var px = b.x + p[0] * b.w, py = b.y + p[1] * b.h; if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    x.closePath();
    x.fillStyle = "rgba(212, 175, 55, 0.18)";
    x.fill();
    x.lineWidth = 3;
    x.strokeStyle = "#d4af37";
    x.stroke();
  }
  function clearOutline() { var cv = $("sc-outline"); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); }

  function capture() {
    if (!sc || !sc.stream) return;
    var v = $("sc-video");
    if (!v.videoWidth) return;
    clearTimeout(sc.timer);
    var last = sc.hist[sc.hist.length - 1] || null;
    var k = Math.min(1, MAX_RAW_SIDE / Math.max(v.videoWidth, v.videoHeight));
    var cv = document.createElement("canvas");
    cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
    cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
    sc.hist = [];
    $("scanner").classList.add("flash");
    setTimeout(function () { $("scanner").classList.remove("flash"); }, 180);
    newShot({ canvas: cv, quad: last, retake: sc.retake });
  }

  // --- photos ---
  function pickPhotos() {
    var acc = C.IMAGE_EXT.join(",") + ",image/*";
    var dlg = dialogHost();
    function got(files) {
      var list = [].slice.call(files || []).filter(function (f) { return C.kindOf(f.name, f.type) === "image"; });
      if (!list.length || !sc) return;
      sc.queue = sc.queue.concat(list);
      if (sc.view === "cam") nextPhoto();
    }
    if (dlg && typeof dlg.openFiles === "function") { dlg.openFiles(acc).then(got); return; }
    var inp = document.createElement("input");
    inp.type = "file"; inp.multiple = true; inp.accept = acc;
    inp.addEventListener("change", function () { got(inp.files); });
    inp.click();
  }
  function nextPhoto() {
    if (!sc || !sc.queue.length) return false;
    var f = sc.queue.shift();
    clearTimeout(sc.timer);
    createImageBitmap(f).then(function (bmp) {
      var k = Math.min(1, MAX_RAW_SIDE / Math.max(bmp.width, bmp.height));
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      try { bmp.close(); } catch (e) {}
      var img = smallFrame(cv, cv.width, cv.height), r = null;
      try { r = SC.detectQuad(img); } catch (e) {}
      var q = r ? r.quad.map(function (p) { return [p[0] / img.width, p[1] / img.height]; }) : null;
      newShot({ canvas: cv, quad: q, photo: true });
    }, function () {
      showToast(t("sc.bad"));
      if (!nextPhoto() && sc) scView("cam");
    });
    return true;
  }

  // --- one page: corners, look, turn ---
  // shot: { canvas (the picture), quad (fractions) | null, filter, rot,
  //         warped (ImageData, straightened, before the look) }
  function newShot(sh) {
    sh.filter = sh.filter || "color";
    sh.rot = 0;
    sc.cur = sh;
    sc.edit = typeof sh.retake === "number" ? sh.retake : null;
    sc.retake = null;
    if (!sh.quad) {
      // nothing found: the corners first, from the whole picture
      sh.quad = SC.fullQuad(1, 1, 0.04);
      openAdjust();
      return;
    }
    straighten().then(openReview);
  }
  function straighten() {
    var sh = sc.cur, cv = sh.canvas, W = cv.width, H = cv.height;
    showBusy(t("sc.working"));
    return new Promise(function (res) { setTimeout(res, 30); }).then(function () {
      var q = SC.scaleQuad(sh.quad, W, H), size = SC.outSize(q);
      var src = cv.getContext("2d").getImageData(0, 0, W, H);
      var ctx = cv.getContext("2d");
      sh.warped = SC.warp(src, q, size[0], size[1], function (w, h) { return ctx.createImageData(w, h); });
      hideBusy();
    });
  }
  // The page with its look and turn, on a new canvas.
  function shotCanvas(sh) {
    var w = sh.warped, tmp = document.createElement("canvas"), x = tmp.getContext("2d");
    var img = x.createImageData(w.width, w.height);
    img.data.set(w.data);
    SC.filter(img, sh.filter);
    var r = ((sh.rot % 4) + 4) % 4;
    for (var i = 0; i < r; i++) img = SC.rotate90(img, 1, function (a, b) { return x.createImageData(a, b); });
    tmp.width = img.width; tmp.height = img.height;
    x.putImageData(img, 0, 0);
    return tmp;
  }
  function openReview() {
    if (!sc) return;
    scView("review");
    $("sc-del").hidden = sc.edit === null;
    renderFilters();
    drawReview();
    setTimeout(function () { $("sc-keep").focus(); }, 0);
  }
  function drawReview() {
    var sh = sc.cur, out = shotCanvas(sh), cv = $("sc-result"), st = $("sc-revstage");
    var k = Math.min((st.clientWidth - 16) / out.width, (st.clientHeight - 16) / out.height, 1);
    cv.width = out.width; cv.height = out.height;
    cv.style.width = Math.round(out.width * k) + "px"; cv.style.height = Math.round(out.height * k) + "px";
    cv.getContext("2d").drawImage(out, 0, 0);
    sh.out = out;
  }
  function renderFilters() {
    var box = $("sc-filters");
    box.textContent = "";
    box.setAttribute("aria-label", t("sc.filter"));
    SC.FILTERS.forEach(function (f) {
      var b = el("button", "chip", t("sc.f." + f));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", sc.cur.filter === f ? "true" : "false");
      b.tabIndex = sc.cur.filter === f ? 0 : -1;
      b.addEventListener("click", function () { sc.cur.filter = f; renderFilters(); drawReview(); box.querySelector('[aria-checked="true"]').focus(); });
      box.appendChild(b);
    });
  }
  function keepShot() {
    var sh = sc.cur, out = sh.out || shotCanvas(sh);
    showBusy(t("busy.save"));
    out.toBlob(function (blob) {
      hideBusy();
      if (!sc || !blob) return;
      var pg = { blob: blob, shot: sh, thumb: thumbCanvas(out) };
      // a kept page holds only compressed pictures (the full-size
      // canvases are let go); looking at it again decodes them
      sh.canvas.toBlob(function (raw) { sh.raw = raw; }, "image/jpeg", 0.92);
      var n;
      if (sc.edit !== null && sc.pages[sc.edit]) { sc.pages[sc.edit] = pg; n = sc.edit + 1; }
      else { sc.pages.push(pg); n = sc.pages.length; }
      sc.cur = null; sc.edit = null;
      sc.pages.forEach(function (p) { if (p !== pg) dropBig(p.shot); });
      renderStrip();
      say(t("sc.kept", { n: n }));
      sc.cool = Date.now() + 1500;
      if (!nextPhoto()) { scView("cam"); $("sc-shoot").focus(); }
    }, "image/jpeg", sh.filter === "photo" ? 0.88 : 0.85);
  }
  function thumbCanvas(cv) {
    var k = 120 / Math.max(cv.width, cv.height), out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cv.width * k)); out.height = Math.max(1, Math.round(cv.height * k));
    out.getContext("2d").drawImage(cv, 0, 0, out.width, out.height);
    return out;
  }
  function renderStrip() {
    var ul = $("sc-strip");
    ul.textContent = "";
    ul.hidden = !sc.pages.length;
    sc.pages.forEach(function (pg, i) {
      var li = el("li"), b = el("button", "sc-thumb");
      b.type = "button";
      setLabel(b, t("sc.page", { n: i + 1 }));
      b.appendChild(pg.thumb);
      b.appendChild(el("span", "sc-num", String(i + 1)));
      b.addEventListener("click", function () {
        // look at it again: corners, look, turn, or delete
        clearTimeout(sc.timer);
        reopenShot(pg.shot).then(function () { sc.cur = pg.shot; sc.edit = i; openReview(); },
                                 function () { showToast(t("sc.bad")); });
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("sc-done").hidden = !sc.pages.length;
    $("sc-done").textContent = tn("sc.done", sc.pages.length);
    var last = ul.lastChild;
    if (last && last.scrollIntoView) last.scrollIntoView({ inline: "end", block: "nearest" });
  }
  // Let go of the big canvases of the kept pages; bring them back on demand.
  function dropBig(sh) { if (sh.raw) { sh.canvas = null; sh.warped = null; sh.out = null; } }
  function reopenShot(sh) {
    if (sh.canvas && sh.warped) return Promise.resolve();
    return createImageBitmap(sh.raw).then(function (bmp) {
      var cv = document.createElement("canvas");
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext("2d").drawImage(bmp, 0, 0);
      try { bmp.close(); } catch (e) {}
      sh.canvas = cv;
      var keep = sc.cur;
      sc.cur = sh;
      return straighten().then(function () { sc.cur = keep; });
    });
  }
  function deleteShot() {
    if (sc.edit === null) return;
    sc.pages.splice(sc.edit, 1);
    sc.cur = null; sc.edit = null;
    renderStrip();
    scView("cam");
    $("sc-shoot").focus();
  }
  function retake() {
    // back to the camera; the next picture replaces this page
    sc.retake = sc.edit;
    sc.cur = null; sc.edit = null;
    if (!sc.stream) { scView("cam"); return; }
    scView("cam");
    $("sc-shoot").focus();
  }

  // --- corners by hand ---
  var adj = null;   // { k, w, h, drag: { i, pid } }
  function openAdjust() {
    scView("adjust");
    var sh = sc.cur, cv = sh.canvas, st = $("sc-adjstage");
    var k = Math.min((st.clientWidth - 40) / cv.width, (st.clientHeight - 40) / cv.height);
    var w = Math.max(40, Math.floor(cv.width * k)), h = Math.max(40, Math.floor(cv.height * k));
    var box = $("sc-adjbox");
    box.style.width = w + "px"; box.style.height = h + "px";
    var ph = $("sc-photo"), dpr = Math.min(2, window.devicePixelRatio || 1);
    ph.width = Math.round(w * dpr); ph.height = Math.round(h * dpr);
    ph.getContext("2d").drawImage(cv, 0, 0, ph.width, ph.height);
    $("sc-quad").setAttribute("viewBox", "0 0 " + w + " " + h);
    adj = { w: w, h: h, drag: null };
    $("sc-retake").hidden = !!sh.photo || !sc.stream;
    placeHandles();
    setTimeout(function () { $("sc-next").focus(); }, 0);
  }
  function placeHandles() {
    var q = sc.cur.quad;
    [].forEach.call(document.querySelectorAll(".sc-h"), function (b) {
      var i = +b.getAttribute("data-i");
      b.style.left = (q[i][0] * 100) + "%";
      b.style.top = (q[i][1] * 100) + "%";
    });
    $("sc-poly").setAttribute("points", q.map(function (p) { return (p[0] * adj.w) + "," + (p[1] * adj.h); }).join(" "));
    $("sc-next").disabled = !SC.isConvex(q);
  }
  function moveCorner(i, fx, fy) {
    var q = sc.cur.quad.map(function (p) { return p.slice(); });
    q[i] = [Math.max(0, Math.min(1, fx)), Math.max(0, Math.min(1, fy))];
    sc.cur.quad = q;
    placeHandles();
  }
  // A magnified view of the picture around the corner being dragged,
  // above the finger (below it near the top), so the corner can be
  // placed exactly on a small screen.
  function drawLoupe(i) {
    var L = $("sc-loupe"), cv = sc.cur.canvas, p = sc.cur.quad[i];
    var x = L.getContext("2d"), R = 40;      // source pixels of the picture around the corner, at 3× on 240
    var sx = p[0] * cv.width, sy = p[1] * cv.height, scale = cv.width / adj.w;
    var half = R * scale;
    x.fillStyle = "#000";
    x.fillRect(0, 0, 240, 240);
    x.drawImage(cv, sx - half, sy - half, half * 2, half * 2, 0, 0, 240, 240);
    x.strokeStyle = "#d4af37"; x.lineWidth = 2;
    x.beginPath(); x.moveTo(120, 96); x.lineTo(120, 144); x.moveTo(96, 120); x.lineTo(144, 120); x.stroke();
    L.hidden = false;
    var px = p[0] * adj.w, py = p[1] * adj.h, size = 120;
    L.style.width = size + "px"; L.style.height = size + "px";
    L.style.left = Math.max(-20, Math.min(adj.w - size + 20, px - size / 2)) + "px";
    L.style.top = (py - size - 40 < -20 ? py + 40 : py - size - 40) + "px";
  }
  function onHandleDown(e) {
    var b = e.target.closest && e.target.closest(".sc-h");
    if (!b || !adj) return;
    e.preventDefault();
    b.focus({ preventScroll: true });
    adj.drag = { i: +b.getAttribute("data-i"), pid: e.pointerId };
    try { b.setPointerCapture(e.pointerId); } catch (x) {}
    drawLoupe(adj.drag.i);
  }
  function onHandleMove(e) {
    if (!adj || !adj.drag || e.pointerId !== adj.drag.pid) return;
    e.preventDefault();
    var r = $("sc-adjbox").getBoundingClientRect();
    moveCorner(adj.drag.i, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    drawLoupe(adj.drag.i);
  }
  function onHandleUp(e) {
    if (adj && adj.drag && e.pointerId === adj.drag.pid) { adj.drag = null; $("sc-loupe").hidden = true; }
  }
  function adjustDone() {
    if (!SC.isConvex(sc.cur.quad)) return;
    sc.cur.quad = SC.orderQuad(sc.cur.quad);
    straighten().then(openReview);
  }

  // Keyboard in the scanner: Esc goes back a step (or leaves); in the
  // corners, arrows move the focused corner (Shift: further).
  function scKey(e) {
    if (!$("modal-veil").hidden) return false;
    if (e.key === "Tab") { trapIn($("scanner"), e); return true; }
    if (e.key === "Escape") {
      e.preventDefault();
      if (sc.view === "cam") leaveScanner();
      else if (sc.view === "adjust" && sc.cur && sc.cur.warped) openReview();
      else { sc.cur = null; sc.edit = null; scView("cam"); $("sc-shoot").focus(); }
      return true;
    }
    var h = e.target.closest && e.target.closest(".sc-h");
    if (h && /^Arrow/.test(e.key)) {
      e.preventDefault();
      var i = +h.getAttribute("data-i"), p = sc.cur.quad[i], st = e.shiftKey ? 0.02 : 0.004;
      moveCorner(i, p[0] + (e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0),
                    p[1] + (e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0));
    }
    return true;
  }

  function wireScanner() {
    [$("scan-btn"), $("scan-start"), $("scan-more")].forEach(function (b) { b.addEventListener("click", openScanner); });
    $("sc-close").addEventListener("click", leaveScanner);
    $("sc-done").addEventListener("click", function () { closeScanner(true); });
    $("sc-shoot").addEventListener("click", capture);
    $("sc-photos").addEventListener("click", pickPhotos);
    $("sc-msg-photos").addEventListener("click", pickPhotos);
    $("sc-torch").addEventListener("click", function () { setTorch(!(sc && sc.torch)); });
    $("sc-auto").addEventListener("change", function () {
      try { localStorage.setItem("oros-scanpdf-auto", $("sc-auto").checked ? "1" : "0"); } catch (e) {}
      if (sc) sc.hist = [];
    });
    $("sc-whole").addEventListener("click", function () { sc.cur.quad = SC.fullQuad(1, 1, 0); placeHandles(); });
    $("sc-retake").addEventListener("click", retake);
    $("sc-next").addEventListener("click", adjustDone);
    $("sc-corners").addEventListener("click", openAdjust);
    $("sc-rotl").addEventListener("click", function () { sc.cur.rot--; drawReview(); });
    $("sc-rotr").addEventListener("click", function () { sc.cur.rot++; drawReview(); });
    $("sc-del").addEventListener("click", deleteShot);
    $("sc-keep").addEventListener("click", keepShot);
    var box = $("sc-adjbox");
    box.addEventListener("pointerdown", onHandleDown);
    box.addEventListener("pointermove", onHandleMove);
    box.addEventListener("pointerup", onHandleUp);
    box.addEventListener("pointercancel", onHandleUp);
    $("sc-filters").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      var i = SC.FILTERS.indexOf(sc.cur.filter) + (e.key === "ArrowRight" ? 1 : -1);
      i = (i + SC.FILTERS.length) % SC.FILTERS.length;
      $("sc-filters").children[i].click();
    });
    window.addEventListener("resize", function () {
      if (!sc) return;
      if (sc.view === "review" && sc.cur && sc.cur.warped) drawReview();
      else if (sc.view === "adjust" && sc.cur) openAdjust();
    });
    // the camera stops when the app is hidden or closed
    document.addEventListener("visibilitychange", function () {
      if (!sc) return;
      if (document.hidden) stopCamera();
      else if (!sc.stream) startCamera();
    });
    window.addEventListener("pagehide", function () { if (sc) stopCamera(); });
  }

  // ---------- 7e. Reading text (OCR) ----------
  // Text recognition = Tesseract.js (Apache-2.0), vendored under
  // vendor/tesseract/ with the Greek and English data (about 7 MB),
  // loaded only when text is read; it runs in its own worker, so the
  // page stays responsive, and nothing leaves this device. What it
  // found is kept per page (src:idx) for this session: Save puts it
  // under the page as invisible text (pdfops, ocr.js), Text shows it.
  var OCR_BASE = "../vendor/tesseract/";
  var OCR_IDLE = 120000;                     // the worker is let go after 2 minutes unused
  var ocrBy = {};                            // "src:idx" -> ocr.record | { own: true, text }
  var ocrLoad = null, ocrW = null, ocrWLang = "", ocrIdleT = null, ocrJob = null;
  function ocrScript() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (ocrLoad) return ocrLoad;
    ocrLoad = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = OCR_BASE + "tesseract.min.js";
      s.onload = function () { window.Tesseract ? res(window.Tesseract) : rej(codeErr("ocr")); };
      s.onerror = function () { s.remove(); ocrLoad = null; rej(codeErr("ocr")); };
      document.head.appendChild(s);
    });
    return ocrLoad;
  }
  function dropWorker() {
    clearTimeout(ocrIdleT); ocrIdleT = null;
    var w = ocrW;
    ocrW = null; ocrWLang = "";
    if (w) { try { w.terminate(); } catch (e) {} }
  }
  function ocrWorker(lang, job) {
    clearTimeout(ocrIdleT); ocrIdleT = null;
    if (ocrW && ocrWLang === lang) return Promise.resolve(ocrW);
    dropWorker();
    var base = new URL(OCR_BASE, location.href).href;
    return ocrScript().then(function (T) {
      return T.createWorker(lang.split("+"), 1, {
        workerPath: base + "worker.min.js",
        corePath: base + "tesseract-core-lstm.js",
        langPath: base.replace(/\/$/, ""),
        workerBlobURL: false,
        cachePath: "oros-scanpdf-ocr",
        logger: function (m) {
          if (!m || typeof m.progress !== "number" || job.stop) return;
          job.pct = Math.round(m.progress * 100);
          job.paint();
        }
      });
    }).then(function (w) {
      if (job.stop) { try { w.terminate(); } catch (e) {} throw codeErr("stop"); }
      ocrW = w; ocrWLang = lang;
      return w;
    }, function (e) { throw e && e.code ? e : codeErr("ocr"); });
  }
  function hasText(p) {
    var r = ocrBy[baseKey(p)];
    return !!(r && (r.own || (r.words && r.words.length)));
  }
  // Words to draw: a page with its own text needs none, except when
  // Compress turns it into a picture (pictures: true).
  function ocrRecords(pictures) {
    var out = {};
    Object.keys(ocrBy).forEach(function (k) {
      var r = ocrBy[k];
      if (r.words && r.words.length && (pictures || !r.own)) out[k] = r;
    });
    return out;
  }
  // Pages of the list still to read in that language (each page once,
  // however many copies the list has). With pictures, pages with their
  // own text are read too, as Compress keeps only what was read.
  function toRead(list, lang, pictures) {
    var seen = {}, out = [];
    list.forEach(function (p) {
      var k = baseKey(p), r = ocrBy[k];
      if (seen[k] || (r && (r.own ? !pictures || r.words : r.lang === lang))) return;
      seen[k] = true;
      out.push(p);
    });
    return out;
  }
  // A picture of the page as it shows (turned), for reading: about
  // 2500 pixels on the long side, white behind it.
  var OCR_SIDE = 2480;
  function ocrCanvas(p) {
    var src = sources[p.src], g = geomOf(p);
    if (!g) return Promise.reject(codeErr("ocr"));
    if (src.kind === "image") {
      return createImageBitmap(new Blob([src.img.bytes])).then(function (bmp) {
        var k = Math.min(2, OCR_SIDE / Math.max(bmp.width, bmp.height));
        var w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        var turned = g.R % 180 !== 0, cv = document.createElement("canvas");
        cv.width = turned ? h : w; cv.height = turned ? w : h;
        var ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.translate(cv.width / 2, cv.height / 2);
        ctx.rotate(g.R * Math.PI / 180);
        ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
        try { bmp.close(); } catch (e) {}
        return { cv: cv, g: g, W: src.img.w, H: src.img.h };
      });
    }
    return pjsDoc(src).then(function (doc) { return doc.getPage(p.idx + 1); }).then(function (pg) {
      var v1 = pg.getViewport({ scale: 1, rotation: g.R });
      var vp = pg.getViewport({ scale: OCR_SIDE / Math.max(v1.width, v1.height), rotation: g.R });
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.floor(vp.width)); cv.height = Math.max(1, Math.floor(vp.height));
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        try { pg.cleanup(); } catch (e) {}
        return { cv: cv, g: g, W: g.W, H: g.H };
      });
    });
  }
  // The PDF's own text of a page, when it has some (then it is not read).
  var OWN_MIN = 20;
  function ownText(p) {
    var src = sources[p.src];
    if (src.kind !== "pdf") return Promise.resolve("");
    return pjsDoc(src).then(function (doc) { return doc.getPage(p.idx + 1); }).then(function (pg) {
      return pg.getTextContent().then(function (tc) {
        var s = "";
        (tc.items || []).forEach(function (it) {
          if (typeof it.str !== "string") return;
          s += it.str + (it.hasEOL ? "\n" : it.str ? " " : "");
        });
        s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
        return s.replace(/\s/g, "").length >= OWN_MIN ? s : "";
      });
    }).then(null, function () { return ""; });
  }
  // Read the pages of `list` that need it. Resolves { read, found,
  // stopped } once done or stopped; pages read before Stop are kept.
  function readPages(list, lang, pictures) {
    var todo = toRead(list, lang, pictures), n = todo.length;
    var job = { stop: false, i: 0, pct: 0, loading: true, found: 0 };
    // Stop ends the wait at once, even while the worker is busy
    job.stopped = new Promise(function (res) { job.onStop = res; }).then(function () { throw codeErr("stop"); });
    job.stopped.then(null, function () {});
    function orStop(pr) { return Promise.race([pr, job.stopped]); }
    if (!n) return Promise.resolve({ read: 0, found: 0, stopped: false });
    ocrJob = job;
    job.paint = function () {
      showBusy(job.loading ? t("ocr.load", { p: job.pct }) : t("ocr.page", { i: job.i, n: n, p: job.pct }));
    };
    $("busy-stop").hidden = false;
    job.paint();
    var chain = Promise.resolve(), worker = null;
    todo.forEach(function (p, i) {
      chain = chain.then(function () {
        if (job.stop) return;
        job.i = i + 1; job.pct = 0;
        job.paint();
        var had = ocrBy[baseKey(p)];
        return orStop(had && had.own ? Promise.resolve(had.text) : ownText(p)).then(function (own) {
          if (own && !pictures) { ocrBy[baseKey(p)] = { own: true, text: own }; job.found++; return; }
          return orStop(worker ? Promise.resolve(worker) : ocrWorker(lang, job)).then(function (w) {
            worker = w;
            job.loading = false; job.pct = 0;
            job.paint();
            return ocrCanvas(p).then(function (pic) {
              if (job.stop) throw codeErr("stop");
              return orStop(w.recognize(pic.cv, {}, { text: true, blocks: true })).then(function (res) {
                var found = O.wordsFrom(res && res.data, pic.cv.width, pic.cv.height);
                pic.cv.width = pic.cv.height = 0;
                if (job.stop) return;
                var rec = O.record(found, pic.g.R, pic.W, pic.H, lang);
                // a page with its own text keeps showing that text; the words only go under its picture
                if (own) { rec.own = true; rec.text = own; }
                ocrBy[baseKey(p)] = rec;
                if (own || found.words.length) job.found++;
              });
            });
          });
        });
      });
    });
    function end(stopped) {
      if (ocrJob === job) ocrJob = null;
      $("busy-stop").hidden = true;
      hideBusy();
      if (ocrW) { clearTimeout(ocrIdleT); ocrIdleT = setTimeout(dropWorker, OCR_IDLE); }
      renderAll();
      return { read: job.stop ? Math.max(0, job.i - 1) : n, found: job.found, stopped: stopped };
    }
    return chain.then(function () { return end(job.stop); }, function (e) {
      if (job.stop || (e && e.code === "stop")) return end(true);
      end(false);
      throw e && e.code ? e : codeErr("ocr");
    });
  }
  function stopReading() {
    if (!ocrJob) return;
    ocrJob.stop = true;
    ocrJob.onStop();
    dropWorker();                            // ends the page being read now
  }

  function langChoice(value) {
    return select([["ell+eng", t("ocr.both")], ["ell", t("ocr.ell")], ["eng", t("ocr.eng")]], value);
  }
  function readDialog() {
    var k = selKeys(), body = el("div", "form");
    body.appendChild(el("p", "hint small", t("ocr.hint")));
    var lang = langChoice(prefs.ocr);
    body.appendChild(field(t("ocr.lang"), lang));
    if (k.length && k.length < pages.length) {
      var box = el("fieldset", "seg");
      box.appendChild(el("legend", "field-l", t("ocr.scope")));
      box.appendChild(radio("scope", "all", tn("ocr.all", pages.length), false));
      box.appendChild(radio("scope", "sel", tn("ocr.sel", k.length), true));
      body.appendChild(box);
    }
    body.appendChild(el("p", "hint small", t("ocr.dl")));
    openModal(t("ocr.title"), body, t("ocr.go"), function () {
      var list = radioVal(body, "scope") === "sel" ? pages.filter(function (p) { return sel[p.key]; }) : pages.slice();
      prefs.ocr = C.readPrefs({ ocr: lang.value }).ocr; savePrefs();
      closeModal();
      readPages(list, prefs.ocr).then(function (r) {
        if (r.stopped) showToast(tn("ocr.stopped", r.read));
        textDialog(list);
      }, function () { showToast(t("ocr.err")); });
    });
  }
  // The text of the pages, page by page: copy it or send it to an app.
  function pagesText(list) {
    return list.map(function (p) {
      var r = ocrBy[baseKey(p)];
      return r && r.text ? r.text : "";
    });
  }
  function textDialog(list) {
    var texts = pagesText(list), any = texts.some(function (s) { return s.trim(); });
    var body = el("div", "form");
    if (!any) {
      body.appendChild(el("p", "", t("ocr.none")));
      openModal(t("txt.title"), body, t("btn.done"), closeModal);
      return;
    }
    var view = el("div", "ocr-text");
    view.tabIndex = 0;
    view.setAttribute("role", "document");
    view.setAttribute("aria-label", t("txt.title"));
    texts.forEach(function (s, i) {
      view.appendChild(el("h3", "", t("txt.page", { n: indexOf(list[i].key) + 1 })));
      view.appendChild(el("p", s.trim() ? "" : "hint small", s.trim() || t("txt.empty")));
    });
    body.appendChild(view);
    var all = texts.map(function (s, i) { return s.trim() ? s.trim() : ""; }).filter(Boolean).join("\n\n");
    var row = el("div", "txt-btns");
    var send = sendApi();
    if (send) {
      var sb = el("button", "btn", t("txt.send"));
      sb.type = "button";
      sb.addEventListener("click", function () {
        closeModal();
        send.open({ kind: "text", data: { title: defaultBase(), text: all } });
      });
      row.appendChild(sb);
    }
    if (row.firstChild) body.appendChild(row);
    openModal(t("txt.title"), body, t("txt.copy"), function () {
      copyText(all).then(function () { showToast(t("txt.copied")); }, function () { showToast(t("txt.noCopy")); });
    });
    $("modal-cancel").textContent = t("btn.closeIt");
  }
  function copyText(s) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") return navigator.clipboard.writeText(s);
    return new Promise(function (res, rej) {
      var ta = document.createElement("textarea");
      ta.value = s; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      ta.remove();
      ok ? res() : rej(new Error("copy"));
    });
  }
  function sendApi() {
    try { return window.parent !== window && window.parent.orosSend && typeof window.parent.orosSend.open === "function" ? window.parent.orosSend : null; }
    catch (e) { return null; }
  }
  // Save › Make it searchable: on by default when the list has scans
  // or pages already read.
  function wantsRead(list) {
    if (prefs.read !== "auto") return prefs.read === "on";
    return list.some(function (p) { return sources[p.src].scan || hasText(p); });
  }

  // Universal search: PDFs saved into Files, by name and text (search.js).
  function indexDoc(path, name, list) {
    var text = pagesText(list).filter(function (s) { return s.trim(); }).join(" ");
    var cur = null;
    try { cur = JSON.parse(localStorage.getItem(O.INDEX_KEY) || "null"); } catch (e) {}
    var next = O.addToIndex(cur, { p: path, n: C.baseName(name), t: text, k: list.length }, Date.now());
    try { localStorage.setItem(O.INDEX_KEY, JSON.stringify(next)); } catch (e) {}
  }
  function indexCount() {
    try { return O.cleanIndex(JSON.parse(localStorage.getItem(O.INDEX_KEY) || "null")).length; } catch (e) { return 0; }
  }

  // ---------- 8. Toast + busy ----------
  var toastTimer = null, toastShown = false;
  function showToast(msg) {
    var tEl = $("toast");
    tEl.textContent = msg;
    tEl.classList.add("show");
    toastShown = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { tEl.classList.remove("show"); }, 3600);
  }
  function errToast(key, name, size) { showToast(t(key, { name: name, size: size || "" })); }
  function say(msg) { $("live").textContent = msg; }
  var busyTimer = null;
  // Shown only when the work takes a moment, so quick steps don't flash.
  function showBusy(text) {
    $("busy-text").textContent = text;
    if ($("busy").hidden && !busyTimer) {
      busyTimer = setTimeout(function () { busyTimer = null; $("busy").hidden = false; }, 250);
    }
  }
  function hideBusy() {
    clearTimeout(busyTimer); busyTimer = null;
    $("busy").hidden = true;
  }
  function isBusy() { return !!busyTimer || !$("busy").hidden; }

  // ---------- 9. Keyboard (Contract Β) ----------
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
      if (!$("modal-veil").hidden) {
        if (e.key === "Escape") { e.preventDefault(); closeModal(); }
        else if (e.key === "Enter" && e.target.tagName !== "BUTTON" && modalOk && !$("modal-ok").disabled) { e.preventDefault(); modalOk(); }
        else if (e.key === "Tab") trapTab(e);
        return;
      }
      if (isBusy()) {
        if (e.key === "Escape" && ocrJob) { e.preventDefault(); stopReading(); }
        return;
      }
      if (ed && edKey(e)) return;
      if (sc && scKey(e)) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      var mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      if (mod && !e.shiftKey && e.code === "KeyO") { e.preventDefault(); pickFiles(); return; }
      if (typing || !pages.length) return;
      if (mod && !e.shiftKey && e.code === "KeyS") { e.preventDefault(); saveDialog(false); }
      else if (mod && !e.shiftKey && e.code === "KeyZ") { e.preventDefault(); actUndo(); }
      else if (mod && ((e.shiftKey && e.code === "KeyZ") || (!e.shiftKey && e.code === "KeyY"))) { e.preventDefault(); actRedo(); }
      else if (mod && !e.shiftKey && e.code === "KeyA") { e.preventDefault(); selectAll(); }
      else if (e.key === "Delete" || e.key === "Backspace") {
        var k = selKeys();
        if (!k.length) { var f = focusedKey(); if (f) k = [f]; }
        if (k.length) { e.preventDefault(); actDelete(k); }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        var fk = focusedKey();
        if (!fk) return;
        e.preventDefault();
        var d = e.key === "ArrowLeft" ? -1 : 1;
        if (mod) {
          // Ctrl+Arrow moves the focused page (with the selection when it is in it)
          var keys = sel[fk] ? selKeys() : [fk];
          edit(C.moveStep(pages, keys, d));
          refocus(fk);
          say(t("live.moved", { to: indexOf(fk) + 1 }));
        } else {
          var i = indexOf(fk) + d;
          if (i >= 0 && i < pages.length) refocus(pages[i].key);
        }
      } else if ((e.key === "e" || e.key === "E") && !mod && !e.altKey && focusedKey()) {
        e.preventDefault();
        openEditor(focusedKey());
      } else if (e.key === "Escape" && selKeys().length) {
        sel = {}; renderSel();
      }
    });
  }
  function focusedKey() {
    var a = document.activeElement;
    return a && a.classList && a.classList.contains("card-main") ? a.getAttribute("data-key") : null;
  }
  function refocus(key) {
    var b = document.querySelector('#grid button[data-key="' + key + '"]');
    if (b) { b.focus(); b.scrollIntoView({ block: "nearest" }); }
  }
  function trapTab(e) { trapIn($("modal"), e); }
  function trapIn(box, e) {
    var f = [].filter.call(box.querySelectorAll("input, select, button, [tabindex='0']"), function (n) {
      return !n.disabled && n.offsetParent !== null;
    });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---------- 10. Palette + deep link ----------
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

  // { paths } from Files, { openFile: { token } } from the shell,
  // { files: [File] } from a direct call on this window.
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (Array.isArray(target.files)) {
      var files = target.files.filter(function (f) { return f && typeof f.name === "string" && typeof f.size === "number"; });
      if (files.length) addFiles(files);
    }
    var tg = C.parseTarget(target);
    if (tg.token) {
      try {
        var p = parentWin(), f = p && typeof p.__orosTakeFile === "function" ? p.__orosTakeFile(tg.token) : null;
        if (f) addFiles([f]);
      } catch (e) {}
    }
    if (tg.paths.length) addPaths(tg.paths);
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    var btns = { "undo-btn": ["undo", "btn.undo"], "redo-btn": ["redo", "btn.redo"], "add-btn": ["plus", "btn.addIcon"],
                 "clear-btn": ["clear", "btn.clear"], "scan-btn": ["camera", "btn.scanIcon"], "sel-all": ["all", "btn.selAll"], "sel-left": ["left", "btn.left"],
                 "sel-right": ["right", "btn.right"], "sel-rotl": ["rotl", "btn.rotl"], "sel-rotr": ["rotr", "btn.rotr"],
                 "sel-dup": ["dup", "btn.dup"], "sel-extract": ["extract", "btn.extract"],
                 "sel-del": ["del", "btn.del"], "ed-prev": ["left", "ed.prev"], "ed-next": ["right", "ed.next"],
                 "ed-cancel": ["close", "btn.close"], "sc-close": ["close", "sc.close"], "sc-photos": ["image", "sc.photos"],
                 "sc-torch": ["torch", "sc.torchOn"], "sc-rotl": ["rotl", "btn.rotl"], "sc-rotr": ["rotr", "btn.rotr"],
                 "sc-del": ["del", "sc.delete"] };
    Object.keys(btns).forEach(function (id) {
      $(id).innerHTML = ICON[btns[id][0]];
      setLabel($(id), t(btns[id][1]));
    });
    [["ed-sig", "sig", "ed.sig"], ["ed-text", "text", "ed.text"], ["ed-date", "date", "ed.date"],
     ["ed-all", "copy", "ed.all"], ["ed-del", "del", "ed.del"]].forEach(function (b) {
      $(b[0]).innerHTML = ICON[b[1]];
      $(b[0]).appendChild(el("span", "", t(b[2])));
      setLabel($(b[0]), t(b[2]));
    });
    $("ed-input").setAttribute("aria-label", t("ed.textLabel"));
    setLabel($("sc-shoot"), t("sc.shoot"));
    $("sc-auto-l").title = t("sc.autoHint");
    [].forEach.call(document.querySelectorAll(".sc-h"), function (b) { setLabel(b, t("sc.corner." + b.getAttribute("data-i"))); });
    $("ed-colors").setAttribute("aria-label", t("ed.color"));
    [].forEach.call($("ed-colors").children, function (b) { setLabel(b, t("color." + b.getAttribute("data-color"))); });
  }

  var dragDepth = 0;
  function hasFiles(e) {
    var ty = e.dataTransfer && e.dataTransfer.types;
    return !!ty && [].indexOf.call(ty, "Files") !== -1;
  }
  function onDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $("drag-veil").hidden = true;
    var files = e.dataTransfer.files;
    if (files && files.length) addFiles(files);
  }

  function wire() {
    $("add-files").addEventListener("click", pickFiles);
    $("add-more").addEventListener("click", pickFiles);
    $("add-btn").addEventListener("click", pickFiles);
    $("clear-btn").addEventListener("click", clearDialog);
    $("undo-btn").addEventListener("click", actUndo);
    $("redo-btn").addEventListener("click", actRedo);
    $("sel-all").addEventListener("click", selectAll);
    $("sel-left").addEventListener("click", function () { actMove(-1); });
    $("sel-right").addEventListener("click", function () { actMove(1); });
    $("sel-rotl").addEventListener("click", function () { actRotate(-90); });
    $("sel-rotr").addEventListener("click", function () { actRotate(90); });
    $("sel-dup").addEventListener("click", actDup);
    $("sel-extract").addEventListener("click", function () { saveDialog(true); });
    $("sel-del").addEventListener("click", function () { actDelete(); });
    $("save-btn").addEventListener("click", function () { saveDialog(false); });
    $("split-btn").addEventListener("click", splitDialog);
    $("opt-btn").addEventListener("click", optionsDialog);
    $("text-btn").addEventListener("click", readDialog);
    $("busy-stop").addEventListener("click", stopReading);
    window.addEventListener("pagehide", dropWorker);
    wireScanner();
    $("ed-cancel").addEventListener("click", cancelEditor);
    $("ed-done").addEventListener("click", function () { closeEditor(true); });
    $("ed-prev").addEventListener("click", function () { edGo(-1); });
    $("ed-next").addEventListener("click", function () { edGo(1); });
    $("ed-sig").addEventListener("click", addSig);
    $("ed-text").addEventListener("click", function () { addText(t("ed.newText"), 0.03, 0.5, 0.5, true); });
    $("ed-date").addEventListener("click", function () { addText(today(), 0.025, 0.3, 0.84, false); });
    $("ed-del").addEventListener("click", function () { if (ed && ed.sel) removeOv(ed.sel); });
    $("ed-all").addEventListener("click", function () { if (ed && ed.sel) ovToAll(ed.sel); });
    $("ed-input").addEventListener("input", function () {
      var o = ed && ed.sel ? ovById(ed.sel) : null;
      if (!o || o.t !== "text") return;
      o.text = $("ed-input").value.slice(0, 200);
      touched();
      var n = ovNode(o.id);
      if (n) { n.querySelector(".ov-txt").textContent = o.text; n.setAttribute("aria-label", t("ed.itemText", { text: o.text })); }
    });
    $("ed-input").addEventListener("change", function () {
      // an empty text goes away
      var o = ed && ed.sel ? ovById(ed.sel) : null;
      if (o && o.t === "text" && !o.text.trim()) removeOv(o.id);
    });
    [].forEach.call($("ed-colors").children, function (b) {
      b.addEventListener("click", function () {
        var o = ed && ed.sel ? ovById(ed.sel) : null;
        if (!o || o.t !== "text") return;
        o.color = b.getAttribute("data-color");
        touched();
        placeOv(ovNode(o.id), o);
        syncProps();
      });
    });
    var layer = $("ed-layer");
    layer.addEventListener("pointerdown", onOvDown);
    layer.addEventListener("pointermove", onOvMove);
    layer.addEventListener("pointerup", onOvUp);
    layer.addEventListener("pointercancel", onOvUp);
    layer.addEventListener("focusin", function (e) {
      var n = e.target.closest && e.target.closest(".ov");
      if (n && ed && ed.sel !== n.getAttribute("data-id")) selectOv(n.getAttribute("data-id"));
    });
    var resizeT = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { if (ed) showEdPage(); }, 150);
    });
    $("modal-cancel").addEventListener("click", closeModal);
    $("modal-ok").addEventListener("click", function () { if (modalOk) modalOk(); });
    $("modal-veil").addEventListener("click", function (e) { if (e.target === $("modal-veil")) closeModal(); });

    var grid = $("grid");
    grid.addEventListener("click", function (e) {
      if (suppressClick) return;
      var pen = e.target.closest && e.target.closest(".pen");
      if (pen) { openEditor(pen.getAttribute("data-key")); return; }
      var b = e.target.closest && e.target.closest(".card-main");
      if (b) toggle(b.getAttribute("data-key"), e.shiftKey);
    });
    grid.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", function (e) {
      if (drag && e.pointerId === drag.id) { drag.at = -1; onPointerUp(e); }
    });
    // A native drag of the canvas would fight our own
    grid.addEventListener("dragstart", function (e) { e.preventDefault(); });

    document.addEventListener("dragenter", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      $("drag-veil").hidden = false;
    });
    document.addEventListener("dragover", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    document.addEventListener("dragleave", function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $("drag-veil").hidden = true;
    });
    document.addEventListener("drop", onDrop);
    window.addEventListener("beforeunload", function (e) {
      if (isBusy()) { e.preventDefault(); e.returnValue = ""; }
    });
    wireKeyboard();
  }

  function boot() {
    loadPrefs();
    applyI18n();
    inheritPalette();
    wire();
    watchPalette();
    renderAll();
    if (!window.PDFLib || !OPS) showToast(t("err.build"));
    try {
      var p = parentWin();
      if (p && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget("scanpdf");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
