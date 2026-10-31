/* ============================================================
   spreadsheet.js — orOS Spreadsheet / Λογιστικά φύλλα
   Wave 3 (formatting + ranges + clipboard + undo/redo +
           column resize + fixed dependent recalc)
   — built from scratch per OROS_BIBLE.md Part VII.
   Designed by Christos Koulaxizis · koulaxizis.gr
   ============================================================ */
(function(){
"use strict";

/* ===== SECTION 1: CONSTANTS · I18N · HELPERS ===== */

var SCRIPT_V = "";
var STORAGE_KEY = "oros-spreadsheet-data";
var ACTIVE_KEY = "oros-spreadsheet-active"; /* device-local, NEVER synced */
var DATA_VER = 2; /* stays 2: f (format) + cw (col widths) are additive,
                     riding whole-object LWW — no migration needed */
var ROWS = 100, COLS = 26;          /* a new sheet */
var MAX_ROWS = 10000, MAX_COLS = 104; /* A..CZ; = functions.js limits */
var VIEW_KEY = "oros-spreadsheet-view"; /* device-local filters, NEVER synced */
var KIT = window.OrosSheetKit;        /* sheetkit.js: Wave 2 pure logic */
var SI = window.OrosSheetImport;      /* sheetimport.js: file import + .orossheet pack */
var LANG = "en";

try {
  var pl = null;
  try { pl = window.parent && window.parent.orosLang; } catch (e) {}
  /* orosI18n (../i18n.js): the full language code, a pack language included */
  LANG = window.orosI18n ? window.orosI18n.lang() : (pl || localStorage.getItem("oros-lang") || "en");
} catch (e) {}
/* "el" / "en" for code that picks between the two inline languages */
var LANG2 = LANG === "el" ? "el" : "en";
/* the locale for numbers and dates */
function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }

(function () {
  var m = (document.currentScript && document.currentScript.src || "")
    .match(/[?&]v=([^&#]+)/);
  SCRIPT_V = m ? m[1] : "";
  document.documentElement.lang = LANG;
  console.log("spreadsheet.js v" + (SCRIPT_V || "?") + " boot [Wave 3]");
})();

var STRINGS = {
  en: {
    "title": "Spreadsheet",
    "sheet.default": "Sheet1",
    "sheet.last": "Can't delete the last sheet",
    "tab.confirm": "Tap ✕ again to delete this sheet",
    "csv.imported": "CSV imported as a new sheet",
    "tbl.made": "New sheet: {n}",
    "csv.exported": "CSV exported",
    "csv.empty": "Cannot export an empty sheet",
    "err.corrupt": "Corrupted data rescued — a fresh sheet was created",
    "undo.empty": "Nothing to undo",
    "redo.empty": "Nothing to redo",
    "clip.empty": "Clipboard is empty",
    "fmt.cleared": "Formatting cleared",
    "xl.imp":      "Import Excel / Calc / orOS (.xlsx, .ods, .xls, .orossheet)",
    "xl.exp":      "Export Excel / Calc / orOS",
    "bk.exp":      "orOS file (.orossheet)",
    "bk.open":     "Open a file (.xlsx, .ods, .xls, .orossheet)…",
    "bk.folder":   "Unzipped orOS folder…",
    "gd.from":     "From Google Sheets…",
    "gd.wait":     "Sign in to Google, then pick one spreadsheet.",
    "bk.newer":    "This file was made by a newer orOS. Update orOS to open it.",
    "xl.xlsx":     "Excel (.xlsx)",
    "xl.ods":      "LibreOffice Calc (.ods)",
    "xl.imported": "Imported — {n} sheet(s)",
    "xl.exported": "Exported as {f}",
    "xl.lib":      "Library not found (vendor/xlsx.full.min.js)",
    "xl.readerr":  "Could not read this file",
    "xl.trunc":    "Import capped at {r} rows × {c} columns",
    "err.save":    "Could not save: the browser storage is full.",
    "tb.undo": "Undo (Ctrl+Z)", "tb.redo": "Redo (Ctrl+Y)",
    "tb.copy": "Copy (Ctrl+C)", "tb.cut": "Cut (Ctrl+X)", "tb.paste": "Paste (Ctrl+V)",
    "tb.bold": "Bold (Ctrl+B)", "tb.ital": "Italic (Ctrl+I)", "tb.und": "Underline (Ctrl+U)",
    "tb.al.l": "Align left", "tb.al.c": "Align center", "tb.al.r": "Align right",
    "tb.nf": "Number format", "tb.nf.gen": "auto", "tb.col": "Text color",
    "tb.clr": "Clear formatting", "tb.bar": "Formatting",
    "csv.imp": "Import CSV", "csv.exp": "Export CSV",
    "sheet.add": "New sheet", "sheets": "Sheets",
    "tb.nf.date": "date",
    "tb.sortA": "Sort A to Z", "tb.sortZ": "Sort Z to A",
    "tb.filter": "Filter", "tb.more": "Rows, columns, freeze",
    "sort.done": "Sorted {n} rows by column {c}",
    "sort.hdr": "Row {r} stays on top as the heading",
    "sort.none": "Nothing to sort here",
    "flt.on": "Filter on the headings of row {r}",
    "flt.none": "Select a table to filter",
    "flt.hidden": "{n} rows hidden",
    "flt.clear": "Remove filter",
    "flt.col": "Filter this column",
    "flt.title": "Filter column {c}",
    "flt.contains": "Contains…",
    "flt.all": "Select all", "flt.nonesel": "Clear all",
    "flt.empty": "(empty)",
    "flt.more": "Only the first {n} values are listed",
    "flt.apply": "Apply", "flt.cancel": "Cancel",
    "flt.local": "Filters stay on this device only",
    "fz.top": "Freeze top row", "fz.rows": "Freeze rows 1–{n}",
    "fz.cols": "Freeze columns A–{c}", "fz.col1": "Freeze column A", "fz.off": "Unfreeze",
    "row.insA": "Insert row above", "row.insB": "Insert row below",
    "row.del1": "Delete row {a}", "row.del": "Delete rows {a}–{b}",
    "col.insL": "Insert column left", "col.insR": "Insert column right",
    "col.del1": "Delete column {a}", "col.del": "Delete columns {a}–{b}",
    "add.rows": "Add {n} rows at the end", "add.cols": "Add {n} columns",
    "max.dims": "A sheet holds at most {r} rows and {c} columns",
    "fx.list": "Functions", "fx.search": "Search functions",
    "menu.label": "Sheet menu",
    "menu.sendApp": "Send to an app…",
    "send.empty": "There is nothing to send: the selected cells are empty.",
    "tb.fmt": "Cell format: fill, borders, wrap, merge, rules", "tb.chart": "Insert chart",
    "fill.title": "Fill colour", "fill.none": "No fill",
    "bd.out": "Outline border", "bd.all": "All borders", "bd.bot": "Bottom border", "bd.none": "No borders",
    "wrap": "Wrap text", "va.t": "Align top", "va.m": "Align middle", "va.b": "Align bottom",
    "mg.all": "Merge cells", "mg.h": "Merge horizontally", "mg.v": "Merge vertically", "mg.un": "Unmerge",
    "mg.big": "A merge can span at most 500 rows",
    "mg.kept": "Merged: only the top-left value was kept",
    "cf.open": "Conditional formatting…", "cf.title": "Conditional formatting",
    "cf.none": "No rules on this sheet yet.", "cf.up": "Higher priority", "cf.edit": "Edit", "cf.del": "Delete rule",
    "cf.prio": "When rules overlap, the one higher in the list wins.",
    "cf.add": "Add rule", "cf.editt": "Edit rule", "cf.range": "Cells", "cf.kind": "Format cells if",
    "cf.val": "Value", "cf.and": "and", "cf.n": "How many",
    "cf.badrange": "Write a range like A1:B10",
    "cf.k.gt": "Greater than", "cf.k.lt": "Less than", "cf.k.bt": "Between", "cf.k.eq": "Equal to",
    "cf.k.tx": "Text contains", "cf.k.top": "Top", "cf.k.bot": "Bottom", "cf.k.dup": "Duplicate values",
    "cf.k.cs": "Colour scale", "cf.k.db": "Data bars",
    "cf.s.red": "Red fill", "cf.s.green": "Green fill", "cf.s.yellow": "Yellow fill", "cf.s.blue": "Blue fill",
    "cf.s.redtx": "Red text", "cf.s.greentx": "Green text", "cf.s.bold": "Bold",
    "cf.cs.rg": "Red → green", "cf.cs.gr": "Green → red", "cf.cs.wb": "Light → blue",
    "cf.cs.ryg": "Red → yellow → green", "cf.cs.gyr": "Green → yellow → red", "cf.cs.bwr": "Blue → light → red",
    "close": "Close", "save": "Save", "use.sel": "Selection",
    "fill.handle": "Drag to fill or continue a series (Ctrl: count up)",
    "fill.big": "Select fewer cells to fill (at most 20,000)",
    "clip.ext": "Nothing to paste. To paste from another app, press Ctrl+V, or allow the clipboard for this site.",
    "ch.empty": "No numbers in this range", "ch.series": "Series", "ch.other": "Other", "ch.label": "Chart",
    "ch.edit": "Edit chart", "ch.png": "Save as PNG", "ch.svg": "Save as SVG", "ch.del": "Delete chart",
    "ch.resize": "Drag to resize", "ch.deleted": "Chart deleted (Ctrl+Z brings it back)",
    "ch.nodata": "Select the data for the chart first",
    "ch.editt": "Edit chart", "ch.new": "New chart", "ch.type": "Type",
    "ch.t.col": "Column", "ch.t.bar": "Bar", "ch.t.line": "Line", "ch.t.pie": "Pie", "ch.t.donut": "Donut", "ch.t.scatter": "Scatter",
    "ch.src": "Data", "ch.by": "Series in", "ch.by.a": "Automatic", "ch.by.c": "Columns", "ch.by.r": "Rows",
    "ch.ttl": "Title", "ch.xl": "Horizontal axis title", "ch.yl": "Vertical axis title", "ch.lg": "Legend",
    "ch.cols": "Colours", "ch.col": "Colour of series", "ch.reset": "Default colours",
    "ch.saved": "Saved {f}", "ch.file": "chart", "ch.err": "Could not make the image",
    "rg.mode": "Select a range…", "rg.tap": "Tap the last cell of the range",
    "cf.k.fx": "Formula is true", "cf.k.ic": "Icon set", "cf.fx": "Formula", "cf.fx.ph": "=$B2>100",
    "cf.fx.hint": "Write it for the first cell of the range; it moves with each cell like a copied formula.",
    "cf.ic.ar": "Arrows", "cf.ic.dt": "Traffic lights",
    "ch.t.area": "Area", "ch.sk": "Stacked", "ch.cb": "Last series as a line", "ch.ln": "Trend line",
    "calc.open": "Calculation…", "calc.title": "Calculation", "calc.it": "Iterative calculation (allow circular references)",
    "calc.n": "Maximum iterations", "calc.d": "Maximum change",
    "pr.open": "Print or save as PDF…", "pr.title": "Print and PDF", "pr.what": "Print", "pr.all": "The whole sheet",
    "pr.sel": "The selection", "pr.paper": "Paper", "pr.or": "Orientation", "pr.p": "Portrait", "pr.l": "Landscape",
    "pr.fit": "Size", "pr.fit.w": "Fit to the page width", "pr.fit.p": "Fit on one page", "pr.fit.n": "Actual size",
    "pr.hr": "Repeat at the top of each page", "pr.hr.0": "No rows", "pr.hr.1": "Row 1", "pr.hr.n": "Rows 1 to {n}",
    "pr.gl": "Gridlines", "pr.pn": "Page numbers", "pr.ch": "Charts", "pr.pdf": "Save PDF", "pr.print": "Print",
    "pr.note": "Hidden (filtered) rows are left out. These settings stay on this device.",
    "pr.page": "Page {n} of {t}", "pr.busy": "Making the PDF…", "pr.empty": "There is nothing to print on this sheet",
    "pr.err": "The PDF could not be made",
    "calc.note": "Off: a formula that refers back to itself shows #CYC!. On: orOS repeats the calculation until no value changes by more than the maximum change.",
    "as.done": "The Assistant changed {n} things in {d} sheets.", "as.done1": "The Assistant changed {n} things in the sheet.",
    "as.done0": "Nothing needed changing.", "as.bad": "The Assistant's request could not be read. Nothing was changed.",
    "as.undone": "The Assistant's change was undone.", "as.changed": "These cells were changed since, so the Assistant's change was not undone.",
    "as.gone": "There is nothing left to undo."
  },
  el: {
    "title": "Λογιστικά φύλλα",
    "sheet.default": "Φύλλο1",
    "sheet.last": "Δεν μπορεί να διαγραφεί το τελευταίο φύλλο",
    "tab.confirm": "Πάτησε ξανά ✕ για διαγραφή του φύλλου",
    "csv.imported": "Το CSV εισήχθη ως νέο φύλλο",
    "tbl.made": "Νέο φύλλο: {n}",
    "csv.exported": "Το CSV εξήχθη",
    "csv.empty": "Δεν μπορεί να εξάγει κενό φύλλο",
    "err.corrupt": "Τα δεδομένα ήταν κατεστραμμένα — δημιουργήθηκε νέο φύλλο",
    "undo.empty": "Τίποτα προς αναίρεση",
    "redo.empty": "Τίποτα προς επανάληψη",
    "clip.empty": "Το πρόχειρο είναι κενό",
    "fmt.cleared": "Η μορφοποίηση καθαρίστηκε",
    "xl.imp":      "Εισαγωγή Excel / Calc / orOS (.xlsx, .ods, .xls, .orossheet)",
    "xl.exp":      "Εξαγωγή Excel / Calc / orOS",
    "bk.exp":      "Αρχείο orOS (.orossheet)",
    "bk.open":     "Άνοιγμα αρχείου (.xlsx, .ods, .xls, .orossheet)…",
    "bk.folder":   "Αποσυμπιεσμένος φάκελος orOS…",
    "gd.from":     "Από το Google Sheets…",
    "gd.wait":     "Συνδέσου στη Google και διάλεξε ένα υπολογιστικό φύλλο.",
    "bk.newer":    "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.",
    "xl.xlsx":     "Excel (.xlsx)",
    "xl.ods":      "LibreOffice Calc (.ods)",
    "xl.imported": "Εισήχθησαν — {n} φύλλα",
    "xl.exported": "Εξήχθη ως {f}",
    "xl.lib":      "Δεν βρέθηκε η βιβλιοθήκη (vendor/xlsx.full.min.js)",
    "xl.readerr":  "Αδύνατη η ανάγνωση του αρχείου",
    "xl.trunc":    "Η εισαγωγή περικόπηκε σε {r} γραμμές × {c} στήλες",
    "err.save":    "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε.",
    "tb.undo": "Αναίρεση (Ctrl+Z)", "tb.redo": "Επανάληψη (Ctrl+Y)",
    "tb.copy": "Αντιγραφή (Ctrl+C)", "tb.cut": "Αποκοπή (Ctrl+X)", "tb.paste": "Επικόλληση (Ctrl+V)",
    "tb.bold": "Έντονα (Ctrl+B)", "tb.ital": "Πλάγια (Ctrl+I)", "tb.und": "Υπογράμμιση (Ctrl+U)",
    "tb.al.l": "Στοίχιση αριστερά", "tb.al.c": "Στοίχιση στο κέντρο", "tb.al.r": "Στοίχιση δεξιά",
    "tb.nf": "Μορφή αριθμού", "tb.nf.gen": "αυτόματη", "tb.col": "Χρώμα κειμένου",
    "tb.clr": "Καθαρισμός μορφοποίησης", "tb.bar": "Μορφοποίηση",
    "csv.imp": "Εισαγωγή CSV", "csv.exp": "Εξαγωγή CSV",
    "sheet.add": "Νέο φύλλο", "sheets": "Φύλλα",
    "tb.nf.date": "ημερομηνία",
    "tb.sortA": "Ταξινόμηση από Α έως Ω", "tb.sortZ": "Ταξινόμηση από Ω έως Α",
    "tb.filter": "Φίλτρο", "tb.more": "Γραμμές, στήλες, πάγωμα",
    "sort.done": "Ταξινομήθηκαν {n} γραμμές με βάση τη στήλη {c}",
    "sort.hdr": "Η γραμμή {r} μένει πάνω ως επικεφαλίδα",
    "sort.none": "Δεν υπάρχει τίποτα για ταξινόμηση εδώ",
    "flt.on": "Φίλτρο στις επικεφαλίδες της γραμμής {r}",
    "flt.none": "Διάλεξε έναν πίνακα για φιλτράρισμα",
    "flt.hidden": "{n} γραμμές κρυμμένες",
    "flt.clear": "Αφαίρεση φίλτρου",
    "flt.col": "Φιλτράρισμα αυτής της στήλης",
    "flt.title": "Φίλτρο στήλης {c}",
    "flt.contains": "Περιέχει…",
    "flt.all": "Επιλογή όλων", "flt.nonesel": "Καμία επιλογή",
    "flt.empty": "(κενό)",
    "flt.more": "Εμφανίζονται μόνο οι πρώτες {n} τιμές",
    "flt.apply": "Εφαρμογή", "flt.cancel": "Άκυρο",
    "flt.local": "Τα φίλτρα μένουν μόνο σε αυτή τη συσκευή",
    "fz.top": "Πάγωμα πρώτης γραμμής", "fz.rows": "Πάγωμα γραμμών 1–{n}",
    "fz.cols": "Πάγωμα στηλών A–{c}", "fz.col1": "Πάγωμα στήλης A", "fz.off": "Ξεπάγωμα",
    "row.insA": "Εισαγωγή γραμμής από πάνω", "row.insB": "Εισαγωγή γραμμής από κάτω",
    "row.del1": "Διαγραφή γραμμής {a}", "row.del": "Διαγραφή γραμμών {a}–{b}",
    "col.insL": "Εισαγωγή στήλης αριστερά", "col.insR": "Εισαγωγή στήλης δεξιά",
    "col.del1": "Διαγραφή στήλης {a}", "col.del": "Διαγραφή στηλών {a}–{b}",
    "add.rows": "Προσθήκη {n} γραμμών στο τέλος", "add.cols": "Προσθήκη {n} στηλών",
    "max.dims": "Ένα φύλλο χωράει έως {r} γραμμές και {c} στήλες",
    "fx.list": "Συναρτήσεις", "fx.search": "Αναζήτηση συναρτήσεων",
    "menu.label": "Μενού φύλλου",
    "menu.sendApp": "Στείλε σε εφαρμογή…",
    "send.empty": "Δεν υπάρχει κάτι για αποστολή: τα επιλεγμένα κελιά είναι κενά.",
    "tb.fmt": "Μορφή κελιού: γέμισμα, περιγράμματα, αναδίπλωση, συγχώνευση, κανόνες", "tb.chart": "Εισαγωγή γραφήματος",
    "fill.title": "Χρώμα γεμίσματος", "fill.none": "Χωρίς γέμισμα",
    "bd.out": "Εξωτερικό περίγραμμα", "bd.all": "Όλα τα περιγράμματα", "bd.bot": "Κάτω περίγραμμα", "bd.none": "Χωρίς περιγράμματα",
    "wrap": "Αναδίπλωση κειμένου", "va.t": "Στοίχιση επάνω", "va.m": "Στοίχιση στη μέση", "va.b": "Στοίχιση κάτω",
    "mg.all": "Συγχώνευση κελιών", "mg.h": "Συγχώνευση οριζόντια", "mg.v": "Συγχώνευση κατακόρυφα", "mg.un": "Κατάργηση συγχώνευσης",
    "mg.big": "Μια συγχώνευση πιάνει έως 500 γραμμές",
    "mg.kept": "Συγχωνεύτηκαν: κρατήθηκε μόνο η τιμή πάνω αριστερά",
    "cf.open": "Μορφοποίηση υπό όρους…", "cf.title": "Μορφοποίηση υπό όρους",
    "cf.none": "Δεν υπάρχουν ακόμη κανόνες σε αυτό το φύλλο.", "cf.up": "Μεγαλύτερη προτεραιότητα", "cf.edit": "Επεξεργασία", "cf.del": "Διαγραφή κανόνα",
    "cf.prio": "Όταν οι κανόνες επικαλύπτονται, υπερισχύει αυτός που είναι πιο πάνω στη λίστα.",
    "cf.add": "Προσθήκη κανόνα", "cf.editt": "Επεξεργασία κανόνα", "cf.range": "Κελιά", "cf.kind": "Μορφοποίηση κελιών αν",
    "cf.val": "Τιμή", "cf.and": "και", "cf.n": "Πόσα",
    "cf.badrange": "Γράψε μια περιοχή όπως A1:B10",
    "cf.k.gt": "Μεγαλύτερο από", "cf.k.lt": "Μικρότερο από", "cf.k.bt": "Μεταξύ", "cf.k.eq": "Ίσο με",
    "cf.k.tx": "Το κείμενο περιέχει", "cf.k.top": "Τα μεγαλύτερα", "cf.k.bot": "Τα μικρότερα", "cf.k.dup": "Διπλότυπες τιμές",
    "cf.k.cs": "Χρωματική κλίμακα", "cf.k.db": "Γραμμές δεδομένων",
    "cf.s.red": "Κόκκινο γέμισμα", "cf.s.green": "Πράσινο γέμισμα", "cf.s.yellow": "Κίτρινο γέμισμα", "cf.s.blue": "Μπλε γέμισμα",
    "cf.s.redtx": "Κόκκινο κείμενο", "cf.s.greentx": "Πράσινο κείμενο", "cf.s.bold": "Έντονα",
    "cf.cs.rg": "Κόκκινο → πράσινο", "cf.cs.gr": "Πράσινο → κόκκινο", "cf.cs.wb": "Ανοιχτό → μπλε",
    "cf.cs.ryg": "Κόκκινο → κίτρινο → πράσινο", "cf.cs.gyr": "Πράσινο → κίτρινο → κόκκινο", "cf.cs.bwr": "Μπλε → ανοιχτό → κόκκινο",
    "close": "Κλείσιμο", "save": "Αποθήκευση", "use.sel": "Επιλογή",
    "fill.handle": "Σύρε για συμπλήρωση ή συνέχιση σειράς (Ctrl: αρίθμηση)",
    "fill.big": "Διάλεξε λιγότερα κελιά για συμπλήρωση (έως 20.000)",
    "clip.ext": "Τίποτα για επικόλληση. Για επικόλληση από άλλη εφαρμογή πάτησε Ctrl+V ή επίτρεψε το πρόχειρο σε αυτόν τον ιστότοπο.",
    "ch.empty": "Δεν υπάρχουν αριθμοί σε αυτή την περιοχή", "ch.series": "Σειρά", "ch.other": "Άλλα", "ch.label": "Γράφημα",
    "ch.edit": "Επεξεργασία γραφήματος", "ch.png": "Αποθήκευση ως PNG", "ch.svg": "Αποθήκευση ως SVG", "ch.del": "Διαγραφή γραφήματος",
    "ch.resize": "Σύρε για αλλαγή μεγέθους", "ch.deleted": "Το γράφημα διαγράφηκε (το Ctrl+Z το επαναφέρει)",
    "ch.nodata": "Διάλεξε πρώτα τα δεδομένα του γραφήματος",
    "ch.editt": "Επεξεργασία γραφήματος", "ch.new": "Νέο γράφημα", "ch.type": "Τύπος",
    "ch.t.col": "Στήλες", "ch.t.bar": "Ράβδοι", "ch.t.line": "Γραμμή", "ch.t.pie": "Πίτα", "ch.t.donut": "Δακτύλιος", "ch.t.scatter": "Διασπορά",
    "ch.src": "Δεδομένα", "ch.by": "Σειρές σε", "ch.by.a": "Αυτόματα", "ch.by.c": "Στήλες", "ch.by.r": "Γραμμές",
    "ch.ttl": "Τίτλος", "ch.xl": "Τίτλος οριζόντιου άξονα", "ch.yl": "Τίτλος κατακόρυφου άξονα", "ch.lg": "Υπόμνημα",
    "ch.cols": "Χρώματα", "ch.col": "Χρώμα σειράς", "ch.reset": "Προεπιλεγμένα χρώματα",
    "ch.saved": "Αποθηκεύτηκε: {f}", "ch.file": "γράφημα", "ch.err": "Δεν ήταν δυνατή η δημιουργία της εικόνας",
    "rg.mode": "Επιλογή περιοχής…", "rg.tap": "Πάτησε το τελευταίο κελί της περιοχής",
    "cf.k.fx": "Ο τύπος είναι αληθής", "cf.k.ic": "Σύνολο εικονιδίων", "cf.fx": "Τύπος", "cf.fx.ph": "=$B2>100",
    "cf.fx.hint": "Γράψ' τον για το πρώτο κελί της περιοχής· μετακινείται με κάθε κελί όπως ένας τύπος που αντιγράφεις.",
    "cf.ic.ar": "Βέλη", "cf.ic.dt": "Φανάρια",
    "ch.t.area": "Περιοχή", "ch.sk": "Στοιβαγμένο", "ch.cb": "Η τελευταία σειρά ως γραμμή", "ch.ln": "Γραμμή τάσης",
    "calc.open": "Υπολογισμός…", "calc.title": "Υπολογισμός", "calc.it": "Επαναληπτικός υπολογισμός (επιτρέπει κυκλικές αναφορές)",
    "calc.n": "Μέγιστες επαναλήψεις", "calc.d": "Μέγιστη μεταβολή",
    "pr.open": "Εκτύπωση ή αποθήκευση ως PDF…", "pr.title": "Εκτύπωση και PDF", "pr.what": "Εκτύπωση", "pr.all": "Όλο το φύλλο",
    "pr.sel": "Η επιλογή", "pr.paper": "Χαρτί", "pr.or": "Προσανατολισμός", "pr.p": "Κατακόρυφος", "pr.l": "Οριζόντιος",
    "pr.fit": "Μέγεθος", "pr.fit.w": "Προσαρμογή στο πλάτος της σελίδας", "pr.fit.p": "Προσαρμογή σε μία σελίδα", "pr.fit.n": "Πραγματικό μέγεθος",
    "pr.hr": "Επανάληψη στην κορυφή κάθε σελίδας", "pr.hr.0": "Καμία γραμμή", "pr.hr.1": "Γραμμή 1", "pr.hr.n": "Γραμμές 1 έως {n}",
    "pr.gl": "Γραμμές πλέγματος", "pr.pn": "Αριθμοί σελίδων", "pr.ch": "Γραφήματα", "pr.pdf": "Αποθήκευση PDF", "pr.print": "Εκτύπωση",
    "pr.note": "Οι κρυφές (φιλτραρισμένες) γραμμές παραλείπονται. Οι ρυθμίσεις μένουν σε αυτή τη συσκευή.",
    "pr.page": "Σελίδα {n} από {t}", "pr.busy": "Φτιάχνεται το PDF…", "pr.empty": "Δεν υπάρχει τίποτα για εκτύπωση σε αυτό το φύλλο",
    "pr.err": "Το PDF δεν μπόρεσε να γίνει",
    "calc.note": "Κλειστό: ένας τύπος που αναφέρεται στον εαυτό του δείχνει #CYC!. Ανοιχτό: το orOS επαναλαμβάνει τον υπολογισμό ώσπου καμία τιμή να μην αλλάζει περισσότερο από τη μέγιστη μεταβολή.",
    "as.done": "Ο Βοηθός άλλαξε {n} στοιχεία σε {d} φύλλα.", "as.done1": "Ο Βοηθός άλλαξε {n} στοιχεία στο φύλλο.",
    "as.done0": "Δεν χρειάστηκε καμία αλλαγή.", "as.bad": "Το αίτημα του Βοηθού δεν διαβάστηκε. Δεν άλλαξε τίποτα.",
    "as.undone": "Η αλλαγή του Βοηθού αναιρέθηκε.", "as.changed": "Τα κελιά άλλαξαν στο μεταξύ, γι' αυτό η αλλαγή του Βοηθού δεν αναιρέθηκε.",
    "as.gone": "Δεν έμεινε κάτι για αναίρεση."
  }
};

if (window.orosI18n) window.orosI18n.table(STRINGS, "spreadsheet", LANG);

function t(k) {
  var d = STRINGS[LANG] || STRINGS.en;
  return d.hasOwnProperty(k) ? d[k] :
    (STRINGS.en.hasOwnProperty(k) ? STRINGS.en[k] : k);
}

function $(id) { return document.getElementById(id); }

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function now() { return Date.now(); }

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function colName(n) { /* 0 -> "A", 25 -> "Z", 26 -> "AA" */
  var s = ""; n += 1;
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colFromName(s) { /* "A" -> 0, "AA" -> 26; -1 on garbage */
  var n = 0; s = String(s).toUpperCase();
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 65 || c > 90) return -1;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/* ===== SECTION 2: DATA MODEL ===== */

/* STATE SHAPE (Wave 3):
   { ver: 2,
     sheets: [{ id, name: null, bi: {en, el}, rows, cols, pos, mtime,
                cw: { "<colIdx>": pxWidth }, fz?: { r, c } }],
     cells:  { "<sheetId>|<r>|<c>":
               { v: "<raw input>", mtime, f?: { b?, i?, u?,
                 al?: "l|c|r", co?: "#hex", nf?: "gen|0|2|%|€|d" } } },
     deleted:{ "<sheetId>": ts, "<sheetId>|<r>|<c>": ts } }
   · f-only cells allowed: v === "" && f present (format on empty cell).
   · cw and fz (frozen rows / columns, only when set) ride the sheet
     entity → synced via sheet LWW. rows ≤ MAX_ROWS, cols ≤ MAX_COLS.
   · filters (oros-spreadsheet-view) are DEVICE-LOCAL, never synced.
   · actSID, CLIP, undoStack are DEVICE-LOCAL, never synced. */

var state = null;
var actSID = "s-main";
var SID = "s-main";

/* SS-2: the seed sheet is the same bytes on every device. It was
   built from t("sheet.default"), so a Greek device stored
   bi.en = "Φύλλο1": an English and a Greek device then held two
   different "untouched" seeds with mtime 0 and uploaded on every
   sync cycle, for ever. */
var SEED_BI = { en: "Sheet1", el: "\u03A6\u03CD\u03BB\u03BB\u03BF1" };

function blankState() {
  return {
    ver: DATA_VER,
    sheets: [{
      id: SID, name: null,
      bi: { en: SEED_BI.en, el: SEED_BI.el },
      rows: ROWS, cols: COLS, pos: 0, mtime: 0, cw: {}
    }],
    cells: {},
    deleted: {},
    charts: {},
    cf: {}
  };
}

/* sanitize format sub-object; null if nothing usable */
function sanitizeF(f) {
  if (!f || typeof f !== "object") return undefined;
  var out = {};
  if (f.b) out.b = 1;
  if (f.i) out.i = 1;
  if (f.u) out.u = 1;
  if (f.al === "l" || f.al === "c" || f.al === "r") out.al = f.al;
  if (typeof f.co === "string" && /^#[0-9a-fA-F]{6}$/.test(f.co)) out.co = f.co;
  if (f.nf === "gen" || f.nf === "0" || f.nf === "2" ||
      f.nf === "%" || f.nf === "\u20AC" || f.nf === "d") out.nf = f.nf;
  /* Wave 2: background, borders, wrap, vertical align, merge span */
  if (typeof f.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(f.bg)) out.bg = f.bg.toLowerCase();
  if (typeof f.bd === "string") {
    var bd = (f.bd.indexOf("t") >= 0 ? "t" : "") + (f.bd.indexOf("b") >= 0 ? "b" : "") +
             (f.bd.indexOf("l") >= 0 ? "l" : "") + (f.bd.indexOf("r") >= 0 ? "r" : "");
    if (bd) out.bd = bd;
  }
  if (f.wr) out.wr = 1;
  if (f.va === "t" || f.va === "m" || f.va === "b") out.va = f.va;
  var mr = parseInt(f.mr, 10), mc = parseInt(f.mc, 10);
  if (mr > 1 || mc > 1) {
    mr = Math.max(1, Math.min(isFinite(mr) ? mr : 1, MAX_ROWS)); mc = Math.max(1, Math.min(isFinite(mc) ? mc : 1, MAX_COLS));
    if (mr > 1) out.mr = mr;
    if (mc > 1) out.mc = mc;
  }
  var has = false;
  for (var kk in out) { has = true; break; }
  return has ? out : undefined;
}

/* frozen panes {r, c}: rows 0..r-1 and columns 0..c-1 stay in view;
   null when nothing is frozen (the field is then left out, so sheets
   without it keep their bytes) */
var FZ_MAX_R = 50, FZ_MAX_C = 26;
function normFz(fz, sh) {
  if (!fz || typeof fz !== "object") return null;
  var r = parseInt(fz.r, 10) || 0, c = parseInt(fz.c, 10) || 0;
  r = Math.max(0, Math.min(r, FZ_MAX_R, (sh && sh.rows ? sh.rows : MAX_ROWS) - 1));
  c = Math.max(0, Math.min(c, FZ_MAX_C, (sh && sh.cols ? sh.cols : MAX_COLS) - 1));
  return (r || c) ? { r: r, c: c } : null;
}

/* row heights {row: px}: only rows that differ from the default */
var RH_MIN = 18, RH_MAX = 400;
function normRh(rh) {
  var o = {}, has = false;
  if (!rh || typeof rh !== "object") return null;
  Object.keys(rh).sort(function (x, y) { return (+x) - (+y); }).forEach(function (k) {
    var h = rh[k];
    if (/^\d+$/.test(k) && +k < MAX_ROWS && typeof h === "number" && isFinite(h)) {
      o[k] = Math.max(RH_MIN, Math.min(RH_MAX, Math.round(h))); has = true;
    }
  });
  return has ? o : null;
}

/* charts and conditional-format rules: { id: record }, each record
   LWW by its mtime, deleted with a tombstone deleted["ch:"+id] /
   deleted["cf:"+id] (delete wins a tie). */
function normObjs(m, norm) {
  var o = {};
  if (!m || typeof m !== "object" || Array.isArray(m)) return o;
  Object.keys(m).sort().forEach(function (k) {
    var x = norm(m[k]);
    if (x && x.id === k) o[k] = x;
  });
  return o;
}

function normalizeState(st) {
  if (!st || typeof st !== "object") return null;
  st.ver = DATA_VER;
  if (!Array.isArray(st.sheets)) st.sheets = [];
  var i, sh;
  for (i = 0; i < st.sheets.length; i++) {
    sh = st.sheets[i];
    if (!sh || typeof sh !== "object" || typeof sh.id !== "string") {
      st.sheets.splice(i, 1); i--; continue;
    }
    sh.rows = Math.min(Math.max(parseInt(sh.rows, 10) || ROWS, 1), MAX_ROWS);
    sh.cols = Math.min(Math.max(parseInt(sh.cols, 10) || COLS, 1), MAX_COLS);
    var fz = normFz(sh.fz, sh);
    if (fz) sh.fz = fz; else delete sh.fz;
    var rh = normRh(sh.rh);
    if (rh) sh.rh = rh; else delete sh.rh;
    if (typeof sh.mtime !== "number" || !isFinite(sh.mtime)) sh.mtime = 0;
    if (sh.pos === undefined || typeof sh.pos !== "number") sh.pos = 0;
    if (sh.cw === undefined || typeof sh.cw !== "object" || !sh.cw) sh.cw = {};
    if (sh.name !== null && sh.name !== undefined &&
        typeof sh.name !== "string") sh.name = String(sh.name);
    /* SS-2: an untouched seed is repaired to the shared seed bytes */
    if (sh.id === SID && sh.mtime === 0 && (sh.name === null || sh.name === undefined))
      sh.bi = { en: SEED_BI.en, el: SEED_BI.el };
  }
  if (!st.sheets.length) st.sheets = [blankState().sheets[0]];
  if (!st.cells || typeof st.cells !== "object") st.cells = {};
  if (!st.deleted || typeof st.deleted !== "object") st.deleted = {};
  st.charts = normObjs(st.charts, KIT.normChart);
  st.cf = normObjs(st.cf, KIT.normCf);
  var calc = KIT.normCalc(st.calc);
  if (calc) st.calc = calc; else delete st.calc;

  var k;
  for (k in st.cells) {
    var cel = st.cells[k];
    var keep = false;
    if (cel && typeof cel === "object" && typeof cel.v === "string" &&
        typeof cel.mtime === "number" && isFinite(cel.mtime) &&
        /^[\w-]+\|\d+\|\d+$/.test(k)) {
      if (cel.v !== "" || cel.f) {
        keep = true;
        var sf = sanitizeF(cel.f);
        if (sf) cel.f = sf; else delete cel.f;
        if (cel.fm !== undefined && (!cel.fm || typeof cel.fm !== "object")) delete cel.fm;
      }
    }
    if (!keep) delete st.cells[k];
  }
  for (k in st.deleted) {
    if (typeof st.deleted[k] !== "number" || !isFinite(st.deleted[k]))
      delete st.deleted[k];
  }
  return st;
}

function tombFor(del, key) {
  var ts = del[key];
  if (ts && typeof ts === "number" && isFinite(ts)) return ts;
  var sid = key.split("|")[0];
  var stTs = del[sid];
  return (stTs && typeof stTs === "number" && isFinite(stTs)) ? stTs : 0;
}

/* the newer of a cell's own tombstone and its sheet's */
function cellTomb(del, key) {
  var a = del[key], b = del[key.split("|")[0]];
  a = (typeof a === "number" && isFinite(a)) ? a : 0;
  b = (typeof b === "number" && isFinite(b)) ? b : 0;
  return Math.max(a, b);
}

function cellKey(sid, r, c) { return sid + "|" + r + "|" + c; }

/* ===== SECTION 2b: MERGE ENGINE =====
   SS-1 one canonical form (canonSS) for the stored copy, the slice
   getter and the merge output (R26): sheets by (pos, id), cells and
   tombstones by key, fixed key order.
   SS-5 a cell carries one stamp per field, fm{ v, f }: the value
   (with Excel's cached result cv) and the format merge separately,
   so formatting a range on one device no longer reverts values typed
   in it on another. A cell whose mtime is newer than both stamps
   was last written by a device on the previous spreadsheet.js (it
   replaces the whole cell and drops fm): mtime then speaks for both
   fields. A field older than the cell's tombstone is cleared.
   Sheets stay whole-entity LWW (tie -> smaller JSON, both sides). A
   deleted sheet comes back when the other device wrote cells in it
   after the deletion ("a newer edit resurrects", R17). */

function newerObj(a, b) {
  if (!a) return b;
  if (!b) return a;
  var am = a.mtime || 0, bm = b.mtime || 0;
  if (am > bm) return a;
  if (bm > am) return b;
  var aj = JSON.stringify(a), bj = JSON.stringify(b);
  return (aj < bj) ? a : b;
}

function stampNum(n) {
  return (typeof n === "number" && isFinite(n) && n > 0) ? n : 0;
}

/* field stamps of a cell: { v, f } */
function cellStamps(cel) {
  var m = stampNum(cel.mtime);
  if (cel.fm && typeof cel.fm === "object") {
    var sv = stampNum(cel.fm.v), sf = stampNum(cel.fm.f);
    if (m <= Math.max(sv, sf)) return { v: sv, f: sf };
  }
  return { v: m, f: m };        /* written by the previous version */
}

function canonF(f) {
  var sf = sanitizeF(f);
  if (!sf) return undefined;
  var o = {};
  /* Wave 2 fields come last: a copy from an older device (which
     strips them) is then a prefix, and the copy with them wins a tie */
  ["b", "i", "u", "al", "co", "nf", "bg", "bd", "wr", "va", "mr", "mc"].forEach(function (k) {
    if (sf[k] !== undefined) o[k] = sf[k];
  });
  return o;
}

/* canonical cell, or null when nothing is left */
function canonCell(cel, tomb) {
  if (!cel || typeof cel !== "object" || typeof cel.v !== "string") return null;
  var st = cellStamps(cel);
  var m = Math.max(stampNum(cel.mtime), st.v, st.f);
  if (tomb && m <= tomb) return null;
  var v = cel.v, f = canonF(cel.f), cv = (typeof cel.cv === "string") ? cel.cv : undefined;
  if (tomb && st.v <= tomb) { v = ""; cv = undefined; }
  if (tomb && st.f <= tomb) f = undefined;
  if (v === "" && !f) return null;
  var o = { v: v, mtime: m };
  if (f) o.f = f;
  if (cv !== undefined && cv !== "") o.cv = cv;
  o.fm = { v: st.v, f: st.f };
  return o;
}

function mergeCell(a, b) {
  if (!a) return b;
  if (!b) return a;
  var sa = cellStamps(a), sb = cellStamps(b);
  var pv, pf;
  if (sa.v !== sb.v) pv = sa.v > sb.v ? a : b;
  else pv = JSON.stringify([a.v, a.cv || ""]) <= JSON.stringify([b.v, b.cv || ""]) ? a : b;
  if (sa.f !== sb.f) pf = sa.f > sb.f ? a : b;
  else pf = JSON.stringify(canonF(a.f) || {}) <= JSON.stringify(canonF(b.f) || {}) ? a : b;
  var o = { v: pv.v, mtime: Math.max(stampNum(a.mtime), stampNum(b.mtime)) };
  var f = canonF(pf.f);
  if (f) o.f = f;
  if (typeof pv.cv === "string") o.cv = pv.cv;
  o.fm = { v: Math.max(sa.v, sb.v), f: Math.max(sa.f, sb.f) };
  return o;
}

function canonSheet(sh) {
  var o = { id: sh.id, name: (typeof sh.name === "string") ? sh.name : null };
  if (o.name === null && sh.bi && typeof sh.bi === "object")
    o.bi = { en: String(sh.bi.en || ""), el: String(sh.bi.el || "") };
  o.rows = sh.rows; o.cols = sh.cols; o.pos = sh.pos; o.mtime = sh.mtime;
  var cw = {};
  if (sh.cw && typeof sh.cw === "object") {
    Object.keys(sh.cw).sort(function (x, y) { return (+x) - (+y); }).forEach(function (k) {
      var w = sh.cw[k];
      if (/^\d+$/.test(k) && typeof w === "number" && isFinite(w) && w > 0) cw[k] = w;
    });
  }
  o.cw = cw;
  var fz = normFz(sh.fz, sh);
  if (fz) o.fz = fz;
  var rh = normRh(sh.rh);
  if (rh) o.rh = rh;
  return o;
}

var TOMB_KEEP = 30 * 24 * 60 * 60 * 1000;

/* Canonical copy (never mutates its input): normalized, tombstones
   pruned 30 days before the NEWEST tombstone (data time, never the
   device clock) except the seed sheet's (SS-3: a deleted Sheet1 must
   not come back when a new device joins), sheets by (pos, id), cells
   and tombstones by key. */
function canonSS(st) {
  st = normalizeState(st ? clone(st) : null) || blankState();
  var del = {}, maxTs = 0, k;
  for (k in st.deleted) if (st.deleted[k] > maxTs) maxTs = st.deleted[k];
  var cutoff = maxTs - TOMB_KEEP;
  Object.keys(st.deleted).sort().forEach(function (key) {
    if (st.deleted[key] >= cutoff || key === SID) del[key] = st.deleted[key];
  });
  var cells = {}, liveSids = {};
  Object.keys(st.cells).sort().forEach(function (key) {
    var c = canonCell(st.cells[key], cellTomb(del, key));
    if (c) { cells[key] = c; liveSids[key.split("|")[0]] = 1; }
  });
  /* a sheet older than its tombstone is gone, unless cells written
     after the deletion keep it (same rule as mergeState) */
  var alive = st.sheets.filter(function (sh) {
    var tomb = del[sh.id] || 0;
    return !(tomb && (sh.mtime || 0) <= tomb && !liveSids[sh.id]);
  });
  if (!alive.length) alive = blankState().sheets;   /* never zero sheets */
  var sheets = alive.map(canonSheet).sort(function (a, b) {
    var d = (a.pos || 0) - (b.pos || 0);
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });
  var out = { ver: DATA_VER, sheets: sheets, cells: cells, deleted: del };
  /* charts / rules: only while their sheet lives and newer than their
     tombstone; the keys are left out when empty, so a workbook without
     them keeps its exact bytes */
  var sids = {};
  sheets.forEach(function (sh) { sids[sh.id] = 1; });
  [["charts", "ch:"], ["cf", "cf:"]].forEach(function (p) {
    var m = st[p[0]], o = {}, any = false;
    Object.keys(m).sort().forEach(function (id) {
      var x = m[id], tomb = del[p[1] + id] || 0;
      if (!sids[x.sid] || (tomb && x.mtime <= tomb)) return;
      o[id] = x; any = true;
    });
    if (any) out[p[0]] = o;
  });
  /* the calculation setting (wave 4.2), only once someone set it */
  if (st.calc) out.calc = st.calc;
  return out;
}

function mergeState(local, remote) {
  if (!local || typeof local !== "object") local = blankState();
  if (!remote || typeof remote !== "object") return canonSS(local);
  local = canonSS(local); remote = canonSS(remote);

  /* 1. DELETED UNION (pruned by canonSS at the end, same rule as the getter) */
  var mergedDel = {}, k;
  for (k in local.deleted) mergedDel[k] = local.deleted[k];
  for (k in remote.deleted)
    mergedDel[k] = Math.max(remote.deleted[k], mergedDel[k] || 0);

  /* 2. Cells — sparse union, per-field merge, tombstone-filtered */
  var mergedCells = {}, liveSids = {};
  var keys = {};
  for (k in local.cells) keys[k] = 1;
  for (k in remote.cells) keys[k] = 1;
  for (k in keys) {
    var mc = mergeCell(local.cells[k], remote.cells[k]);
    if (mc && mc.v === "" && !canonF(mc.f)) {
      /* both fields ended empty (value cleared here, format there):
         the cell is gone — say so with a tombstone, or the side that
         still holds an older copy would bring it back */
      mergedDel[k] = Math.max(mergedDel[k] || 0, stampNum(mc.mtime));
      continue;
    }
    var cel = canonCell(mc, cellTomb(mergedDel, k));
    if (!cel) continue;
    mergedCells[k] = cel;
    liveSids[k.split("|")[0]] = 1;
  }

  /* 3. Sheets — union, LWW by mtime, tombstone-filtered */
  var sheetsMap = {}, i, sh, src;
  for (src = 0; src < 2; src++) {
    var arr = src ? remote.sheets : local.sheets;
    for (i = 0; i < arr.length; i++) {
      sh = arr[i];
      sheetsMap[sh.id] = newerObj(sheetsMap[sh.id], sh);
    }
  }
  var mergedSheets = [];
  for (k in sheetsMap) {
    sh = sheetsMap[k];
    var tomb = tombFor(mergedDel, sh.id);
    if (tomb && (sh.mtime || 0) <= tomb && !liveSids[sh.id]) continue;
    mergedSheets.push(sh);
  }

  /* 4. Charts and rules — union, LWW by mtime (canonSS drops the
     ones older than their tombstone or whose sheet is gone) */
  function unionObjs(a, b) {
    var o = {}, id;
    for (id in a || {}) o[id] = a[id];
    for (id in b || {}) o[id] = newerObj(o[id], b[id]);
    return o;
  }
  return canonSS({ ver: DATA_VER, sheets: mergedSheets, cells: mergedCells,
                   deleted: mergedDel, charts: unionObjs(local.charts, remote.charts),
                   cf: unionObjs(local.cf, remote.cf), calc: newerObj(local.calc, remote.calc) });
}

/* ===== SECTION 2c: STORAGE FUNNEL ===== */

var saveTimer = null;

function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  dirtyFlag = false;       /* saved state */
  saveTimer = setTimeout(saveNow, 400);
}

var saveFailNoted = false;
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(canonSS(state)));  /* SS-1: stored = getter */
  } catch (e) {
    if (!saveFailNoted) { saveFailNoted = true; notifyTransient(t("err.save")); }  /* R30 */
  }
}

function loadState() {
  var raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  var st = null;
  if (raw) {
    try { st = JSON.parse(raw); } catch (e) { st = null; }
    if (!st) {
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e2) {}
    }
  }
  state = normalizeState(st);
  if (!state) {
    state = blankState();
    if (raw) setTimeout(function(){ notifyTransient(t("err.corrupt")); }, 400);
  }
  try {
    var loadedAct = localStorage.getItem(ACTIVE_KEY);
    if (loadedAct) {
      var exists = false, ix;
      for (ix = 0; ix < state.sheets.length; ix++)
        if (state.sheets[ix] && state.sheets[ix].id === loadedAct) { exists = true; break; }
      if (exists && !state.deleted[loadedAct]) actSID = loadedAct;
    }
  } catch (e) {}
  if (!getActiveSheet()) { actSID = state.sheets[0].id; }
  saveActive();
}

function saveActive() {
  try { localStorage.setItem(ACTIVE_KEY, actSID); } catch (e) {}
}

/* ===== SECTION 3: STATE · RAW OPS · UNDO · SELECTION ===== */

var selR = 0, selC = 0;        /* cursor */
var selAR = 0, selAC = 0;      /* selection ANCHOR (range start) */
var editing = false, editingR = -1, editingC = -1;
var editInput = null;
var editStartVal = "";   /* SS-4: value the open editor started from */
var fxFocused = false;
var fxStartVal = "";     /* SS-4: value the formula bar showed on focus */
var dirtyFlag = false;

/* selection rectangle (normalized, inclusive) */
function selTop()    { return Math.min(selR, selAR); }
function selBottom() { return Math.max(selR, selAR); }
function selLeft()   { return Math.min(selC, selAC); }
function selRight()  { return Math.max(selC, selAC); }
function selIsRange() { return selR !== selAR || selC !== selAC; }

function collapseSel(r, c) {
  if (r === undefined) { r = selR; c = selC; }
  selR = selAR = r; selC = selAC = c;
}

function getActiveSheet() {
  for (var i = 0; i < state.sheets.length; i++) {
    if (state.sheets[i] && state.sheets[i].id === actSID)
      return state.sheets[i];
  }
  return state.sheets[0] || null;
}

function getSheetById(id) {
  for (var i = 0; i < state.sheets.length; i++) {
    if (state.sheets[i] && state.sheets[i].id === id)
      return state.sheets[i];
  }
  return null;
}

function findSheetByName(name) {
  /* Keep Greek letters (α-ω, Α-Ω) + ASCII word chars */
  var nl = String(name).toLowerCase().replace(/[^a-z0-9\u03b1-\u03c9]/g, "");
  for (var i = 0; i < state.sheets.length; i++) {
    var sh = state.sheets[i];
    if (!sh) continue;
    var n = sh.name || sh.bi[LANG] || sh.bi.en || "";
    if (String(n).toLowerCase().replace(/[^a-z0-9\u03b1-\u03c9]/g, "") === nl) return sh;
  }
  return null;
}

function getCell(r, c) {
  var key = cellKey(actSID, r, c);
  return state.cells[key] || null;
}

/* --- evaluation cache invalidation (Wave 3 recalc fix) --- */
var EVAL_DIRTY = true;
function invalidateEval() { EVAL_DIRTY = true; }

/* --- raw mutations (no undo, no UI) — used by undo/paste/sync --- */
/* SS-5: only the field that really changes gets a new stamp (R27);
   a value that is set again unchanged stamps nothing. */
function rawSet(sid, r, c, v, f) {
  var key = cellKey(sid, r, c);
  var cur = state.cells[key];
  var t0 = now();
  var nv = String(v), sf = canonF(f);
  var st = cur ? cellStamps(cur) : { v: 0, f: 0 };
  var vChanged = !cur || cur.v !== nv;
  var fChanged = JSON.stringify(cur ? (canonF(cur.f) || null) : null) !== JSON.stringify(sf || null);
  if (cur && !vChanged && !fChanged) return;
  var o = { v: nv, mtime: t0 };
  if (sf) o.f = sf;
  if (cur && !vChanged && typeof cur.cv === "string") o.cv = cur.cv;
  o.fm = { v: vChanged ? t0 : st.v, f: fChanged ? t0 : st.f };
  delete state.deleted[key];
  state.cells[key] = o;
}

function rawDel(sid, r, c) {
  var key = cellKey(sid, r, c);
  delete state.cells[key];
  state.deleted[key] = now();
}

/* cell content snapshot for undo entries: {v, f}|null (null = absent) */
function snapCell(sid, r, c) {
  var cel = state.cells[cellKey(sid, r, c)];
  if (!cel) return null;
  var o = { v: cel.v };
  if (cel.f) o.f = clone(cel.f);
  return o;
}

/* --- UNDO/REDO (device-local, op-based, batch entries) ---
   entry = [ {key, before:snap|null, after:snap|null}, ... ]
   undo restores `before`, redo reapplies `after`; every apply
   stamps a FRESH mtime so sync stays LWW-consistent.          */
var undoStack = [], redoStack = [], UNDO_MAX = 100;

function pushUndo(entries) {
  if (!entries || !entries.length) return;
  undoStack.push(entries);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0; /* new edit kills the redo branch */
  updateToolbar();
}

function applyEntries(entries, useAfter) {
  var e, i, dimsChanged = false;
  for (i = 0; i < entries.length; i++) {
    e = entries[i];
    var target = useAfter ? e.after : e.before;
    if (e.obj) { applyObj(e.obj, e.id, target); continue; }   /* a chart or a rule */
    if (e.dim) {
      /* insert / delete rows or columns: the sheet's size and widths */
      var sh = getSheetById(e.sid);
      if (sh && target) {
        sh.rows = target.rows; sh.cols = target.cols; sh.cw = clone(target.cw);
        if (target.fz) sh.fz = clone(target.fz); else delete sh.fz;
        if (target.rh) sh.rh = clone(target.rh); else delete sh.rh;
        sh.mtime = now();
        dimsChanged = true;
      }
      continue;
    }
    var pk = e.key.split("|");
    var r = parseInt(pk[1], 10), c = parseInt(pk[2], 10);
    if (target === null) {
      rawDel(pk[0], r, c);
    } else {
      rawSet(pk[0], r, c, target.v, target.f);
    }
  }
  invalidateEval();
  markDirty();
  queueSave();
  if (dimsChanged) buildGrid();
  CFR = null;
  renderGrid();
  renderSelection();
}

function doUndo() {
  if (editing) cancelEdit();
  var entries = undoStack.pop();
  if (!entries) { notifyTransient(t("undo.empty")); return; }
  redoStack.push(entries);
  applyEntries(entries, false);
}

function doRedo() {
  if (editing) cancelEdit();
  var entries = redoStack.pop();
  if (!entries) { notifyTransient(t("redo.empty")); return; }
  undoStack.push(entries);
  applyEntries(entries, true);
}

/* --- undo-capturing single-cell edit ops (UI path) --- */
function setCell(r, c, rawValue) {
  var key = cellKey(actSID, r, c);
  var before = snapCell(actSID, r, c);
  var after = { v: String(rawValue) };
  var cur = state.cells[key];
  if (cur && cur.f) after.f = clone(cur.f); /* keep format on retype */
  rawSet(actSID, r, c, rawValue, after.f);
  invalidateEval();
  markDirty();
  pushUndo([{ key: key, before: before, after: snapCell(actSID, r, c) }]);
}

function deleteCell(r, c) {
  var key = cellKey(actSID, r, c);
  var before = snapCell(actSID, r, c);
  if (!before) return;
  rawDel(actSID, r, c);
  invalidateEval();
  markDirty();
  pushUndo([{ key: key, before: before, after: null }]);
}

/* delete a whole selection rect (single undo entry) */
function deleteSelection() {
  var entries = [], r, c;
  var top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
  for (r = top; r <= bot; r++)
    for (c = lef; c <= rig; c++) {
      var key = cellKey(actSID, r, c);
      var before = snapCell(actSID, r, c);
      if (before) {
        rawDel(actSID, r, c);
        entries.push({ key: key, before: before, after: null });
      }
    }
  if (!entries.length) return;
  invalidateEval();
  markDirty();
  pushUndo(entries);
  queueSave();
  renderGrid();
}

function markDirty() {
  dirtyFlag = true;
  updateStatus();
  queueSave();
  if (syncApi && syncApi.dirty) syncApi.dirty();
}

function updateStatus() {
  var st = $("st-note");
  if (st) st.textContent = dirtyFlag ? "*" : "";
}

// orosDialog lives in the parent shell (same-origin iframe).
// Standalone PWA mode -> null -> caller uses local fallback.
function dialogHost() {
  try {
    return window.orosDialog || window.parent.orosDialog || null;
  } catch (e) { return null; }
}

/* ===== SECTION 3b: FORMULA ENGINE (functions.js · OrosSheetFx) =====
   The tokenizer, parser, evaluator and the function library live in
   functions.js (pure, Node-tested). This is the glue: how the engine
   reads cells, finds sheets by name and the used extent of a sheet
   (whole-column references A:A stop there). */

var FX = window.OrosSheetFx;
var EXTENT = {}, FCELLS = null;

function cellRaw(sid, r, c) {
  var cel = state.cells[cellKey(sid, r, c)];
  return cel ? cel.v : "";
}

function sheetExtent(sid) {
  if (!Object.prototype.hasOwnProperty.call(EXTENT, sid)) {
    var rows = 0, cols = 0, pref = sid + "|", k, p;
    for (k in state.cells) {
      if (k.lastIndexOf(pref, 0) !== 0) continue;
      p = k.split("|");
      if (+p[1] + 1 > rows) rows = +p[1] + 1;
      if (+p[2] + 1 > cols) cols = +p[2] + 1;
    }
    EXTENT[sid] = { rows: rows, cols: cols };
  }
  return EXTENT[sid];
}

function formulaCells() {
  if (!FCELLS) {
    FCELLS = [];
    for (var k in state.cells) {
      var cel = state.cells[k];
      if (cel && cel.v.charAt(0) === "=") {
        var p = k.split("|");
        FCELLS.push([p[0], +p[1], +p[2]]);
      }
    }
    FCELLS.sort(function (a, b) {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] - b[1]) || (a[2] - b[2]);
    });
  }
  return FCELLS;
}

var ENG = FX.engine({
  raw: cellRaw,
  cached: function (sid, r, c) {
    var cel = state.cells[cellKey(sid, r, c)];
    return cel ? cel.cv : undefined;
  },
  sheetId: function (name) {
    var sh = findSheetByName(name);
    return sh ? sh.id : null;
  },
  extent: sheetExtent,
  formulaCells: formulaCells,
  lang: LANG,
  now: function () { return Date.now(); }
});

function resetEval() {
  ENG.reset(); EXTENT = {}; FCELLS = null;
  /* iterative calculation: settle the circular references now, so every
     cell then reads its final value from the cache */
  ENG.setIter(state && state.calc);
  if (ENG.iter) { try { ENG.settle(); } catch (e) { console.error("[SS] iterative calculation:", e); } }
}
function evalCell(sid, r, c) { return ENG.value(sid, r, c); }
function isError(v) { return FX.isErr(v); }

/* --- NUMBER FORMAT rendering (display layer only) --- */
function fmtDisplay(v, nf) {
  if (FX.isErr(v)) return v;
  if (typeof v === "number" && isFinite(v) && nf && nf !== "gen") {
    if (nf === "0") return String(Math.round(v));
    if (nf === "2") return v.toFixed(2);
    if (nf === "%") return (v * 100).toFixed(1) + "%";
    if (nf === "€") return v.toFixed(2) + " €";
    if (nf === "d" || nf === "dt") {
      var ds = FX.dateStr(v, LANG, nf === "dt");
      if (ds !== null) return ds;
    }
  }
  return FX.display(v, LANG);
}

/* what a cell shows: { s: text, k: "" | "num" | "err" | "bool" }.
   Typed values show as typed (so 007 stays 007; a leading ' is
   hidden); a number format applies to numbers. Formulas show their
   result; TODAY(), DATE()… show as a date unless a format is set. */
function cellView(r, c) {
  var key = r + "," + c;
  if (Object.prototype.hasOwnProperty.call(DISP, key)) return DISP[key];
  var cel = getCell(r, c), out, nf = cel && cel.f && cel.f.nf;
  if (!cel || cel.v === "") out = { s: "", k: "" };
  else if (cel.v.charAt(0) === "=") {
    var res = evalCell(actSID, r, c);
    if (!nf) nf = FX.autoDate(cel.v);
    out = { s: fmtDisplay(res, nf),
            k: FX.isErr(res) ? "err" : typeof res === "number" ? "num" : typeof res === "boolean" ? "bool" : "" };
  } else {
    var lv = FX.literal(cel.v);
    if (typeof lv === "number") out = { s: nf ? fmtDisplay(lv, nf) : cel.v, k: "num" };
    else out = { s: cel.v.charAt(0) === "'" ? cel.v.slice(1) : cel.v,
                 k: FX.isErr(lv) ? "err" : typeof lv === "boolean" ? "bool" : "" };
  }
  DISP[key] = out;
  return out;
}
function displayVal(r, c) { return cellView(r, c).s; }

/* ===== SECTION 3b2: CLIPBOARD (internal, ref-shifting) ===== */

/* CLIP = { sid, w, h, cells: [[{v,f}|null,...],...] } — device-local */
var CLIP = null;

function copySelection(cut) {
  if (editing) cancelEdit();
  var top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
  var cells = [], r, c;
  for (r = top; r <= bot; r++) {
    var rowArr = [];
    for (c = lef; c <= rig; c++) {
      var sn = snapCell(actSID, r, c);
      rowArr.push(sn ? { v: sn.v, f: sn.f ? clone(sn.f) : undefined } : null);
    }
    cells.push(rowArr);
  }
    CLIP = { sid: actSID, w: rig - lef + 1, h: bot - top + 1, cells: cells,
           originR: top, originC: lef };

  if (cut) {
    var entries = [];
    for (r = top; r <= bot; r++)
      for (c = lef; c <= rig; c++) {
        var before = snapCell(actSID, r, c);
        if (before) {
          rawDel(actSID, r, c);
          entries.push({ key: cellKey(actSID, r, c), before: before, after: null });
        }
      }
    if (entries.length) {
      invalidateEval();
      markDirty();
      pushUndo(entries);
    }
    renderGrid();
    renderSelection();
  }
}

/* Shift relative refs in "=FORMULA" by (dr, dc) (functions.js): the
   text around the references stays as typed; $A$1 parts stay; refs
   that would leave the sheet become #REF!. Sheet!A1 refs move too. */
function shiftFormula(formula, dr, dc) {
  return FX.shiftFormula(formula, dr, dc, MAX_ROWS, MAX_COLS);
}

function pasteClipboard() {
  if (editing) cancelEdit();
  if (!CLIP) { notifyTransient(t("clip.empty")); return; }
  var sheet = getActiveSheet();
  if (!sheet) return;

  var top = selTop(), lef = selLeft();
  var entries = [], r, c;

  /* a paste past the last row / column grows the sheet (up to the caps) */
  var needR = Math.min(top + CLIP.h, MAX_ROWS), needC = Math.min(lef + CLIP.w, MAX_COLS);
  if (needR > sheet.rows || needC > sheet.cols) {
    sheet.rows = Math.max(sheet.rows, needR);
    sheet.cols = Math.max(sheet.cols, needC);
    sheet.mtime = now();
    markDirty();
    buildGrid();
  }

  for (r = 0; r < CLIP.h; r++) {
    for (c = 0; c < CLIP.w; c++) {
      var tr = top + r, tc = lef + c;
      if (tr >= sheet.rows || tc >= sheet.cols) continue; /* clip overflow */
      var src = CLIP.cells[r][c];
      var key = cellKey(actSID, tr, tc);
      var before = snapCell(actSID, tr, tc);
      if (!src) {
        /* source empty — clear target */
        if (before) {
          rawDel(actSID, tr, tc);
          entries.push({ key: key, before: before, after: null });
        }
        continue;
      }
      var nv = src.v;
      /* shift relative refs by the paste offset from source origin */
      if (nv.charAt(0) === "=" && CLIP.originR !== undefined) {
        nv = shiftFormula(nv, top - CLIP.originR, lef - CLIP.originC);
      }
      var after = { v: nv };
      if (src.f) after.f = clone(src.f);
      rawSet(actSID, tr, tc, nv, after.f);
      entries.push({ key: key, before: before,
        after: { v: nv, f: src.f ? clone(src.f) : undefined } });
    }
  }

  if (entries.length) {
    invalidateEval();
    markDirty();
    pushUndo(entries);
  }
  /* selection expands to pasted rect */
  selR = top; selC = lef;
  selAR = Math.min(top + CLIP.h - 1, sheet.rows - 1);
  selAC = Math.min(lef + CLIP.w - 1, sheet.cols - 1);
  renderGrid();
  renderSelection();
}

/* ===== SECTION 3c: RENDER (virtual rows · frozen panes · filter) =====
   Only the rows in view (plus BUF on each side) exist in the DOM; two
   spacer rows stand in for the rest, so a 10,000-row sheet costs about
   what a 100-row one did. Every row has the same height (ROWH, from
   the CSS), so a row's place is index × ROWH. Columns are all built.
   Frozen rows are always rendered first, sticky under the header;
   frozen columns are sticky after the row numbers.
   VIS = the rows that are shown (the device-local filter hides some),
   in order; POS[r] = index of row r in VIS, -1 when hidden; VIS[0 …
   SL0-1] are the frozen rows, the rest scroll. */

var cellRefs = {};      /* r -> [td, …]  (rendered rows only) */
var rowEls = {};        /* r -> tr */
var rowHeads = {};      /* r -> th.rowh */
var lastPainted = {};   /* r -> [painted text marker, …] */
var colHeads = [];
var headRow = null;
var DISP = {};
var VIS = [], POS = null, SL0 = 0;
var FR = 0, FC = 0;     /* frozen rows / columns in effect */
var ROWH = 28, HEADH = 28, ROWHEADW = 44, DEFW = 88;
var COLLEFT = [];       /* left edge of each column inside the table */
var WIN0 = 0, WIN1 = 0; /* rendered scrolling rows: VIS[SL0+WIN0 … SL0+WIN1-1] */
var BUILT = "";         /* layout the grid was built for (sync rebuild check) */
var tbodyEl = null, spTop = null, spBot = null;
var BUF = 30;
/* Wave 2: rows may have their own height (sheet.rh). OFF[k] = top of
   the k-th scrolling row inside the scrolling part, OFF[n] = its
   height; FROFF[i] = top of frozen row i under the header, FRH = the
   frozen rows' height. */
var OFF = new Float64Array(1), FROFF = [0], FRH = 0;

function layoutSig(sh) {
  return JSON.stringify([sh.id, sh.rows, sh.cols, sh.cw || {}, sh.fz || null, sh.rh || null]);
}
function rowH(sheet, r) { return (sheet.rh && sheet.rh[r]) || ROWH; }
function computeOffsets(sheet) {
  var i, n = VIS.length - SL0;
  FROFF = [0];
  for (i = 0; i < SL0; i++) FROFF.push(FROFF[i] + rowH(sheet, VIS[i]));
  FRH = FROFF[SL0];
  OFF = new Float64Array(n + 1);
  for (i = 0; i < n; i++) OFF[i + 1] = OFF[i] + rowH(sheet, VIS[SL0 + i]);
}
/* the scrolling row index at y (inside the scrolling part) */
function offIdx(y) {
  var lo = 0, hi = OFF.length - 1;
  while (lo < hi) { var m = (lo + hi + 1) >> 1; if (OFF[m] <= y) lo = m; else hi = m - 1; }
  return lo;
}
/* the y of row r inside the grid's content box (top of the table = 0) */
function rowTopAbs(r) {
  if (!POS || !POS.length) return HEADH;
  r = Math.max(0, Math.min(r, POS.length - 1));
  var k = POS[r];
  while (k < 0 && r < POS.length - 1) k = POS[++r];
  if (k < 0) return HEADH + FRH + OFF[OFF.length - 1];
  return k < SL0 ? HEADH + FROFF[k] : HEADH + FRH + OFF[k - SL0];
}
/* the cell at content point (x, y) for charts: { r, c, dx, dy } */
function cellAtPoint(x, y) {
  var sheet = getActiveSheet(), c = 0;
  while (c + 1 < COLLEFT.length && COLLEFT[c + 1] <= x) c++;
  var r = 0, yy = y - HEADH, k;
  if (yy < FRH) { for (k = 0; k + 1 < FROFF.length && FROFF[k + 1] <= yy; k++) {} r = VIS[Math.min(k, SL0 - 1)] || 0; }
  else { k = Math.min(offIdx(yy - FRH), Math.max(0, VIS.length - SL0 - 1)); r = VIS[SL0 + k] || 0; }
  void sheet;
  return { r: r, c: c, dx: Math.max(0, Math.round(x - COLLEFT[c])), dy: Math.max(0, Math.round(y - rowTopAbs(r))) };
}
function colW(sheet, c) { return (sheet.cw && sheet.cw[c]) || DEFW; }

function computeVis(sheet) {
  var hidden = filterHidden(sheet), r;
  VIS = []; POS = new Int32Array(sheet.rows);
  for (r = 0; r < sheet.rows; r++) {
    if (hidden && hidden[r]) { POS[r] = -1; continue; }
    POS[r] = VIS.length; VIS.push(r);
  }
  var fz = normFz(sheet.fz, sheet) || { r: 0, c: 0 };
  FR = fz.r; FC = fz.c;
  SL0 = 0;
  while (SL0 < VIS.length && VIS[SL0] < FR) SL0++;
}

function mkSpacer() {
  var tr = document.createElement("tr");
  tr.className = "sp";
  var td = document.createElement("td");
  td.colSpan = (getActiveSheet().cols || 1) + 1;
  tr.appendChild(td);
  tr.style.display = "none";
  return tr;
}
function setSpacer(tr, h) {
  if (h <= 0) { tr.style.display = "none"; return; }
  tr.style.display = "";
  tr.firstChild.style.height = h + "px";
}

function inSelRows(r) { return r >= selTop() && r <= selBottom(); }

function createRow(r, fi) {
  var sheet = getActiveSheet(), c;
  var tr = document.createElement("tr");
  tr.dataset.r = r;
  var th = document.createElement("th");
  th.className = "rowh" + (inSelRows(r) ? " hl" : "");
  th.textContent = String(r + 1);
  tr.appendChild(th);
  var tds = [], lp = [];
  for (c = 0; c < sheet.cols; c++) {
    var td = document.createElement("td");
    if (sheet.cw[c]) { td.style.width = sheet.cw[c] + "px"; td.style.minWidth = sheet.cw[c] + "px"; }
    if (c < FC) td.style.left = COLLEFT[c] + "px";
    tr.appendChild(td);
    tds.push(td); lp.push(null);
  }
  var rh = rowH(sheet, r);
  if (rh !== ROWH) {
    th.style.height = rh + "px";
    for (c = 0; c < tds.length; c++) tds[c].style.height = rh + "px";
  }
  if (fi >= 0) {
    tr.className = "fzr" + (fi === SL0 - 1 ? " fzl" : "");
    var top = (HEADH + FROFF[fi]) + "px";
    th.style.top = top;
    for (c = 0; c < tds.length; c++) tds[c].style.top = top;
  }
  rowEls[r] = tr; rowHeads[r] = th; cellRefs[r] = tds; lastPainted[r] = lp;
  for (c = 0; c < tds.length; c++) paintCell(r, c);
  return tr;
}

function dropRow(r) {
  var tr = rowEls[r];
  if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
  delete rowEls[r]; delete cellRefs[r]; delete rowHeads[r]; delete lastPainted[r];
}

function buildGrid() {
  var tbl = $("grid");
  if (!tbl) { console.error("[SS] CRITICAL: #grid element missing!"); return; }
  var sheet = getActiveSheet();
  if (!sheet) { console.error("[SS] CRITICAL: no active sheet!"); return; }
  if (typeof sheet.rows !== "number" || sheet.rows < 1) sheet.rows = ROWS;
  if (typeof sheet.cols !== "number" || sheet.cols < 1) sheet.cols = COLS;
  if (!sheet.cw || typeof sheet.cw !== "object") sheet.cw = {};

  var r, c, th, i;
  tbl.innerHTML = "";
  cellRefs = {}; rowEls = {}; rowHeads = {}; lastPainted = {};
  if (EVAL_DIRTY) { resetEval(); EVAL_DIRTY = false; }
  resetDisp();
  computeVis(sheet);

  var thead = document.createElement("thead");
  headRow = document.createElement("tr");
  th = document.createElement("th");
  th.className = "corner";
  headRow.appendChild(th);
  colHeads = [th];
  for (c = 0; c < sheet.cols; c++) {
    th = document.createElement("th");
    th.textContent = colName(c);
    if (sheet.cw[c]) th.style.width = sheet.cw[c] + "px";
    if (c < FC) th.className = "fzc" + (c === FC - 1 ? " fzcl" : "");
    headRow.appendChild(th);
    colHeads.push(th);
  }
  thead.appendChild(headRow);
  tbl.appendChild(thead);

  tbodyEl = document.createElement("tbody");
  tbl.appendChild(tbodyEl);

  /* measure: header height, row height (CSS decides: 28 / 34 px), row-number width */
  var probe = document.createElement("tr");
  probe.innerHTML = '<th class="rowh">1</th><td></td>';
  tbodyEl.appendChild(probe);
  ROWH = probe.offsetHeight || ROWH;
  ROWHEADW = colHeads[0].offsetWidth || ROWHEADW;
  HEADH = headRow.offsetHeight || HEADH;
  tbodyEl.removeChild(probe);
  COLLEFT = [];
  var x = ROWHEADW;
  for (c = 0; c < sheet.cols; c++) { COLLEFT.push(x); x += colW(sheet, c); }
  for (c = 0; c < FC; c++) colHeads[c + 1].style.left = COLLEFT[c] + "px";
  computeOffsets(sheet);
  MG_TOUCHED = [];

  for (i = 0; i < SL0; i++) tbodyEl.appendChild(createRow(VIS[i], i));
  spTop = mkSpacer(); spBot = mkSpacer();
  tbodyEl.appendChild(spTop);
  tbodyEl.appendChild(spBot);
  WIN0 = WIN1 = 0;
  renderWindow(true);
  initColResize();
  BUILT = layoutSig(sheet);
  fixMerges();
  scheduleOverlay();
  void r;
}

/* put the rows in view (± BUF) in the DOM; force = rebuild the window */
function renderWindow(force) {
  if (!tbodyEl || !spTop) return;
  var wrap = $("grid-wrap");
  var n = VIS.length - SL0;
  var st = wrap ? wrap.scrollTop : 0, ch = (wrap && wrap.clientHeight) || 800;
  var v0 = Math.min(n, offIdx(st));
  var v1 = Math.min(n, offIdx(st + ch) + 2);
  if (!force && v0 >= WIN0 && v1 <= WIN1) return;
  var w0 = Math.max(0, v0 - BUF), w1 = Math.min(n, v1 + BUF);
  /* an open editor whose row would leave the DOM is committed first */
  if (editing && editingR >= 0 && POS && POS[editingR] >= SL0) {
    var ek = POS[editingR] - SL0;
    if (ek < w0 || ek >= w1) commitEdit(0, 0);
  }
  var key, r, k;
  for (key in rowEls) {
    r = +key;
    if (POS[r] >= 0 && POS[r] < SL0) continue;          /* frozen */
    k = POS[r] - SL0;
    if (POS[r] < 0 || k < w0 || k >= w1) dropRow(r);
  }
  if (EVAL_DIRTY) { resetEval(); EVAL_DIRTY = false; resetDisp(); }
  for (k = w0; k < w1; k++) {
    r = VIS[SL0 + k];
    var tr = rowEls[r] || createRow(r, -1);
    tbodyEl.insertBefore(tr, spBot);
  }
  setSpacer(spTop, OFF[w0]);
  setSpacer(spBot, OFF[n] - OFF[w1]);
  WIN0 = w0; WIN1 = w1;
  fixMerges();
}

var winRaf = 0;
function onGridScroll() {
  if (winRaf) return;
  winRaf = (window.requestAnimationFrame || setTimeout)(function () {
    winRaf = 0;
    renderWindow(false);
    placeFillHandle();
  });
}

/* scroll so the cell (r, c) is in view, outside the frozen panes */
function ensureVisible(r, c) {
  var wrap = $("grid-wrap");
  if (!wrap || !POS) return;
  var sheet = getActiveSheet();
  if (r >= 0 && r < POS.length && POS[r] >= SL0) {
    var k = POS[r] - SL0, y = OFF[k], h = OFF[k + 1] - OFF[k], top = wrap.scrollTop;
    var avail = wrap.clientHeight - HEADH - FRH;
    if (y < top) wrap.scrollTop = y;
    else if (y + h > top + avail) wrap.scrollTop = y + h - Math.max(h, avail);
  }
  if (c >= FC && c < COLLEFT.length) {
    var x = COLLEFT[c], w = colW(sheet, c);
    var frozenW = FC ? COLLEFT[FC - 1] + colW(sheet, FC - 1) : ROWHEADW;
    var left = wrap.scrollLeft, cw = wrap.clientWidth;
    if (x < left + frozenW) wrap.scrollLeft = Math.max(0, x - frozenW);
    else if (x + w > left + cw) wrap.scrollLeft = x + w - cw;
  }
  renderWindow(false);
}

function paintCell(r, c) {
  if (editing && editingR === r && editingC === c) return;
  var tds = cellRefs[r], td = tds && tds[c];
  if (!td) return;
  var cel = getCell(r, c), f = cel && cel.f;
  var view = cellView(r, c), disp = view.s;
  var fh = filterHead(r, c);
  var cf = cfAt(r, c);
  var wr = !!(f && f.wr), wh = wr ? spanHeight(r, c) : 0;
  var ic = cf && cf.ic ? cf.ic + cf.icCo : "";
  var mark = disp + "\u0001" + (fh || "") + "\u0001" + wh + "\u0001" + ic;
  if (lastPainted[r][c] !== mark) {
    lastPainted[r][c] = mark;
    if (wr) {
      td.textContent = "";
      var wd = document.createElement("div");
      wd.className = "wrp";
      wd.style.maxHeight = Math.max(12, wh - 2) + "px";
      wd.textContent = disp;
      td.appendChild(wd);
    } else td.textContent = disp;
    if (ic) {
      var icn = document.createElement("span");
      icn.className = "cfi";
      icn.setAttribute("aria-hidden", "true");
      icn.style.color = cf.icCo;
      icn.textContent = cf.ic;
      td.insertBefore(icn, td.firstChild);
    }
    if (fh) {
      var b = document.createElement("span");
      b.className = "fbtn" + (fh === 2 ? " on" : "");
      b.setAttribute("role", "button");
      b.title = t("flt.col");
      b.setAttribute("aria-label", t("flt.col"));
      b.innerHTML = IC_FILTER;
      td.appendChild(b);
    }
  }

  /* class rebuild: base (num/err/bool) + format + panes + selection */
  var cls = view.k;
  if (fh) cls += " fhd";
  if (c < FC) cls += " fzc" + (c === FC - 1 ? " fzcl" : "");
  if (f) {
    if (f.b) cls += " fb";
    if (f.i) cls += " fi";
    if (f.u) cls += " fu";
    if (f.al === "c") cls += " fa-c";
    else if (f.al === "r") cls += " fa-r";
    else if (f.al === "l") cls += " fa-l";
    if (f.wr) cls += " fw";
    if (f.va) cls += " va-" + f.va;
  }
  if (cf && cf.b && !(f && f.b)) cls += " fb";
  var bg = (cf && cf.bg) || (f && f.bg) || "";
  var co = (cf && cf.co) || (f && f.co) || (bg ? KIT.inkOn(bg) : "");
  var bar = cf && cf.bar !== undefined ? cf : null;
  if (bg) cls += " hbg";
  if (bar) cls += " hbar";
  var inRange = (r >= selTop() && r <= selBottom() &&
                 c >= selLeft() && c <= selRight());
  if (inRange && !(r === selR && c === selC) && selIsRange()) cls += " rangesel";
  if (r === selR && c === selC) cls += " sel";

  if (td.dataset.cls !== cls) {
    td.dataset.cls = cls;
    td.className = cls;
  }
  var sh = borderShadow(r, c, f, bg);
  var sig = bg + "|" + co + "|" + (bar ? bar.bar + bar.barCo : "") + "|" + sh;
  if (td._sty !== sig) {
    td._sty = sig;
    if (bg) td.style.setProperty("--cbg", bg); else td.style.removeProperty("--cbg");
    td.style.color = co;
    if (bar) {
      var pc = (bar.bar * 100).toFixed(1) + "%", bc = KIT.rgba(bar.barCo, 0.55);
      td.style.setProperty("--cbar", "linear-gradient(90deg," + bc + " " + pc + ",transparent " + pc + ")");
    } else td.style.removeProperty("--cbar");
    td.style.boxShadow = sh;
  }
}

/* borders: own bottom / right always; own top / left only when the
   neighbour does not already draw that line (no double lines) */
function borderShadow(r, c, f, bg) {
  var bd = f && f.bd;
  if (!bd) return "";
  var out = [], C = bg ? KIT.inkOn(bg) : "var(--text)";
  if (bd.indexOf("t") >= 0) { var up = r > 0 && getCell(r - 1, c); if (!(up && up.f && up.f.bd && up.f.bd.indexOf("b") >= 0)) out.push("inset 0 1px 0 0 " + C); }
  if (bd.indexOf("b") >= 0) out.push("inset 0 -1px 0 0 " + C);
  if (bd.indexOf("l") >= 0) { var lf = c > 0 && getCell(r, c - 1); if (!(lf && lf.f && lf.f.bd && lf.f.bd.indexOf("r") >= 0)) out.push("inset 1px 0 0 0 " + C); }
  if (bd.indexOf("r") >= 0) out.push("inset -1px 0 0 0 " + C);
  return out.join(",");
}

function renderGrid() {
  if (EVAL_DIRTY) { resetEval(); EVAL_DIRTY = false; }
  resetDisp();
  var key, c, row;
  for (key in cellRefs) {
    row = cellRefs[key];
    for (c = 0; c < row.length; c++) paintCell(+key, c);
  }
  fixMerges();
  updateFilterStatus();
  scheduleOverlay();
}

function refreshCell(r, c) { resetDisp(); paintCell(r, c); }

function renderSelection() {
  var i, key;
  for (key in rowHeads) rowHeads[key].classList.remove("hl");
  for (i = 0; i < colHeads.length; i++) colHeads[i].classList.remove("hl");

  var prev = document.querySelectorAll("#grid td.sel, #grid td.rangesel");
  for (i = 0; i < prev.length; i++)
    prev[i].classList.remove("sel", "rangesel");

  if (selR < 0 || selC < 0) return;
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (td) td.classList.add("sel");
  if (rowHeads[selR]) rowHeads[selR].classList.add("hl");
  if (colHeads[selC + 1]) colHeads[selC + 1].classList.add("hl");
  if (selIsRange()) {
    var c, top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
    for (key in cellRefs) {
      var r = +key;
      if (r < top || r > bot) continue;
      for (c = lef; c <= rig; c++) {
        if (r === selR && c === selC) continue;
        var rt = cellRefs[key][c];
        if (rt) rt.classList.add("rangesel");
      }
      if (rowHeads[key]) rowHeads[key].classList.add("hl");
    }
    for (i = lef; i <= rig; i++) if (colHeads[i + 1]) colHeads[i + 1].classList.add("hl");
  }

  var refTxt = selIsRange() ? colName(selLeft()) + (selTop() + 1) + ":" + colName(selRight()) + (selBottom() + 1)
    : colName(selC) + (selR + 1);
  $("st-sel").textContent = refTxt;
  $("fx-ref").textContent = colName(selC) + (selR + 1);
  var cel = getCell(selR, selC);
  var fxv = cel ? cel.v : "";
  var fxi = $("fx-input");
  if (!fxFocused) {
    fxi.value = fxv;
  } else if (fxi.value === fxStartVal && fxv !== fxStartVal) {
    /* SS-4: the formula bar is focused but untouched: follow the data */
    fxi.value = fxv; fxStartVal = fxv;
  }
  updateToolbar();
  placeFillHandle();
}

/* ===== SECTION 3d: EDITING FLOW ===== */

function beginEdit(initialText) {
  if (editing) return;
  collapseSel(); /* typing replaces the range — single-cell edit */
  ensureVisible(selR, selC);
  var td = cellRefs[selR] && cellRefs[selR][selC];
  if (!td) return;
  editing = true; editingR = selR; editingC = selC;

  editInput = document.createElement("input");
  editInput.type = "text";
  editInput.autocomplete = "off";
  editInput.spellcheck = false;
  var startCel = getCell(selR, selC);
  editStartVal = startCel ? startCel.v : "";
  editInput.value =
    (initialText !== undefined && initialText !== null)
      ? initialText : editStartVal;
  td.textContent = "";
  td.className = "cell-editor" + (selC < FC ? " fzc" : "");
  td.appendChild(editInput);
  editInput.focus();
  placeFillHandle();
  if (initialText !== undefined) editInput.setSelectionRange(
    editInput.value.length, editInput.value.length);

  editInput.addEventListener("keydown", function (e) {
    if (fxHelpKey(e, editInput)) { e.stopPropagation(); return; }
    if (e.key === "Enter") { e.preventDefault(); commitEdit(1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, 1); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    e.stopPropagation();
  });
  editInput.addEventListener("input", function () {
    $("fx-input").value = editInput.value;
    fxHelpUpdate(editInput);
  });
  editInput.addEventListener("blur", function () { setTimeout(fxHelpHideSoon, 150); });
}

function endEditDom() {
  var td = cellRefs[editingR] && cellRefs[editingR][editingC];
  if (td && editInput && td.contains(editInput)) td.removeChild(editInput);
  editInput = null;
  editing = false;
  fxHelpHide();
  if (lastPainted[editingR]) lastPainted[editingR][editingC] = null;
  if (td) delete td.dataset.cls;
  editingR = -1; editingC = -1;
  placeFillHandle();
}

function commitEdit(dr, dc) {
  if (!editing) return;
  var raw = editInput ? editInput.value : "";
  var val = raw.replace(/^\s+|\s+$/g, "");
  var r = editingR, c = editingC;
  /* SS-4: an editor whose text was never changed writes nothing (it
     could hold a value another device has replaced meanwhile) */
  if (raw === editStartVal) {
    /* untouched */
  } else if (val === "") {
    if (getCell(r, c)) deleteCell(r, c);
  } else {
    setCell(r, c, val);
  }
  var hadFocus = editInput && document.activeElement === editInput;
  endEditDom();
  /* the editor left the DOM: keep the keyboard on the grid */
  if (hadFocus) try { $("grid-wrap").focus({ preventScroll: true }); } catch (e) {}
  queueSave();
  invalidateEval();
  renderGrid();
  if (dr || dc) navigate(dr, dc);
  renderSelection();
}

function cancelEdit() {
  if (!editing) return;
  var r = editingR, c = editingC;
  endEditDom();
  refreshCell(r, c);
  renderSelection();
  $("grid-wrap").focus();
}

/* the shown row `steps` visible rows away from r (filtered rows are skipped) */
function stepRow(r, steps) {
  if (!VIS.length) return r;
  var k = POS && r < POS.length ? POS[r] : -1;
  if (k < 0) {   /* r is hidden: start from the next shown row */
    k = 0;
    while (k < VIS.length - 1 && VIS[k] < r) k++;
    if (steps > 0) steps--;
  }
  k = Math.min(Math.max(k + steps, 0), VIS.length - 1);
  return VIS[k];
}

function navigate(dr, dc, extend) {
  var sheet = getActiveSheet();
  if (!sheet) return;
  var nr = dr ? stepRow(selR, dr) : selR;
  var nc = Math.min(Math.max(selC + dc, 0), sheet.cols - 1);
  if (extend) {
    /* Shift+Arrow: extend the range from the anchor */
    selR = nr; selC = nc;
    ensureVisible(selR, selC);
    renderSelection();
    return;
  }
  /* merged cells: step over the merge, land on its top-left cell */
  var cm = mergeAt(selR, selC), m = mergeAt(nr, nc);
  if (m && cm === m) {
    if (dr > 0) nr = stepRow(m.r2, 1); else if (dr < 0) nr = stepRow(m.r, -1);
    if (dc > 0) nc = Math.min(m.c2 + 1, sheet.cols - 1); else if (dc < 0) nc = Math.max(m.c - 1, 0);
    m = mergeAt(nr, nc);
    if (m === cm) { nr = selR; nc = selC; m = null; }
  }
  if (m) { nr = m.r; nc = m.c; }
  if (nr === selR && nc === selC && !selIsRange()) return;
  collapseSel(nr, nc);
  ensureVisible(selR, selC);
  renderSelection();
}

function clearSelected() {
  if (editing) return;
  if (selIsRange()) { deleteSelection(); return; }
  if (getCell(selR, selC)) {
    deleteCell(selR, selC);
    queueSave();
    invalidateEval();
    renderGrid();
  }
}

/* ===== SECTION 3d2: FORMAT OPS (undoable, whole-selection) ===== */

function applyFormatToSelection(mut) {
  if (editing) cancelEdit();
  var entries = [], r, c, changed = false;
  /* a whole column / row selected: format the used part only (an
     empty cell with a format is a stored, synced cell) */
  var ext = sheetExtent(actSID), sh = getActiveSheet();
  var bot = selBottom(), rig = selRight();
  if (selTop() === 0 && bot === sh.rows - 1 && bot - selTop() > 200) bot = Math.max(selR, ext.rows - 1);
  if (selLeft() === 0 && rig === sh.cols - 1 && rig - selLeft() > 26) rig = Math.max(selC, ext.cols - 1);
  for (r = selTop(); r <= bot; r++)
    for (c = selLeft(); c <= rig; c++) {
      var key = cellKey(actSID, r, c);
      var before = snapCell(actSID, r, c);
      var cel = state.cells[key];
      var f = cel && cel.f ? clone(cel.f) : {};
      var res = mut(f, r, c, bot, rig); /* returns {v?, f} or null to delete cell */
      if (!res) continue;
      if (res.remove) {
        if (before) {
          rawDel(actSID, r, c);
          entries.push({ key: key, before: before, after: null });
          changed = true;
        }
        continue;
      }
      var nv = res.v !== undefined ? res.v : (cel ? cel.v : "");
      var sf = sanitizeF(res.f);
      if (!sf && nv === "") {
        if (before) {
          rawDel(actSID, r, c);
          entries.push({ key: key, before: before, after: null });
          changed = true;
        }
        continue;
      }
      rawSet(actSID, r, c, nv, sf);
      entries.push({ key: key, before: before,
        after: snapCell(actSID, r, c) });
      changed = true;
    }
  if (changed) {
    markDirty();
    pushUndo(entries);
    invalidateEval();
    renderGrid();
    renderSelection();
  }
}

function fmtToggle(field) {
  return function (f) {
    f[field] = f[field] ? 0 : 1;
    return { f: f };
  };
}

function fmtAlign(al) {
  return function (f) {
    if (f.al === al) delete f.al; else f.al = al;
    return { f: f };
  };
}

function fmtColor(co) {
  return function (f) {
    if (f.co === co) delete f.co; else f.co = co;
    return { f: f };
  };
}

function fmtNumFormat(nf) {
  return function (f) {
    if (!nf || f.nf === nf || (nf === "gen")) delete f.nf; else f.nf = nf;
    return { f: f };
  };
}

function clearFormat() {
  return function (f) { return { f: {} }; };
}

/* SWATCHES — 8 preset colors from OS palette space */
var SWATCHES = ["#c8a96e","#d9bd88","#87cf3e","#e0a44c",
                "#e06c75","#a78bfa","#7dd3fc","#e8e4dc"];

function toggleSwatchPopover() {
  var pop = $("swatches");
  if (!pop) return;
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.innerHTML = "";
  var btn = $("tb-col");
  var br = btn.getBoundingClientRect();
  var i;
  for (i = 0; i < SWATCHES.length; i++) {
    (function (co) {
      var sw = document.createElement("div");
      sw.className = "sw";
      sw.style.background = co;
      sw.title = co;
      sw.addEventListener("click", function () {
        applyFormatToSelection(fmtColor(co));
        pop.hidden = true;
      });
      pop.appendChild(sw);
    })(SWATCHES[i]);
  }
  pop.hidden = false;
  /* SS-9: kept inside the viewport (the color button sits at the far
     end of a scrolled toolbar on a phone) */
  var pw = pop.offsetWidth;
  pop.style.left = Math.max(4, Math.min(br.left, window.innerWidth - pw - 4)) + "px";
  pop.style.top = (br.bottom + 4) + "px";
}

/* --- toolbar state reflection --- */
function updateToolbar() {
  var u = $("tb-undo"), rd = $("tb-redo");
  if (u) u.disabled = undoStack.length === 0;
  if (rd) rd.disabled = redoStack.length === 0;

  var cel = getCell(selR, selC);
  var f = cel && cel.f;
  var on = function (id, flag) {
    var el = $(id);
    if (el) { if (flag) el.classList.add("on"); else el.classList.remove("on"); }
  };
  on("tb-bold", !!(f && f.b));
  on("tb-ital", !!(f && f.i));
  on("tb-und",  !!(f && f.u));
  on("tb-al-l", !f || !f.al || f.al === "l");
  on("tb-al-c", !!(f && f.al === "c"));
  on("tb-al-r", !!(f && f.al === "r"));
  var nf = $("tb-nf");
  if (nf) nf.value = (f && f.nf) ? f.nf : "gen";
}

/* ===== SECTION 3d3: COLUMN RESIZE (mouse only) ===== */

var rsDrag = null, rsStartX = 0, rsStartW = 0, rsCol = -1;

function initColResize() {
  /* per-header handlers only — <th> elements are discarded with the
     table rebuild, so they cannot leak. Document-level handlers are
     attached ONCE (initResizeDocHandlers, called from wire()). */
  var i;
  for (i = 1; i < colHeads.length; i++) {
    (function (th, ci) {
      th.addEventListener("mousemove", function (e) {
        if (rsDrag) return;
        var rect = th.getBoundingClientRect();
        if (e.clientX > rect.right - 6) th.classList.add("colresize");
        else th.classList.remove("colresize");
      });
      th.addEventListener("mousedown", function (e) {
        var rect = th.getBoundingClientRect();
        if (e.clientX <= rect.right - 6) return; /* not on the edge */
        e.preventDefault();
        rsDrag = th; rsStartX = e.clientX;
        rsStartW = rect.width; rsCol = ci - 1;
      });
    })(colHeads[i], i);
  }
}

function initResizeDocHandlers() {
  /* attached exactly once for the app lifetime */
  document.addEventListener("mousemove", function (e) {
    if (rhDrag) { rhDrag.h = Math.max(RH_MIN, Math.min(RH_MAX, rhDrag.h0 + (e.clientY - rhDrag.y0))); setRowHLive(rhDrag.r, rhDrag.h); return; }
    if (!rsDrag) return;
    setColWLive(rsCol, Math.max(40, Math.min(400, rsStartW + (e.clientX - rsStartX))));
  });
  document.addEventListener("mouseup", function () {
    if (rhDrag) { var d = rhDrag; rhDrag = null; commitRowH(d.r, d.h); return; }
    if (!rsDrag) return;
    rsDrag = null;
    commitColW();   /* persist via sheet entity LWW */
  });
}

/* ===== SECTION 3h: SORT · FILTER · FREEZE · ROWS / COLUMNS · MENUS =====
   Sort and Insert / Delete write cells like any edit (per-cell stamps,
   one Undo step). Freeze is the sheet's fz field (synced like column
   widths). Filters are a view of this device only: oros-spreadsheet-view
   { <sheetId>: { flt: { top, l, r, cols: { <c>: { q, ex: [...] } } } } },
   never in the sync slice. */

/* which grid cell / header an element belongs to */
function gridPos(el) {
  var cell = el;
  while (cell && cell.tagName !== "TD" && cell.tagName !== "TH") {
    if (cell.id === "grid") return null;
    cell = cell.parentElement;
  }
  if (!cell) return null;
  var tr = cell.parentElement;
  if (!tr || tr.classList.contains("sp")) return null;
  if (tr.parentElement && tr.parentElement.tagName === "THEAD")
    return cell.cellIndex > 0 ? { col: cell.cellIndex - 1 } : { all: true };
  if (tr.dataset.r === undefined) return null;
  var r = +tr.dataset.r;
  if (cell.tagName === "TH") return { row: r };
  return { r: r, c: cell.cellIndex - 1, td: cell };
}

function freshEval() {
  if (EVAL_DIRTY) { resetEval(); EVAL_DIRTY = false; resetDisp(); }
}

/* a cell's full copy {v, f?, cv?} or null */
function snapFull(sid, r, c) {
  var cel = state.cells[cellKey(sid, r, c)];
  if (!cel) return null;
  var o = { v: cel.v };
  if (cel.f) o.f = clone(cel.f);
  if (typeof cel.cv === "string") o.cv = cel.cv;
  return o;
}

/* write { key: {v, f?, cv?} | null } as ONE undo step (+ an optional
   sheet-size entry). Unchanged cells are not touched (no new stamps). */
function commitChanges(changes, dim) {
  var entries = [], key;
  for (key in changes) {
    var pk = key.split("|"), sid = pk[0], r = +pk[1], c = +pk[2];
    var before = snapCell(sid, r, c), after = changes[key];
    var a2 = after ? { v: after.v } : null;
    if (a2 && after.f) a2.f = clone(after.f);
    if (JSON.stringify(before) === JSON.stringify(a2)) continue;
    if (!a2 || (a2.v === "" && !a2.f)) {
      if (!before) continue;
      rawDel(sid, r, c);
      entries.push({ key: key, before: before, after: null });
    } else {
      rawSet(sid, r, c, a2.v, a2.f);
      if (after.cv && state.cells[key] && state.cells[key].v === after.v) state.cells[key].cv = after.cv;
      entries.push({ key: key, before: before, after: a2 });
    }
  }
  if (dim) entries = entries.concat(dim);   /* one entry or a list */
  if (!entries.length) return false;
  invalidateEval();
  markDirty();
  pushUndo(entries);
  return true;
}

function hasValue(r, c) {
  var cel = state.cells[cellKey(actSID, r, c)];
  return !!(cel && cel.v !== "");
}
function dataRegion(r, c) {
  var sh = getActiveSheet();
  return FX.region(hasValue, r, c, sh.rows, sh.cols);
}

/* ---------- sort ---------- */
function looksLikeHeading(rg) {
  var c, r, any = false, bold = false;
  for (c = rg.l; c <= rg.r; c++) {
    var cel = getCell(rg.t, c);
    if (!cel || cel.v === "") continue;
    if (cel.v.charAt(0) === "=" || typeof FX.literal(cel.v) !== "string") return false;
    any = true;
    if (cel.f && cel.f.b) bold = true;
  }
  if (!any) return false;
  if (bold) return true;
  for (r = rg.t + 1; r <= Math.min(rg.b, rg.t + 10); r++)
    for (c = rg.l; c <= rg.r; c++)
      if (hasValue(r, c) && typeof evalCell(actSID, r, c) === "number") return true;
  return false;
}

function sortSelection(desc) {
  if (editing) commitEdit(0, 0);
  freshEval();
  var rg, hdr = false, r, c, i;
  if (selIsRange()) {
    var ext = sheetExtent(actSID);
    rg = { t: selTop(), b: selBottom(), l: selLeft(), r: selRight() };
    rg.b = Math.min(rg.b, Math.max(rg.t, ext.rows - 1));
    rg.r = Math.min(rg.r, Math.max(rg.l, ext.cols - 1));
    if (FLT && FLT.top === rg.t) hdr = true;
  } else {
    rg = dataRegion(selR, selC);
    if (!rg) { notifyTransient(t("sort.none")); return; }
    if (FLT && FLT.top >= rg.t && FLT.top < rg.b) { rg.t = FLT.top; hdr = true; }
    else hdr = looksLikeHeading(rg);
  }
  var key = Math.min(Math.max(selC, rg.l), rg.r);
  var first = rg.t + (hdr ? 1 : 0);
  if (first >= rg.b) { notifyTransient(t("sort.none")); return; }
  var rows = [], vals = [];
  for (r = first; r <= rg.b; r++) { rows.push(r); vals.push(hasValue(r, key) ? evalCell(actSID, r, key) : null); }
  var order = FX.sortOrder(vals, desc, LANG), changes = {};
  for (i = 0; i < order.length; i++) {
    var src = rows[order[i]], dst = rows[i];
    if (src === dst) continue;
    for (c = rg.l; c <= rg.r; c++) {
      var sn = snapFull(actSID, src, c);
      if (sn && sn.v.charAt(0) === "=") {
        var nv = shiftFormula(sn.v, dst - src, 0);
        if (nv !== sn.v) { sn.v = nv; delete sn.cv; }
      }
      changes[cellKey(actSID, dst, c)] = sn;
    }
  }
  commitChanges(changes);
  queueSave();
  if (FLT) buildGrid();
  renderGrid();
  renderSelection();
  notifyTransient(t("sort.done").replace("{n}", rows.length).replace("{c}", colName(key)) +
    (hdr ? " · " + t("sort.hdr").replace("{r}", rg.t + 1) : ""));
}

/* ---------- filter (device-local view) ---------- */
var VIEW = null, FLT = null;
function loadView() {
  try { VIEW = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); } catch (e) { VIEW = {}; }
  if (!VIEW || typeof VIEW !== "object" || Array.isArray(VIEW)) VIEW = {};
}
function getView(sid) {
  if (!VIEW) loadView();
  var v = VIEW[sid];
  return (v && typeof v === "object") ? v : null;
}
function setView(sid, v) {
  if (!VIEW) loadView();
  if (v) VIEW[sid] = v; else delete VIEW[sid];
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(VIEW)); } catch (e) {}
}
function readFilter(sheet) {
  var v = getView(sheet.id), f = v && v.flt;
  if (!f || typeof f !== "object") return null;
  var top = parseInt(f.top, 10), l = parseInt(f.l, 10), r = parseInt(f.r, 10);
  if (!(top >= 0 && top < sheet.rows && l >= 0 && r >= l && r < sheet.cols)) return null;
  var cols = {}, k;
  if (f.cols && typeof f.cols === "object") for (k in f.cols) {
    var c = parseInt(k, 10), x = f.cols[k];
    if (!(c >= l && c <= r) || !x || typeof x !== "object") continue;
    var o = {};
    if (typeof x.q === "string" && x.q) o.q = x.q.slice(0, 200);
    if (Array.isArray(x.ex)) { var ex = x.ex.filter(function (s) { return typeof s === "string"; }); if (ex.length) o.ex = ex.slice(0, 2000); }
    if (o.q || o.ex) cols[c] = o;
  }
  return { top: top, l: l, r: r, cols: cols };
}
function filterActive(f) { for (var k in (f && f.cols) || {}) return true; return false; }
/* the last row of the filtered table: down from the heading while the
   next row has something in the filter's columns (the first empty row
   ends it, as in Excel; rows typed right under the table join it) */
function filterBottom(f) {
  var sh = getActiveSheet(), b = f.top, c, any;
  for (;;) {
    if (b + 1 >= sh.rows) return b;
    any = false;
    for (c = f.l; c <= f.r && !any; c++) if (hasValue(b + 1, c)) any = true;
    if (!any) return b;
    b++;
  }
}
function filterHidden(sheet) {
  FLT = readFilter(sheet);
  if (!FLT || !filterActive(FLT)) return null;
  freshEval();
  var hidden = {}, bot = filterBottom(FLT), r;
  for (r = FLT.top + 1; r <= bot; r++) {
    if (!FX.filterPass(FLT, (function (row) { return function (c) { return displayVal(row, c); }; })(r)))
      hidden[r] = 1;
  }
  return hidden;
}
function filterHead(r, c) {
  if (!FLT || r !== FLT.top || c < FLT.l || c > FLT.r) return 0;
  return FLT.cols[c] ? 2 : 1;
}
function updateFilterStatus() {
  var el = $("st-flt"), sheet = getActiveSheet(), b = $("tb-filter");
  if (b) { if (FLT) b.classList.add("on"); else b.classList.remove("on"); }
  if (!el || !sheet) return;
  if (!FLT) { el.hidden = true; return; }
  var n = sheet.rows - VIS.length;
  $("st-flt-t").textContent = n > 0 ? t("flt.hidden").replace("{n}", n) : t("tb.filter");
  el.title = t("flt.local");
  el.hidden = false;
}
function rebuildKeepSel() {
  buildGrid(); renderGrid(); renderSelection();
  if (POS && POS[selR] >= 0) ensureVisible(selR, selC);
}
function toggleFilter() {
  if (editing) commitEdit(0, 0);
  if (FLT) { clearFilter(); return; }
  var rg = selIsRange() ? { t: selTop(), b: selBottom(), l: selLeft(), r: selRight() } : dataRegion(selR, selC);
  if (selIsRange()) {
    var ext = sheetExtent(actSID);
    rg.r = Math.min(rg.r, Math.max(rg.l, ext.cols - 1));
  }
  if (!rg) { notifyTransient(t("flt.none")); return; }
  setView(actSID, { flt: { top: rg.t, l: rg.l, r: rg.r, cols: {} } });
  rebuildKeepSel();
  notifyTransient(t("flt.on").replace("{r}", rg.t + 1));
}
function clearFilter() {
  closePops();
  setView(actSID, null);
  rebuildKeepSel();
}

/* ---------- popovers / menus ---------- */
var popEl = null;
function closePops() {
  if (popEl) { popEl.remove(); popEl = null; }
}
function placePop(el, anchor) {
  document.body.appendChild(el);
  popEl = el;
  if (window.innerWidth <= 480 && !anchor.x) { el.classList.add("sheet"); return; }
  var x, y, h = el.offsetHeight, w = el.offsetWidth;
  if (anchor.el) { var br = anchor.el.getBoundingClientRect(); x = br.left; y = br.bottom + 4; if (y + h > window.innerHeight - 4) y = Math.max(4, br.top - h - 4); }
  else { x = anchor.x; y = anchor.y; if (y + h > window.innerHeight - 4) y = Math.max(4, window.innerHeight - h - 4); }
  el.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + "px";
  el.style.top = Math.max(4, y) + "px";
}
function mkBtn(text, cls, fn) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = cls || "";
  b.textContent = text;
  b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
  return b;
}

function openFilterPop(c, anchor) {
  closePops();
  if (!FLT) return;
  freshEval();
  var cur = FLT.cols[c] || {}, ex = {}, i;
  (cur.ex || []).forEach(function (s) { ex[s] = 1; });
  var bot = filterBottom(FLT), seen = {}, vals = [], CAP = 500, more = false;
  for (var r = FLT.top + 1; r <= bot; r++) {
    var s = displayVal(r, c);
    if (seen[s]) continue;
    if (vals.length >= CAP) { more = true; break; }
    seen[s] = 1; vals.push(s);
  }
  (cur.ex || []).forEach(function (s) { if (!seen[s] && vals.length < CAP + 50) { seen[s] = 1; vals.push(s); } });
  var order = FX.sortOrder(vals.map(function (v) { var n = FX.literal(v); return n === null ? null : n; }), false, LANG);

  var pop = document.createElement("div");
  pop.className = "ss-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t("flt.title").replace("{c}", colName(c)));
  var h = document.createElement("div");
  h.className = "pop-h";
  h.textContent = t("flt.title").replace("{c}", colName(c));
  pop.appendChild(h);
  var q = document.createElement("input");
  q.type = "search"; q.className = "pop-q";
  q.placeholder = t("flt.contains");
  q.setAttribute("aria-label", t("flt.contains"));
  q.value = cur.q || "";
  pop.appendChild(q);
  var acts = document.createElement("div");
  acts.className = "pop-acts";
  var list = document.createElement("div");
  list.className = "pop-list";
  var boxes = [];
  acts.appendChild(mkBtn(t("flt.all"), "", function () { boxes.forEach(function (b) { b.checked = true; }); }));
  acts.appendChild(mkBtn(t("flt.nonesel"), "", function () { boxes.forEach(function (b) { b.checked = false; }); }));
  pop.appendChild(acts);
  for (i = 0; i < order.length; i++) {
    var v = vals[order[i]];
    var lab = document.createElement("label");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !ex[v];
    cb._v = v;
    boxes.push(cb);
    var sp = document.createElement("span");
    sp.textContent = v === "" ? t("flt.empty") : v;
    if (v === "") sp.className = "dim";
    lab.appendChild(cb); lab.appendChild(sp);
    list.appendChild(lab);
  }
  pop.appendChild(list);
  var note = document.createElement("div");
  note.className = "pop-note";
  note.textContent = (more ? t("flt.more").replace("{n}", CAP) + " · " : "") + t("flt.local");
  pop.appendChild(note);
  var btns = document.createElement("div");
  btns.className = "pop-btns";
  btns.appendChild(mkBtn(t("flt.cancel"), "", closePops));
  btns.appendChild(mkBtn(t("flt.apply"), "primary", function () {
    var nex = [];
    boxes.forEach(function (b) { if (!b.checked) nex.push(b._v); });
    var f = readFilter(getActiveSheet()) || FLT;
    var o = {};
    if (q.value.trim()) o.q = q.value.trim();
    if (nex.length) o.ex = nex;
    if (o.q || o.ex) f.cols[c] = o; else delete f.cols[c];
    setView(actSID, { flt: f });
    closePops();
    rebuildKeepSel();
  }));
  pop.appendChild(btns);
  pop.addEventListener("click", function (e) { e.stopPropagation(); });
  pop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePops(); $("grid-wrap").focus(); }
    e.stopPropagation();
  });
  placePop(pop, { el: anchor });
}

/* ---------- freeze ---------- */
function setFreeze(r, c) {
  if (editing) commitEdit(0, 0);
  var sheet = getActiveSheet();
  var fz = normFz({ r: r, c: c }, sheet);
  if (JSON.stringify(fz) === JSON.stringify(normFz(sheet.fz, sheet))) return;
  if (fz) sheet.fz = fz; else delete sheet.fz;
  sheet.mtime = now();
  markDirty();
  var wrap = $("grid-wrap");
  if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
  rebuildKeepSel();
}

/* ---------- insert / delete rows and columns ---------- */
function dimsOf(sh) {
  var o = { rows: sh.rows, cols: sh.cols, cw: clone(sh.cw || {}) };
  if (sh.fz) o.fz = clone(sh.fz);
  var rh = normRh(sh.rh);
  if (rh) o.rh = rh;
  return o;
}
/* n > 0: insert n rows ("r") / columns ("c") before index `at`;
   n < 0: delete -n of them from `at`. Cells move (formats with them),
   references to them in every sheet follow (functions.js adjustFormula),
   references into deleted cells become #REF!. One Undo step. */
function structural(axis, at, n) {
  if (editing) commitEdit(0, 0);
  closePops();
  var sheet = getActiveSheet(), sid = actSID, k;
  var cur = axis === "r" ? sheet.rows : sheet.cols, max = axis === "r" ? MAX_ROWS : MAX_COLS;
  if (n > 0 && cur + n > max) {
    notifyTransient(t("max.dims").replace("{r}", MAX_ROWS.toLocaleString(loc())).replace("{c}", MAX_COLS));
    return;
  }
  function pointsHere(hostSid) {
    return function (name) {
      if (name === null) return hostSid === sid;
      var sh = findSheetByName(name);
      return !!sh && sh.id === sid;
    };
  }
  var adj = {};
  for (k in state.cells) {
    var cel = state.cells[k];
    if (!cel || cel.v.charAt(0) !== "=") continue;
    var nv = FX.adjustFormula(cel.v, pointsHere(k.split("|")[0]), axis, at, n);
    if (nv !== cel.v) adj[k] = nv;
  }
  var changes = {}, moved = {}, pref = sid + "|", end = at - n - 1;
  for (k in state.cells) {
    var p = k.split("|");
    var snap = snapFull(p[0], +p[1], +p[2]);
    if (adj[k]) snap.v = adj[k];
    if (p[0] !== sid) { if (adj[k]) changes[k] = snap; continue; }
    var r = +p[1], c = +p[2], idx = axis === "r" ? r : c, to = -1;
    if (n > 0) { if (idx >= at) to = idx + n; }
    else if (idx >= at && idx <= end) { changes[k] = null; continue; }
    else if (idx > end) to = idx + n;
    if (to >= 0) {
      if (!changes.hasOwnProperty(k)) changes[k] = null;
      moved[axis === "r" ? cellKey(sid, to, c) : cellKey(sid, r, to)] = snap;
    } else if (adj[k]) changes[k] = snap;
  }
  for (k in moved) changes[k] = moved[k];
  void pref;
  var before = dimsOf(sheet);
  if (n > 0) { if (axis === "r") sheet.rows += n; else sheet.cols += n; }
  if (axis === "r" && sheet.rh) {
    var rh = {}, rk;
    for (rk in sheet.rh) {
      var ri = +rk;
      if (n > 0) rh[ri >= at ? ri + n : ri] = sheet.rh[rk];
      else if (ri < at) rh[ri] = sheet.rh[rk];
      else if (ri > end) rh[ri + n] = sheet.rh[rk];
    }
    sheet.rh = rh;
  }
  if (axis === "c") {
    var cw = {}, key;
    for (key in sheet.cw) {
      var ci = +key;
      if (n > 0) cw[ci >= at ? ci + n : ci] = sheet.cw[key];
      else if (ci < at) cw[ci] = sheet.cw[key];
      else if (ci > end) cw[ci + n] = sheet.cw[key];
    }
    sheet.cw = cw;
  }
  sheet.mtime = now();
  /* the device-local filter heading follows its row / columns */
  if (FLT) {
    var f = readFilter(sheet);
    if (f) {
      if (axis === "r") { if (n > 0 && at <= f.top) f.top += n; else if (n < 0 && at <= f.top) { if (f.top <= end) f = null; else f.top += n; } }
      else f = null;
      setView(sid, f ? { flt: f } : null);
    }
  }
  commitChanges(changes, [{ dim: true, sid: sid, before: before, after: dimsOf(sheet) }].concat(adjustObjs(sid, axis, at, n)));
  markDirty();
  queueSave();
  buildGrid();
  renderGrid();
  renderSelection();
}

function insertRows(below) {
  var sh = getActiveSheet(), top = selTop(), bot = selBottom();
  var n = (top === 0 && bot === sh.rows - 1) ? 1 : bot - top + 1;
  structural("r", below ? bot + 1 : top, Math.min(n, 1000));
  if (below) { collapseSel(bot + 1, selC); renderSelection(); }
}
function deleteRows() {
  var top = selTop(), bot = selBottom();
  structural("r", top, -(bot - top + 1));
  collapseSel(Math.min(top, getActiveSheet().rows - 1), selC);
  renderSelection();
}
function insertCols(right) {
  var sh = getActiveSheet(), lef = selLeft(), rig = selRight();
  var n = (lef === 0 && rig === sh.cols - 1) ? 1 : rig - lef + 1;
  structural("c", right ? rig + 1 : lef, n);
  if (right) { collapseSel(selR, rig + 1); renderSelection(); }
}
function deleteCols() {
  var lef = selLeft(), rig = selRight();
  structural("c", lef, -(rig - lef + 1));
  collapseSel(selR, Math.min(lef, getActiveSheet().cols - 1));
  renderSelection();
}
/* grow at the end: no cell moves, only the sheet size (synced) */
function addRowsCols(axis, n) {
  if (editing) commitEdit(0, 0);
  var sh = getActiveSheet();
  var cur = axis === "r" ? sh.rows : sh.cols, max = axis === "r" ? MAX_ROWS : MAX_COLS;
  if (cur >= max) {
    notifyTransient(t("max.dims").replace("{r}", MAX_ROWS.toLocaleString(loc())).replace("{c}", MAX_COLS));
    return;
  }
  var before = dimsOf(sh);
  if (axis === "r") sh.rows = Math.min(max, sh.rows + n); else sh.cols = Math.min(max, sh.cols + n);
  sh.mtime = now();
  pushUndo([{ dim: true, sid: actSID, before: before, after: dimsOf(sh) }]);
  markDirty();
  rebuildKeepSel();
}

/* "Send to an app" (shell send/, BR-SEND): the selected cells, or the
   whole sheet when one cell is selected, as a table (what the cells
   show, not their formulas) to Writer, Mail, Text Tools…            */
var SEND_ROWS = 500, SEND_COLS = 64;
function sendApi() {
  try { return window.parent !== window && window.parent.orosSend ? window.parent.orosSend : null; }
  catch (e) { return null; }
}
function sendSelection() {
  var api = sendApi();
  if (!api) return;
  if (editing) commitEdit(0, 0);
  var top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
  if (!selIsRange()) {
    var ex = sheetExtent(actSID);
    top = 0; lef = 0; bot = ex.rows - 1; rig = ex.cols - 1;
  }
  bot = Math.min(bot, top + SEND_ROWS - 1);
  rig = Math.min(rig, lef + SEND_COLS - 1);
  var rows = [], any = false;
  for (var r = top; r <= bot; r++) {
    var row = [];
    for (var c = lef; c <= rig; c++) {
      var v = displayVal(r, c);
      if (v !== "") any = true;
      row.push(v);
    }
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every(function (v) { return v === ""; })) rows.pop();
  if (!any || !rows.length) { notifyTransient(t("send.empty")); return; }
  var sh = getActiveSheet();
  api.open({ kind: "table", data: { name: displayName(sh), rows: rows } });
}

function openSheetMenu(anchor) {
  if (editing) commitEdit(0, 0);
  closePops();
  var sh = getActiveSheet();
  var top = selTop(), bot = selBottom(), lef = selLeft(), rig = selRight();
  var m = document.createElement("div");
  m.className = "ss-pop ss-menu";
  m.setAttribute("role", "menu");
  m.setAttribute("aria-label", t("menu.label"));
  function item(text, fn, disabled) {
    var b = mkBtn(text, "mi", function () { closePops(); fn(); });
    b.setAttribute("role", "menuitem");
    if (disabled) b.disabled = true;
    m.appendChild(b);
  }
  function sep() { var d = document.createElement("div"); d.className = "msep"; m.appendChild(d); }
  var fzr = normFz(sh.fz, sh) || { r: 0, c: 0 };
  item(t("rg.mode"), function () { RANGE_MODE = true; notifyTransient(t("rg.tap")); });
  sep();
  if (sendApi()) { item(t("menu.sendApp"), sendSelection); sep(); }
  if (selR > 0 && selR + 1 <= FZ_MAX_R) item(t("fz.rows").replace("{n}", selR + 1), function () { setFreeze(selR + 1, fzr.c); });
  else item(t("fz.top"), function () { setFreeze(1, fzr.c); }, fzr.r === 1);
  if (selC + 1 <= FZ_MAX_C) item(selC === 0 ? t("fz.col1") : t("fz.cols").replace("{c}", colName(selC)), function () { setFreeze(fzr.r, selC + 1); }, selC === 0 && fzr.c === 1);
  if (fzr.r || fzr.c) item(t("fz.off"), function () { setFreeze(0, 0); });
  sep();
  var fullCols = top === 0 && bot === sh.rows - 1, fullRows = lef === 0 && rig === sh.cols - 1;
  item(t("row.insA"), function () { insertRows(false); }, sh.rows >= MAX_ROWS);
  item(t("row.insB"), function () { insertRows(true); }, sh.rows >= MAX_ROWS);
  item(top === bot ? t("row.del1").replace("{a}", top + 1) : t("row.del").replace("{a}", top + 1).replace("{b}", bot + 1), deleteRows, fullCols && sh.rows > 1000);
  sep();
  item(t("col.insL"), function () { insertCols(false); }, sh.cols >= MAX_COLS);
  item(t("col.insR"), function () { insertCols(true); }, sh.cols >= MAX_COLS);
  item(lef === rig ? t("col.del1").replace("{a}", colName(lef)) : t("col.del").replace("{a}", colName(lef)).replace("{b}", colName(rig)), deleteCols, fullRows && sh.cols > 26);
  sep();
  item(t("add.rows").replace("{n}", 100), function () { addRowsCols("r", 100); }, sh.rows >= MAX_ROWS);
  item(t("add.rows").replace("{n}", (1000).toLocaleString(loc())), function () { addRowsCols("r", 1000); }, sh.rows >= MAX_ROWS);
  item(t("add.cols").replace("{n}", 10), function () { addRowsCols("c", 10); }, sh.cols >= MAX_COLS);
  sep();
  item(t("calc.open"), openCalcDialog);
  item(t("pr.open"), openPrintDialog);
  m.addEventListener("click", function (e) { e.stopPropagation(); });
  m.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePops(); $("grid-wrap").focus(); }
  });
  placePop(m, anchor);
  var first = m.querySelector("button:not([disabled])");
  if (first) try { first.focus({ preventScroll: true }); } catch (e) {}
}

/* ---------- calculation setting (wave 4.2): iterative calculation ---------- */
function openCalcDialog() {
  var x = state.calc || { it: 0, n: 100, d: 0.001 };
  var pop = popShell(t("calc.title"), "calc-dlg");
  var on = document.createElement("input");
  on.type = "checkbox"; on.checked = x.it === 1;
  field(pop, t("calc.it"), on).classList.add("pop-chk");
  var n = mkInput(String(x.n)), d = mkInput(String(x.d).replace(".", LANG === "el" ? "," : "."));
  n.inputMode = "numeric"; d.inputMode = "decimal";
  var row = document.createElement("div");
  row.className = "pop-2";
  pop.appendChild(row);
  var fn = field(row, t("calc.n"), n), fd = field(row, t("calc.d"), d);
  function sync() { fn.hidden = fd.hidden = !on.checked; }
  on.addEventListener("change", sync); sync();
  var note = document.createElement("div");
  note.className = "pop-note"; note.textContent = t("calc.note");
  pop.appendChild(note);
  var btns = document.createElement("div");
  btns.className = "pop-btns";
  btns.appendChild(mkBtn(t("flt.cancel"), "", closePops));
  btns.appendChild(mkBtn(t("save"), "primary", function () {
    var nn = parseInt(n.value, 10), dd = parseFloat(String(d.value).replace(",", "."));
    var rec = KIT.normCalc({ it: on.checked ? 1 : 0, n: isFinite(nn) ? nn : 100, d: isFinite(dd) && dd > 0 ? dd : 0.001,
      mtime: Math.max(now(), state.calc ? state.calc.mtime + 1 : 0) });
    closePops();
    if (state.calc && state.calc.it === rec.it && state.calc.n === rec.n && state.calc.d === rec.d) return;
    if (!state.calc && !rec.it) return;
    state.calc = rec;
    invalidateEval(); resetDisp();
    markDirty(); queueSave();
    renderGrid();
  }));
  pop.appendChild(btns);
  placePop(pop, { el: $("tb-fmt") });
  try { on.focus({ preventScroll: true }); } catch (e) {}
}

/* ---------- function help (formula bar and cell editor) ---------- */
var fxHelp = { el: null, input: null, items: [], sel: -1, tok: null };
function fxHelpText(name) {
  var H = FX.HELP[LANG] || FX.HELP.en, base = name.replace(/\.[A-Z]+$/, "");
  return H[name] || H[base] || FX.HELP.en[name] || FX.HELP.en[base] || "";
}
function fxToken(inp) {
  var v = inp.value;
  if (v.charAt(0) !== "=") return null;
  var pos = (typeof inp.selectionStart === "number") ? inp.selectionStart : v.length;
  var before = v.slice(0, pos);
  if ((before.match(/"/g) || []).length % 2) return null;      /* inside a string */
  var m = before.match(/(^=|[=(,;+\-*\/^&<>\s])([A-Za-z][A-Za-z0-9.]*)$/);
  return m ? { word: m[2], start: pos - m[2].length, end: pos } : null;
}
function fxHelpHide() {
  if (fxHelp.el) { fxHelp.el.remove(); fxHelp.el = null; }
  fxHelp.items = []; fxHelp.sel = -1; fxHelp.input = null;
}
function fxHelpHideSoon() {
  if (fxHelp.input && document.activeElement === fxHelp.input) return;
  fxHelpHide();
}
function fxHelpPaint() {
  if (!fxHelp.el) return;
  var kids = fxHelp.el.children;
  for (var i = 0; i < kids.length; i++) {
    if (i === fxHelp.sel) { kids[i].classList.add("on"); kids[i].setAttribute("aria-selected", "true"); }
    else { kids[i].classList.remove("on"); kids[i].removeAttribute("aria-selected"); }
  }
}
function fxHelpAccept(name) {
  var inp = fxHelp.input, tk = fxHelp.tok;
  if (!inp || !tk) return;
  var v = inp.value;
  var ins = name + "(";
  inp.value = v.slice(0, tk.start) + ins + v.slice(tk.end).replace(/^\(/, "");
  var at = tk.start + ins.length;
  try { inp.setSelectionRange(at, at); } catch (e) {}
  if (inp === editInput) $("fx-input").value = inp.value;
  fxHelpHide();
  inp.focus();
}
function fxHelpUpdate(inp) {
  var tk = fxToken(inp);
  if (!tk) { fxHelpHide(); return; }
  var up = tk.word.toUpperCase();
  var list = FX.names().filter(function (n) { return n.indexOf(up) === 0; }).slice(0, 8);
  if (!list.length || (list.length === 1 && list[0] === up)) { fxHelpHide(); return; }
  if (!fxHelp.el) {
    fxHelp.el = document.createElement("div");
    fxHelp.el.className = "fx-help";
    fxHelp.el.setAttribute("role", "listbox");
    fxHelp.el.setAttribute("aria-label", t("fx.list"));
    document.body.appendChild(fxHelp.el);
  }
  fxHelp.input = inp; fxHelp.tok = tk; fxHelp.items = list; fxHelp.sel = -1;
  fxHelp.el.innerHTML = "";
  list.forEach(function (n) {
    var it = document.createElement("div");
    it.className = "fx-it";
    it.setAttribute("role", "option");
    var b = document.createElement("b");
    b.textContent = n + (FX.SIG[n] ? "(" + FX.SIG[n] + ")" : "");
    var d = document.createElement("span");
    d.textContent = fxHelpText(n);
    it.appendChild(b); it.appendChild(d);
    it.addEventListener("mousedown", function (e) { e.preventDefault(); fxHelpAccept(n); });
    fxHelp.el.appendChild(it);
  });
  var br = inp.getBoundingClientRect();
  var w = Math.min(420, window.innerWidth - 8);
  fxHelp.el.style.width = w + "px";
  fxHelp.el.style.left = Math.max(4, Math.min(br.left, window.innerWidth - w - 4)) + "px";
  var h = fxHelp.el.offsetHeight, y = br.bottom + 2;
  if (y + h > window.innerHeight - 4) y = Math.max(4, br.top - h - 2);
  fxHelp.el.style.top = y + "px";
}
/* keys while the list is open: arrows choose, Tab (or Enter on a
   chosen item) inserts, Esc closes. true = the key was used */
function fxHelpKey(e, inp) {
  if (!fxHelp.el || fxHelp.input !== inp) return false;
  var n = fxHelp.items.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    fxHelp.sel = e.key === "ArrowDown" ? (fxHelp.sel + 1) % n : (fxHelp.sel <= 0 ? n - 1 : fxHelp.sel - 1);
    fxHelpPaint();
    return true;
  }
  if (e.key === "Tab" || (e.key === "Enter" && fxHelp.sel >= 0)) {
    e.preventDefault();
    fxHelpAccept(fxHelp.items[Math.max(0, fxHelp.sel)]);
    return true;
  }
  if (e.key === "Escape") { e.preventDefault(); fxHelpHide(); return true; }
  return false;
}

/* the full list (the ƒx mark): pick one to put it in the cell */
function openFxList() {
  closePops();
  var pop = document.createElement("div");
  pop.className = "ss-pop fx-list";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t("fx.list"));
  var h = document.createElement("div");
  h.className = "pop-h";
  h.textContent = t("fx.list");
  pop.appendChild(h);
  var q = document.createElement("input");
  q.type = "search"; q.className = "pop-q";
  q.placeholder = t("fx.search");
  q.setAttribute("aria-label", t("fx.search"));
  pop.appendChild(q);
  var list = document.createElement("div");
  list.className = "pop-list fx-all";
  pop.appendChild(list);
  var names = FX.names().filter(function (n) { return fxHelpText(n) !== ""; });
  function fill() {
    var s = q.value.trim().toLowerCase();
    list.innerHTML = "";
    names.forEach(function (n) {
      var d = fxHelpText(n);
      if (s && n.toLowerCase().indexOf(s) < 0 && d.toLowerCase().indexOf(s) < 0) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fx-it";
      var bb = document.createElement("b");
      bb.textContent = n;
      var sp = document.createElement("span");
      sp.textContent = d;
      b.appendChild(bb); b.appendChild(sp);
      b.addEventListener("click", function (e) { e.stopPropagation(); closePops(); insertFunction(n); });
      list.appendChild(b);
    });
  }
  q.addEventListener("input", fill);
  fill();
  pop.addEventListener("click", function (e) { e.stopPropagation(); });
  pop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePops(); }
    e.stopPropagation();
  });
  placePop(pop, { el: $("fx-mark") });
  try { q.focus({ preventScroll: true }); } catch (e) {}
}
function insertFunction(name) {
  var inp = editing && editInput ? editInput : $("fx-input");
  inp.focus();        /* focus first: the formula bar remembers its starting text on focus */
  var v = inp.value, pos = (typeof inp.selectionStart === "number" && v.charAt(0) === "=") ? inp.selectionStart : v.length;
  if (v.charAt(0) !== "=") { v = "="; pos = 1; }
  inp.value = v.slice(0, pos) + name + "(" + v.slice(pos);
  var at = pos + name.length + 1;
  try { inp.setSelectionRange(at, at); } catch (e) {}
  if (inp === editInput) $("fx-input").value = inp.value;
}

/* ===== SECTION 3e: SHEET TABS (unchanged from Wave 2) ===== */

function displayName(sh) {
  if (!sh) return "";
  if (sh.name !== null && sh.name !== undefined) return sh.name;
  return sh.bi ? (sh.bi[LANG] || sh.bi.en || sh.id) : sh.id;
}

function nextSheetNumber() {
  var n = 1, i;
  for (i = 0; i < state.sheets.length; i++) {
    var m = displayName(state.sheets[i]).match(/(\d+)\s*$/);
    if (m) n = Math.max(n, parseInt(m[1], 10));
  }
  return n + 1;
}

function maxPos() {
  var p = 0, i;
  for (i = 0; i < state.sheets.length; i++)
    if ((state.sheets[i].pos || 0) > p) p = state.sheets[i].pos;
  return p;
}

var armX = { id: null, timer: null };

function renderTabs() {
  var nav = $("stabs");
  if (!nav) return;
  nav.innerHTML = "";

  var sheets = state.sheets.slice().sort(function (a, b) {
    var d = (a.pos || 0) - (b.pos || 0);
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });

  var i;
  for (i = 0; i < sheets.length; i++) {
    (function (sh) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "stab" + (sh.id === actSID ? " active" : "");

      var label = document.createElement("span");
      label.className = "stab-label";
      label.textContent = displayName(sh);
      tab.appendChild(label);

      var x = document.createElement("span");
      x.className = "stab-x";
      x.innerHTML = IC_X;
      x.title = t("tab.confirm");
      if (armX.id === sh.id) x.classList.add("armed");
      x.addEventListener("click", function (e) {
        e.stopPropagation();
        tryDeleteSheet(sh.id);
      });
      tab.appendChild(x);

      var lpFired = false;
      tab.addEventListener("click", function (e) {
        if (lpFired) { lpFired = false; return; }   /* the long-press already acted */
        if (e.target.classList && e.target.classList.contains("stab-x")) return;
        if (editing) commitEdit(0, 0);
        switchTo(sh.id);
      });
      tab.addEventListener("dblclick", function (e) {
        if (e.target.classList && e.target.classList.contains("stab-x")) return;
        beginRename(tab, label, sh);
      });
      /* SS-10: touch twin of the double click (450 ms long-press) */
      var lpT = null;
      tab.addEventListener("touchstart", function (e) {
        if (e.target.closest && e.target.closest(".stab-x")) return;
        lpFired = false;
        lpT = setTimeout(function () { lpT = null; lpFired = true; beginRename(tab, label, sh); }, 450);
      }, { passive: true });
      var lpCancel = function () { if (lpT) { clearTimeout(lpT); lpT = null; } };
      tab.addEventListener("touchend", lpCancel, { passive: true });
      tab.addEventListener("touchmove", lpCancel, { passive: true });
      tab.addEventListener("touchcancel", lpCancel, { passive: true });
      tab.addEventListener("contextmenu", function (e) {
        if (tab.querySelector("input")) e.preventDefault();
      });

      nav.appendChild(tab);
    })(sheets[i]);
  }

  var add = document.createElement("button");
  add.type = "button";
  add.className = "stab-add";
  add.innerHTML = IC_ADD;
  add.title = t("sheet.add");
  add.setAttribute("aria-label", t("sheet.add"));
  add.addEventListener("click", function () {
    if (editing) commitEdit(0, 0);
    addSheet();
  });
  nav.appendChild(add);
}

function switchTo(id) {
  if (id === actSID) return;
  if (!getSheetById(id)) return;
  actSID = id;
  saveActive();
  collapseSel(0, 0);
  closePops();
  var wrap = $("grid-wrap");
  if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
  buildGrid();
  renderTabs();
  renderGrid();
  renderSelection();
  $("grid-wrap").focus();
}

function addSheet() {
  var n = nextSheetNumber();
  var sh = {
    id: uid(),
    name: null,
    bi: { en: "Sheet" + n, el: "\u03A6\u03CD\u03BB\u03BB\u03BF" + n },
    rows: ROWS, cols: COLS, cw: {},
    pos: maxPos() + 1,
    mtime: now()
  };
  state.sheets.push(sh);
  markDirty();
  switchTo(sh.id);
}

function tryDeleteSheet(id) {
  if (state.sheets.length <= 1) { notifyTransient(t("sheet.last")); return; }

  if (armX.id !== id) {
    if (armX.timer) clearTimeout(armX.timer);
    armX.id = id;
    armX.timer = setTimeout(function () {
      armX.id = null; renderTabs();
    }, 3000);
    notifyTransient(t("tab.confirm"));
    renderTabs();
    return;
  }
  if (armX.timer) { clearTimeout(armX.timer); }
  armX = { id: null, timer: null };

  deleteSheet(id);
}

function deleteSheet(id) {
  var i, k;

  for (i = 0; i < state.sheets.length; i++) {
    if (state.sheets[i] && state.sheets[i].id === id) {
      state.sheets.splice(i, 1); break;
    }
  }

  var ts = now();
  state.deleted[id] = ts;
  setView(id, null);
  var pref = id + "|";
  for (k in state.cells)
    if (k.indexOf(pref) === 0) delete state.cells[k];
  for (k in state.charts) if (state.charts[k].sid === id) delete state.charts[k];
  for (k in state.cf) if (state.cf[k].sid === id) delete state.cf[k];

  if (actSID === id) {
    actSID = state.sheets[0] ? state.sheets[0].id : SID;
    collapseSel(0, 0);
    buildGrid();
  }

  markDirty();
  renderTabs();
  renderGrid();
  renderSelection();
  $("grid-wrap").focus();
}

function beginRename(tabEl, labelEl, sh) {
  var inp = document.createElement("input");
  inp.type = "text";
  inp.value = displayName(sh);
  inp.maxLength = 24;
  inp.autocomplete = "off";
  inp.spellcheck = false;
  labelEl.style.display = "none";
  tabEl.insertBefore(inp, labelEl);
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);

  var done = false;
  function finish(commit) {
    if (done) return;
    done = true;
    if (commit) {
      var nv = inp.value.replace(/^\s+|\s+$/g, "");
      if (nv && nv !== displayName(sh)) {
        sh.name = nv;
        sh.bi = undefined;
        sh.mtime = now();
        markDirty();
      }
    }
    tabEl.removeChild(inp);
    labelEl.style.display = "";
    renderTabs();
    renderGrid();
    $("grid-wrap").focus();
  }

  inp.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  inp.addEventListener("blur", function () { finish(true); });
  inp.addEventListener("click", function (e) { e.stopPropagation(); });
}

/* ===== SECTION 3f: CSV IMPORT / EXPORT ===== */

/* Encoding-safe decoder (sheetimport.js): BOM sniff, strict UTF-8,
   then Greek ANSI (windows-1253). Used by CSV + Excel import. */
function sniffDecode(buf) { return SI.sniffDecode(buf); }

function csvEscape(v) {
  v = String(v);
  if (/[",;\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function csvExport() {
  var sheet = getActiveSheet();
  if (!sheet) return;

  var maxR = -1, maxC = -1, pref = actSID + "|", k;
  for (k in state.cells) {
    if (k.indexOf(pref) !== 0) continue;
    var p = k.split("|");
    var r = parseInt(p[1], 10), c = parseInt(p[2], 10);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (maxR < 0) { notifyTransient(t("csv.empty")); return; }

  var lines = [], r, c, row;
  for (r = 0; r <= maxR; r++) {
    row = [];
    for (c = 0; c <= maxC; c++) {
      var cel = state.cells[cellKey(actSID, r, c)];
      row.push(cel ? csvEscape(cel.v) : "");
    }
    lines.push(row.join(","));
  }
  var csv = lines.join("\r\n");

  var safeName = displayName(sheet).replace(/[^\w\- ]+/g, "_") || "sheet";
  var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  var done = function () { notifyTransient(t("csv.exported")); };
  var dlg = dialogHost();
  if (dlg && typeof dlg.saveFile === "function") {
    dlg.saveFile({
      blob: blob,
      filename: safeName + ".csv",
      mime: "text/csv;charset=utf-8",
      types: [{ description: "CSV",
                accept: { "text/csv": [".csv"] } }]
    }).then(function (r) { if (r && r.ok) done(); });
    return;                       // cancel (ok=false) = silent exit
  }
  // Standalone fallback — classic download (no shell present).
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = safeName + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
  }, 500);
  done();
}

/* SS-6: ',' ';' or TAB, capped at the normalizeState limits
   (sheetimport.js csvParse) */
function csvParse(text) {
  return SI.csvParse(text, { rowsCap: XL_ROWS_CAP, colsCap: XL_COLS_CAP });
}

function csvImport(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var rows = csvParse(sniffDecode(reader.result));
      if (!rows.length) { notifyTransient(t("xl.readerr")); return; }

      var imp = SI.csvSheet(rows, { uid: uid, now: now(), n: nextSheetNumber(), pos: maxPos() + 1,
        rows: ROWS, cols: COLS, rowsCap: XL_ROWS_CAP, colsCap: XL_COLS_CAP });
      var sh = imp.sheets[0], k;
      state.sheets.push(sh);
      for (k in imp.cells) state.cells[k] = imp.cells[k];

      markDirty();
      switchTo(sh.id);
      notifyTransient(t("csv.imported"));
      if (rows.truncated) notifyTransient(t("xl.trunc")
        .replace("{r}", XL_ROWS_CAP).replace("{c}", XL_COLS_CAP));
    } catch (e) {
      console.error("[SS] CSV import failed:", e);
      notifyTransient(t("xl.readerr"));
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ===== SECTION 3g: XLSX / ODS IMPORT + EXPORT (#9) ===== */
/* SheetJS vendored locally (vendor/xlsx.full.min.js) — never a
   CDN, same discipline as jspdf in cycle.js. Reads AND writes
   .xlsx, .ods (plus legacy .xls). Optional dependency: if the
   file is absent, import/export degrade to a toast — nothing
   else breaks. Lazy-loaded on first use only.               */

var XL_ROWS_CAP = MAX_ROWS, XL_COLS_CAP = MAX_COLS;   /* = normalizeState limits */
var xlLibLoading = false;

function loadXlsxLib(done) {
  if (window.XLSX && window.XLSX.utils) { done(); return; }
  if (xlLibLoading) return;
  xlLibLoading = true;
  var cands = ["../vendor/xlsx.full.min.js", "vendor/xlsx.full.min.js"];
  var i = 0;
  (function next() {
    if (i >= cands.length) {
      xlLibLoading = false;
      notifyTransient(t("xl.lib"));
      return;
    }
    var s = document.createElement("script");
    s.src = cands[i++] + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
    s.onload = function () { xlLibLoading = false; done(); };
    s.onerror = function () { s.remove(); next(); };
    document.head.appendChild(s);
  })();
}

function xlPad(n) { return (n < 10 ? "0" : "") + n; }

function xlStamp() {
  var d = new Date();
  return d.getFullYear() + "-" + xlPad(d.getMonth() + 1) + "-" + xlPad(d.getDate());
}

/* Excel sheet-name rules: no []:*?/\ , max 31 chars */
function xlSafeName(nm) { return SI.xlSafeName(nm); }

/* IMPORT — every worksheet becomes a NEW orOS sheet (never
   overwrites existing data; same contract as csvImport).     */
function xlImport(file) {
  loadXlsxLib(function () {
    var reader = new FileReader();
    reader.onload = function () {
      var made = 0, truncated = false, lastId = null;
      try {
        /* the workbook -> new sheets: sheetimport.js (the Converter
           uses the same code) */
        var wb = SI.readWorkbook(window.XLSX, reader.result);
        var imp = SI.workbookSheets(wb, window.XLSX.utils, { uid: uid, now: now(), pos: maxPos() + 1,
          rows: ROWS, cols: COLS, rowsCap: XL_ROWS_CAP, colsCap: XL_COLS_CAP, rhMin: RH_MIN, rhMax: RH_MAX });
        imp.sheets.forEach(function (sh) { state.sheets.push(sh); });
        for (var k in imp.cells) state.cells[k] = imp.cells[k];
        made = imp.sheets.length; truncated = imp.truncated; lastId = imp.lastId;
        if (!made) { notifyTransient(t("xl.readerr")); return; }
        markDirty();
        invalidateEval();
        switchTo(lastId);   /* rebuilds tabs + grid, focuses */
        notifyTransient(t("xl.imported").replace("{n}", made));
        if (truncated) notifyTransient(t("xl.trunc")
          .replace("{r}", XL_ROWS_CAP).replace("{c}", XL_COLS_CAP));
      } catch (e) {
        console.error("[SS] XLSX import failed:", e);
        notifyTransient(t("xl.readerr"));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* EXPORT — ALL sheets -> one workbook. Raw v goes out as-is:
   strings starting "=" become formulas (aoa_to_sheet contract);
   numeric-looking strings become real numbers (no green Excel
   triangles), EXCEPT leading-zero values like phone numbers. */
function xlOutVal(v) {
  if (typeof v === "string" && v !== "" && v.charAt(0) !== "=" &&
      /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v.trim()) &&
      !/^-?0\d/.test(v.trim()) &&
      isFinite(parseFloat(v))) {
    return parseFloat(v);
  }
  return v;
}

function xlExport(bookType) {
  var sheets = state.sheets.slice().sort(function (a, b) {
    var d = (a.pos || 0) - (b.pos || 0);
    return d !== 0 ? d : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
  });
  if (!sheets.length) { notifyTransient(t("csv.empty")); return; }

  /* any data at all, anywhere? (same emptiness rule as csvExport) */
  var any = false, k, q, pref;
  for (q = 0; q < sheets.length && !any; q++) {
    pref = sheets[q].id + "|";
    for (k in state.cells) { if (k.indexOf(pref) === 0) { any = true; break; } }
  }
  if (!any) { notifyTransient(t("csv.empty")); return; }

  loadXlsxLib(function () {
    try {
      var X = window.XLSX.utils;
      var wb = X.book_new();
      var used = {};
      sheets.forEach(function (sh) {
        var maxR = -1, maxC = -1, p, r, c;
        pref = sh.id + "|";
        for (k in state.cells) {
          if (k.indexOf(pref) !== 0) continue;
          p = k.split("|");
          r = parseInt(p[1], 10); c = parseInt(p[2], 10);
          if (r > maxR) maxR = r;
          if (c > maxC) maxC = c;
        }
        var aoa = [], row;
        for (r = 0; r <= maxR; r++) {
          row = [];
          for (c = 0; c <= maxC; c++) {
            var cel = state.cells[cellKey(sh.id, r, c)];
            row.push(cel ? xlOutVal(cel.v) : "");
          }
          aoa.push(row);
        }
        var ws = X.aoa_to_sheet(aoa);
        /* column widths ride along (px -> approx character width) */
        var colw = [];
        for (c = 0; c <= Math.max(maxC, 0); c++) {
          colw.push(sh.cw && sh.cw[c]
            ? { wch: Math.max(4, Math.round(sh.cw[c] / 8)) } : undefined);
        }
        try { ws["!cols"] = colw; } catch (e2) {}
        /* merged cells and custom row heights ride along too */
        var mgs = [], rows = [], any2 = false;
        for (k in state.cells) {
          if (k.indexOf(pref) !== 0) continue;
          var mf = state.cells[k].f;
          if (!mf || !(mf.mr || mf.mc)) continue;
          p = k.split("|"); r = +p[1]; c = +p[2];
          mgs.push({ s: { r: r, c: c }, e: { r: r + (mf.mr || 1) - 1, c: c + (mf.mc || 1) - 1 } });
        }
        if (mgs.length) ws["!merges"] = mgs;
        for (r in sh.rh || {}) { rows[+r] = { hpt: sh.rh[r] * 3 / 4 };   /* points (SheetJS writes hpx as points) */ any2 = true; }
        if (any2) ws["!rows"] = rows;
        var nm = xlSafeName(displayName(sh));
        while (used[nm]) nm = nm.slice(0, 28) + "_" + (Object.keys(used).length + 1);
        used[nm] = true;
        X.book_append_sheet(wb, ws, nm);
      });

      var out = window.XLSX.write(wb, { bookType: bookType, type: "array" });
      var ext = (bookType === "ods") ? "ods" : "xlsx";
      var mime = (bookType === "ods")
        ? "application/vnd.oasis.opendocument.spreadsheet"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      var fname = "oros-spreadsheet-" + xlStamp() + "." + ext;
      var done = function () {
        notifyTransient(t("xl.exported")
          .replace("{f}", ext.toUpperCase()));
      };
      var blob = new Blob([out], { type: mime });
      var dlg = dialogHost();
      if (dlg && typeof dlg.saveFile === "function") {
        // ES5: dynamic key via bracket assignment (bookType-dependent).
        var accept = {};
        accept[mime] = ["." + ext];
        dlg.saveFile({
          blob: blob,
          filename: fname,
          mime: mime,
          types: [{ description: ext.toUpperCase(),
                    accept: accept }]
        }).then(function (r) { if (r && r.ok) done(); });
        return;                   // cancel (ok=false) = silent exit
      }
      // Standalone fallback — classic download (no shell present).
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
      }, 500);
      done();
    } catch (e) {
      console.error("[SS] XLSX export failed:", e);
    }
  });
}

/* ===== SECTION 3g2: THE .orossheet FILE (orOS bundle) =====
   bundle.js (OrosBundle) + docs/oros-bundle.md. The whole workbook is
   one file: content.json = { kind: "oros-spreadsheet-package", ver: 1,
   workbook: { ver, sheets, cells, charts?, cf? } } (the synced model,
   tombstones left out; sheetkit.js bookContent), preview/NN-<name>.csv
   = each sheet's shown values, preview/thumbnail.png = the first
   sheet's top-left corner. No media: the app keeps no pictures.
   Opening one ADDS its sheets (fresh ids, normalizeState first), like
   the Excel import; an .xlsx / .ods / .xls still goes to xlImport. */
var BOOK_MIME = "application/x-oros-sheet";

/* a cell as text for the CSV preview: formulas by their result */
function bookCellText(sid, r, c, cel) {
  return SI.previewText(cel, function () { return evalCell(sid, r, c); }, FX);
}

/* the first sheet's top-left corner as a PNG (≤ 512 px), or null */
function bookThumb(sh) {
  return SI.thumbnail(function () { return document.createElement("canvas"); },
    function (r, c) { return state.cells[cellKey(sh.id, r, c)]; },
    function (r, c, cel) { return bookCellText(sh.id, r, c, cel); });
}

function bookSave() {
  if (!window.OrosBundle) { notifyTransient(t("xl.readerr")); return; }
  if (editing) commitEdit(0, 0);
  freshEval();
  var canon = canonSS(state);
  var preview = SI.previewFiles(KIT, canon, bookCellText, displayName);
  var title = t("title") + " " + xlStamp();
  bookThumb(canon.sheets[0]).then(function (thumb) {
    return OrosBundle.write(SI.writeOpts({ KIT: KIT, canon: canon, title: title, lang: LANG,
      active: actSID, now: now(), thumb: thumb, preview: preview }));
  }).then(function (bytes) {
    var fname = title + ".orossheet";
    var blob = new Blob([bytes], { type: BOOK_MIME });
    var done = function () { notifyTransient(t("xl.exported").replace("{f}", ".orossheet")); };
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: fname, mime: BOOK_MIME,
        types: [{ description: t("bk.exp"), accept: { "application/x-oros-sheet": [".orossheet"] } }] })
        .then(function (r) { if (r && r.ok) done(); });
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    done();
  }).catch(function (e) {
    console.error("[SS] .orossheet export failed:", e);
    notifyTransient(t("xl.readerr"));
  });
}

/* a read bundle (zip or unzipped folder) -> new sheets */
function bookApply(r) {
  var wb = KIT.bookWorkbook(r && r.content);
  var tmp = normalizeState(clone(wb));
  if (!tmp) throw new Error("notbook");
  var taken = [];
  state.sheets.forEach(function (sh) {
    if (sh.name !== null && sh.name !== undefined) taken.push(sh.name);
    else if (sh.bi) { taken.push(sh.bi.en); taken.push(sh.bi.el); }
  });
  var imp = KIT.importBook(tmp, { taken: taken, uid: uid, now: now(), pos: maxPos() + 1,
    mapRefs: FX.mapRefs, lang: LANG });
  if (!imp.sheets.length) throw new Error("notbook");
  if (editing) commitEdit(0, 0);
  imp.sheets.forEach(function (sh) { state.sheets.push(sh); });
  var k;
  for (k in imp.cells) state.cells[k] = imp.cells[k];
  state.charts = state.charts || {}; state.cf = state.cf || {};
  for (k in imp.charts) state.charts[k] = imp.charts[k];
  for (k in imp.cf) state.cf[k] = imp.cf[k];
  /* the tab that was open when it was saved, else the first */
  var act = r.settings && imp.ids[r.settings.active];
  markDirty();
  invalidateEval();
  switchTo(act || imp.sheets[0].id);
  notifyTransient(t("xl.imported").replace("{n}", imp.sheets.length));
}
function bookFail(e) {
  console.error("[SS] .orossheet import failed:", e);
  notifyTransient(t(e && e.code === "newer" ? "bk.newer" : "xl.readerr"));
}
/* a picked / shared file: an orOS bundle by its first bytes, else the
   Excel / Calc import as before */
function bookOrXlImport(f) {
  if (!window.OrosBundle || !f || typeof f.slice !== "function") { xlImport(f); return; }
  f.slice(0, 256).arrayBuffer().then(function (head) {
    var kind = OrosBundle.sniff(new Uint8Array(head));
    if (kind === null || kind === "") {
      if (/\.orossheet$/i.test(f.name || "")) throw new Error("notbook");
      xlImport(f);
      return;
    }
    return f.arrayBuffer()
      .then(function (ab) { return OrosBundle.read(new Uint8Array(ab), { mime: BOOK_MIME }); })
      .then(bookApply);
  }).catch(bookFail);
}
function bookPickFolder() {
  if (!window.OrosBundle) return;
  OrosBundle.pickFolder().then(function (files) {
    if (!files) return;
    return OrosBundle.readFolder(files, { mime: BOOK_MIME }).then(bookApply);
  }).catch(bookFail);
}

/* ---- toolbar buttons (JS-injected — zero dependence on
   unseen spreadsheet.html markup) ---- */
var xlMenu = null;
function closeXlMenu() { if (xlMenu) { xlMenu.remove(); xlMenu = null; } }

function toggleXlExportMenu(btn) {
  var items = [["xlsx", t("xl.xlsx")], ["ods", t("xl.ods")]];
  if (window.OrosBundle) items.push(["oros", t("bk.exp")]);
  items.push(["pdf", t("pr.open")]);
  toggleXlMenu(btn, items.map(function (o) {
    return [o[1], function () { if (o[0] === "oros") bookSave(); else if (o[0] === "pdf") openPrintDialog(); else xlExport(o[0]); }];
  }));
}
/* the import button: a file (Excel / Calc / orOS) or an unzipped
   orOS folder */
function toggleXlImportMenu(btn) {
  var items = [[t("bk.open"), xlPickFile]];
  if (window.OrosBundle) items.push([t("bk.folder"), bookPickFolder]);
  if (window.OrosGoogleMedia && OrosGoogleMedia.docReady()) items.push([t("gd.from"), xlFromGoogle]);
  toggleXlMenu(btn, items);
}
/* one Google Sheet (or an .xlsx / .ods in Drive), exported to .xlsx
   by ../files/gmedia.js, then the usual Excel import. Runs inside the
   menu click: Google's sign-in window needs it. */
function xlFromGoogle() {
  var GM = window.OrosGoogleMedia, lang = LANG2;
  var job = GM.pickDoc("spreadsheet", lang);
  notifyTransient(t("gd.wait"));
  job.then(function (f) {
    if (f) bookOrXlImport(f);
  }, function (e) {
    var msg = GM.docMessage(e, lang);
    if (msg) notifyTransient(msg);
  });
}
function xlPickFile() {
  var dlg = dialogHost(), acc = ".xlsx,.xls,.ods,.orossheet";
  if (dlg && typeof dlg.openFile === "function") {
    dlg.openFile(acc).then(function (f) {
      if (f) bookOrXlImport(f);   // cancel (null) = silent exit
    });
    return;
  }
  var inp = document.createElement("input");
  inp.type = "file";
  inp.accept = acc;
  inp.addEventListener("change", function () {
    if (inp.files && inp.files[0]) bookOrXlImport(inp.files[0]);
  });
  inp.click();
}
/* items: [[label, fn]] */
function toggleXlMenu(btn, items) {
  if (xlMenu) { closeXlMenu(); return; }
  var m = document.createElement("div");
  m.style.cssText =
    "position:fixed;z-index:1100;background:var(--panel-bg,#22242a);" +
    "border:1px solid var(--border,#333);border-radius:8px;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.35);padding:4px;" +
    "display:flex;flex-direction:column;gap:2px;min-width:175px;max-width:calc(100vw - 8px);";
  m.setAttribute("role", "menu");
  items.forEach(function (o) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.textContent = o[0];
    b.style.cssText =
      "text-align:left;padding:7px 12px;font:inherit;font-size:12.5px;" +
      "background:transparent;color:var(--text,#eee);border:none;" +
      "border-radius:6px;cursor:pointer;";
    b.addEventListener("mouseenter", function () {
      b.style.background = "var(--accent-soft,rgba(212,175,55,.15))";
    });
    b.addEventListener("mouseleave", function () {
      b.style.background = "transparent";
    });
    b.addEventListener("click", function () { closeXlMenu(); o[1](); });
    m.appendChild(b);
  });
  var br = btn.getBoundingClientRect();
  document.body.appendChild(m);
  void m.offsetWidth;
  m.style.left = Math.max(4, Math.min(br.left, window.innerWidth - m.offsetWidth - 4)) + "px";
  /* SS-9: the button sits in the footer — the menu opened below it,
     outside the window, and could not be reached. Open upwards when
     there is no room below. */
  var mh = m.offsetHeight;
  var top = br.bottom + 4;
  if (top + mh > window.innerHeight - 4) top = Math.max(4, br.top - mh - 4);
  m.style.top = top + "px";
  xlMenu = m;
}

function injectXlButtons() {
  var host = $("btn-csv-exp");
  if (!host || !host.parentElement) return;
  if ($("btn-xl-imp")) return;   /* idempotent */

  var imp = document.createElement("button");
  imp.type = "button";
  imp.id = "btn-xl-imp";
  imp.className = host.className;
  imp.title = t("xl.imp");
  imp.innerHTML = ICONS["csv-imp"] + "XLS";
  imp.setAttribute("aria-haspopup", "menu");
  imp.addEventListener("click", function () { toggleXlImportMenu(imp); });

  var exp = document.createElement("button");
  exp.type = "button";
  exp.id = "btn-xl-exp";
  exp.className = host.className;
  exp.title = t("xl.exp");
  exp.innerHTML = ICONS["csv-exp"] + "XL";
  exp.addEventListener("click", function () { toggleXlExportMenu(exp); });

  host.parentElement.insertBefore(imp, host.nextSibling);
  host.parentElement.insertBefore(exp, imp.nextSibling);

  /* close the import / export menu on outside click (swatch pattern) */
  document.addEventListener("click", function (e) {
    if (!xlMenu) return;
    if (xlMenu.contains(e.target)) return;
    var be = $("btn-xl-exp"), bi = $("btn-xl-imp");
    if (be && be.contains(e.target)) return;
    if (bi && bi.contains(e.target)) return;
    closeXlMenu();
  });
}

/* ===== SECTION 3i: WAVE 2 — MERGES · CELL FORMAT · CONDITIONAL
   FORMATTING · FILL HANDLE · TOUCH · SYSTEM CLIPBOARD · CHARTS =====
   Merges, fill colour, borders, wrap and vertical alignment live in
   the cell format f (mr / mc on the top-left cell; per-cell stamps as
   before). Charts and rules are records of their own (state.charts,
   state.cf: per-record mtime, tombstones "ch:<id>" / "cf:<id>"), so an
   older device that does not know them can never overwrite them with a
   sheet edit. Charts float over the grid in a layer placed by cell
   (anchor cell + offset), which the virtual rows do not disturb: a
   chart's place is computed from column lefts and row offsets, not from
   rendered rows. */

var CFST = {}, CFR = null, MG = null, MG_TOUCHED = [];
function resetDisp() { DISP = {}; CFST = {}; CFR = null; MG = null; }

/* ---------- merged cells ---------- */
function mergeMap() {
  if (MG) return MG;
  var sheet = getActiveSheet(), pref = actSID + "|", list = [], k;
  for (k in state.cells) {
    if (k.lastIndexOf(pref, 0) !== 0) continue;
    var f = state.cells[k].f;
    if (!f || !(f.mr || f.mc)) continue;
    var p = k.split("|"), r = +p[1], c = +p[2];
    if (r >= sheet.rows || c >= sheet.cols) continue;
    list.push({ r: r, c: c, r2: Math.min(sheet.rows - 1, r + (f.mr || 1) - 1), c2: Math.min(sheet.cols - 1, c + (f.mc || 1) - 1) });
  }
  list.sort(function (a, b) { return (a.r - b.r) || (a.c - b.c); });
  var out = [];
  list.forEach(function (m) {       /* two devices may merge overlapping areas: the first wins */
    for (var i = 0; i < out.length; i++) {
      var o = out[i];
      if (m.r <= o.r2 && m.r2 >= o.r && m.c <= o.c2 && m.c2 >= o.c) return;
    }
    out.push(m);
  });
  MG = { list: out };
  return MG;
}
function mergeAt(r, c) {
  var l = mergeMap().list;
  for (var i = 0; i < l.length; i++) {
    var m = l[i];
    if (r >= m.r && r <= m.r2 && c >= m.c && c <= m.c2) return m;
  }
  return null;
}
/* rowspan / colspan on the rendered rows only (the virtual window);
   covered cells are hidden, or drawn blank when their top-left cell
   is not in the window */
function fixMerges() {
  var i;
  for (i = 0; i < MG_TOUCHED.length; i++) {
    var x = MG_TOUCHED[i];
    x.style.display = ""; x.colSpan = 1; x.rowSpan = 1; x.classList.remove("mgc");
  }
  MG_TOUCHED = [];
  if (!POS) return;
  mergeMap().list.forEach(function (m) {
    var a = cellRefs[m.r] && cellRefs[m.r][m.c], rows = {}, cs = m.c2 - m.c + 1, n = 1, rr;
    if (m.c < FC && m.c2 >= FC) cs = FC - m.c;
    if (a && POS[m.r] >= 0) {
      var fr = POS[m.r] < SL0;
      for (rr = m.r + 1; rr <= m.r2; rr++) {
        if (POS[rr] < 0) continue;
        if (!rowEls[rr] || ((POS[rr] < SL0) !== fr)) break;
        rows[rr] = 1; n++;
      }
      a.rowSpan = n; a.colSpan = cs; MG_TOUCHED.push(a);
    } else a = null;
    for (rr = m.r; rr <= m.r2; rr++) {
      var tds = cellRefs[rr];
      if (!tds) continue;
      for (var c = m.c; c <= m.c2; c++) {
        if (rr === m.r && c === m.c) continue;
        var td = tds[c];
        if (!td) continue;
        if (a && (rr === m.r || rows[rr]) && c < m.c + cs) td.style.display = "none";
        else td.classList.add("mgc");
        MG_TOUCHED.push(td);
      }
    }
  });
}
/* the height a wrapped cell may use (a merge: its rows) */
function spanHeight(r, c) {
  var sheet = getActiveSheet(), m = mergeAt(r, c), h = 0;
  if (!m || m.r !== r || m.c !== c) return rowH(sheet, r);
  for (var rr = m.r; rr <= m.r2 && rr < m.r + 60; rr++) if (!POS || POS[rr] >= 0) h += rowH(sheet, rr);
  return h || rowH(sheet, r);
}

/* ---------- conditional formatting (evaluation) ---------- */
function cfRules() {
  if (CFR) return CFR;
  CFR = [];
  var sh = getActiveSheet();
  for (var id in state.cf) {
    var x = state.cf[id];
    if (x.sid !== actSID) continue;
    var g = KIT.parseRange(x.rg, MAX_ROWS, MAX_COLS);
    if (g) CFR.push({ x: x, g: g });
  }
  CFR.sort(function (a, b) { return (a.x.pos - b.x.pos) || (a.x.id < b.x.id ? -1 : 1); });
  void sh;
  return CFR;
}
/* the evaluated value of a cell of the open sheet (null = blank) */
function cellValue(r, c) {
  var cel = getCell(r, c);
  if (!cel || cel.v === "") return null;
  if (cel.v.charAt(0) === "=") return evalCell(actSID, r, c);
  return FX.literal(cel.v);
}
var CF_NEEDS_STATS = { top: 1, bot: 1, dup: 1, cs: 1, db: 1, ic: 1 };
/* a formula rule: its formula is written for the top-left cell of the
   range and moves with each cell like a copied formula (=$B2>100);
   TRUE or a number other than 0 colours the cell. Run by the sheet's
   own engine, never as script. */
function cfFxHit(ru, r, c) {
  var key = "fx|" + ru.x.id + "|" + r + "|" + c;
  if (CFST[key] !== undefined) return CFST[key];
  var f = String(ru.x.a || "").trim(), hit = false;
  if (f) {
    if (f.charAt(0) !== "=") f = "=" + f;
    var v = ENG.formula(actSID, FX.shiftFormula(f, r - ru.g.t, c - ru.g.l));
    hit = v === true || (typeof v === "number" && v !== 0);
  }
  CFST[key] = hit;
  return hit;
}
function cfStatsFor(rule) {
  if (CFST[rule.x.id]) return CFST[rule.x.id];
  var ext = sheetExtent(actSID), g = rule.g, vals = [], r, c;
  var b = Math.min(g.b, ext.rows - 1), rr = Math.min(g.r, ext.cols - 1);
  for (r = g.t; r <= b; r++) for (c = g.l; c <= rr; c++) vals.push(cellValue(r, c));
  CFST[rule.x.id] = KIT.cfStats(rule.x, vals);
  return CFST[rule.x.id];
}
/* the first rule (by priority) that sets a property wins it */
function cfAt(r, c) {
  var rules = cfRules();
  if (!rules.length) return null;
  var out = null, v, got = false;
  for (var i = 0; i < rules.length; i++) {
    var ru = rules[i];
    if (!KIT.inRange(ru.g, r, c)) continue;
    if (!got) { v = cellValue(r, c); got = true; }
    var s;
    if (ru.x.k === "fx") s = KIT.cfStyle(ru.x, v, {}, cfFxHit(ru, r, c));
    else if (v === null) continue;
    else s = KIT.cfStyle(ru.x, v, CF_NEEDS_STATS[ru.x.k] ? cfStatsFor(ru) : {});
    if (!s) continue;
    out = out || {};
    for (var k in s) if (out[k] === undefined) out[k] = s[k];
  }
  return out;
}

/* ---------- records (charts / rules) with Undo ---------- */
function applyObj(kind, id, rec) {
  var pre = kind === "charts" ? "ch:" : "cf:";
  if (!rec) {
    if (state[kind][id]) { delete state[kind][id]; state.deleted[pre + id] = now(); }
    return;
  }
  var x = clone(rec), tomb = state.deleted[pre + id] || 0;
  x.id = id;
  x.mtime = Math.max(now(), tomb + 1);
  x = (kind === "charts" ? KIT.normChart : KIT.normCf)(x);
  if (x) { state[kind][id] = x; delete state.deleted[pre + id]; }
}
/* write a record (null = delete) and return its Undo entry */
function putObj(kind, id, rec) {
  var before = state[kind][id] ? clone(state[kind][id]) : null;
  applyObj(kind, id, rec);
  return { obj: kind, id: id, before: before, after: state[kind][id] ? clone(state[kind][id]) : null };
}
function objDone(entries) {
  pushUndo(entries);
  CFR = null; CFST = {};
  markDirty();
  queueSave();
  renderGrid();
}
/* insert / delete rows or columns: rule ranges and chart ranges and
   anchors follow (KIT.adjRange); a range wholly deleted drops its rule */
function adjustObjs(sid, axis, at, n) {
  var out = [], id, x, y, g;
  for (id in state.cf) {
    x = state.cf[id];
    if (x.sid !== sid) continue;
    g = KIT.parseRange(x.rg);
    var ng = g && KIT.adjRange(g, axis, at, n);
    if (!ng) { out.push(putObj("cf", id, null)); continue; }
    if (KIT.rangeStr(ng) !== x.rg) { y = clone(x); y.rg = KIT.rangeStr(ng); out.push(putObj("cf", id, y)); }
  }
  for (id in state.charts) {
    x = state.charts[id];
    if (x.sid !== sid) continue;
    y = clone(x);
    g = KIT.parseRange(x.src);
    if (g) { var g2 = KIT.adjRange(g, axis, at, n); y.src = g2 ? KIT.rangeStr(g2) : "#REF!"; }
    var k = axis === "r" ? "r" : "c", a = y.at[k];
    if (n > 0) { if (a >= at) y.at[k] = a + n; }
    else if (a > at - n - 1) y.at[k] = a + n;
    else if (a >= at) y.at[k] = at;
    if (JSON.stringify(y) !== JSON.stringify(x)) out.push(putObj("charts", id, y));
  }
  return out;
}

/* ---------- cell format menu ---------- */
var FILLS = ["#fde68a", "#fecaca", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fed7aa", "#c8a96e", "#5b8def", "#1baf7a", "#e34948"];
function fmtFill(bg) { return function (f) { if (bg) f.bg = bg; else delete f.bg; return { f: f }; }; }
function fmtBorder(mode) {
  var T = selTop(), L = selLeft();
  return function (f, r, c, B, R) {
    var s = f.bd || "";
    if (mode === "none") s = "";
    else if (mode === "all") s = "tblr";
    else if (mode === "bot") { if (r === B) s += "b"; }
    else { if (r === T) s += "t"; if (r === B) s += "b"; if (c === L) s += "l"; if (c === R) s += "r"; }
    if (s) f.bd = s; else delete f.bd;
    return { f: f };
  };
}
function fmtSet(field, val) { return function (f) { if (val) f[field] = val; else delete f[field]; return { f: f }; }; }
function toggleWrap() {
  var cel = getCell(selR, selC), on = !(cel && cel.f && cel.f.wr);
  applyFormatToSelection(fmtSet("wr", on ? 1 : 0));
  if (on) autofitRows(selTop(), selBottom());
}
/* a row with wrapped text grows to show it (rows in view; ≤ 300) */
function autofitRows(top, bot) {
  var sheet = getActiveSheet(), before = dimsOf(sheet), changed = false, r, c;
  var ext = sheetExtent(actSID), probe = document.createElement("div");
  probe.className = "fit-probe";
  document.body.appendChild(probe);
  bot = Math.min(bot, top + 300, ext.rows - 1);
  for (r = top; r <= bot; r++) {
    var need = 0;
    for (c = 0; c < Math.min(ext.cols, sheet.cols); c++) {
      var cel = getCell(r, c);
      if (!cel || !cel.f || !cel.f.wr || cel.v === "") continue;
      var m = mergeAt(r, c), w = 0;
      if (m && (m.r !== r || m.c !== c)) continue;
      for (var cc = c; cc <= (m ? m.c2 : c); cc++) w += colW(sheet, cc);
      probe.style.width = Math.max(20, w - 12) + "px";
      probe.textContent = displayVal(r, c);
      need = Math.max(need, probe.offsetHeight + 8);
    }
    var cur = sheet.rh && sheet.rh[r], h = need > ROWH ? Math.min(RH_MAX, need) : 0;
    if (h && h !== cur) { sheet.rh = sheet.rh || {}; sheet.rh[r] = h; changed = true; }
  }
  probe.remove();
  if (!changed) return;
  sheet.mtime = now();
  var last = undoStack[undoStack.length - 1];
  if (last) last.push({ dim: true, sid: actSID, before: before, after: dimsOf(sheet) });
  markDirty();
  buildGrid(); renderGrid(); renderSelection();
}
/* mode: "all" one block, "h" each row, "v" each column, "un" undo merges */
function mergeSel(mode) {
  if (editing) commitEdit(0, 0);
  closePops();
  var T = selTop(), B = selBottom(), L = selLeft(), R = selRight(), ext = sheetExtent(actSID);
  if (B - T > 499 && mode !== "un") B = Math.max(T, Math.min(B, ext.rows - 1));
  if (mode !== "un" && B - T > 499) { notifyTransient(t("mg.big")); return; }
  var changes = {}, cleared = false;
  function snapOf(r, c) {
    var key = cellKey(actSID, r, c);
    return changes.hasOwnProperty(key) ? changes[key] : snapFull(actSID, r, c);
  }
  mergeMap().list.forEach(function (m) {
    if (m.r > B || m.r2 < T || m.c > R || m.c2 < L) return;
    var sn = snapOf(m.r, m.c);
    if (sn && sn.f) { sn = clone(sn); delete sn.f.mr; delete sn.f.mc; changes[cellKey(actSID, m.r, m.c)] = sn; }
  });
  var groups = [], r, c;
  if (mode === "all") groups.push({ t: T, b: B, l: L, r: R });
  else if (mode === "h") for (r = T; r <= B; r++) groups.push({ t: r, b: r, l: L, r: R });
  else if (mode === "v") for (c = L; c <= R; c++) groups.push({ t: T, b: B, l: c, r: c });
  groups.forEach(function (g) {
    if (g.t === g.b && g.l === g.r) return;
    var a = snapOf(g.t, g.l);
    a = a ? clone(a) : { v: "" };
    a.f = a.f || {};
    if (g.b > g.t) a.f.mr = g.b - g.t + 1; else delete a.f.mr;
    if (g.r > g.l) a.f.mc = g.r - g.l + 1; else delete a.f.mc;
    changes[cellKey(actSID, g.t, g.l)] = a;
    for (r = g.t; r <= g.b; r++) for (c = g.l; c <= g.r; c++) {
      if (r === g.t && c === g.l) continue;
      var sn = snapOf(r, c);
      if (sn && sn.v !== "") cleared = true;
      if (sn) changes[cellKey(actSID, r, c)] = null;
    }
  });
  if (commitChanges(changes)) {
    queueSave();
    renderGrid(); renderSelection();
    if (cleared) notifyTransient(t("mg.kept"));
  }
}

function openFormatMenu(anchor) {
  if (editing) commitEdit(0, 0);
  closePops();
  var cel = getCell(selR, selC), f = (cel && cel.f) || {};
  var m = document.createElement("div");
  m.className = "ss-pop ss-menu fmt-menu";
  m.setAttribute("role", "menu");
  m.setAttribute("aria-label", t("tb.fmt"));
  function item(text, fn, on) {
    var b = mkBtn((on ? "✓ " : "") + text, "mi", function () { closePops(); fn(); });
    b.setAttribute("role", "menuitem");
    m.appendChild(b);
  }
  function sep() { var d = document.createElement("div"); d.className = "msep"; m.appendChild(d); }
  function head(text) { var d = document.createElement("div"); d.className = "mh"; d.textContent = text; m.appendChild(d); }
  head(t("fill.title"));
  var row = document.createElement("div");
  row.className = "fill-row";
  FILLS.forEach(function (co) {
    var b = mkBtn("", "fsw" + (f.bg === co ? " on" : ""), function () { closePops(); applyFormatToSelection(fmtFill(co)); });
    b.style.background = co;
    b.title = co;
    b.setAttribute("aria-label", t("fill.title") + " " + co);
    row.appendChild(b);
  });
  var nb = mkBtn(t("fill.none"), "fsw none", function () { closePops(); applyFormatToSelection(fmtFill(null)); });
  row.appendChild(nb);
  m.appendChild(row);
  sep();
  item(t("bd.out"), function () { applyFormatToSelection(fmtBorder("out")); });
  item(t("bd.all"), function () { applyFormatToSelection(fmtBorder("all")); });
  item(t("bd.bot"), function () { applyFormatToSelection(fmtBorder("bot")); });
  item(t("bd.none"), function () { applyFormatToSelection(fmtBorder("none")); });
  sep();
  item(t("wrap"), toggleWrap, !!f.wr);
  item(t("va.t"), function () { applyFormatToSelection(fmtSet("va", f.va === "t" ? 0 : "t")); }, f.va === "t");
  item(t("va.m"), function () { applyFormatToSelection(fmtSet("va", f.va === "m" ? 0 : "m")); }, f.va === "m");
  item(t("va.b"), function () { applyFormatToSelection(fmtSet("va", f.va === "b" ? 0 : "b")); }, f.va === "b");
  sep();
  item(t("mg.all"), function () { mergeSel("all"); });
  item(t("mg.h"), function () { mergeSel("h"); });
  item(t("mg.v"), function () { mergeSel("v"); });
  item(t("mg.un"), function () { mergeSel("un"); });
  sep();
  item(t("cf.open"), function () { openCfManager(); });
  m.addEventListener("click", function (e) { e.stopPropagation(); });
  m.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePops(); $("grid-wrap").focus(); }
  });
  placePop(m, anchor);
}

/* ---------- conditional formatting: the rules manager ---------- */
var CF_STYLES = [
  ["cf.s.red", { bg: "#f8c4c4" }], ["cf.s.green", { bg: "#bfe8c8" }], ["cf.s.yellow", { bg: "#f6e3a1" }],
  ["cf.s.blue", { bg: "#c3d8f5" }], ["cf.s.redtx", { co: "#e34948", b: 1 }], ["cf.s.greentx", { co: "#1baf7a", b: 1 }],
  ["cf.s.bold", { b: 1 }]
];
var CF_SCALES = [
  ["cf.cs.rg", ["#e34948", "#1baf7a"]], ["cf.cs.gr", ["#1baf7a", "#e34948"]], ["cf.cs.wb", ["#f4f4f4", "#2a78d6"]],
  ["cf.cs.ryg", ["#e34948", "#f6e3a1", "#1baf7a"]], ["cf.cs.gyr", ["#1baf7a", "#f6e3a1", "#e34948"]],
  ["cf.cs.bwr", ["#2a78d6", "#f4f4f4", "#e34948"]]
];
var CF_BARS = ["#2a78d6", "#1baf7a", "#e34948", "#eb6834", "#6250d6"];
function cfDesc(x) {
  var k = x.k, s = t("cf.k." + k);
  if (k === "gt" || k === "lt" || k === "eq") s += " " + x.a;
  else if (k === "bt") s += " " + x.a + " – " + x.b;
  else if (k === "tx") s += " “" + x.a + "”";
  else if (k === "top" || k === "bot") s += " " + x.n;
  else if (k === "fx") s += " " + x.a;
  else if (k === "ic") s += " · " + t("cf.ic." + (x.is || "ar"));
  return s;
}
function cfChip(x) {
  var d = document.createElement("span");
  d.className = "cf-chip";
  if (x.k === "cs") d.style.background = "linear-gradient(90deg," + x.cs.join(",") + ")";
  else if (x.k === "db") d.style.background = "linear-gradient(90deg," + x.db + " 60%,transparent 60%)";
  else if (x.k === "ic") {
    var set = KIT.CF_ICONS[x.is] || KIT.CF_ICONS.ar;
    set.forEach(function (g, i) { var e = document.createElement("span"); e.textContent = g; e.style.color = KIT.CF_ICON_CO[i]; d.appendChild(e); });
  }
  else {
    if (x.st.bg) d.style.background = x.st.bg;
    d.style.color = x.st.co || (x.st.bg ? KIT.inkOn(x.st.bg) : "");
    if (x.st.b) d.style.fontWeight = "700";
    d.textContent = "Ab";
  }
  return d;
}
function sheetRules() {
  var out = [];
  for (var id in state.cf) if (state.cf[id].sid === actSID) out.push(state.cf[id]);
  out.sort(function (a, b) { return (a.pos - b.pos) || (a.id < b.id ? -1 : 1); });
  return out;
}
function selRangeStr() {
  var ext = sheetExtent(actSID), sh = getActiveSheet();
  var g = { t: selTop(), b: selBottom(), l: selLeft(), r: selRight() };
  if (g.b - g.t > 200 && g.b === sh.rows - 1) g.b = Math.max(g.t, ext.rows - 1);
  if (g.r - g.l > 26 && g.r === sh.cols - 1) g.r = Math.max(g.l, ext.cols - 1);
  return KIT.rangeStr(g);
}
function popShell(title, cls) {
  closePops();
  var pop = document.createElement("div");
  pop.className = "ss-pop " + (cls || "");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", title);
  var h = document.createElement("div");
  h.className = "pop-h";
  h.textContent = title;
  pop.appendChild(h);
  pop.addEventListener("click", function (e) { e.stopPropagation(); });
  pop.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  pop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closePops(); $("grid-wrap").focus(); }
    e.stopPropagation();
  });
  return pop;
}
function field(pop, label, el) {
  var w = document.createElement("label");
  w.className = "pop-f";
  var s = document.createElement("span");
  s.textContent = label;
  w.appendChild(s); w.appendChild(el);
  pop.appendChild(w);
  return w;
}
function mkInput(val, ph) {
  var i = document.createElement("input");
  i.type = "text"; i.className = "pop-q"; i.value = val || ""; i.autocomplete = "off"; i.spellcheck = false;
  if (ph) i.placeholder = ph;
  return i;
}
function mkSelect(opts, val) {
  var s = document.createElement("select");
  s.className = "pop-q";
  opts.forEach(function (o) {
    var op = document.createElement("option");
    op.value = o[0]; op.textContent = o[1];
    if (o[0] === val) op.selected = true;
    s.appendChild(op);
  });
  return s;
}
function openCfManager() {
  if (editing) commitEdit(0, 0);
  var pop = popShell(t("cf.title"), "cf-dlg");
  var list = document.createElement("div");
  list.className = "pop-list cf-list";
  var rules = sheetRules();
  if (!rules.length) {
    var e = document.createElement("div");
    e.className = "pop-note";
    e.textContent = t("cf.none");
    list.appendChild(e);
  }
  rules.forEach(function (x, i) {
    var row = document.createElement("div");
    row.className = "cf-row";
    row.appendChild(cfChip(x));
    var d = document.createElement("span");
    d.className = "cf-d";
    d.textContent = x.rg + " · " + cfDesc(x);
    row.appendChild(d);
    if (i > 0) {
      var up = mkBtn("↑", "ic", function () {
        var p = rules[i - 1], a = clone(x), b = clone(p), pa = a.pos;
        a.pos = b.pos; b.pos = pa;
        if (a.pos === b.pos) a.pos = b.pos - 1;
        objDone([putObj("cf", x.id, a), putObj("cf", p.id, b)]);
        openCfManager();
      });
      up.title = t("cf.up"); up.setAttribute("aria-label", t("cf.up"));
      row.appendChild(up);
    }
    var ed = mkBtn(t("cf.edit"), "", function () { openCfEditor(x); });
    row.appendChild(ed);
    var del = mkBtn("✕", "ic", function () { objDone([putObj("cf", x.id, null)]); openCfManager(); });
    del.title = t("cf.del"); del.setAttribute("aria-label", t("cf.del"));
    row.appendChild(del);
    list.appendChild(row);
  });
  pop.appendChild(list);
  var note = document.createElement("div");
  note.className = "pop-note";
  note.textContent = t("cf.prio");
  if (rules.length > 1) pop.appendChild(note);
  var btns = document.createElement("div");
  btns.className = "pop-btns";
  btns.appendChild(mkBtn(t("close"), "", closePops));
  btns.appendChild(mkBtn(t("cf.add"), "primary", function () { openCfEditor(null); }));
  pop.appendChild(btns);
  placePop(pop, { el: $("tb-fmt") });
}
function openCfEditor(rule) {
  var x = rule ? clone(rule) : { k: "gt", rg: selRangeStr(), a: "", b: "", n: 10, st: clone(CF_STYLES[0][1]) };
  var pop = popShell(rule ? t("cf.editt") : t("cf.add"), "cf-dlg");
  var rg = mkInput(x.rg, "A1:B10");
  var rgw = field(pop, t("cf.range"), rg);
  var useSel = mkBtn(t("use.sel"), "", function () { rg.value = selRangeStr(); });
  rgw.appendChild(useSel);
  var kind = mkSelect(KIT.CF_KINDS.map(function (k) { return [k, t("cf.k." + k)]; }), x.k);
  field(pop, t("cf.kind"), kind);
  var a = mkInput(x.a), b = mkInput(x.b), n = mkInput(String(x.n || 10));
  n.inputMode = "numeric";
  var fa = field(pop, t("cf.val"), a), fb = field(pop, t("cf.and"), b), fn = field(pop, t("cf.n"), n);
  var faLab = fa.querySelector("span"), fxHint = document.createElement("div");
  fxHint.className = "pop-note"; fxHint.textContent = t("cf.fx.hint");
  fa.parentNode.insertBefore(fxHint, fa.nextSibling);
  var choice = document.createElement("div");
  choice.className = "cf-choice";
  pop.appendChild(choice);
  var cur = { st: x.st || clone(CF_STYLES[0][1]), cs: x.cs || CF_SCALES[0][1].slice(), db: x.db || CF_BARS[0], is: x.is || "ar" };
  function paintChoice() {
    choice.innerHTML = "";
    var k = kind.value;
    var opts = k === "cs" ? CF_SCALES.map(function (s) { return { lab: t(s[0]), rec: { k: "cs", cs: s[1] }, on: JSON.stringify(s[1]) === JSON.stringify(cur.cs), set: function () { cur.cs = s[1].slice(); } }; })
      : k === "db" ? CF_BARS.map(function (c) { return { lab: "", rec: { k: "db", db: c }, on: c === cur.db, set: function () { cur.db = c; } }; })
      : k === "ic" ? ["ar", "dt"].map(function (c) { return { lab: t("cf.ic." + c), rec: { k: "ic", is: c }, on: c === cur.is, set: function () { cur.is = c; } }; })
      : CF_STYLES.map(function (s) { return { lab: t(s[0]), rec: { k: "gt", st: s[1] }, on: JSON.stringify(s[1]) === JSON.stringify(cur.st), set: function () { cur.st = clone(s[1]); } }; });
    opts.forEach(function (o) {
      var bt = mkBtn("", "cf-opt" + (o.on ? " on" : ""), function () { o.set(); paintChoice(); });
      bt.appendChild(cfChip(o.rec));
      if (o.lab) { var sp = document.createElement("span"); sp.textContent = o.lab; bt.appendChild(sp); }
      bt.setAttribute("aria-pressed", o.on ? "true" : "false");
      choice.appendChild(bt);
    });
    var vk = k === "gt" || k === "lt" || k === "eq" || k === "tx" || k === "bt" || k === "fx";
    fa.hidden = !vk; fxHint.hidden = k !== "fx";
    if (faLab) faLab.textContent = k === "fx" ? t("cf.fx") : t("cf.val");
    a.placeholder = k === "fx" ? t("cf.fx.ph") : ""; fb.hidden = k !== "bt"; fn.hidden = !(k === "top" || k === "bot");
  }
  kind.addEventListener("change", paintChoice);
  paintChoice();
  var btns = document.createElement("div");
  btns.className = "pop-btns";
  btns.appendChild(mkBtn(t("flt.cancel"), "", openCfManager));
  btns.appendChild(mkBtn(t("save"), "primary", function () {
    var sh = getActiveSheet(), g = KIT.parseRange(rg.value, sh.rows, sh.cols);
    if (!g) { notifyTransient(t("cf.badrange")); rg.focus(); return; }
    var k = kind.value;
    if ((k === "gt" || k === "lt" || k === "eq" || k === "tx" || k === "bt" || k === "fx") && !a.value.trim()) { a.focus(); return; }
    if (k === "bt" && !b.value.trim()) { b.focus(); return; }
    var maxPos = 0;
    sheetRules().forEach(function (q) { if (q.pos > maxPos) maxPos = q.pos; });
    var rec = { sid: actSID, pos: rule ? rule.pos : maxPos + 1, rg: KIT.rangeStr(g), k: k,
      a: a.value.trim(), b: b.value.trim(), n: parseInt(n.value, 10) || 10, st: cur.st, cs: cur.cs, db: cur.db, is: cur.is };
    objDone([putObj("cf", rule ? rule.id : uid(), rec)]);
    openCfManager();
  }));
  pop.appendChild(btns);
  placePop(pop, { el: $("tb-fmt") });
  try { rg.focus({ preventScroll: true }); } catch (e) {}
}

/* ---------- row heights · column widths by touch ---------- */
var rhDrag = null;
function setRowHLive(r, h) {
  if (rowHeads[r]) rowHeads[r].style.height = h + "px";
  (cellRefs[r] || []).forEach(function (td) { td.style.height = h + "px"; });
}
function commitRowH(r, h) {
  var sheet = getActiveSheet(), before = dimsOf(sheet);
  h = Math.max(RH_MIN, Math.min(RH_MAX, Math.round(h)));
  sheet.rh = sheet.rh || {};
  if (Math.abs(h - ROWH) < 2) delete sheet.rh[r]; else sheet.rh[r] = h;
  if (JSON.stringify(before.rh || {}) === JSON.stringify(normRh(sheet.rh) || {})) { buildGrid(); renderGrid(); renderSelection(); return; }
  sheet.mtime = now();
  pushUndo([{ dim: true, sid: actSID, before: before, after: dimsOf(sheet) }]);
  markDirty();
  buildGrid(); renderGrid(); renderSelection();
}
function setColWLive(col, w) {
  var sheet = getActiveSheet();
  if (!sheet) return;
  sheet.cw = sheet.cw || {};
  sheet.cw[col] = w;
  if (colHeads[col + 1]) colHeads[col + 1].style.width = w + "px";
  for (var key in cellRefs) {
    var td = cellRefs[key][col];
    if (td) { td.style.width = w + "px"; td.style.minWidth = w + "px"; }
  }
}
function commitColW() {
  var sheet = getActiveSheet();
  if (!sheet) return;
  sheet.mtime = now(); markDirty();
  if (FC) { buildGrid(); renderGrid(); renderSelection(); }   /* frozen offsets */
  else {
    COLLEFT = []; var x = ROWHEADW;
    for (var c = 0; c < sheet.cols; c++) { COLLEFT.push(x); x += colW(sheet, c); }
    BUILT = layoutSig(sheet);
    scheduleOverlay();
  }
}

/* ---------- fill handle ---------- */
var fillH = null, fillDrag = null, RANGE_MODE = false;
function placeFillHandle() {
  if (!fillH) return;
  var hide = editing || CHSEL || selBottom() - selTop() > 5000;
  var r = selBottom(), c = selRight(), m = !hide && mergeAt(r, c);
  if (m) { r = m.r; c = m.c; }
  var td = !hide && cellRefs[r] && cellRefs[r][c];
  if (!td || td.style.display === "none") { fillH.hidden = true; return; }
  var wrap = $("grid-wrap"), wr = wrap.getBoundingClientRect(), tr = td.getBoundingClientRect();
  fillH.hidden = false;
  fillH.style.left = (tr.right - wr.left + wrap.scrollLeft - wrap.clientLeft - 5) + "px";
  fillH.style.top = (tr.bottom - wr.top + wrap.scrollTop - wrap.clientTop - 5) + "px";
}
function cellFromPoint(x, y) {
  var els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!el || el === fillH) continue;
    if (el.closest && el.closest("#grid")) {
      var p = gridPos(el);
      return p && p.td !== undefined ? p : null;
    }
  }
  return null;
}
var FILLPREV = [];
function showFillPrev(g) {
  FILLPREV.forEach(function (td) { td.classList.remove("fillprev"); });
  FILLPREV = [];
  if (!g) return;
  for (var r = g.t; r <= g.b; r++) {
    var tds = cellRefs[r];
    if (!tds) continue;
    for (var c = g.l; c <= g.r; c++) if (tds[c]) { tds[c].classList.add("fillprev"); FILLPREV.push(tds[c]); }
  }
}
function fillTarget(p) {
  var T = selTop(), B = selBottom(), L = selLeft(), R = selRight();
  var d = { d: p.r - B, u: T - p.r, r: p.c - R, l: L - p.c }, best = null, k;
  for (k in d) if (d[k] > 0 && (!best || d[k] > d[best])) best = k;
  if (!best) return null;
  var g = best === "d" ? { t: B + 1, b: p.r, l: L, r: R } : best === "u" ? { t: p.r, b: T - 1, l: L, r: R }
    : best === "r" ? { t: T, b: B, l: R + 1, r: p.c } : { t: T, b: B, l: p.c, r: L - 1 };
  return { dir: best, n: d[best], g: g };
}
function fillMove(x, y) {
  if (!fillDrag) return;
  fillDrag.x = x; fillDrag.y = y;
  var p = cellFromPoint(x, y);
  if (!p) return;
  fillDrag.tg = fillTarget(p);
  showFillPrev(fillDrag.tg && fillDrag.tg.g);
}
function fillAuto() {
  if (!fillDrag) return;
  var wrap = $("grid-wrap"), br = wrap.getBoundingClientRect(), dx = 0, dy = 0;
  if (fillDrag.y > br.bottom - 28) dy = 18; else if (fillDrag.y < br.top + HEADH + FRH + 8) dy = -18;
  if (fillDrag.x > br.right - 28) dx = 18; else if (fillDrag.x < br.left + ROWHEADW + 8) dx = -18;
  if (dx || dy) { wrap.scrollTop += dy; wrap.scrollLeft += dx; renderWindow(false); fillMove(fillDrag.x, fillDrag.y); }
  fillDrag.raf = (window.requestAnimationFrame || setTimeout)(fillAuto);
}
function initFillHandle() {
  var wrap = $("grid-wrap");
  fillH = document.createElement("div");
  fillH.id = "fill-h";
  fillH.hidden = true;
  fillH.title = t("fill.handle");
  fillH.setAttribute("aria-hidden", "true");
  wrap.appendChild(fillH);
  fillH.addEventListener("pointerdown", function (e) {
    if (e.button && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (editing) commitEdit(0, 0);
    try { fillH.setPointerCapture(e.pointerId); } catch (er) {}
    fillDrag = { x: e.clientX, y: e.clientY, tg: null, inc: e.ctrlKey || e.metaKey };
    fillDrag.raf = (window.requestAnimationFrame || setTimeout)(fillAuto);
  });
  fillH.addEventListener("pointermove", function (e) {
    if (!fillDrag) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) fillDrag.inc = true;
    fillMove(e.clientX, e.clientY);
  });
  function end(e, cancel) {
    if (!fillDrag) return;
    var d = fillDrag;
    fillDrag = null;
    (window.cancelAnimationFrame || clearTimeout)(d.raf);
    showFillPrev(null);
    if (!cancel && d.tg) doFill(d.tg.dir, d.tg.n, d.inc);
    void e;
  }
  fillH.addEventListener("pointerup", function (e) { end(e, false); });
  fillH.addEventListener("pointercancel", function (e) { end(e, true); });
}
/* fill n cells in direction dir ("d", "u", "r", "l") from the selection:
   series continue (KIT.fillSeries), the rest repeats, formulas shift */
function doFill(dir, n, inc) {
  var sheet = getActiveSheet(), T = selTop(), B = selBottom(), L = selLeft(), R = selRight();
  var vert = dir === "d" || dir === "u", back = dir === "u" || dir === "l";
  if ((B - T + 1) * (R - L + 1) > 20000) { notifyTransient(t("fill.big")); return; }
  if (dir === "d") n = Math.min(n, MAX_ROWS - 1 - B);
  if (dir === "r") n = Math.min(n, MAX_COLS - 1 - R);
  if (dir === "u") n = Math.min(n, T);
  if (dir === "l") n = Math.min(n, L);
  if (n <= 0) return;
  var dim = null, before = dimsOf(sheet);
  if (dir === "d" && B + n >= sheet.rows) { sheet.rows = B + n + 1; }
  if (dir === "r" && R + n >= sheet.cols) { sheet.cols = R + n + 1; }
  if (sheet.rows !== before.rows || sheet.cols !== before.cols) {
    sheet.mtime = now();
    dim = { dim: true, sid: actSID, before: before, after: dimsOf(sheet) };
  }
  var changes = {}, lane, i, j;
  var lanes = vert ? [L, R] : [T, B], k = vert ? B - T + 1 : R - L + 1, s0 = vert ? T : L;
  function src(lane, idx) { return vert ? snapFull(actSID, s0 + idx, lane) : snapFull(actSID, lane, s0 + idx); }
  function strip(sn) { if (sn && sn.f) { delete sn.f.mr; delete sn.f.mc; } return sn; }
  for (lane = lanes[0]; lane <= lanes[1]; lane++) {
    var raws = [], dates = [];
    for (i = 0; i < k; i++) {
      var sn = src(lane, i);
      raws.push(sn ? sn.v : "");
      dates.push(!!(sn && sn.f && sn.f.nf === "d"));
    }
    var ents = KIT.fillSeries(raws, n, { back: back, inc: inc, dates: dates, lang: LANG });
    for (j = 0; j < ents.length; j++) {
      var pos = back ? s0 - 1 - j : s0 + k + j;
      if (pos < 0) break;
      var key = vert ? cellKey(actSID, pos, lane) : cellKey(actSID, lane, pos), e = ents[j], out;
      if (e.copy !== undefined) {
        out = strip(src(lane, e.copy));
        if (out && out.v.charAt(0) === "=") {
          var dd = pos - (s0 + e.copy);
          out.v = vert ? shiftFormula(out.v, dd, 0) : shiftFormula(out.v, 0, dd);
          delete out.cv;
        }
      } else {
        var fs = strip(src(lane, back ? k - 1 - (j % k) : j % k));
        out = { v: e.v };
        if (fs && fs.f) out.f = fs.f;
      }
      changes[key] = out;
    }
  }
  commitChanges(changes, dim);
  if (dim) buildGrid();
  var g = { t: T, b: B, l: L, r: R };
  if (dir === "d") g.b = B + n; else if (dir === "u") g.t = T - n; else if (dir === "r") g.r = R + n; else g.l = L - n;
  selR = g.t; selC = g.l; selAR = g.b; selAC = g.r;
  queueSave();
  renderGrid();
  renderSelection();
}

/* ---------- the system clipboard (other apps) ----------
   Copy puts text (tab-separated, as Excel, Sheets and Calc write it)
   and an HTML table on the clipboard. Paste reads either; a paste of
   what was copied here (same text) uses the internal clipboard, so
   formulas move their references and formats come along. */
var FORCE_COPY = null;
function usedSel() {
  var ext = sheetExtent(actSID), T = selTop(), L = selLeft();
  return { t: T, l: L, b: Math.min(selBottom(), Math.max(T, ext.rows - 1)), r: Math.min(selRight(), Math.max(L, ext.cols - 1)) };
}
function selTexts() {
  freshEval();
  var g = usedSel(), rows = [], hrows = [], r, c, skip = {};
  for (r = g.t; r <= g.b; r++) {
    var tr = [], hr = [];
    for (c = g.l; c <= g.r; c++) {
      var cel = getCell(r, c), s = displayVal(r, c), f = cel && cel.f, h = { s: s, f: f };
      if (skip[r + "," + c]) h.skip = true;
      else if (f && (f.mr || f.mc)) {
        h.rs = Math.min(f.mr || 1, g.b - r + 1); h.cs = Math.min(f.mc || 1, g.r - c + 1);
        for (var dr = 0; dr < h.rs; dr++) for (var dc = 0; dc < h.cs; dc++) if (dr || dc) skip[(r + dr) + "," + (c + dc)] = 1;
      }
      tr.push(s); hr.push(h);
    }
    rows.push(tr); hrows.push(hr);
  }
  return { tsv: KIT.toTSV(rows), html: KIT.toHTML(hrows) };
}
function gridHasFocus() {
  var a = document.activeElement;
  if (editing || popEl) return false;
  if (!a || a === document.body || a === document.documentElement) return true;
  return a === $("grid-wrap");
}
function clipNorm(s) { return String(s || "").replace(/\r\n?/g, "\n").replace(/\n+$/, ""); }
function onCopyEvent(e, cut) {
  var tx = FORCE_COPY || (gridHasFocus() ? selTexts() : null);
  if (!tx || !e.clipboardData) return;
  e.clipboardData.setData("text/plain", tx.tsv);
  e.clipboardData.setData("text/html", tx.html);
  e.preventDefault();
  if (!FORCE_COPY) { copySelection(cut); if (CLIP) CLIP.tsv = tx.tsv; }
}
function sysCopy(cut) {
  if (editing) cancelEdit();
  var tx = selTexts(), ok = false;
  FORCE_COPY = tx;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  FORCE_COPY = null;
  if (!ok) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tx.tsv).catch(function () {}); } catch (e) {}
  }
  copySelection(cut);
  if (CLIP) CLIP.tsv = tx.tsv;
  try { $("grid-wrap").focus({ preventScroll: true }); } catch (e) {}
}
function onPasteEvent(e) {
  if (!gridHasFocus() || !e.clipboardData) return;
  e.preventDefault();
  pasteFrom(e.clipboardData.getData("text/plain"), e.clipboardData.getData("text/html"));
}
function sysPaste() {
  if (editing) cancelEdit();
  var cb = navigator.clipboard;
  function internal() { if (CLIP) pasteClipboard(); else notifyTransient(t("clip.ext")); }
  function viaText() {
    if (cb && cb.readText) cb.readText().then(function (s) { pasteFrom(s, ""); }, internal);
    else internal();
  }
  if (cb && cb.read) {
    cb.read().then(function (items) {
      var html = "", txt = "", jobs = [];
      items.forEach(function (it) {
        if (it.types.indexOf("text/html") >= 0) jobs.push(it.getType("text/html").then(function (b) { return b.text(); }).then(function (s) { html = s; }));
        if (it.types.indexOf("text/plain") >= 0) jobs.push(it.getType("text/plain").then(function (b) { return b.text(); }).then(function (s) { txt = s; }));
      });
      return Promise.all(jobs).then(function () { pasteFrom(txt, html); });
    }).catch(viaText);
  } else viaText();
}
function pasteFrom(txt, html) {
  if (CLIP && CLIP.tsv !== undefined && txt && clipNorm(txt) === clipNorm(CLIP.tsv)) { pasteClipboard(); return; }
  if (!txt && !html) { if (CLIP) pasteClipboard(); else notifyTransient(t("clip.empty")); return; }
  var tab = html ? KIT.parseHTMLTable(html) : null;
  var rows = tab ? tab.rows : KIT.parseTSV(txt).map(function (r) { return r.map(function (v) { return { v: v }; }); });
  if (!rows.length) return;
  pasteRows(rows, tab ? tab.merges : [], !!tab);
}
function pasteRows(rows, merges, withFmt) {
  var sheet = getActiveSheet(), top = selTop(), lef = selLeft(), w = 0, r, c, cut = false;
  rows.forEach(function (row) { if (row.length > w) w = row.length; });
  var h = rows.length;
  if (top + h > MAX_ROWS) { h = MAX_ROWS - top; cut = true; }
  if (lef + w > MAX_COLS) { w = MAX_COLS - lef; cut = true; }
  var before = dimsOf(sheet), dim = null;
  if (top + h > sheet.rows || lef + w > sheet.cols) {
    sheet.rows = Math.max(sheet.rows, top + h); sheet.cols = Math.max(sheet.cols, lef + w);
    sheet.mtime = now();
    dim = { dim: true, sid: actSID, before: before, after: dimsOf(sheet) };
  }
  var changes = {};
  for (r = 0; r < h; r++) for (c = 0; c < w; c++) {
    var src = rows[r][c] || { v: "" }, key = cellKey(actSID, top + r, lef + c), cur = snapFull(actSID, top + r, lef + c);
    var v = KIT.pasteValue(src.v, LANG), f;
    if (withFmt) f = src.f ? sanitizeF(src.f) : undefined;
    else if (cur && cur.f) { f = clone(cur.f); delete f.mr; delete f.mc; }
    changes[key] = (v === "" && !f) ? null : (f ? { v: v, f: f } : { v: v });
  }
  (merges || []).forEach(function (m) {
    if (m.r >= h || m.c >= w) return;
    var key = cellKey(actSID, top + m.r, lef + m.c), a = changes[key] || { v: "" };
    a.f = a.f || {};
    if (m.rs > 1) a.f.mr = Math.min(m.rs, h - m.r);
    if (m.cs > 1) a.f.mc = Math.min(m.cs, w - m.c);
    changes[key] = a;
  });
  commitChanges(changes, dim);
  if (dim) buildGrid();
  selR = top; selC = lef; selAR = top + h - 1; selAC = lef + w - 1;
  queueSave();
  renderGrid();
  renderSelection();
  if (cut) notifyTransient(t("max.dims").replace("{r}", MAX_ROWS.toLocaleString(loc())).replace("{c}", MAX_COLS));
  try { $("grid-wrap").focus({ preventScroll: true }); } catch (e) {}
}

/* ---------- charts ---------- */
var chLayer = null, CHSEL = null, CHEL = {}, ovRaf = 0;
function scheduleOverlay() {
  if (ovRaf) return;
  ovRaf = (window.requestAnimationFrame || setTimeout)(function () {
    ovRaf = 0;
    renderCharts();
    placeFillHandle();
  });
}
function cssHex(cs, name, d) {
  var v = cs.getPropertyValue(name);
  return KIT.hex(v || "") || d;
}
function chartPal() {
  var cs = getComputedStyle(document.documentElement);
  var bg = cssHex(cs, "--panel-bg", "#26231c");
  return { bg: bg, text: cssHex(cs, "--text", "#e8e4dc"), dim: cssHex(cs, "--text-dim", "#9a948a"),
    grid: cssHex(cs, "--border", "#3a362e"), dark: KIT.luminance(bg) < 0.35,
    font: "Nunito, -apple-system, Segoe UI, Roboto, sans-serif" };
}
/* the chart's source as rows of { n, s } (filtered-out rows are left out) */
function chartData(x) {
  var g = KIT.parseRange(x.src, MAX_ROWS, MAX_COLS);
  if (!g || x.sid !== actSID) return { cats: [], series: [] };
  freshEval();
  var ext = sheetExtent(actSID), grid = [], r, c;
  g.b = Math.min(g.b, Math.max(g.t, ext.rows - 1));
  g.r = Math.min(g.r, Math.max(g.l, ext.cols - 1));
  for (r = g.t; r <= g.b && grid.length <= KIT.MAX_POINTS + 1; r++) {
    if (POS && r < POS.length && POS[r] < 0) continue;
    var row = [];
    for (c = g.l; c <= g.r; c++) {
      var v = cellValue(r, c);
      row.push({ n: (typeof v === "number" && isFinite(v)) ? v : null, s: displayVal(r, c) });
    }
    grid.push(row);
  }
  return KIT.chartModel(grid, { by: x.by || "", t: x.t });
}
function chartOpts(x, pal, w, h) {
  return { t: x.t, w: w || x.w, h: h || x.h, ttl: x.ttl, xl: x.xl, yl: x.yl, lg: x.lg, co: x.co, lang: LANG,
    cb: x.cb, ln: x.ln, sk: x.sk,
    pal: pal, empty: t("ch.empty"), seriesWord: t("ch.series"), otherWord: t("ch.other") };
}
function chartBox(x) {
  var sheet = getActiveSheet(), c = Math.min(x.at.c, sheet.cols - 1);
  return { left: (COLLEFT[c] || ROWHEADW) + x.at.x, top: rowTopAbs(Math.min(x.at.r, sheet.rows - 1)) + x.at.y, w: x.w, h: x.h };
}
function renderCharts() {
  if (!chLayer) return;
  var pal = null, seen = {}, id;
  for (id in state.charts) {
    var x = state.charts[id];
    if (x.sid !== actSID) continue;
    seen[id] = 1;
    var e = CHEL[id];
    if (!e) { e = CHEL[id] = mkChartEl(id); chLayer.appendChild(e.el); }
    if (e.drag) continue;
    var b = chartBox(x);
    e.el.style.left = b.left + "px"; e.el.style.top = b.top + "px";
    e.el.style.width = b.w + "px"; e.el.style.height = b.h + "px";
    pal = pal || chartPal();
    var svgS = KIT.chartSVG(chartData(x), chartOpts(x, pal));
    if (e.sig !== svgS) { e.box.innerHTML = svgS; e.sig = svgS; }
    e.el.setAttribute("aria-label", t("ch.label") + (x.ttl ? ": " + x.ttl : ""));
    if (CHSEL === id) e.el.classList.add("on"); else e.el.classList.remove("on");
  }
  for (id in CHEL) if (!seen[id]) { CHEL[id].el.remove(); delete CHEL[id]; }
  if (CHSEL && !seen[CHSEL]) CHSEL = null;
}
function selectChart(id) {
  if (CHSEL === id) return;
  CHSEL = id;
  if (id && editing) commitEdit(0, 0);
  renderCharts();
  placeFillHandle();
  if (id && CHEL[id]) try { CHEL[id].el.focus({ preventScroll: true }); } catch (e) {}
}
function chTool(label, icon, fn) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = "ch-b";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = icon;
  b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
  return b;
}
function mkChartEl(id) {
  var el = document.createElement("div");
  el.className = "chart";
  el.tabIndex = 0;
  el.setAttribute("role", "img");
  var box = document.createElement("div");
  box.className = "ch-svg";
  el.appendChild(box);
  var tools = document.createElement("div");
  tools.className = "ch-tools";
  tools.appendChild(chTool(t("ch.edit"), ICONS["ch-edit"], function () { openChartEditor(id); }));
  tools.appendChild(chTool(t("ch.png"), ICONS["ch-dl"] + "<span>PNG</span>", function () { exportChart(id, "png"); }));
  tools.appendChild(chTool(t("ch.svg"), ICONS["ch-dl"] + "<span>SVG</span>", function () { exportChart(id, "svg"); }));
  tools.appendChild(chTool(t("ch.del"), ICONS["ch-del"], function () { deleteChart(id); }));
  el.appendChild(tools);
  var rs = document.createElement("div");
  rs.className = "ch-rs";
  rs.title = t("ch.resize");
  el.appendChild(rs);
  var e = { el: el, box: box, sig: "", drag: null };
  el.addEventListener("pointerdown", function (ev) {
    if (ev.button && ev.button !== 0) return;
    ev.stopPropagation();
    closePops();
    var was = CHSEL === id;
    selectChart(id);
    if (ev.pointerType !== "mouse" && !was) return;      /* touch: the first tap selects */
    var x = state.charts[id];
    if (!x) return;
    var b = chartBox(x);
    e.drag = { mode: ev.target.closest(".ch-rs") ? "rs" : "mv", x0: ev.clientX, y0: ev.clientY, b: b, moved: false };
    try { el.setPointerCapture(ev.pointerId); } catch (er) {}
    ev.preventDefault();
  });
  el.addEventListener("pointermove", function (ev) {
    var d = e.drag;
    if (!d) return;
    var dx = ev.clientX - d.x0, dy = ev.clientY - d.y0;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    if (d.mode === "mv") {
      el.style.left = Math.max(ROWHEADW, d.b.left + dx) + "px";
      el.style.top = Math.max(HEADH, d.b.top + dy) + "px";
    } else {
      el.style.width = Math.max(160, Math.min(2000, d.b.w + dx)) + "px";
      el.style.height = Math.max(120, Math.min(1500, d.b.h + dy)) + "px";
    }
  });
  function end(ev, cancel) {
    var d = e.drag;
    if (!d) return;
    e.drag = null;
    if (cancel || !d.moved) { renderCharts(); return; }
    var x = state.charts[id];
    if (!x) return;
    var y = clone(x);
    if (d.mode === "mv") {
      var p = cellAtPoint(parseFloat(el.style.left), parseFloat(el.style.top));
      y.at = { r: p.r, c: p.c, x: Math.min(400, p.dx), y: Math.min(400, p.dy) };
    } else { y.w = Math.round(parseFloat(el.style.width)); y.h = Math.round(parseFloat(el.style.height)); }
    objDone([putObj("charts", id, y)]);
    void ev;
  }
  el.addEventListener("pointerup", function (ev) { end(ev, false); });
  el.addEventListener("pointercancel", function (ev) { end(ev, true); });
  el.addEventListener("dblclick", function (ev) { ev.stopPropagation(); openChartEditor(id); });
  el.addEventListener("keydown", function (ev) {
    if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); ev.stopPropagation(); deleteChart(id); }
    else if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); openChartEditor(id); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); selectChart(null); $("grid-wrap").focus(); }
  });
  return e;
}
function deleteChart(id) {
  if (!state.charts[id]) return;
  CHSEL = null;
  objDone([putObj("charts", id, null)]);
  notifyTransient(t("ch.deleted"));
  try { $("grid-wrap").focus({ preventScroll: true }); } catch (e) {}
}
function insertChart() {
  if (editing) commitEdit(0, 0);
  var sh = getActiveSheet(), g;
  if (selIsRange()) g = usedSel(); else g = dataRegion(selR, selC);
  if (!g) { notifyTransient(t("ch.nodata")); return; }
  var wrap = $("grid-wrap");
  var w = Math.max(200, Math.min(420, wrap.clientWidth - ROWHEADW - 40)), h = Math.max(160, Math.min(260, Math.round(w * 0.62)));
  /* beside the data when it fits in view, else under it, else at the
     top-left of the view (it can be moved) */
  var vx0 = wrap.scrollLeft + (FC ? COLLEFT[FC - 1] + colW(sh, FC - 1) : ROWHEADW), vx1 = wrap.scrollLeft + wrap.clientWidth;
  var vy0 = wrap.scrollTop + HEADH + FRH, vy1 = wrap.scrollTop + wrap.clientHeight;
  var at = null, cr = Math.min(g.r + 2, sh.cols - 1), rb = Math.min(g.b + 2, sh.rows - 1);
  if (cr > g.r && COLLEFT[cr] >= vx0 && COLLEFT[cr] + w <= vx1 && rowTopAbs(g.t) >= vy0 && rowTopAbs(g.t) + 40 <= vy1)
    at = { r: g.t, c: cr, x: 0, y: 0 };
  else if (rb > g.b && rowTopAbs(rb) >= vy0 && rowTopAbs(rb) + 40 <= vy1 && COLLEFT[g.l] >= vx0 && COLLEFT[g.l] < vx1)
    at = { r: rb, c: g.l, x: 0, y: 0 };
  else {
    var p = cellAtPoint(vx0 + 16, vy0 + 16);
    at = { r: p.r, c: p.c, x: p.dx, y: p.dy };
  }
  openChartEditor(null, { t: "col", src: KIT.rangeStr(g), lg: 1, at: at, w: w, h: h });
}
function openChartEditor(id, init) {
  if (editing) commitEdit(0, 0);
  var x = id ? clone(state.charts[id]) : clone(init);
  if (!x) return;
  var pop = popShell(id ? t("ch.editt") : t("ch.new"), "ch-dlg");
  var type = mkSelect(KIT.CHART_TYPES.map(function (k) { return [k, t("ch.t." + k)]; }), x.t);
  field(pop, t("ch.type"), type);
  var src = mkInput(x.src, "A1:C10");
  var sw = field(pop, t("ch.src"), src);
  sw.appendChild(mkBtn(t("use.sel"), "", function () { src.value = selRangeStr(); upd(); }));
  var by = mkSelect([["", t("ch.by.a")], ["c", t("ch.by.c")], ["r", t("ch.by.r")]], x.by || "");
  field(pop, t("ch.by"), by);
  var ttl = mkInput(x.ttl || ""), xl = mkInput(x.xl || ""), yl = mkInput(x.yl || "");
  ttl.maxLength = 100; xl.maxLength = 60; yl.maxLength = 60;
  field(pop, t("ch.ttl"), ttl);
  var axw = document.createElement("div");
  axw.className = "pop-2";
  pop.appendChild(axw);
  field(axw, t("ch.xl"), xl); field(axw, t("ch.yl"), yl);
  var lg = document.createElement("input");
  lg.type = "checkbox"; lg.checked = x.lg !== 0;
  var lw = field(pop, t("ch.lg"), lg);
  lw.classList.add("pop-chk");
  /* wave 4.2: stacked, combo, trend line; each shown for the types it fits */
  var opt = {};
  ["sk", "cb", "ln"].forEach(function (k) {
    var cbx = document.createElement("input");
    cbx.type = "checkbox"; cbx.checked = x[k] === 1;
    var fw = field(pop, t("ch." + k), cbx);
    fw.classList.add("pop-chk");
    opt[k] = { box: cbx, wrap: fw };
    cbx.addEventListener("change", function () { draw(); });
  });
  function showOpts() { for (var k in opt) opt[k].wrap.hidden = !KIT.CH_OPT[k][type.value]; }
  var colRow = document.createElement("div");
  colRow.className = "ch-cols";
  pop.appendChild(colRow);
  var prev = document.createElement("div");
  prev.className = "ch-prev";
  pop.appendChild(prev);
  var co = (x.co || []).slice();
  function cur() {
    var y = clone(x);
    y.t = type.value; y.src = src.value.trim().toUpperCase(); y.by = by.value || undefined;
    y.ttl = ttl.value; y.xl = xl.value; y.yl = yl.value; y.lg = lg.checked ? 1 : 0;
    y.co = co.slice();
    y.sid = x.sid || actSID;
    for (var k in opt) { if (opt[k].box.checked && KIT.CH_OPT[k][y.t]) y[k] = 1; else delete y[k]; }
    return y;
  }
  function upd() {
    showOpts();
    var y = cur(), pal = chartPal(), model = chartData(y);
    var n = (y.t === "pie" || y.t === "donut") ? (model.series[0] ? KIT.pieSlices(model.series[0], model.cats).length : 0) : model.series.length;
    var base = KIT.seriesColors(pal, co);
    colRow.innerHTML = "";
    if (n) {
      var lab = document.createElement("span");
      lab.textContent = t("ch.cols");
      colRow.appendChild(lab);
    }
    for (var i = 0; i < Math.min(8, n); i++) (function (i) {
      var inp = document.createElement("input");
      inp.type = "color"; inp.value = base[i];
      inp.title = t("ch.col") + " " + (i + 1);
      inp.setAttribute("aria-label", inp.title);
      inp.addEventListener("input", function () { while (co.length <= i) co.push(""); co[i] = inp.value; draw(); });
      colRow.appendChild(inp);
    })(i);
    if (co.some(function (c) { return !!c; })) colRow.appendChild(mkBtn(t("ch.reset"), "", function () { co = []; upd(); }));
    draw();
  }
  function draw() {
    var y = cur(), pw = Math.max(200, Math.min(380, (pop.clientWidth || 320) - 20));
    prev.innerHTML = KIT.chartSVG(chartData(y), chartOpts(y, chartPal(), pw, Math.round(pw * 0.58)));
  }
  [type, by, lg].forEach(function (el) { el.addEventListener("change", upd); });
  [src, ttl, xl, yl].forEach(function (el) { el.addEventListener("input", function () { if (el === src) upd(); else draw(); }); });
  var btns = document.createElement("div");
  btns.className = "pop-btns";
  if (id) btns.appendChild(mkBtn(t("ch.del"), "danger", function () { closePops(); deleteChart(id); }));
  btns.appendChild(mkBtn(t("flt.cancel"), "", closePops));
  btns.appendChild(mkBtn(t("save"), "primary", function () {
    var y = cur(), sh = getActiveSheet();
    if (!KIT.parseRange(y.src, sh.rows, sh.cols)) { notifyTransient(t("cf.badrange")); src.focus(); return; }
    while (y.co.length && !y.co[y.co.length - 1]) y.co.pop();
    if (!y.co.length) delete y.co;
    if (!y.by) delete y.by;
    y.sid = id ? x.sid : actSID;
    var nid = id || uid();
    closePops();
    objDone([putObj("charts", nid, y)]);
    selectChart(nid);
  }));
  pop.appendChild(btns);
  placePop(pop, { el: $("tb-chart") });
  upd();
}
function saveBlob(blob, filename, mime, desc) {
  var done = function () { notifyTransient(t("ch.saved").replace("{f}", filename)); };
  var dlg = dialogHost();
  if (dlg && typeof dlg.saveFile === "function") {
    var accept = {};
    accept[mime] = ["." + filename.split(".").pop()];
    dlg.saveFile({ blob: blob, filename: filename, mime: mime, types: [{ description: desc, accept: accept }] })
      .then(function (r) { if (r && r.ok) done(); });
    return;
  }
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  done();
}
function exportChart(id, kind) {
  var x = state.charts[id];
  if (!x) return;
  var svgS = KIT.chartSVG(chartData(x), chartOpts(x, chartPal()));
  var name = (x.ttl || t("ch.file")).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 60) || "chart";
  if (kind === "svg") { saveBlob(new Blob([svgS], { type: "image/svg+xml" }), name + ".svg", "image/svg+xml", "SVG"); return; }
  var img = new Image();
  img.onload = function () {
    var cv = document.createElement("canvas"), k = 2;
    cv.width = x.w * k; cv.height = x.h * k;
    var ctx = cv.getContext("2d");
    ctx.scale(k, k);
    ctx.drawImage(img, 0, 0, x.w, x.h);
    cv.toBlob(function (b) { if (b) saveBlob(b, name + ".png", "image/png", "PNG"); }, "image/png");
  };
  img.onerror = function () { notifyTransient(t("ch.err")); };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgS);
}
function initCharts() {
  var wrap = $("grid-wrap");
  chLayer = document.createElement("div");
  chLayer.id = "ch-layer";
  wrap.insertBefore(chLayer, wrap.firstChild);
}

/* ===== SECTION 3j: PRINT · PDF (Spreadsheet wave 4.3) =====
   The active sheet (its used area, or the selection) as a real PDF:
   jsPDF + the Noto Sans fonts (both precached, loaded on first use),
   text as selectable text, so Greek comes out right. The page plan is
   KIT.printPages (pure, tested); this draws it: fills, data bars,
   icons, borders, merged cells, gridlines, repeated heading rows,
   charts (their SVG drawn to a picture) and "Page n of t". Print opens
   the same PDF in the browser's print dialog. The settings stay on
   this device (PR_KEY), nothing in the workbook changes.            */
var PR_KEY = "oros-spreadsheet-print";   /* device-local, NEVER synced */
var PR_FONT = { n: "NotoSans-Regular", b: "NotoSans-Bold", i: "NotoSans-Italic", bi: "NotoSans-BoldItalic" };
var prLib = { loading: false, q: [], fonts: null };
function prSettings() {
  var o = {};
  try { o = JSON.parse(localStorage.getItem(PR_KEY) || "{}") || {}; } catch (e) { o = {}; }
  return KIT.normPrint(o);
}
function prKeep(x) { try { localStorage.setItem(PR_KEY, JSON.stringify(x)); } catch (e) {} }
function prLoadLib(done) {
  if (window.jspdf && window.jspdf.jsPDF) { done(true); return; }
  prLib.q.push(done);
  if (prLib.loading) return;
  prLib.loading = true;
  var s = document.createElement("script");
  s.src = "../vendor/jspdf.umd.min.js" + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
  s.onload = function () { prLib.loading = false; prLib.q.splice(0).forEach(function (cb) { cb(true); }); };
  s.onerror = function () { prLib.loading = false; s.remove(); prLib.q.splice(0).forEach(function (cb) { cb(false); }); };
  document.head.appendChild(s);
}
function prLoadFonts() {
  if (prLib.fonts) return Promise.resolve(prLib.fonts);
  function get(name) {
    return fetch("../vendor/noto/" + name + ".ttf").then(function (r) { if (!r.ok) throw new Error("font"); return r.arrayBuffer(); })
      .then(function (buf) {
        var bytes = new Uint8Array(buf), bin = "";
        for (var i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        return btoa(bin);
      });
  }
  var keys = Object.keys(PR_FONT);
  return Promise.all(keys.map(function (k) { return get(PR_FONT[k]); })).then(function (list) {
    var out = {};
    keys.forEach(function (k, i) { out[k] = list[i]; });
    prLib.fonts = out;
    return out;
  });
}
/* the rows and columns to print: { rows: [r], cols: [c], head: [r] } or null */
function prArea(x) {
  var sh = getActiveSheet(), r0 = 0, r1 = -1, c0 = 0, c1 = -1, id;
  if (x.sel && selIsRange()) { r0 = selTop(); r1 = selBottom(); c0 = selLeft(); c1 = selRight(); }
  else {
    var ext = sheetExtent(actSID);
    r1 = ext.rows - 1; c1 = ext.cols - 1;
    mergeMap().list.forEach(function (m) { r1 = Math.max(r1, m.r2); c1 = Math.max(c1, m.c2); });
    if (x.ch) for (id in state.charts) {
      var ch = state.charts[id];
      if (ch.sid !== actSID) continue;
      var e = prChartEnd(sh, ch);
      r1 = Math.max(r1, e.r); c1 = Math.max(c1, e.c);
    }
  }
  r1 = Math.min(r1, sh.rows - 1); c1 = Math.min(c1, sh.cols - 1);
  if (r1 < r0 || c1 < c0) return null;
  var head = [], rows = [], cols = [], r, c;
  for (r = 0; r < Math.min(x.hr, sh.rows); r++) if (!(POS && POS[r] < 0)) head.push(r);
  for (r = r0; r <= r1; r++) {
    if (POS && r < POS.length && POS[r] < 0) continue;     /* filtered out */
    if (x.hr && r < x.hr) continue;                        /* drawn as headings */
    rows.push(r);
  }
  for (c = c0; c <= c1; c++) cols.push(c);
  if (!rows.length && !head.length) return null;
  return { rows: rows, cols: cols, head: head };
}
/* the last cell a chart covers */
function prChartEnd(sh, ch) {
  var c = ch.at.c, w = ch.at.x + ch.w, r = ch.at.r, h = ch.at.y + ch.h;
  while (c < sh.cols - 1 && w > colW(sh, c)) { w -= colW(sh, c); c++; }
  while (r < sh.rows - 1 && h > rowH(sh, r)) { h -= rowH(sh, r); r++; }
  return { r: r, c: c };
}
/* the charts of the active sheet as PNG data URLs, light colours */
function prCharts(x) {
  if (!x.ch) return Promise.resolve([]);
  var pal = { bg: "#ffffff", text: "#1f1d1a", dim: "#5f5a52", grid: "#d9d4ca", dark: false,
    font: "Noto Sans, Nunito, -apple-system, Segoe UI, Roboto, sans-serif" };
  var list = [], id;
  for (id in state.charts) if (state.charts[id].sid === actSID) list.push(state.charts[id]);
  return Promise.all(list.map(function (ch) {
    return new Promise(function (res) {
      var svgS = KIT.chartSVG(chartData(ch), chartOpts(ch, pal));
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement("canvas"), k = 3;
          cv.width = ch.w * k; cv.height = ch.h * k;
          var g = cv.getContext("2d");
          g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height);
          g.scale(k, k);
          g.drawImage(img, 0, 0, ch.w, ch.h);
          res({ ch: ch, png: cv.toDataURL("image/png") });
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgS);
    });
  })).then(function (a) { return a.filter(Boolean); });
}
function prRgb(hex) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}
function prFill(pdf, hex) { var c = prRgb(hex); pdf.setFillColor(c[0], c[1], c[2]); }
function prDrawC(pdf, hex) { var c = prRgb(hex); pdf.setDrawColor(c[0], c[1], c[2]); }
function prInk(pdf, hex) { var c = prRgb(hex); pdf.setTextColor(c[0], c[1], c[2]); }
/* one icon of an icon-set rule as a shape (the font has no arrows) */
function prIcon(pdf, ch, hex, x, y, s) {
  prFill(pdf, hex);
  var h = s / 2;
  if (ch === "▲") pdf.triangle(x, y + h, x + s, y + h, x + h, y - h, "F");
  else if (ch === "▼") pdf.triangle(x, y - h, x + s, y - h, x + h, y + h, "F");
  else if (ch === "▶") pdf.triangle(x, y - h, x, y + h, x + s, y, "F");
  else pdf.circle(x + h, y, h * 0.9, "F");
}
/* the whole PDF; resolves to { blob, pages } */
function prBuild(x) {
  freshEval();
  var area = prArea(x);
  if (!area) return Promise.reject(new Error("empty"));
  return new Promise(function (res, rej) {
    prLoadLib(function (ok) { if (ok) res(); else rej(new Error("lib")); });
  }).then(function () {
    return Promise.all([prLoadFonts(), prCharts(x)]);
  }).then(function (got) { return prRender(x, area, got[0], got[1]); });
}
function prRender(x, area, fonts, charts) {
  var sh = getActiveSheet(), PT = KIT.PX_PT, FOOT = 18;
  var colWs = area.cols.map(function (c) { return colW(sh, c) * PT; });
  var rowHs = area.rows.map(function (r) { return rowH(sh, r) * PT; });
  var headHs = area.head.map(function (r) { return rowH(sh, r) * PT; });
  var P = KIT.printPages({ pa: x.pa, or: x.or, fit: x.fit, colW: colWs, rowH: rowHs, headH: headHs, margin: 36, foot: x.pn ? FOOT : 0 });
  var pdf = new window.jspdf.jsPDF({ unit: "pt", format: [P.w, P.h], orientation: x.or === "l" ? "landscape" : "portrait", compress: true });
  Object.keys(PR_FONT).forEach(function (k) {
    var file = PR_FONT[k] + ".ttf";
    pdf.addFileToVFS(file, fonts[k]);
    pdf.addFont(file, "NotoSans", k === "n" ? "normal" : k === "b" ? "bold" : k === "i" ? "italic" : "bolditalic");
  });
  pdf.setProperties({ title: displayName(sh), creator: "orOS Spreadsheet" });
  var s = P.scale, total = P.pages.length, name = displayName(sh);
  P.pages.forEach(function (pg, n) {
    if (n) pdf.addPage([P.w, P.h], x.or === "l" ? "landscape" : "portrait");
    var cols = area.cols.slice(pg.c[0], pg.c[1] + 1), cw = colWs.slice(pg.c[0], pg.c[1] + 1);
    var body = pg.r ? area.rows.slice(pg.r[0], pg.r[1] + 1) : [];
    var rows = area.head.concat(body), rh = rows.map(function (r) { return rowH(sh, r) * PT; });
    var cx = [P.x0], ry = [P.y0], i;
    for (i = 0; i < cw.length; i++) cx.push(cx[i] + cw[i] * s);
    for (i = 0; i < rh.length; i++) ry.push(ry[i] + rh[i] * s);
    prPage(pdf, sh, x, s, rows, cols, cx, ry);
    prPageCharts(pdf, s, charts, rows, cols, cx, ry, !pg.r || pg.r[0] === 0 ? 0 : area.head.length);
    if (x.pn) {
      pdf.setFont("NotoSans", "normal"); pdf.setFontSize(8); prInk(pdf, "#5f5a52");
      var lab = KIT.pageLabel(t("pr.page"), n + 1, total), yb = P.h - 36 + 4;
      pdf.text(KIT.fitText(name, P.uw / 2 - 12, function (q) { return pdf.getTextWidth(q); }), P.x0, yb, { baseline: "top" });
      pdf.text(lab, P.w - 36, yb, { baseline: "top", align: "right" });
    }
  });
  return { blob: pdf.output("blob"), pages: total };
}
function prPage(pdf, sh, x, s, rows, cols, cx, ry) {
  var nR = rows.length, nC = cols.length, i, j, fs = 9.75 * s, pad = 4.5 * s;
  var colAt = {}, rowAt = {};
  cols.forEach(function (c, j) { colAt[c] = j; });
  rows.forEach(function (r, i) { rowAt[r] = i; });
  var covered = {}, spans = {};
  mergeMap().list.forEach(function (m) {
    for (var r = m.r; r <= m.r2; r++) for (var c = m.c; c <= m.c2; c++) {
      if (rowAt[r] === undefined || colAt[c] === undefined) continue;
      if (r === m.r && c === m.c) continue;
      covered[r + "," + c] = m;
    }
    if (rowAt[m.r] !== undefined && colAt[m.c] !== undefined) spans[m.r + "," + m.c] = m;
  });
  /* the box of a cell (a merge's top-left: the visible part of the merge) */
  function box(i, j) {
    var r = rows[i], c = cols[j], m = spans[r + "," + c], i2 = i, j2 = j;
    if (m) {
      while (i2 + 1 < nR && rows[i2 + 1] <= m.r2 && rows[i2 + 1] > r) i2++;
      while (j2 + 1 < nC && cols[j2 + 1] <= m.c2) j2++;
    }
    return { x: cx[j], y: ry[i], w: cx[j2 + 1] - cx[j], h: ry[i2 + 1] - ry[i], j2: j2 };
  }
  var cells = [];
  for (i = 0; i < nR; i++) for (j = 0; j < nC; j++) {
    var r = rows[i], c = cols[j], key = r + "," + c;
    var mc = covered[key];
    if (mc && spans[mc.r + "," + mc.c]) continue;          /* drawn by its top-left */
    var src = mc ? { r: mc.r, c: mc.c } : { r: r, c: c };
    var cel = getCell(src.r, src.c), f = (cel && cel.f) || {}, cf = cfAt(src.r, src.c) || {};
    var b = box(i, j), view = mc ? { s: "", k: "" } : cellView(r, c);
    cells.push({ i: i, j: j, r: r, c: c, b: b, f: f, cf: cf, v: view, m: !!spans[key] || !!mc });
  }
  /* fills and data bars */
  cells.forEach(function (q) {
    var bg = q.cf.bg || q.f.bg;
    if (bg) { prFill(pdf, bg); pdf.rect(q.b.x, q.b.y, q.b.w, q.b.h, "F"); }
    if (q.cf.bar !== undefined) {
      var bc = prRgb(q.cf.barCo), mix = function (v) { return Math.round(v * 0.55 + 255 * 0.45); };
      pdf.setFillColor(mix(bc[0]), mix(bc[1]), mix(bc[2]));
      pdf.rect(q.b.x, q.b.y + 0.5, q.b.w * Math.max(0, Math.min(1, q.cf.bar)), q.b.h - 1, "F");
    }
  });
  /* gridlines: every cell edge but the inside of merges */
  if (x.gl) {
    pdf.setLineWidth(0.4); prDrawC(pdf, "#c8c3b8");
    cells.forEach(function (q) {
      pdf.line(q.b.x + q.b.w, q.b.y, q.b.x + q.b.w, q.b.y + q.b.h);
      pdf.line(q.b.x, q.b.y + q.b.h, q.b.x + q.b.w, q.b.y + q.b.h);
    });
    pdf.line(cx[0], ry[0], cx[nC], ry[0]);
    pdf.line(cx[0], ry[0], cx[0], ry[nR]);
  }
  /* text: left-aligned text runs on over empty cells to its right, like on screen in Excel */
  var empty = {};
  cells.forEach(function (q) { if (!q.v.s && !q.m) empty[q.i + "," + q.j] = 1; });
  cells.forEach(function (q) {
    var txt = q.v.s, f = q.f, cf = q.cf;
    var bold = !!(f.b || cf.b), ital = !!f.i;
    pdf.setFont("NotoSans", bold && ital ? "bolditalic" : bold ? "bold" : ital ? "italic" : "normal");
    pdf.setFontSize(fs);
    var bg = cf.bg || f.bg;
    var ink = q.v.k === "err" ? "#c62828" : (cf.co || f.co || (bg ? KIT.inkOn(bg) : "#1f1d1a"));
    var al = f.al || (q.v.k === "num" ? "r" : q.v.k === "bool" || q.v.k === "err" ? "c" : "l");
    var x0 = q.b.x + pad, w = q.b.w - 2 * pad;
    if (cf.ic) { prIcon(pdf, cf.ic, cf.icCo, x0, q.b.y + q.b.h / 2, fs * 0.7); x0 += fs; w -= fs; }
    if (!txt || w <= 0) return;
    prInk(pdf, ink);
    var meas = function (z) { return pdf.getTextWidth(z); };
    var va = f.va || "m", lh = fs * 1.2;
    if (f.wr) {
      var lines = pdf.splitTextToSize(txt, w), room = Math.max(1, Math.floor((q.b.h - 2 * s) / lh));
      if (lines.length > room) { lines = lines.slice(0, room); lines[room - 1] = KIT.fitText(lines[room - 1] + "…", w, meas); }
      var th = lines.length * lh, ty = va === "t" ? q.b.y + 2 * s : va === "b" ? q.b.y + q.b.h - 2 * s - th : q.b.y + (q.b.h - th) / 2;
      lines.forEach(function (ln, k) { prText(pdf, ln, al, x0, w, ty + k * lh + lh / 2, f.u); });
      return;
    }
    if (al === "l" && !q.m && q.v.k === "") {
      for (var jj = q.b.j2 + 1; jj < nC && empty[q.i + "," + jj] && meas(txt) > w; jj++) w = cx[jj + 1] - x0 - pad;
    }
    var yy = va === "t" ? q.b.y + 2 * s + fs * 0.6 : va === "b" ? q.b.y + q.b.h - 2 * s - fs * 0.6 : q.b.y + q.b.h / 2;
    var out = q.v.k === "num" && meas(txt) > w ? "#".repeat(Math.max(1, Math.floor(w / Math.max(1, meas("#"))))) : KIT.fitText(txt, w, meas);
    prText(pdf, out, al, x0, w, yy, f.u);
  });
  /* borders on top */
  pdf.setLineWidth(0.75);
  cells.forEach(function (q) {
    var bd = q.f.bd;
    if (!bd) return;
    var bg = q.cf.bg || q.f.bg;
    prDrawC(pdf, bg ? KIT.inkOn(bg) : "#1f1d1a");
    var X = q.b.x, Y = q.b.y, W = q.b.w, H = q.b.h;
    if (bd.indexOf("t") >= 0) pdf.line(X, Y, X + W, Y);
    if (bd.indexOf("b") >= 0) pdf.line(X, Y + H, X + W, Y + H);
    if (bd.indexOf("l") >= 0) pdf.line(X, Y, X, Y + H);
    if (bd.indexOf("r") >= 0) pdf.line(X + W, Y, X + W, Y + H);
  });
}
function prText(pdf, s, al, x0, w, y, u) {
  if (!s) return;
  var tx = al === "r" ? x0 + w : al === "c" ? x0 + w / 2 : x0;
  pdf.text(s, tx, y, { baseline: "middle", align: al === "r" ? "right" : al === "c" ? "center" : "left" });
  if (u) {
    var tw = pdf.getTextWidth(s), ux = al === "r" ? tx - tw : al === "c" ? tx - tw / 2 : tx, fsz = pdf.getFontSize();
    pdf.setLineWidth(fsz / 18); pdf.setDrawColor(pdf.getTextColor());
    pdf.line(ux, y + fsz * 0.45, ux + tw, y + fsz * 0.45);
  }
}
/* charts whose anchor cell is on this page, at their place; a chart
   that starts in a repeated heading row prints once, on the first page
   of its columns (from: where on this page anchors may be looked for) */
function prPageCharts(pdf, s, charts, rows, cols, cx, ry, from) {
  var PT = KIT.PX_PT;
  charts.forEach(function (o) {
    var ch = o.ch, j = cols.indexOf(ch.at.c), i = rows.indexOf(ch.at.r, from);
    if (j < 0 || i < 0) return;
    pdf.addImage(o.png, "PNG", cx[j] + ch.at.x * PT * s, ry[i] + ch.at.y * PT * s, ch.w * PT * s, ch.h * PT * s, undefined, "FAST");
  });
}
/* file name: the sheet's name, safe on every system */
function prName() {
  var n = displayName(getActiveSheet()).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80);
  return (n || "sheet") + ".pdf";
}
function prMake(x, then) {
  notifyTransient(t("pr.busy"));
  prBuild(x).then(then, function (e) {
    notifyTransient(e && e.message === "empty" ? t("pr.empty") : t("pr.err"));
    if (!(e && e.message === "empty")) console.error("[SS] PDF failed:", e);
  });
}
/* Print: the PDF in a hidden frame, then the browser's print dialog;
   where a frame cannot print a PDF, the PDF opens in a new tab */
function prPrint(blob) {
  var url = URL.createObjectURL(blob), old = $("ss-print");
  if (old) old.remove();
  var fr = document.createElement("iframe");
  fr.id = "ss-print";
  fr.setAttribute("aria-hidden", "true");
  fr.tabIndex = -1;
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  fr.addEventListener("load", function () {
    setTimeout(function () {
      try { fr.contentWindow.focus(); fr.contentWindow.print(); }
      catch (e) { try { window.open(url, "_blank", "noopener"); } catch (e2) {} }
    }, 250);
  }, { once: true });
  fr.src = url;
  document.body.appendChild(fr);
  setTimeout(function () { URL.revokeObjectURL(url); }, 10 * 60 * 1000);
}
function openPrintDialog() {
  var x = prSettings();
  if (!selIsRange()) x.sel = 0;
  var pop = popShell(t("pr.title"), "print-dlg");
  var what = mkSelect([["0", t("pr.all")], ["1", t("pr.sel")]], String(x.sel));
  if (!selIsRange()) what.disabled = true;
  field(pop, t("pr.what"), what);
  var row1 = document.createElement("div");
  row1.className = "pop-2";
  pop.appendChild(row1);
  var pa = mkSelect([["a4", "A4"], ["a3", "A3"], ["letter", "Letter"], ["legal", "Legal"]], x.pa);
  var or = mkSelect([["p", t("pr.p")], ["l", t("pr.l")]], x.or);
  field(row1, t("pr.paper"), pa); field(row1, t("pr.or"), or);
  var fit = mkSelect([["w", t("pr.fit.w")], ["p", t("pr.fit.p")], ["n", t("pr.fit.n")]], x.fit);
  field(pop, t("pr.fit"), fit);
  var hrOpts = [["0", t("pr.hr.0")]];
  for (var k = 1; k <= 5; k++) hrOpts.push([String(k), t(k === 1 ? "pr.hr.1" : "pr.hr.n").replace("{n}", k)]);
  var hr = mkSelect(hrOpts, String(x.hr));
  field(pop, t("pr.hr"), hr);
  function chk(label, on) {
    var b = document.createElement("input");
    b.type = "checkbox"; b.checked = !!on;
    field(pop, label, b).classList.add("pop-chk");
    return b;
  }
  var gl = chk(t("pr.gl"), x.gl), pn = chk(t("pr.pn"), x.pn), chs = chk(t("pr.ch"), x.ch);
  var note = document.createElement("div");
  note.className = "pop-note"; note.textContent = t("pr.note");
  pop.appendChild(note);
  function read() {
    return KIT.normPrint({ sel: what.value === "1" ? 1 : 0, pa: pa.value, or: or.value, fit: fit.value,
      hr: parseInt(hr.value, 10), gl: gl.checked ? 1 : 0, pn: pn.checked ? 1 : 0, ch: chs.checked ? 1 : 0 });
  }
  var btns = document.createElement("div");
  btns.className = "pop-btns";
  btns.appendChild(mkBtn(t("flt.cancel"), "", closePops));
  btns.appendChild(mkBtn(t("pr.print"), "", function () {
    var y = read(); prKeep(y); closePops();
    prMake(y, function (o) { prPrint(o.blob); });
  }));
  btns.appendChild(mkBtn(t("pr.pdf"), "primary", function () {
    var y = read(); prKeep(y); closePops();
    prMake(y, function (o) { saveBlob(o.blob, prName(), "application/pdf", "PDF"); });
  }));
  pop.appendChild(btns);
  placePop(pop, { el: $("tb-fmt") });
  try { what.focus({ preventScroll: true }); } catch (e) {}
}

/* ===== SECTION 4: SYNC SLICE + PALETTE + NOTIFICATIONS ===== */

var syncApi = null;

var __ss = { _suppress: false,
  dirty: function () {
    if (this._suppress) return;
    var api = (window.parent && window.parent.orosSync) || window.orosSync;
    if (api && typeof api.markDirty === "function") api.markDirty();
  } };

syncApi = __ss;

/* SS-1: the canonical copy, byte-equal to the stored one */
function sliceGet() {
  return canonSS(state);
}

/* Pull-fed (R6: no markDirty). SS-4: an open cell editor and a
   focused formula bar stay where they are (the old code cancelled
   the edit and dropped the phone keyboard on every pull); an
   editor the user has not typed in follows the new value. */
function sliceSet(data, info) {
  var cur = sliceGet();
  var merged = null;
  __ss._suppress = true;
  try { merged = mergeState(cur, data); } catch (e) { merged = null; }
  __ss._suppress = false;
  if (!merged) return;
  if (JSON.stringify(merged) === JSON.stringify(cur)) return;   /* echo */
  state = merged;
  state.charts = state.charts || {}; state.cf = state.cf || {};

  var rebuild = false;
  var act = getSheetById(actSID);
  if (!act || (state.deleted[actSID] && act.mtime <= state.deleted[actSID])) {
    if (editing) cancelEdit();
    actSID = state.sheets[0] ? state.sheets[0].id : SID;
    collapseSel(0, 0);
    rebuild = true;
  } else if (layoutSig(act) !== BUILT) {
    rebuild = true;          /* rows, columns, widths or frozen panes changed */
  }
  if (rebuild && editing) cancelEdit();
  if (editing && editInput && editInput.value === editStartVal) {
    var ec = getCell(editingR, editingC);
    var nv = ec ? ec.v : "";
    if (nv !== editStartVal) { editInput.value = nv; editStartVal = nv; }
  }
  saveNow();
  undoStack.length = 0; /* sync reshape — device-local undo voids */
  redoStack.length = 0;
  invalidateEval();
  if (rebuild) buildGrid();
  renderTabs();
  renderGrid();
  renderSelection();
  updateToolbar();
}

function mergeFn(local, remote) {
  return mergeState(local, remote);
}

function registerSync() {
  var api = (window.parent && window.parent.orosSync) || window.orosSync;
  if (!api || typeof api.registerSlice !== "function") return;
  api.registerSlice("spreadsheet", sliceGet, sliceSet,
    STORAGE_KEY, mergeFn);
}

var PAL_VARS = ["--bg","--bg-desktop","--bar-bg","--text","--text-dim",
  "--accent","--accent-hover","--accent-soft","--panel-bg","--border",
  "--shadow","--danger","--ok","--warn","--font-stack","--mono"];

function inheritPalette() {
  var pd = null;
  try { pd = window.parent && window.parent.document; } catch (e) {}
  if (!pd || !pd.documentElement) return;
  var de = document.documentElement;
  var rs = de.style;
  try {
    de.setAttribute("data-theme", pd.documentElement.getAttribute("data-theme") || "");
    de.setAttribute("data-skin", pd.documentElement.getAttribute("data-skin") || "");
  } catch (e) {}
  for (var i = 0; i < PAL_VARS.length; i++) {
    var v = pd.documentElement.style.getPropertyValue(PAL_VARS[i]);
    if (v) rs.setProperty(PAL_VARS[i], v);
  }
}

function watchPalette() {
  var pd = null;
  try { pd = window.parent && window.parent.document; } catch (e) {}
  if (!pd || !pd.documentElement || typeof MutationObserver === "undefined")
    return;
  new MutationObserver(function () { inheritPalette(); scheduleOverlay(); })
    .observe(pd.documentElement, { attributes: true,
      attributeFilter: ["data-skin", "data-theme"] });
}

function notifyTransient(text) {
  var nm = null;
  try { nm = (window.parent && window.parent.orosNotifs) || window.orosNotifs; }
  catch (e) {}
  if (nm && typeof nm.transient === "function") {
    try { nm.transient({ ns: "spreadsheet", title: text }); return; }
    catch (e) {}
  }
  toast(text);
}

function toast(text) {
  var el = document.getElementById("ss-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ss-toast";
    el.className = "ss-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove("on"); }, 5000);
}

/* ===== SECTION 5: WIRING + BOOT ===== */

function applyI18n() {
  document.title = t("title") + " — orOS";
  var el = $("doc-title");
  if (el) el.textContent = t("title");
  document.documentElement.lang = LANG;
}

/* ---- inline SVG icons (Bible R9: HTML ships buttons EMPTY,
        JS injects SVGs — no external deps, no unicode glyphs) ---- */
var SVG_ATTRS = ' xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"' +
  ' width="15" height="15" fill="none" stroke="currentColor"' +
  ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"' +
  ' aria-hidden="true"';
function svg(inner, txt) {
  return "<svg" + SVG_ATTRS + (txt ? ' fill="currentColor" stroke="none"' : "") +
    ">" + inner + "</svg>";
}
var ICONS = {
  "tb-undo":  svg('<path d="M8 5 4 9l4 4"/><path d="M4 9h7a5 5 0 1 1 0 10H8"/>'),
  "tb-redo":  svg('<path d="M12 5l4 4-4 4"/><path d="M16 9H9a5 5 0 1 0 0 10h3"/>'),
  "tb-copy":  svg('<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"/>'),
  "tb-cut":   svg('<circle cx="5.5" cy="5.5" r="2.2"/><circle cx="5.5" cy="14.5" r="2.2"/><path d="M7.4 7.2 17 16.5M7.4 12.8 17 3.5"/>'),
  "tb-paste": svg('<rect x="5" y="4" width="10" height="13" rx="1.5"/><path d="M8 2.5h4v3H8z"/>'),
  "tb-bold":  svg('<text x="10" y="15" text-anchor="middle" style="font:700 13px sans-serif">B</text>', true),
  "tb-ital":  svg('<text x="10" y="15" text-anchor="middle" style="font:italic 600 13px sans-serif">I</text>', true),
  "tb-und":   svg('<text x="10" y="14" text-anchor="middle" style="font:600 12px sans-serif">U</text><path d="M6 16h8" stroke="currentColor"/>', true),
  "tb-al-l":  svg('<path d="M3 6h14M3 10h9M3 14h12"/>'),
  "tb-al-c":  svg('<path d="M3 6h14M5.5 10h9M4.5 14h11"/>'),
  "tb-al-r":  svg('<path d="M3 6h14M8 10h9M5 14h12"/>'),
  "tb-col":   svg('<circle cx="10" cy="10" r="6"/><path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/>'),
  "tb-clr":   svg('<path d="M4 14 12 6l4 4-6 6H6z"/><path d="M3 17h14"/>'),
  "csv-imp":  svg('<path d="M10 12V3"/><path d="M6.5 6.5 10 3l3.5 3.5"/><path d="M4 13v3.5h12V13"/>'),
  "csv-exp":  svg('<path d="M10 3v9"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M4 13v3.5h12V13"/>'),
  "tb-sort-a": svg('<path d="M6 3v13M3 13l3 3 3-3"/><text x="14.5" y="8.5" text-anchor="middle" style="font:600 7px sans-serif" fill="currentColor" stroke="none">A</text><text x="14.5" y="17" text-anchor="middle" style="font:600 7px sans-serif" fill="currentColor" stroke="none">Z</text>'),
  "tb-sort-z": svg('<path d="M6 3v13M3 13l3 3 3-3"/><text x="14.5" y="8.5" text-anchor="middle" style="font:600 7px sans-serif" fill="currentColor" stroke="none">Z</text><text x="14.5" y="17" text-anchor="middle" style="font:600 7px sans-serif" fill="currentColor" stroke="none">A</text>'),
  "tb-filter": svg('<path d="M3.5 5h13l-5 6v4.5l-3 1.5v-6z"/>'),
  "tb-more":   svg('<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 8h14M8 8v9"/>'),
  "st-flt-x":  svg('<path d="M5 5l10 10M15 5 5 15"/>'),
  "tb-fmt":    svg('<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 10h14M10 3v14" stroke-dasharray="2 2"/><path d="M3 17h14" stroke-width="2.4"/>'),
  "tb-chart":  svg('<path d="M3 17h14"/><path d="M5.5 14V9M10 14V5M14.5 14v-3" stroke-width="2.4"/>'),
  "ch-edit":   svg('<path d="M4 16l1-4 8-8 3 3-8 8z"/><path d="M11.5 5.5l3 3"/>'),
  "ch-dl":     svg('<path d="M10 3v9"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M4 14v2.5h12V14"/>'),
  "ch-del":    svg('<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>')
};
var IC_X   = svg('<path d="M5 5l10 10M15 5 5 15"/>');
var IC_FILTER = svg('<path d="M3.5 5h13l-5 6v4.5l-3 1.5v-6z"/>');
var IC_ADD = svg('<path d="M10 4v12M4 10h12"/>');

/* SS-8: the toolbar titles in index.html are English only */
var TITLE_KEYS = {
  "tb-undo": "tb.undo", "tb-redo": "tb.redo", "tb-copy": "tb.copy",
  "tb-cut": "tb.cut", "tb-paste": "tb.paste", "tb-bold": "tb.bold",
  "tb-ital": "tb.ital", "tb-und": "tb.und", "tb-al-l": "tb.al.l",
  "tb-al-c": "tb.al.c", "tb-al-r": "tb.al.r", "tb-nf": "tb.nf",
  "tb-col": "tb.col", "tb-clr": "tb.clr",
  "tb-sort-a": "tb.sortA", "tb-sort-z": "tb.sortZ", "tb-filter": "tb.filter",
  "tb-more": "tb.more", "fx-mark": "fx.list", "st-flt-x": "flt.clear",
  "tb-fmt": "tb.fmt", "tb-chart": "tb.chart",
  "btn-csv-imp": "csv.imp", "btn-csv-exp": "csv.exp"
};

function injectIcons() {
  var k;
  for (k in TITLE_KEYS) {
    var te = $(k);
    if (te) { te.setAttribute("title", t(TITLE_KEYS[k])); te.setAttribute("aria-label", t(TITLE_KEYS[k])); }
  }
  var bar = $("sbar"); if (bar) bar.setAttribute("aria-label", t("tb.bar"));
  var tabsNav = $("stabs"); if (tabsNav) tabsNav.setAttribute("aria-label", t("sheets"));
  var nfSel = $("tb-nf");
  if (nfSel && nfSel.options[0]) nfSel.options[0].textContent = t("tb.nf.gen");
  if (nfSel) for (var oi = 0; oi < nfSel.options.length; oi++)
    if (nfSel.options[oi].value === "d") nfSel.options[oi].textContent = t("tb.nf.date");
  for (k in ICONS) {
    var el = $(k);
    if (el) {
      el.innerHTML = ICONS[k];
      if (!el.getAttribute("aria-label")) {
        var ttl = el.getAttribute("title");
        if (ttl) el.setAttribute("aria-label", ttl);
      }
    }
  }
  var imp = $("btn-csv-imp"), exp = $("btn-csv-exp");
  if (imp) imp.innerHTML = ICONS["csv-imp"] + "CSV";
  if (exp) exp.innerHTML = ICONS["csv-exp"] + "CSV";
}


/* format CSS injection (kept in JS — single-file discipline) */
(function injectFmtCss() {
  var st = document.createElement("style");
  st.textContent =
    "#grid td.fb{font-weight:700;}" +
    "#grid td.fi{font-style:italic;}" +
    "#grid td.fu{text-decoration:underline;}" +
    "#grid td.fa-l{text-align:left;}" +
    "#grid td.fa-c{text-align:center;}" +
    "#grid td.fa-r{text-align:right;}";
  document.head.appendChild(st);
})();

function wire() {
  var wrap = $("grid-wrap");
  var dragSelecting = false;
  var mdSelected = false;     /* mouse mousedown owns the next click */
  var tapWasSelected = false; /* tap target already selected pre-mousedown */
  var ptrType = "mouse";      /* last pointerdown type (mouse|touch|pen) */
  initResizeDocHandlers();   /* document-level: attach EXACTLY once */

  wrap.addEventListener("scroll", onGridScroll, { passive: true });
  var rsT = null;
  window.addEventListener("resize", function () {
    clearTimeout(rsT);
    rsT = setTimeout(function () {
      if (editing) return;
      buildGrid(); renderGrid(); renderSelection();
    }, 200);
  });

  $("grid").addEventListener("pointerdown", function (e) {
    ptrType = e.pointerType || "mouse";
  }, true);

  /* a header click selects the whole column / row (corner = all) */
  function headerSelect(pos, extend) {
    var sh = getActiveSheet();
    if (pos.all) { selR = 0; selC = 0; selAR = sh.rows - 1; selAC = sh.cols - 1; }
    else if (pos.col !== undefined) {
      if (extend) { selC = pos.col; selR = sh.rows - 1; selAR = 0; }
      else { selR = 0; selC = pos.col; selAR = sh.rows - 1; selAC = pos.col; }
    } else if (pos.row !== undefined) {
      if (extend) { selR = pos.row; selC = sh.cols - 1; selAC = 0; }
      else { selR = pos.row; selC = 0; selAR = pos.row; selAC = sh.cols - 1; }
    }
    renderSelection();
  }

  /* the bottom edge of a row number (mouse: 5 px, touch: 12 px) */
  function rowEdge(el, y, tol) {
    var th = el && el.closest && el.closest("th.rowh");
    if (!th) return -1;
    var rc = th.getBoundingClientRect();
    if (rc.bottom - y > tol) return -1;
    var p = gridPos(th);
    return p && p.row !== undefined ? p.row : -1;
  }
  $("grid").addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest(".fbtn")) return;   /* filter button: click opens */
    if (CHSEL) selectChart(null);
    var pos = gridPos(e.target);
    if (!pos) return;
    if (pos.td === undefined) {
      if (rsDrag) return;                         /* column resize grabbed the edge */
      if (editing) commitEdit(0, 0);
      var er = ptrType === "mouse" ? rowEdge(e.target, e.clientY, 5) : -1;
      if (er >= 0) {
        e.preventDefault();
        rhDrag = { r: er, y0: e.clientY, h0: rowH(getActiveSheet(), er), h: rowH(getActiveSheet(), er) };
        return;
      }
      mdSelected = (ptrType === "mouse");
      headerSelect(pos, e.shiftKey);
      return;
    }
    var r = pos.r, c = pos.c;
    tapWasSelected = (r === selR && c === selC && !editing);
    mdSelected = (ptrType === "mouse");
    if (editing) commitEdit(0, 0); /* then KEEP selecting the clicked cell */
    if (RANGE_MODE && mdSelected) {
      RANGE_MODE = false;
      selR = r; selC = c;
      renderSelection();
      return;
    }
    if (e.shiftKey) {
      /* Shift+click: extend selection from anchor */
      selR = r; selC = c;
      renderSelection();
    } else {
      collapseSel(r, c);
      dragSelecting = true;
      renderSelection();
    }
  });

  $("grid").addEventListener("mousemove", function (e) {
    if (!dragSelecting) {
      var rt = e.target.closest && e.target.closest("th.rowh");
      if (rt) { if (rowEdge(rt, e.clientY, 5) >= 0 || rhDrag) rt.classList.add("rowresize"); else rt.classList.remove("rowresize"); }
      return;
    }
    var pos = gridPos(e.target);
    if (!pos || pos.td === undefined) return;
    if (pos.r !== selR || pos.c !== selC) {
      selR = pos.r; selC = pos.c;
      renderSelection();
    }
  });

  document.addEventListener("mouseup", function () {
    dragSelecting = false;
  });

  /* dblclick on cell = edit (desktop fast path) */
  $("grid").addEventListener("dblclick", function (e) {
    var pos = gridPos(e.target);
    if (!pos || pos.td === undefined) return;
    if (e.target.closest && e.target.closest(".fbtn")) return;
    if (!editing) beginEdit();
  });

  /* right click: the sheet menu (rows, columns, freeze) */
  $("grid").addEventListener("contextmenu", function (e) {
    var pos = gridPos(e.target);
    if (lp.on || lp.timer || tRs) { e.preventDefault(); return; }   /* a long-press drag owns it */
    if (!pos || editing) return;
    e.preventDefault();
    if (pos.td !== undefined && !(pos.r >= selTop() && pos.r <= selBottom() && pos.c >= selLeft() && pos.c <= selRight())) {
      collapseSel(pos.r, pos.c); renderSelection();
    }
    openSheetMenu({ x: e.clientX, y: e.clientY });
  });

  /* mobile: tap selects, tap on SELECTED cell edits.
     ptrType comes from pointerdown (works in every browser —
     click/mousedown never expose pointerType in Firefox/Safari). */
  $("grid").addEventListener("click", function (e) {
    var fb = e.target.closest && e.target.closest(".fbtn");
    if (fb) {
      e.stopPropagation();          /* the document click would close it again */
      var fp = gridPos(fb);
      mdSelected = false;
      if (fp && fp.td !== undefined) openFilterPop(fp.c, fb);
      return;
    }
    if (mdSelected) { mdSelected = false; return; } /* mouse: mousedown owned it */
    if (Date.now() < ignoreClickUntil) return;      /* a touch drag just ended */
    if (CHSEL) selectChart(null);
    var pos = gridPos(e.target);
    if (!pos) return;
    if (pos.td === undefined) { if (editing) commitEdit(0, 0); headerSelect(pos, false); return; }
    var r = pos.r, c = pos.c;
    if (editing) commitEdit(0, 0);
    if (RANGE_MODE) {
      RANGE_MODE = false;
      selR = r; selC = c;
      renderSelection();
      return;
    }
    if (tapWasSelected && r === selR && c === selC) beginEdit();
    else { collapseSel(r, c); renderSelection(); }
  });

  /* ---- touch (Wave 2): drag the right edge of a column letter or the
     bottom edge of a row number to resize; long-press a cell, then
     drag, to select a range (a long-press without moving still opens
     the sheet menu) ---- */
  var tRs = null, lp = { timer: null, on: false, moved: false, x: 0, y: 0 }, ignoreClickUntil = 0;
  function lpClear() { if (lp.timer) { clearTimeout(lp.timer); lp.timer = null; } }
  $("grid").addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) { lpClear(); return; }
    var tc = e.touches[0], th = e.target.closest && e.target.closest("th");
    if (CHSEL) selectChart(null);
    if (th) {
      var hp = gridPos(th), rc = th.getBoundingClientRect(), sh = getActiveSheet();
      if (hp && hp.col !== undefined && rc.right - tc.clientX <= 16) {
        e.preventDefault();
        tRs = { k: "c", i: hp.col, x0: tc.clientX, y0: tc.clientY, s0: colW(sh, hp.col), v: colW(sh, hp.col), moved: false, pos: hp };
      } else if (hp && hp.row !== undefined && rc.bottom - tc.clientY <= 12) {
        e.preventDefault();
        tRs = { k: "r", i: hp.row, x0: tc.clientX, y0: tc.clientY, s0: rowH(sh, hp.row), v: rowH(sh, hp.row), moved: false, pos: hp };
      }
      return;
    }
    var p = gridPos(e.target);
    if (!p || p.td === undefined || editing) return;
    lp.x = tc.clientX; lp.y = tc.clientY; lp.moved = false; lp.on = false;
    lpClear();
    lp.timer = setTimeout(function () {
      lp.timer = null; lp.on = true;
      if (editing) commitEdit(0, 0);
      collapseSel(p.r, p.c);
      renderSelection();
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (er) {}
    }, 420);
  }, { passive: false });
  $("grid").addEventListener("touchmove", function (e) {
    var tc = e.touches[0];
    if (!tc) return;
    if (tRs) {
      e.preventDefault();
      var d = tRs.k === "c" ? tc.clientX - tRs.x0 : tc.clientY - tRs.y0;
      if (Math.abs(d) > 3) tRs.moved = true;
      if (!tRs.moved) return;
      if (tRs.k === "c") { tRs.v = Math.max(40, Math.min(400, tRs.s0 + d)); setColWLive(tRs.i, tRs.v); }
      else { tRs.v = Math.max(RH_MIN, Math.min(RH_MAX, tRs.s0 + d)); setRowHLive(tRs.i, tRs.v); }
      return;
    }
    if (lp.timer && Math.abs(tc.clientX - lp.x) + Math.abs(tc.clientY - lp.y) > 10) { lpClear(); return; }
    if (!lp.on) return;
    e.preventDefault();
    lp.moved = true;
    var q = cellFromPoint(tc.clientX, tc.clientY);
    if (q && (q.r !== selR || q.c !== selC)) { selR = q.r; selC = q.c; renderSelection(); }
    var br = wrap.getBoundingClientRect();
    if (tc.clientY > br.bottom - 30) wrap.scrollTop += 16; else if (tc.clientY < br.top + HEADH + FRH + 10) wrap.scrollTop -= 16;
    if (tc.clientX > br.right - 30) wrap.scrollLeft += 16; else if (tc.clientX < br.left + ROWHEADW + 10) wrap.scrollLeft -= 16;
  }, { passive: false });
  function touchEnd(e) {
    lpClear();
    if (tRs) {
      var d = tRs;
      tRs = null;
      if (e.cancelable) e.preventDefault();      /* no click after it */
      ignoreClickUntil = Date.now() + 450;
      if (d.moved) { if (d.k === "c") { commitColW(); } else commitRowH(d.i, d.v); }
      else { if (editing) commitEdit(0, 0); headerSelect(d.pos, false); }
      return;
    }
    if (lp.on) {
      lp.on = false;
      if (e.cancelable) e.preventDefault();
      ignoreClickUntil = Date.now() + 450;
      if (!lp.moved && e.type === "touchend") openSheetMenu({ x: lp.x, y: lp.y });
    }
  }
  $("grid").addEventListener("touchend", touchEnd);
  $("grid").addEventListener("touchcancel", touchEnd);

  /* ---- the system clipboard: Ctrl+C / X / V and the toolbar ---- */
  document.addEventListener("copy", function (e) { onCopyEvent(e, false); });
  document.addEventListener("cut", function (e) { onCopyEvent(e, true); });
  document.addEventListener("paste", onPasteEvent);

  wrap.addEventListener("keydown", function (e) {
    if (editing) return;
    var k = e.key;
    if (CHSEL) selectChart(null);
    if (RANGE_MODE && k === "Escape") { RANGE_MODE = false; return; }
    if (k === "ArrowUp") { e.preventDefault(); navigate(-1, 0, e.shiftKey); }
    else if (k === "ArrowDown") { e.preventDefault(); navigate(1, 0, e.shiftKey); }
    else if (k === "ArrowLeft") { e.preventDefault(); navigate(0, -1, e.shiftKey); }
    else if (k === "ArrowRight") { e.preventDefault(); navigate(0, 1, e.shiftKey); }
    else if (k === "Enter" || k === "F2") { e.preventDefault(); beginEdit(); }
    else if (k === "Tab") { e.preventDefault(); navigate(0, 1); }
    else if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      var page = Math.max(1, Math.floor((wrap.clientHeight - HEADH) / ROWH) - 1);
      navigate(k === "PageDown" ? page : -page, 0, e.shiftKey);
    }
    else if (k === "Delete" || k === "Backspace") {
      e.preventDefault(); clearSelected();
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z") && !e.shiftKey) {
      e.preventDefault(); doUndo();
    }
    else if ((e.ctrlKey || e.metaKey) &&
             ((k === "y" || k === "Y") || (e.shiftKey && (k === "z" || k === "Z")))) {
      e.preventDefault(); doRedo();
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "C" || k === "x" || k === "X" || k === "v" || k === "V")) {
      /* left to the browser: the copy / cut / paste events reach the
         system clipboard (onCopyEvent, onPasteEvent) */
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "b" || k === "B")) {
      e.preventDefault(); applyFormatToSelection(fmtToggle("b"));
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "i" || k === "I")) {
      e.preventDefault(); applyFormatToSelection(fmtToggle("i"));
    }
    else if ((e.ctrlKey || e.metaKey) && (k === "u" || k === "U")) {
      e.preventDefault(); applyFormatToSelection(fmtToggle("u"));
    }
    else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === "p" || k === "P")) {
      e.preventDefault(); openPrintDialog();     /* the sheet, not the app's window */
    }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); beginEdit(k);
    }
  });

  var fx = $("fx-input");
  fx.addEventListener("focus", function () { fxFocused = true; fxStartVal = fx.value; });
  fx.addEventListener("blur", function () {
    fxFocused = false;
    renderSelection();
  });
  fx.addEventListener("input", function () { fxHelpUpdate(fx); });
  fx.addEventListener("blur", function () { setTimeout(fxHelpHideSoon, 150); });
  fx.addEventListener("keydown", function (e) {
    if (fxHelpKey(e, fx)) { e.stopPropagation(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      var val = fx.value.replace(/^\s+|\s+$/g, "");
      if (fx.value === fxStartVal) { /* SS-4: untouched: write nothing */ }
      else if (val === "") { if (getCell(selR, selC)) deleteCell(selR, selC); }
      else setCell(selR, selC, val);
      queueSave(); invalidateEval(); renderGrid();
      navigate(1, 0);
      fx.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      var cel = getCell(selR, selC);
      fx.value = cel ? cel.v : "";
      fx.blur();
    }
    e.stopPropagation();
  });

  /* ---- toolbar buttons ---- */
  var btn = function (id, fn) {
    var el = $(id);
    if (el) el.addEventListener("click", fn);
  };
  btn("tb-undo", doUndo);
  btn("tb-redo", doRedo);
  btn("tb-copy", function () { sysCopy(false); });
  btn("tb-cut", function () { sysCopy(true); });
  btn("tb-paste", sysPaste);
  btn("tb-fmt", function (e) { e.stopPropagation(); openFormatMenu({ el: $("tb-fmt") }); });
  btn("tb-chart", function (e) { e.stopPropagation(); insertChart(); });
  btn("tb-bold", function () { applyFormatToSelection(fmtToggle("b")); });
  btn("tb-ital", function () { applyFormatToSelection(fmtToggle("i")); });
  btn("tb-und", function () { applyFormatToSelection(fmtToggle("u")); });
  btn("tb-al-l", function () { applyFormatToSelection(fmtAlign("l")); });
  btn("tb-al-c", function () { applyFormatToSelection(fmtAlign("c")); });
  btn("tb-al-r", function () { applyFormatToSelection(fmtAlign("r")); });
  btn("tb-col", toggleSwatchPopover);
  btn("tb-clr", function () {
    applyFormatToSelection(clearFormat());
    notifyTransient(t("fmt.cleared"));
  });
  var nf = $("tb-nf");
  if (nf) nf.addEventListener("change", function () {
    applyFormatToSelection(fmtNumFormat(nf.value));
  });
  btn("tb-sort-a", function () { sortSelection(false); });
  btn("tb-sort-z", function () { sortSelection(true); });
  btn("tb-filter", toggleFilter);
  btn("tb-more", function (e) { e.stopPropagation(); openSheetMenu({ el: $("tb-more") }); });
  btn("fx-mark", function (e) { e.stopPropagation(); openFxList(); });
  btn("st-flt-x", clearFilter);

  /* sheet menu / filter / function list close on an outside click */
  document.addEventListener("click", function () { closePops(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && popEl) { closePops(); }
  });

  /* swatch popover closes on outside click */
  document.addEventListener("click", function (e) {
    var pop = $("swatches");
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (e.target === $("tb-col") || $("tb-col").contains(e.target)) return;
    pop.hidden = true;
  });

  /* CSV buttons */
  var bi = $("btn-csv-imp"), be = $("btn-csv-exp");
  if (be) be.addEventListener("click", csvExport);
  if (bi) bi.addEventListener("click", function () {
    var dlg = dialogHost();
    if (dlg && typeof dlg.openFile === "function") {
      dlg.openFile(".csv,text/csv").then(function (f) {
        if (f) csvImport(f);      // cancel (null) = silent exit
      });
      return;
    }
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".csv,text/csv";
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) csvImport(inp.files[0]);
    });
    inp.click();
  });

  injectXlButtons();   /* #9: XLSX/ODS import + export buttons */
  injectNotionButton();   /* wave 6E: Import from Notion */

  window.addEventListener("beforeunload", function () {
    if (editing) commitEdit(0, 0);
    saveNow();
  });
}

/* SHELL SHORTCUT FORWARDING (Contract Β — capture phase) */
document.addEventListener("keydown", function (e) {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
  var p = window.parent;
  if (!(p && p.orosShortcuts &&
      typeof p.orosShortcuts.handle === "function")) return;
  if (p.orosShortcuts.handle(e)) e.stopPropagation();
}, true);

/* ===== Import from Notion (integrations wave 6E, platforms.js) =====
   The plan comes from links/sheets.js; this is its one write: a new
   sheet per database (row 1 in bold) and, when asked, the values of a
   sheet imported before (its formats stay). Undo deletes the new
   sheets (tombstoned, like any deletion here) and puts back the old
   values. Only inside the orOS shell.                              */
var PLAT = window.OrosSheetPlatforms || null;
function platformData() {
  var sheets = {}, k;
  state.sheets.forEach(function (sh) { sheets[sh.id] = []; });
  for (k in state.cells) {
    var pk = k.split("|"), g = sheets[pk[0]];
    if (!g) continue;
    var r = +pk[1], c = +pk[2];
    while (g.length <= r) g.push([]);
    while (g[r].length <= c) g[r].push("");
    g[r][c] = state.cells[k].v;
  }
  return { sheets: sheets, deleted: state.deleted };
}
function platformApply(pl, doneText) {
  var ts = now(), back = { sheets: [], cells: [] }, first = null;
  pl.add.forEach(function (a) {
    if (getSheetById(a.id)) return;
    var rows = a.rows.slice(0, XL_ROWS_CAP), maxCols = 0, r, c;
    for (r = 0; r < rows.length; r++) if (rows[r].length > maxCols) maxCols = rows[r].length;
    state.sheets.push({
      id: a.id, name: a.name, bi: undefined,
      rows: Math.min(Math.max(ROWS, rows.length + 5), XL_ROWS_CAP),
      cols: Math.min(Math.max(COLS, maxCols), XL_COLS_CAP),
      cw: {}, pos: maxPos() + 1, mtime: ts
    });
    delete state.deleted[a.id];
    for (r = 0; r < rows.length; r++)
      for (c = 0; c < rows[r].length && c < XL_COLS_CAP; c++) {
        if (rows[r][c] === "") continue;
        var rec = { v: rows[r][c], mtime: ts };
        if (r === 0) rec.f = { b: 1 };
        state.cells[cellKey(a.id, r, c)] = rec;
      }
    back.sheets.push(a.id);
    if (!first) first = a.id;
  });
  pl.upd.forEach(function (u) {
    var sh = getSheetById(u.id);
    if (!sh) return;
    var rows = u.rows.slice(0, XL_ROWS_CAP), want = {}, r, c, k, maxCols = 0;
    for (r = 0; r < rows.length; r++)
      for (c = 0; c < rows[r].length && c < XL_COLS_CAP; c++) {
        if (rows[r][c] !== "") want[cellKey(u.id, r, c)] = rows[r][c];
        if (c + 1 > maxCols) maxCols = c + 1;
      }
    var keys = {};
    for (k in state.cells) if (k.indexOf(u.id + "|") === 0) keys[k] = 1;
    for (k in want) keys[k] = 1;
    for (k in keys) {
      var cur = state.cells[k], pk = k.split("|");
      if (Object.prototype.hasOwnProperty.call(want, k)) {
        if (cur && cur.v === want[k]) continue;
        back.cells.push({ key: k, before: snapCell(u.id, +pk[1], +pk[2]) });
        rawSet(u.id, +pk[1], +pk[2], want[k], cur && cur.f);
      } else if (cur && cur.v !== "") {
        back.cells.push({ key: k, before: snapCell(u.id, +pk[1], +pk[2]) });
        if (cur.f) rawSet(u.id, +pk[1], +pk[2], "", cur.f);
        else rawDel(u.id, +pk[1], +pk[2]);
      }
    }
    var nr = Math.min(Math.max(sh.rows, rows.length + 5), XL_ROWS_CAP), nc = Math.min(Math.max(sh.cols, maxCols), XL_COLS_CAP);
    if (nr !== sh.rows || nc !== sh.cols) { sh.rows = nr; sh.cols = nc; sh.mtime = ts; }
    if (!first) first = u.id;
  });
  if (!back.sheets.length && !back.cells.length) return true;
  platformDone(first);
  notifyUndo(doneText, function () { platformUndo(back); });
  return true;
}
function platformUndo(back) {
  back.cells.slice().reverse().forEach(function (e) {
    var pk = e.key.split("|");
    if (!getSheetById(pk[0])) return;
    if (e.before === null) rawDel(pk[0], +pk[1], +pk[2]);
    else rawSet(pk[0], +pk[1], +pk[2], e.before.v, e.before.f);
  });
  var ts = now();
  back.sheets.forEach(function (id) {
    if (!getSheetById(id) || state.sheets.length <= 1) return;
    state.sheets = state.sheets.filter(function (sh) { return sh.id !== id; });
    state.deleted[id] = ts;
    for (var k in state.cells) if (k.indexOf(id + "|") === 0) delete state.cells[k];
  });
  if (!getSheetById(actSID)) { actSID = state.sheets[0].id; saveActive(); }
  platformDone(null);
  notifyTransient(PLAT ? PLAT.undone() : "");
}
function platformDone(id) {
  invalidateEval();
  markDirty();
  saveNow();
  if (id && id !== actSID) { switchTo(id); return; }
  resetDisp();
  collapseSel(0, 0);
  buildGrid();
  renderTabs();
  renderGrid();
  renderSelection();
}
/* a notice with an Undo button (the shell's notifications) */
function notifyUndo(text, fn) {
  try {
    var N = (window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
    if (N && typeof N.transient === "function") {
      N.transient({ ns: "spreadsheet", title: text, body: "", action: { label: PLAT ? PLAT.undoLabel() : "Undo", fn: fn } });
      return;
    }
  } catch (e) { /* cross-origin guard */ }
  toast(text);
}
/* the cloud button next to CSV / XL (only when the shell can call Notion) */
function injectNotionButton() {
  var host = $("btn-xl-exp") || $("btn-csv-exp");
  if (!PLAT || !PLAT.has() || !host || $("btn-notion")) return;
  PLAT.init({ lang: LANG, data: platformData, apply: platformApply });
  var b = document.createElement("button");
  b.type = "button";
  b.id = "btn-notion";
  b.className = host.className;
  b.title = PLAT.label();
  b.setAttribute("aria-label", PLAT.label());
  b.innerHTML = svg('<path d="M14.5 15.5H7a5 5 0 1 1 4.6-7h1.4a3.5 3.5 0 1 1 0 7z"/><path d="M10 9.5v4"/><path d="m8.3 11.8 1.7 1.7 1.7-1.7"/>') + "Notion";
  b.addEventListener("click", function () { if (editing) commitEdit(0, 0); PLAT.open(); });
  host.parentElement.insertBefore(b, host.nextSibling);
}

/* ===== "Open in Spreadsheet" from another app (Bible BR-S1) =====
   target = { newSheet: { name, rows: [[cell, …], …], sum: [col, …] } }
   Always a NEW sheet (never overwrites). Row 1 is the heading. A cell
   is a finite number, a string (plain text: one starting with = + - @
   gets an apostrophe, so it never runs as a formula) or null/"".
   `sum`: 0-based columns that get =SUM(…) under the last row, the
   only formulas made here. Capped at XL_ROWS_CAP × XL_COLS_CAP.   */
function tableCell(v) {
  if (typeof v === "number") return isFinite(v) ? String(v) : "";
  if (typeof v !== "string") return "";
  v = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, 500);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function sheetFromTable(p) {
  if (!p || typeof p !== "object" || !Array.isArray(p.rows) || !p.rows.length) return false;
  var sums = Array.isArray(p.sum) ? p.sum.filter(function (c) {
    return c === Math.floor(c) && c >= 0 && c < XL_COLS_CAP;
  }) : [];
  var rows = p.rows.slice(0, XL_ROWS_CAP - (sums.length ? 1 : 0)).map(function (r) {
    return Array.isArray(r) ? r.slice(0, XL_COLS_CAP).map(tableCell) : [];
  });
  var maxCols = 0, r, c;
  for (r = 0; r < rows.length; r++) if (rows[r].length > maxCols) maxCols = rows[r].length;
  var name = typeof p.name === "string" && p.name.trim() ? xlSafeName(p.name) : null;
  var ts = now(), num = nextSheetNumber();
  var sh = {
    id: uid(),
    name: name,
    bi: name ? undefined : { en: "Sheet" + num, el: "\u03A6\u03CD\u03BB\u03BB\u03BF" + num },
    rows: Math.min(Math.max(ROWS, rows.length + 5), XL_ROWS_CAP),
    cols: Math.min(Math.max(COLS, maxCols), XL_COLS_CAP),
    cw: {},
    pos: maxPos() + 1,
    mtime: ts
  };
  state.sheets.push(sh);
  for (r = 0; r < rows.length; r++)
    for (c = 0; c < rows[r].length; c++)
      if (rows[r][c] !== "") state.cells[cellKey(sh.id, r, c)] = { v: rows[r][c], mtime: ts };
  if (rows.length > 1) sums.forEach(function (col) {
    var L = colName(col);
    state.cells[cellKey(sh.id, rows.length, col)] = { v: "=SUM(" + L + "2:" + L + rows.length + ")", mtime: ts };
  });
  markDirty();
  invalidateEval();
  switchTo(sh.id);
  notifyTransient(t("tbl.made").replace("{n}", name || sh.bi[LANG] || sh.bi.en));
  return true;
}
/* One receiver for every deep link: live push from the shell
   (window.__orosOpenAt) and the staged target at boot
   (window.parent.__orosTakeTarget). { newSheet } = BR-S1,
   { sheet, r?, c? } = universal search.                            */
function openTarget(tg) {
  if (!tg || typeof tg !== "object") return;
  // { newBlank: true }: the single app's "New sheet" icon shortcut.
  if (tg.newBlank === true) { if (editing) commitEdit(0, 0); addSheet(); return; }
  if (tg.edit || tg.editUndo) { assistRun(tg); return; }
  if (tg.openFile) openSharedFile(tg.openFile);
  else if (tg.newSheet) sheetFromTable(tg.newSheet);
  else openSearchTarget(tg);
}
/* { openFile: { token } }: a file from the system's "Open with"
   (shell fileopen.js), taken once from the shell, then the same
   import as the XL / CSV buttons.                                  */
function openSharedFile(o) {
  var f = null;
  try {
    var p = window.parent;
    if (o && typeof o.token === "string" && p && p !== window && typeof p.__orosTakeFile === "function")
      f = p.__orosTakeFile(o.token);
  } catch (e) { f = null; }
  if (!f) return;
  var nm = String(f.name || "").toLowerCase();
  if (/\.(xlsx|xls|ods|orossheet)$/.test(nm)) bookOrXlImport(f);
  else if (/\.csv$/.test(nm)) csvImport(f);
}
window.__orosOpenAt = openTarget;
/* AS-EDIT (wave SS1): the Assistant's changes (commands.js, assist.js,
   loaded on the first request) write through these */
window.SheetAssistHost = {
  t: t, toast: notifyTransient, undoToast: notifyUndo, lang: function () { return LANG; }, now: now,
  state: function () { return state; }, getSheet: getSheetById, activeId: function () { return actSID; }, switchTo: switchTo,
  flush: function () { if (editing) commitEdit(0, 0); closePops(); },
  rawSet: rawSet, rawDel: rawDel, canonF: canonF, applyObj: applyObj, push: pushUndo,
  done: function () {
    if (!getActiveSheet() || !getSheetById(actSID)) actSID = state.sheets[0].id;
    invalidateEval(); resetDisp(); markDirty(); queueSave();
    buildGrid(); renderTabs(); renderGrid(); renderSelection();
  }
};
var assistP = null;
function assistLoad() {
  if (window.SheetAssist) return Promise.resolve(window.SheetAssist);
  if (!assistP) {
    var v = (document.querySelector('script[src*="spreadsheet.js?v="]') || {}).src || "", m = v.match(/[?&]v=([^&#]+)/);
    var load = function (f) {
      return new Promise(function (ok, fail) {
        var s = document.createElement("script");
        s.src = f + (m ? "?v=" + m[1] : "");
        s.onload = ok; s.onerror = function () { fail(new Error(f)); };
        document.head.appendChild(s);
      });
    };
    assistP = (window.orosRecipes ? Promise.resolve() : load("../recipes/core.js"))
      .then(function () { return load("commands.js"); }).then(function () { return load("assist.js"); }).then(function () {
        if (!window.SheetAssist) throw new Error("assist");
        return window.SheetAssist;
      });
    assistP.catch(function () { assistP = null; });
  }
  return assistP;
}
/* { edit: { key, chat, docs, steps } } | { editUndo: { key, tok } } */
function assistRun(tg) {
  assistLoad().then(function (A) {
    if (tg.edit) A.edit(tg.edit); else A.undo(tg.editUndo);
  }, function () { notifyTransient(t("as.bad")); });
}
function takeTarget() {
  var tg = null;
  try {
    if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function")
      tg = window.parent.__orosTakeTarget("spreadsheet");
  } catch (e) { tg = null; }
  openTarget(tg);
}

function boot() {
  console.log("[SS] boot start, LANG =", LANG);
  loadState();
  console.log("[SS] loadState ok, sheets:",
    state.sheets.length, "| cells:", Object.keys(state.cells).length);
  applyI18n();
  injectIcons();
  initCharts();
  initFillHandle();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  buildGrid();
  renderTabs();
  collapseSel(0, 0);
  renderGrid();
  renderSelection();
  console.log("[SS] boot COMPLETE [Wave 3]");
  $("grid-wrap").focus();
  takeTarget();
}

boot();

/* Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
   target { sheet, r?, c? }. Shows the sheet and selects the cell.
   Unknown sheet, a cell edit in progress or an open dialog -> no-op. */
function openSearchTarget(tg) {
  if (!tg || typeof tg.sheet !== "string" || editing) return;
  if (document.querySelector("dialog[open]")) return;
  var sh = getSheetById(tg.sheet);
  if (!sh) return;
  switchTo(sh.id);
  var r = tg.r, c = tg.c;
  if (typeof r !== "number" || typeof c !== "number" ||
      r < 0 || c < 0 || r >= sh.rows || c >= sh.cols) return;
  collapseSel(Math.floor(r), Math.floor(c));
  ensureVisible(selR, selC);
  renderSelection();
}

})();
