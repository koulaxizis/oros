// ============================================================
// orOS Text Tools — App logic (v1.0.0)
// Paste text, pick a tool, get the result live; chain several steps
// and keep a chain as a recipe. The tools themselves are in core.js
// (TextToolsCore); chains run in worker.js when the browser allows.
// Data:
//   - synced slice "texttools" (oros-texttools-data): recipes only,
//     LWW + tombstones (core.mergeRecipes; R5, R17, R26)
//   - sessionStorage oros-texttools-session: the text, the steps and
//     the open tab, for this browser session only (never stored on
//     the device, never synced)
//   - device-local oros-texttools-prefs: { layout: "stack"|"side" }
// Sections:
//   1. Constants, i18n, helpers
//   2. State: storage, session, prefs
//   3. Running a chain (worker, time limit, live preview)
//   4. UI: groups, tools, steps, options
//   5. Text panes: stats, open, paste, clear, copy, use, save
//   6. Recipes
//   7. Send to other apps
//   8. Dialogs + toasts
//   9. Keyboard (Contract Β)
//  10. Sync slice + palette
//  11. Deep link, wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.TextToolsCore;
  var STORAGE_KEY = "oros-texttools-data";
  var PREFS_KEY   = "oros-texttools-prefs";
  var SESSION_KEY = "oros-texttools-session";
  var FILE_MAX    = 5 * 1024 * 1024;
  var PATTERN_MS  = 2000;          // a chain with a pattern stops after this
  var CHAIN_MS    = 30000;         // any other chain
  var NOTES_MAX   = 20000;         // Notes target { add } takes this much
  var SHEET_ROWS  = 500, SHEET_COLS = 64, TODO_MAX = 200;
  var OPEN_ACCEPT = ".txt,.text,.csv,.tsv,.md,.markdown,.log,.json,text/plain,text/csv,text/tab-separated-values,text/markdown";

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }

  var STRINGS = {
    en: {
      "app": "Text Tools",
      "grp.lines": "Lines", "grp.space": "Clean up", "grp.num": "Numbers", "grp.cols": "Columns", "grp.find": "Find",
      "grp.code": "Encode", "grp.cmp": "Compare",
      "tool.sort": "Sort", "tool.reverse": "Reverse order", "tool.dedupe": "Remove duplicates", "tool.dupes": "Only duplicates",
      "tool.count": "Count lines", "tool.noempty": "Remove empty lines", "tool.squeeze": "One empty line",
      "tool.filter": "Keep / remove lines", "tool.join": "Join lines", "tool.split": "Split into lines",
      "tool.trim": "Trim spaces", "tool.spaces": "Collapse spaces", "tool.tabs": "Tabs ↔ spaces", "tool.unwrap": "Unwrap lines",
      "tool.wrap": "Wrap lines", "tool.clean": "Hidden characters", "tool.eol": "Line endings",
      "tool.number": "Number lines", "tool.unnumber": "Remove numbers / bullets", "tool.affix": "Prefix / suffix",
      "tool.convert": "Change separator", "tool.columns": "Pick columns", "tool.transpose": "Rows ↔ columns",
      "tool.markdown": "Markdown table", "tool.json": "JSON", "tool.replace": "Find and replace",
      "tool.extract": "Extract", "tool.url": "URL", "tool.base64": "Base64", "tool.html": "HTML entities",
      "tool.slug": "Slug", "tool.diff": "Compare texts",
      "hint.sort": "Sorts the lines in alphabetical order (Greek and English), by number, by length or at random.",
      "hint.reverse": "Puts the last line first.",
      "hint.dedupe": "Keeps each line once.",
      "hint.dupes": "Shows only the lines that appear more than once, each one once.",
      "hint.count": "Each different line once, with how many times it appears (number, tab, line).",
      "hint.noempty": "Removes empty lines and lines with only spaces.",
      "hint.squeeze": "Several empty lines in a row become one.",
      "hint.filter": "Keeps (or removes) the lines that contain a text.",
      "hint.join": "Puts all lines on one line with a separator between them.",
      "hint.split": "Breaks the text into lines wherever the separator appears.",
      "hint.trim": "Removes spaces and tabs at the start and end of each line.",
      "hint.spaces": "Two or more spaces in a row become one.",
      "hint.tabs": "Turns tabs into spaces, or leading spaces into tabs.",
      "hint.unwrap": "Joins the lines of each paragraph into one line. Empty lines between paragraphs stay.",
      "hint.wrap": "Breaks long lines between words.",
      "hint.clean": "Removes invisible characters that come with copied text, and makes odd spaces normal.",
      "hint.eol": "Windows programs sometimes want CRLF line endings.",
      "hint.number": "Adds 1. 2. 3. … at the start of each line.",
      "hint.unnumber": "Removes 1. 2) - • and similar marks from the start of each line.",
      "hint.affix": "Adds the same text before and after each line.",
      "hint.convert": "For CSV and similar tables: changes the separator between columns. Quotes are handled.",
      "hint.columns": "Keeps the columns you list, in that order, or removes them.",
      "hint.transpose": "Rows become columns and columns become rows.",
      "hint.markdown": "Makes a Markdown table from a CSV-like table.",
      "hint.json": "Makes JSON from a CSV-like table.",
      "hint.replace": "Finds a text and replaces it everywhere.",
      "hint.extract": "Lists the emails, links, phone numbers, numbers, #hashtags or @names found in the text, one per line.",
      "hint.url": "Encodes text for a web address (Ελλάδα → %CE%95…) or decodes it back.",
      "hint.base64": "Encodes text as Base64 or decodes Base64 back to text (UTF-8).",
      "hint.html": "Turns < > & \" ' into HTML entities, or entities like &amp; and &#233; back into characters.",
      "hint.slug": "Makes each line a web-friendly name: “Καλή Χρονιά!” → kali-chronia.",
      "hint.diff": "Compares the text with a second text, line by line: - removed, + added. The second text is not saved in recipes.",
      "opt.by": "Order", "val.by.az": "A → Z", "val.by.za": "Z → A", "val.by.natural": "Natural (2 before 10)",
      "val.by.num": "By number", "val.by.len": "By length", "val.by.random": "Random",
      "opt.icase": "Ignore case", "opt.iaccent": "Ignore accents", "opt.emptyLast": "Empty lines at the end",
      "opt.keep": "Keep", "val.keep.first": "The first one", "val.keep.last": "The last one",
      "opt.trim": "Ignore spaces at the edges", "opt.split.trim": "Trim each piece", "opt.empty": "Also remove repeated empty lines",
      "opt.order": "Order", "val.order.count": "Most first", "val.order.first": "As they appear", "val.order.az": "A → Z",
      "opt.mode": "Action", "val.mode.keep": "Keep", "val.mode.drop": "Remove",
      "opt.where": "Lines that", "val.where.contains": "contain", "val.where.starts": "start with",
      "val.where.ends": "end with", "val.where.regex": "match a pattern",
      "opt.find": "Find", "opt.filter.find": "Text", "opt.repl": "Replace with",
      "opt.sep": "Separator", "opt.split.sep": "Split at", "opt.skipEmpty": "Skip empty lines", "opt.split.skipEmpty": "Skip empty pieces",
      "opt.side": "Where", "val.side.both": "Both ends", "val.side.start": "Start only", "val.side.end": "End only",
      "opt.indent": "Keep indentation",
      "opt.dir": "Direction", "val.dir.t2s": "Tabs → spaces", "val.dir.s2t": "Leading spaces → tabs", "opt.width": "Width",
      "opt.wrap.width": "Characters per line",
      "opt.invisible": "Remove invisible characters", "opt.nbsp": "Odd spaces → normal space",
      "opt.quotes": "Curly quotes and «» → straight quotes", "opt.dashes": "Dashes → hyphen, … → ...",
      "opt.to": "To", "val.to.lf": "LF (Linux, Android, Mac)", "val.to.crlf": "CRLF (Windows)",
      "opt.style": "Style", "val.style.dot": "1.", "val.style.paren": "1)", "val.style.dash": "1 -", "val.style.bracket": "(1)",
      "val.style.tab": "1 + tab", "val.style.space": "1 + space",
      "opt.start": "Start at", "opt.step": "Step", "opt.pad": "Digits (001)",
      "opt.prefix": "Before", "opt.suffix": "After",
      "opt.delim": "Separator in", "opt.convert.to": "Separator out", "opt.custom": "Your separator", "opt.toCustom": "Your separator",
      "dl.auto": "Find it", "dl.comma": "Comma ,", "dl.semi": "Semicolon ;", "dl.tab": "Tab", "dl.pipe": "Pipe |", "dl.custom": "Other…",
      "opt.quoteAll": "Quotes around every field",
      "opt.cols": "Columns", "ph.cols": "e.g. 3,1 or 2-4",
      "opt.header": "First row is the heading",
      "opt.word": "Whole words", "opt.regex": "Pattern (regular expression)",
      "opt.what": "Find", "val.what.emails": "Emails", "val.what.links": "Links", "val.what.phones": "Phone numbers",
      "val.what.numbers": "Numbers", "val.what.hashtags": "#hashtags", "val.what.mentions": "@names",
      "opt.unique": "Each one once", "opt.extract.sort": "Sort A → Z",
      "opt.url.dir": "Action", "opt.base64.dir": "Action", "opt.html.dir": "Action",
      "val.dir.enc": "Encode", "val.dir.dec": "Decode",
      "opt.full": "Whole address (keep : / ? & =)", "opt.plus": "+ means a space (forms)",
      "opt.each": "Each line on its own", "opt.urlsafe": "URL-safe (- _ without =)",
      "opt.all": "Also every non-English character (&#…;)",
      "opt.greek": "Greek letters", "val.greek.latin": "To Latin (kali-mera)", "val.greek.keep": "Keep (καλη-μερα)",
      "opt.slug.sep": "Between words", "val.sep.dash": "Dash -", "val.sep.under": "Underscore _",
      "opt.slug.max": "Longest (0 = no limit)",
      "opt.show": "Show", "val.show.all": "Everything (- removed, + added)", "val.show.changes": "Only the changes",
      "val.show.added": "Only lines added", "val.show.removed": "Only lines removed", "val.show.same": "Only lines in both",
      "other.label": "Compare with", "other.ph": "Paste the second text here…", "btn.openOther": "Open a file for the second text",
      "btn.swap": "Swap the two texts",
      "ph.sep": "\\t = tab, \\n = new line",
      "preset.bullet": "• bullet", "preset.dash": "- dash", "preset.quotes": "\"…\"", "preset.gr": "«…»", "preset.sql": "'…',",
      "sec.steps": "Steps", "step.add": "+ Step", "step.aria": "Step {n}: {tool}", "step.del": "Remove step {n}",
      "step.up": "Move step {n} up", "step.full": "Up to {n} steps",
      "pane.in": "Text", "pane.out": "Result",
      "btn.open": "Open a file", "btn.paste": "Paste", "btn.clear": "Clear", "btn.layout": "Side by side / one under the other",
      "btn.copy": "Copy", "btn.use": "Use as text", "btn.save": "Save", "btn.send": "Send", "btn.apply": "Apply",
      "btn.recipes": "Recipes", "btn.saveRecipe": "Save as recipe", "btn.updateRecipe": "Update “{name}”",
      "in.ph": "Paste or type your text here…",
      "st.line": "{c} characters · {w} words · {l} lines", "st.more": "Tap for more",
      "stats.title": "Text statistics", "stats.chars": "Characters", "stats.noSpace": "Characters without spaces",
      "stats.words": "Words", "stats.lines": "Lines", "stats.paras": "Paragraphs", "stats.sentences": "Sentences",
      "stats.read": "Reading time", "stats.min": "{n} min", "stats.top": "Most used words", "stats.none": "No words yet.",
      "stats.approx": "The text is long, so characters are counted one by one (emoji may count twice).",
      "note.dedupe": "{n} removed", "note.dupes": "{n} duplicated lines", "note.count": "{n} different lines",
      "note.noempty": "{n} removed", "note.squeeze": "{n} removed", "note.filter": "{n} lines left",
      "note.join": "{n} lines joined", "note.split": "{n} lines", "note.number": "{n} numbered",
      "note.unnumber": "{n} removed", "note.convert": "{n} rows", "note.columns": "{n} rows", "note.transpose": "{n} rows",
      "note.markdown": "{n} rows", "note.json": "{n} items", "note.replace": "{n} replaced", "note.clean": "Nothing to clean",
      "note.extract": "{n} found", "note.url": "{n} changed", "note.base64": "{n} lines", "note.html": "{n} changed",
      "note.slug": "{n} lines", "note.diff": "{a} added · {r} removed", "note.same": "The texts are the same",
      "err.pattern": "The pattern is not valid", "err.long": "The text to find is too long", "err.cols": "Write the column numbers, e.g. 3,1",
      "err.unknown": "A step is from a newer orOS and was skipped", "err.failed": "A step failed and was skipped",
      "err.time": "The pattern took too long and was stopped", "err.run": "Could not run the steps",
      "err.b64": "This is not Base64 text", "err.noother": "Paste the second text in “Compare with”",
      "note.stale": "Text is long: press Apply", "note.working": "Working…",
      "rec.title": "Recipes", "rec.empty": "No recipes yet. Build a few steps and press “Save as recipe”.",
      "rec.open": "Use {name}", "rec.rename": "Rename {name}", "rec.del": "Delete {name}", "rec.steps": "{n} steps",
      "rec.export": "Export", "rec.import": "Import", "rec.close": "Close",
      "dlg.saveTitle": "Save as recipe", "dlg.renameTitle": "Rename recipe", "dlg.name": "Name",
      "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.close": "Close",
      "send.title": "Send the result to", "send.notes": "Notes (new page)", "send.sheet": "Spreadsheet (new sheet)",
      "send.todo": "To-Do (one task per line)", "send.case": "Case Converter",
      "toast.copied": "Copied", "toast.copyFail": "Could not copy: select the result and press Ctrl+C",
      "toast.pasteFail": "Could not read the clipboard: paste with Ctrl+V or a long press",
      "toast.cleared": "Text cleared", "toast.replaced": "Text replaced", "toast.undo": "Undo",
      "toast.saved": "Recipe saved", "toast.updated": "Recipe updated", "toast.deleted": "Recipe deleted", "toast.stepDel": "Step removed",
      "toast.loaded": "Recipe “{name}” loaded", "toast.maxRecipes": "Up to {n} recipes",
      "toast.needName": "Give the recipe a name", "toast.save": "Could not save: storage is full",
      "toast.exported": "Saved", "toast.empty": "The result is empty",
      "toast.big": "The file is too big (up to 5 MB)", "toast.cut": "Only the first {n} characters were kept",
      "toast.imported": "{n} recipes imported", "imp.err.json": "This is not a recipes file",
      "imp.err.kind": "This is not a Text Tools recipes file", "imp.err.empty": "The file has no recipes this version can use",
      "toast.noBridge": "Open orOS to send to other apps", "toast.notesCut": "Only the first 20,000 characters were sent",
      "toast.sheetCut": "Only the first 500 rows and 64 columns were sent", "toast.todoNone": "There are no lines to send",
      "toast.todoCut": "Only the first 200 lines were sent", "toast.opened": "Opened “{name}”",
      "sheet.name": "Text Tools", "note.title": "Text Tools · {d}", "from": "Text Tools"
    },
    el: {
      "app": "Εργαλεία κειμένου",
      "grp.lines": "Γραμμές", "grp.space": "Καθάρισμα", "grp.num": "Αρίθμηση", "grp.cols": "Στήλες", "grp.find": "Εύρεση",
      "grp.code": "Κωδικοποίηση", "grp.cmp": "Σύγκριση",
      "tool.sort": "Ταξινόμηση", "tool.reverse": "Αντίστροφη σειρά", "tool.dedupe": "Αφαίρεση διπλότυπων", "tool.dupes": "Μόνο τα διπλότυπα",
      "tool.count": "Μέτρημα γραμμών", "tool.noempty": "Χωρίς κενές γραμμές", "tool.squeeze": "Μία κενή γραμμή",
      "tool.filter": "Κράτα / βγάλε γραμμές", "tool.join": "Ένωση γραμμών", "tool.split": "Σπάσιμο σε γραμμές",
      "tool.trim": "Κενά στις άκρες", "tool.spaces": "Διπλά κενά", "tool.tabs": "Tabs ↔ κενά", "tool.unwrap": "Ένωση παραγράφων",
      "tool.wrap": "Αναδίπλωση γραμμών", "tool.clean": "Κρυφοί χαρακτήρες", "tool.eol": "Τέλος γραμμής",
      "tool.number": "Αρίθμηση γραμμών", "tool.unnumber": "Χωρίς αριθμούς / κουκκίδες", "tool.affix": "Πρόθεμα / κατάληξη",
      "tool.convert": "Αλλαγή διαχωριστικού", "tool.columns": "Επιλογή στηλών", "tool.transpose": "Γραμμές ↔ στήλες",
      "tool.markdown": "Πίνακας Markdown", "tool.json": "JSON", "tool.replace": "Εύρεση και αντικατάσταση",
      "tool.extract": "Εξαγωγή", "tool.url": "URL", "tool.base64": "Base64", "tool.html": "Οντότητες HTML",
      "tool.slug": "Slug", "tool.diff": "Σύγκριση κειμένων",
      "hint.sort": "Βάζει τις γραμμές σε αλφαβητική σειρά (ελληνικά και αγγλικά), κατά αριθμό, κατά μήκος ή τυχαία.",
      "hint.reverse": "Η τελευταία γραμμή έρχεται πρώτη.",
      "hint.dedupe": "Κρατά κάθε γραμμή μία φορά.",
      "hint.dupes": "Δείχνει μόνο τις γραμμές που υπάρχουν πάνω από μία φορά, από μία φορά την καθεμιά.",
      "hint.count": "Κάθε διαφορετική γραμμή μία φορά, με το πόσες φορές υπάρχει (αριθμός, tab, γραμμή).",
      "hint.noempty": "Βγάζει τις κενές γραμμές και όσες έχουν μόνο κενά.",
      "hint.squeeze": "Πολλές κενές γραμμές στη σειρά γίνονται μία.",
      "hint.filter": "Κρατά (ή βγάζει) τις γραμμές που περιέχουν ένα κείμενο.",
      "hint.join": "Βάζει όλες τις γραμμές σε μία, με ένα διαχωριστικό ανάμεσα.",
      "hint.split": "Σπάει το κείμενο σε γραμμές όπου βρει το διαχωριστικό.",
      "hint.trim": "Βγάζει κενά και tabs από την αρχή και το τέλος κάθε γραμμής.",
      "hint.spaces": "Δύο ή περισσότερα κενά στη σειρά γίνονται ένα.",
      "hint.tabs": "Κάνει τα tabs κενά, ή τα κενά στην αρχή tabs.",
      "hint.unwrap": "Ενώνει τις γραμμές κάθε παραγράφου σε μία. Οι κενές γραμμές ανάμεσα στις παραγράφους μένουν.",
      "hint.wrap": "Σπάει τις μεγάλες γραμμές ανάμεσα σε λέξεις.",
      "hint.clean": "Βγάζει αόρατους χαρακτήρες που έρχονται με την αντιγραφή και κάνει κανονικά τα περίεργα κενά.",
      "hint.eol": "Κάποια προγράμματα των Windows θέλουν τέλος γραμμής CRLF.",
      "hint.number": "Βάζει 1. 2. 3. … στην αρχή κάθε γραμμής.",
      "hint.unnumber": "Βγάζει 1. 2) - • και παρόμοια σημάδια από την αρχή κάθε γραμμής.",
      "hint.affix": "Βάζει το ίδιο κείμενο πριν και μετά από κάθε γραμμή.",
      "hint.convert": "Για CSV και παρόμοιους πίνακες: αλλάζει το διαχωριστικό ανάμεσα στις στήλες. Τα εισαγωγικά τα χειρίζεται σωστά.",
      "hint.columns": "Κρατά τις στήλες που γράφεις, με αυτή τη σειρά, ή τις βγάζει.",
      "hint.transpose": "Οι γραμμές γίνονται στήλες και οι στήλες γραμμές.",
      "hint.markdown": "Φτιάχνει πίνακα Markdown από έναν πίνακα τύπου CSV.",
      "hint.json": "Φτιάχνει JSON από έναν πίνακα τύπου CSV.",
      "hint.replace": "Βρίσκει ένα κείμενο και το αντικαθιστά παντού.",
      "hint.extract": "Βγάζει σε λίστα τα emails, τους συνδέσμους, τα τηλέφωνα, τους αριθμούς, τα #hashtags ή τα @ονόματα του κειμένου, ένα σε κάθε γραμμή.",
      "hint.url": "Κωδικοποιεί κείμενο για διεύθυνση ιστού (Ελλάδα → %CE%95…) ή το αποκωδικοποιεί.",
      "hint.base64": "Κωδικοποιεί κείμενο σε Base64 ή φέρνει το Base64 πίσω σε κείμενο (UTF-8).",
      "hint.html": "Κάνει τα < > & \" ' οντότητες HTML, ή φέρνει οντότητες όπως &amp; και &#233; πίσω σε χαρακτήρες.",
      "hint.slug": "Κάνει κάθε γραμμή όνομα για διεύθυνση ιστού: «Καλή Χρονιά!» → kali-chronia.",
      "hint.diff": "Συγκρίνει το κείμενο με ένα δεύτερο, γραμμή προς γραμμή: - βγήκε, + μπήκε. Το δεύτερο κείμενο δεν μπαίνει στις συνταγές.",
      "opt.by": "Σειρά", "val.by.az": "Α → Ω", "val.by.za": "Ω → Α", "val.by.natural": "Φυσική (το 2 πριν το 10)",
      "val.by.num": "Κατά αριθμό", "val.by.len": "Κατά μήκος", "val.by.random": "Τυχαία",
      "opt.icase": "Χωρίς διάκριση πεζών-κεφαλαίων", "opt.iaccent": "Χωρίς διάκριση τόνων", "opt.emptyLast": "Οι κενές γραμμές στο τέλος",
      "opt.keep": "Κράτα", "val.keep.first": "Την πρώτη", "val.keep.last": "Την τελευταία",
      "opt.trim": "Αγνόησε τα κενά στις άκρες", "opt.split.trim": "Χωρίς κενά στις άκρες", "opt.empty": "Βγάλε και τις επαναλαμβανόμενες κενές",
      "opt.order": "Σειρά", "val.order.count": "Πρώτα οι συχνότερες", "val.order.first": "Όπως εμφανίζονται", "val.order.az": "Α → Ω",
      "opt.mode": "Ενέργεια", "val.mode.keep": "Κράτα", "val.mode.drop": "Βγάλε",
      "opt.where": "Γραμμές που", "val.where.contains": "περιέχουν", "val.where.starts": "αρχίζουν με",
      "val.where.ends": "τελειώνουν σε", "val.where.regex": "ταιριάζουν σε μοτίβο",
      "opt.find": "Εύρεση", "opt.filter.find": "Κείμενο", "opt.repl": "Αντικατάσταση με",
      "opt.sep": "Διαχωριστικό", "opt.split.sep": "Σπάσε στο", "opt.skipEmpty": "Παράλειψε τις κενές γραμμές", "opt.split.skipEmpty": "Παράλειψε τα κενά κομμάτια",
      "opt.side": "Πού", "val.side.both": "Και στις δύο άκρες", "val.side.start": "Μόνο στην αρχή", "val.side.end": "Μόνο στο τέλος",
      "opt.indent": "Κράτα την εσοχή",
      "opt.dir": "Κατεύθυνση", "val.dir.t2s": "Tabs → κενά", "val.dir.s2t": "Κενά στην αρχή → tabs", "opt.width": "Πλάτος",
      "opt.wrap.width": "Χαρακτήρες ανά γραμμή",
      "opt.invisible": "Βγάλε τους αόρατους χαρακτήρες", "opt.nbsp": "Περίεργα κενά → κανονικό κενό",
      "opt.quotes": "Κυρτά εισαγωγικά και «» → ίσια", "opt.dashes": "Παύλες → ενωτικό, … → ...",
      "opt.to": "Σε", "val.to.lf": "LF (Linux, Android, Mac)", "val.to.crlf": "CRLF (Windows)",
      "opt.style": "Μορφή", "val.style.dot": "1.", "val.style.paren": "1)", "val.style.dash": "1 -", "val.style.bracket": "(1)",
      "val.style.tab": "1 + tab", "val.style.space": "1 + κενό",
      "opt.start": "Ξεκίνα από", "opt.step": "Βήμα", "opt.pad": "Ψηφία (001)",
      "opt.prefix": "Πριν", "opt.suffix": "Μετά",
      "opt.delim": "Διαχωριστικό εισόδου", "opt.convert.to": "Διαχωριστικό εξόδου", "opt.custom": "Δικό σου διαχωριστικό", "opt.toCustom": "Δικό σου διαχωριστικό",
      "dl.auto": "Βρες το μόνο σου", "dl.comma": "Κόμμα ,", "dl.semi": "Ερωτηματικό ;", "dl.tab": "Tab", "dl.pipe": "Κάθετος |", "dl.custom": "Άλλο…",
      "opt.quoteAll": "Εισαγωγικά σε κάθε πεδίο",
      "opt.cols": "Στήλες", "ph.cols": "π.χ. 3,1 ή 2-4",
      "opt.header": "Η πρώτη γραμμή είναι επικεφαλίδα",
      "opt.word": "Ολόκληρες λέξεις", "opt.regex": "Μοτίβο (regular expression)",
      "opt.what": "Βρες", "val.what.emails": "Διευθύνσεις email", "val.what.links": "Συνδέσμους", "val.what.phones": "Τηλέφωνα",
      "val.what.numbers": "Αριθμούς", "val.what.hashtags": "#hashtags", "val.what.mentions": "@ονόματα",
      "opt.unique": "Το καθένα μία φορά", "opt.extract.sort": "Ταξινόμηση Α → Ω",
      "opt.url.dir": "Ενέργεια", "opt.base64.dir": "Ενέργεια", "opt.html.dir": "Ενέργεια",
      "val.dir.enc": "Κωδικοποίηση", "val.dir.dec": "Αποκωδικοποίηση",
      "opt.full": "Ολόκληρη διεύθυνση (μένουν τα : / ? & =)", "opt.plus": "Το + σημαίνει κενό (φόρμες)",
      "opt.each": "Κάθε γραμμή χωριστά", "opt.urlsafe": "Για URL (- _ χωρίς =)",
      "opt.all": "Και κάθε μη αγγλικός χαρακτήρας (&#…;)",
      "opt.greek": "Ελληνικά γράμματα", "val.greek.latin": "Σε λατινικά (kali-mera)", "val.greek.keep": "Μένουν (καλη-μερα)",
      "opt.slug.sep": "Ανάμεσα στις λέξεις", "val.sep.dash": "Παύλα -", "val.sep.under": "Κάτω παύλα _",
      "opt.slug.max": "Μέγιστο μήκος (0 = χωρίς όριο)",
      "opt.show": "Δείξε", "val.show.all": "Όλα (- βγήκε, + μπήκε)", "val.show.changes": "Μόνο τις αλλαγές",
      "val.show.added": "Μόνο όσες μπήκαν", "val.show.removed": "Μόνο όσες βγήκαν", "val.show.same": "Μόνο όσες είναι και στα δύο",
      "other.label": "Σύγκριση με", "other.ph": "Επικόλλησε εδώ το δεύτερο κείμενο…", "btn.openOther": "Άνοιγμα αρχείου για το δεύτερο κείμενο",
      "btn.swap": "Αντιμετάθεση των δύο κειμένων",
      "ph.sep": "\\t = tab, \\n = νέα γραμμή",
      "preset.bullet": "• κουκκίδα", "preset.dash": "- παύλα", "preset.quotes": "\"…\"", "preset.gr": "«…»", "preset.sql": "'…',",
      "sec.steps": "Βήματα", "step.add": "+ Βήμα", "step.aria": "Βήμα {n}: {tool}", "step.del": "Αφαίρεση βήματος {n}",
      "step.up": "Μετακίνηση βήματος {n} πιο πάνω", "step.full": "Έως {n} βήματα",
      "pane.in": "Κείμενο", "pane.out": "Αποτέλεσμα",
      "btn.open": "Άνοιγμα αρχείου", "btn.paste": "Επικόλληση", "btn.clear": "Καθάρισμα", "btn.layout": "Δίπλα-δίπλα / το ένα κάτω από το άλλο",
      "btn.copy": "Αντιγραφή", "btn.use": "Χρήση ως κείμενο", "btn.save": "Αποθήκευση", "btn.send": "Αποστολή", "btn.apply": "Εφαρμογή",
      "btn.recipes": "Συνταγές", "btn.saveRecipe": "Αποθήκευση ως συνταγή", "btn.updateRecipe": "Ενημέρωση «{name}»",
      "in.ph": "Επικόλλησε ή γράψε το κείμενό σου εδώ…",
      "st.line": "{c} χαρακτήρες · {w} λέξεις · {l} γραμμές", "st.more": "Πάτα για περισσότερα",
      "stats.title": "Στατιστικά κειμένου", "stats.chars": "Χαρακτήρες", "stats.noSpace": "Χαρακτήρες χωρίς κενά",
      "stats.words": "Λέξεις", "stats.lines": "Γραμμές", "stats.paras": "Παράγραφοι", "stats.sentences": "Προτάσεις",
      "stats.read": "Χρόνος ανάγνωσης", "stats.min": "{n} λεπτά", "stats.top": "Οι πιο συχνές λέξεις", "stats.none": "Δεν υπάρχουν λέξεις ακόμη.",
      "stats.approx": "Το κείμενο είναι μεγάλο, οπότε οι χαρακτήρες μετριούνται ένας-ένας (ένα emoji μπορεί να μετρήσει διπλό).",
      "note.dedupe": "{n} βγήκαν", "note.dupes": "{n} διπλές γραμμές", "note.count": "{n} διαφορετικές γραμμές",
      "note.noempty": "{n} βγήκαν", "note.squeeze": "{n} βγήκαν", "note.filter": "Έμειναν {n} γραμμές",
      "note.join": "Ενώθηκαν {n} γραμμές", "note.split": "{n} γραμμές", "note.number": "Αριθμήθηκαν {n}",
      "note.unnumber": "{n} βγήκαν", "note.convert": "{n} γραμμές", "note.columns": "{n} γραμμές", "note.transpose": "{n} γραμμές",
      "note.markdown": "{n} γραμμές", "note.json": "{n} στοιχεία", "note.replace": "{n} αντικαταστάσεις", "note.clean": "Δεν βρέθηκε κάτι",
      "note.extract": "Βρέθηκαν {n}", "note.url": "{n} άλλαξαν", "note.base64": "{n} γραμμές", "note.html": "{n} άλλαξαν",
      "note.slug": "{n} γραμμές", "note.diff": "{a} μπήκαν · {r} βγήκαν", "note.same": "Τα κείμενα είναι ίδια",
      "err.pattern": "Το μοτίβο δεν είναι σωστό", "err.long": "Το κείμενο αναζήτησης είναι πολύ μεγάλο", "err.cols": "Γράψε τους αριθμούς των στηλών, π.χ. 3,1",
      "err.unknown": "Ένα βήμα είναι από νεότερο orOS και παραλείφθηκε", "err.failed": "Ένα βήμα απέτυχε και παραλείφθηκε",
      "err.time": "Το μοτίβο άργησε πολύ και σταμάτησε", "err.run": "Τα βήματα δεν έτρεξαν",
      "err.b64": "Αυτό δεν είναι κείμενο Base64", "err.noother": "Επικόλλησε το δεύτερο κείμενο στο «Σύγκριση με»",
      "note.stale": "Μεγάλο κείμενο: πάτα Εφαρμογή", "note.working": "Δουλεύει…",
      "rec.title": "Συνταγές", "rec.empty": "Δεν υπάρχουν συνταγές ακόμη. Φτιάξε μερικά βήματα και πάτα «Αποθήκευση ως συνταγή».",
      "rec.open": "Χρήση: {name}", "rec.rename": "Μετονομασία: {name}", "rec.del": "Διαγραφή: {name}", "rec.steps": "{n} βήματα",
      "rec.export": "Εξαγωγή", "rec.import": "Εισαγωγή", "rec.close": "Κλείσιμο",
      "dlg.saveTitle": "Αποθήκευση ως συνταγή", "dlg.renameTitle": "Μετονομασία συνταγής", "dlg.name": "Όνομα",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.close": "Κλείσιμο",
      "send.title": "Στείλε το αποτέλεσμα σε", "send.notes": "Σημειώσεις (νέα σελίδα)", "send.sheet": "Υπολογιστικό φύλλο (νέο φύλλο)",
      "send.todo": "To-Do (μία εργασία ανά γραμμή)", "send.case": "Κεφαλαία & πεζά",
      "toast.copied": "Αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή: επίλεξε το αποτέλεσμα και πάτα Ctrl+C",
      "toast.pasteFail": "Δεν διάβασα το πρόχειρο: επικόλλησε με Ctrl+V ή με παρατεταμένο πάτημα",
      "toast.cleared": "Το κείμενο καθαρίστηκε", "toast.replaced": "Το κείμενο άλλαξε", "toast.undo": "Αναίρεση",
      "toast.saved": "Η συνταγή αποθηκεύτηκε", "toast.updated": "Η συνταγή ενημερώθηκε", "toast.deleted": "Η συνταγή διαγράφηκε", "toast.stepDel": "Το βήμα αφαιρέθηκε",
      "toast.loaded": "Φορτώθηκε η συνταγή «{name}»", "toast.maxRecipes": "Έως {n} συνταγές",
      "toast.needName": "Δώσε ένα όνομα στη συνταγή", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.exported": "Αποθηκεύτηκε", "toast.empty": "Το αποτέλεσμα είναι κενό",
      "toast.big": "Το αρχείο είναι πολύ μεγάλο (έως 5 MB)", "toast.cut": "Κρατήθηκαν μόνο οι πρώτοι {n} χαρακτήρες",
      "toast.imported": "Εισήχθησαν {n} συνταγές", "imp.err.json": "Αυτό δεν είναι αρχείο συνταγών",
      "imp.err.kind": "Αυτό δεν είναι αρχείο συνταγών των Εργαλείων κειμένου", "imp.err.empty": "Το αρχείο δεν έχει συνταγές που μπορεί να χρησιμοποιήσει αυτή η έκδοση",
      "toast.noBridge": "Άνοιξε το orOS για αποστολή σε άλλες εφαρμογές", "toast.notesCut": "Στάλθηκαν μόνο οι πρώτοι 20.000 χαρακτήρες",
      "toast.sheetCut": "Στάλθηκαν μόνο οι πρώτες 500 γραμμές και 64 στήλες", "toast.todoNone": "Δεν υπάρχουν γραμμές για αποστολή",
      "toast.todoCut": "Στάλθηκαν μόνο οι πρώτες 200 γραμμές", "toast.opened": "Άνοιξε το «{name}»",
      "sheet.name": "Εργαλεία κειμένου", "note.title": "Εργαλεία κειμένου · {d}", "from": "Εργαλεία κειμένου"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "texttools", LANG);

  function hasKey(key) { var p = STRINGS[LANG] || STRINGS.en; return p[key] !== undefined || STRINGS.en[key] !== undefined; }
  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    return s;
  }
  function fmtNum(n) { try { return n.toLocaleString(loc()); } catch (e) { return String(n); } }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function copyObj(o) { return JSON.parse(JSON.stringify(o)); }

  var ICON = function (body) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  };
  var UI = {
    open: ICON('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    paste: ICON('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    clear: ICON('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>'),
    layout: ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
    copy: ICON('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
    use: ICON('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
    save: ICON('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
    send: ICON('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
    book: ICON('<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M8 8h6"/><path d="M8 12h6"/>'),
    x: ICON('<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'),
    up: ICON('<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>'),
    edit: ICON('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    swap: ICON('<path d="M7 4v16"/><path d="M3 8l4-4 4 4"/><path d="M17 20V4"/><path d="M13 16l4 4 4-4"/>')
  };

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("texttools.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. State ----------
  var data = null;                 // recipes (synced)
  var prefs = { layout: "stack" };
  // Session: the text, the steps and which step is open.
  var S = { text: "", other: "", chain: [{ tool: "sort", opts: {} }], active: 0, group: "lines", loaded: null };

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var p = JSON.parse(raw);
        if (p && typeof p === "object" && Array.isArray(p.recipes)) { data = C.mergeRecipes(p, p); return; }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] texttools: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = C.emptyData();
  }
  var saveFailShown = false;
  function saveNow() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); saveFailShown = false; }
    catch (e) { if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); } }   // R30
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && (p.layout === "side" || p.layout === "stack")) prefs.layout = p.layout;
    } catch (e) {}
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  function loadSession() {
    var p = null;
    try { p = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
    if (!p || typeof p !== "object") return;
    if (typeof p.text === "string") S.text = p.text.slice(0, C.MAX_TEXT);
    if (typeof p.other === "string") S.other = p.other.slice(0, C.MAX_TEXT);
    var chain = C.normSteps(p.chain);
    if (chain.length) S.chain = chain;
    S.active = typeof p.active === "number" && p.active >= 0 && p.active < S.chain.length ? Math.floor(p.active) : 0;
    if (C.GROUPS.indexOf(p.group) >= 0) S.group = p.group;
    if (typeof p.loaded === "string" && C.ID_RE.test(p.loaded)) S.loaded = p.loaded;
  }
  var sessTimer = null;
  function saveSession() { clearTimeout(sessTimer); sessTimer = setTimeout(saveSessionNow, 400); }
  function saveSessionNow() {
    clearTimeout(sessTimer); sessTimer = null;
    var v = { text: S.text, other: S.other, chain: S.chain, active: S.active, group: S.group, loaded: S.loaded };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); }
    catch (e) {                      // a huge text: keep at least the steps
      try { v.text = ""; v.other = ""; sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch (e2) {}
    }
  }

  function loadedRecipe() {
    if (!S.loaded) return null;
    for (var i = 0; i < data.recipes.length; i++) if (data.recipes[i].id === S.loaded) return data.recipes[i];
    return null;
  }

  // ---------- 3. Running a chain ----------
  var worker = null, workerBroken = false, seq = 0, pending = null, liveTimer = null;
  var lastNotes = [];

  function getWorker() {
    if (worker || workerBroken) return worker;
    try {
      worker = new Worker("worker.js");
      worker.onmessage = function (e) {
        var m = e.data || {};
        if (!pending || m.id !== pending.id) return;
        var p = pending;
        pending = null;
        clearTimeout(p.timer);
        if (m.ok) showResult(m.text, m.notes); else showError("err.run");
      };
      worker.onerror = function () {
        workerBroken = true;
        try { worker.terminate(); } catch (e) {}
        worker = null;
        if (pending) { var p = pending; pending = null; clearTimeout(p.timer); runLocal(p.text, p.steps, p.ctx); }
      };
    } catch (e) { workerBroken = true; worker = null; }
    return worker;
  }
  function stopWorker() {
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null;
  }
  function runLocal(text, steps, ctx) {
    var r;
    try { r = C.run(text, steps, ctx || {}); } catch (e) { showError("err.run"); return; }
    showResult(r.text, r.notes);
  }

  function runNow() {
    clearTimeout(liveTimer); liveTimer = null;
    var text = S.text, steps = copyObj(S.chain), ctx = C.usesOther(steps) ? { other: S.other } : {};
    if (pending) { clearTimeout(pending.timer); pending = null; }
    $("apply-btn").hidden = true;
    var w = getWorker();
    if (!w) { runLocal(text, steps, ctx); return; }
    var id = ++seq, pattern = steps.some(C.usesPattern);
    pending = { id: id, text: text, steps: steps, ctx: ctx };
    pending.timer = setTimeout(function () {
      if (!pending || pending.id !== id) return;
      pending = null;
      stopWorker();                       // a fresh worker next time
      showError(pattern ? "err.time" : "err.run");
    }, pattern ? PATTERN_MS : CHAIN_MS);
    setNote(t("note.working"), false);
    try { w.postMessage({ id: id, text: text, steps: steps, ctx: ctx }); }
    catch (e) { clearTimeout(pending.timer); pending = null; runLocal(text, steps, ctx); }
  }

  // Live preview while the text is not huge; above that, "Apply".
  function schedule() {
    clearTimeout(liveTimer);
    if (S.text.length + (C.usesOther(S.chain) ? S.other.length : 0) > C.LIVE_MAX) {
      $("apply-btn").hidden = false;
      setNote(t("note.stale"), false);
      return;
    }
    liveTimer = setTimeout(runNow, 220);
  }

  function showResult(text, notes) {
    $("out").value = text;
    lastNotes = notes || [];
    var err = null, info = null;
    lastNotes.forEach(function (n) { if (n.err && !err) err = n.err; });
    if (err) { setNote(t("err." + err), true); return; }
    var act = lastNotes[S.active];
    if (act && act.tool === "diff" && act.x) {
      setNote(act.n ? t("note.diff", { a: fmtNum(act.x.add), r: fmtNum(act.x.del) }) : t("note.same"), false);
      return;
    }
    if (act && act.n !== null && act.n !== undefined && hasKey("note." + act.tool) &&
        !(act.tool === "clean" && act.n !== 0)) {
      info = t("note." + act.tool, { n: fmtNum(act.n) });
    }
    setNote(info || "", false);
  }
  function showError(key) { setNote(t(key), true); }
  function setNote(s, bad) {
    var n = $("note");
    n.textContent = s;
    n.classList.toggle("bad", !!bad);
  }

  // ---------- 4. UI: groups, tools, steps, options ----------
  function activeStep() { return S.chain[S.active]; }

  function renderGroups() {
    var host = $("groups");
    host.innerHTML = "";
    C.GROUPS.forEach(function (g) {
      var b = el("button", "tab", t("grp." + g));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", g === S.group ? "true" : "false");
      b.tabIndex = g === S.group ? 0 : -1;
      b.addEventListener("click", function () { S.group = g; saveSession(); renderGroups(); renderTools(); });
      b.addEventListener("keydown", function (e) {
        var i = C.GROUPS.indexOf(S.group), d = e.key === "ArrowRight" ? 1 : (e.key === "ArrowLeft" ? -1 : 0);
        if (!d) return;
        e.preventDefault();
        S.group = C.GROUPS[(i + d + C.GROUPS.length) % C.GROUPS.length];
        saveSession();
        renderGroups();
        renderTools();
        var on = host.querySelector('[aria-selected="true"]');
        if (on) on.focus();
      });
      host.appendChild(b);
    });
  }

  function renderTools() {
    var host = $("tools"), cur = activeStep().tool;
    host.innerHTML = "";
    C.toolsOf(S.group).forEach(function (id) {
      var b = el("button", "chip", t("tool." + id));
      b.type = "button";
      var on = id === cur;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () { pickTool(id); });
      host.appendChild(b);
    });
  }

  function pickTool(id) {
    var st = activeStep();
    if (st.tool === id) return;
    st.tool = id;
    st.opts = {};
    changedChain();
  }

  function changedChain() {
    saveSession();
    renderTools();
    renderChain();
    renderOpts();
    schedule();
  }

  function renderChain() {
    var host = $("chain");
    host.innerHTML = "";
    S.chain.forEach(function (st, i) {
      var li = el("li", "step" + (i === S.active ? " on" : ""));
      li.appendChild(el("span", "step-n", String(i + 1)));
      var name = C.TOOLS[st.tool] ? t("tool." + st.tool) : st.tool;
      var b = el("button", "step-btn", name);
      b.type = "button";
      b.setAttribute("aria-pressed", i === S.active ? "true" : "false");
      b.setAttribute("aria-label", t("step.aria", { n: i + 1, tool: name }));
      b.addEventListener("click", function () {
        S.active = i;
        if (C.TOOLS[st.tool]) S.group = C.TOOLS[st.tool].g;
        saveSession();
        renderGroups();
        renderTools();
        renderChain();
        renderOpts();
        showResult($("out").value, lastNotes);
      });
      li.appendChild(b);
      if (i > 0) li.appendChild(iconBtn("mini", UI.up, t("step.up", { n: i + 1 }), function () { moveStep(i); }));
      if (S.chain.length > 1) li.appendChild(iconBtn("mini danger", UI.x, t("step.del", { n: i + 1 }), function () { removeStep(i); }));
      host.appendChild(li);
    });
    var full = S.chain.length >= C.MAX_STEPS;
    $("add-step").disabled = full;
    $("add-step").title = full ? t("step.full", { n: C.MAX_STEPS }) : "";
    var r = loadedRecipe();
    var differs = r && JSON.stringify(C.normSteps(S.chain)) !== JSON.stringify(r.steps);
    $("update-recipe").hidden = !differs;
    if (r) $("update-recipe").textContent = t("btn.updateRecipe", { name: r.name });
    $("title").textContent = r ? r.name : t("app");
  }

  function addStep() {
    if (S.chain.length >= C.MAX_STEPS) { showToast(t("step.full", { n: C.MAX_STEPS })); return; }
    var first = C.toolsOf(S.group)[0];
    S.chain.push({ tool: first, opts: {} });
    S.active = S.chain.length - 1;
    changedChain();
  }
  function removeStep(i) {
    if (S.chain.length <= 1) return;
    var before = copyObj(S.chain), act = S.active;
    S.chain.splice(i, 1);
    if (S.active >= S.chain.length) S.active = S.chain.length - 1;
    else if (S.active > i) S.active--;
    syncGroup();
    changedChain();
    renderGroups();
    undoToast(t("toast.stepDel"), function () {
      S.chain = before; S.active = act; syncGroup(); changedChain(); renderGroups();
    });
  }
  function moveStep(i) {
    var x = S.chain[i];
    S.chain[i] = S.chain[i - 1];
    S.chain[i - 1] = x;
    if (S.active === i) S.active = i - 1; else if (S.active === i - 1) S.active = i;
    changedChain();
  }
  function syncGroup() { var st = activeStep(); if (st && C.TOOLS[st.tool]) S.group = C.TOOLS[st.tool].g; }

  // The options form is built from the tool's field list (core TOOLS[id].f).
  function optLabel(tool, key) { return hasKey("opt." + tool + "." + key) ? t("opt." + tool + "." + key) : t("opt." + key); }
  function valLabel(key, v) {
    if (key === "delim" || (key === "to" && v !== "lf" && v !== "crlf")) return t("dl." + v);
    return t("val." + key + "." + v);
  }

  function renderOpts() {
    var st = activeStep(), host = $("opts");
    host.innerHTML = "";
    var T = C.TOOLS[st.tool];
    $("opts-title").textContent = T ? t("tool." + st.tool) : st.tool;
    $("tool-hint").textContent = T ? t("hint." + st.tool) : t("err.unknown");
    if (!T) return;
    var o = C.optsFor(st.tool, st.opts);
    Object.keys(T.f).forEach(function (key) {
      var f = T.f[key], when = f[2];
      if (when && Object.keys(when).some(function (k) { return when[k].indexOf(o[k]) < 0; })) return;
      var id = "o-" + key, row;
      if (f[0] === "chk") {
        row = el("label", "opt chk");
        var cb = el("input");
        cb.type = "checkbox";
        cb.id = id;
        cb.checked = !!o[key];
        cb.addEventListener("change", function () { setOpt(key, cb.checked, true); });
        row.appendChild(cb);
        row.appendChild(el("span", "", optLabel(st.tool, key)));
        host.appendChild(row);
        return;
      }
      row = el("div", "opt");
      var lab = el("label", "opt-lbl", optLabel(st.tool, key));
      lab.setAttribute("for", id);
      row.appendChild(lab);
      var inp;
      if (f[0] === "sel") {
        inp = el("select");
        f[1].forEach(function (v) {
          var op = el("option", "", valLabel(key, v));
          op.value = v;
          inp.appendChild(op);
        });
        inp.value = o[key];
        inp.addEventListener("change", function () { setOpt(key, inp.value, true); });
      } else if (f[0] === "num") {
        inp = el("input");
        inp.type = "number";
        inp.inputMode = "numeric";
        inp.min = f[1][0];
        inp.max = f[1][1];
        inp.value = o[key];
        inp.addEventListener("input", function () {
          var v = parseInt(inp.value, 10);
          if (isFinite(v)) setOpt(key, v, false);
        });
      } else {
        inp = el("input");
        inp.type = "text";
        inp.maxLength = C.STR_LEN;
        inp.autocomplete = "off";
        inp.spellcheck = false;
        inp.value = o[key];
        var ph = key === "sep" || key === "custom" || key === "toCustom" || key === "prefix" || key === "suffix" ? "ph.sep" : "ph." + key;
        if (hasKey(ph)) inp.placeholder = t(ph);
        inp.addEventListener("input", function () { setOpt(key, inp.value, false); });
      }
      inp.id = id;
      row.appendChild(inp);
      host.appendChild(row);
    });
    if (st.tool === "affix") host.appendChild(affixPresets());
    if (st.tool === "diff") host.appendChild(otherBox());
  }

  // Compare: the second text. Session only, like the first one; never
  // part of a step or a recipe.
  function otherBox() {
    var box = el("div", "opt other");
    var head = el("div", "other-head");
    var lab = el("label", "opt-lbl", t("other.label"));
    lab.setAttribute("for", "other");
    head.appendChild(lab);
    head.appendChild(el("span", "spacer"));
    head.appendChild(iconBtn("", UI.swap, t("btn.swap"), swapTexts));
    head.appendChild(iconBtn("", UI.open, t("btn.openOther"), function () {
      readPicked(function (text) { setOther(text); renderOpts(); });
    }));
    box.appendChild(head);
    var ta = el("textarea");
    ta.id = "other";
    ta.spellcheck = false;
    ta.autocomplete = "off";
    ta.rows = 8;
    ta.placeholder = t("other.ph");
    ta.value = S.other;
    ta.addEventListener("input", function () { setOther(ta.value); });
    box.appendChild(ta);
    return box;
  }
  function setOther(v) {
    v = String(v);
    if (v.length > C.MAX_TEXT) { v = v.slice(0, C.MAX_TEXT); showToast(t("toast.cut", { n: fmtNum(C.MAX_TEXT) })); }
    S.other = v;
    saveSession();
    schedule();
  }
  function swapTexts() {
    var a = S.text, b = S.other;
    S.other = a;
    setText(b, null);
    renderOpts();
  }

  // Some options show or hide others (a "when" rule): rebuild then.
  function setOpt(key, v, rebuild) {
    var st = activeStep();
    st.opts = C.optsFor(st.tool, st.opts);
    st.opts[key] = v;
    saveSession();
    renderChain();
    if (rebuild) renderOpts();
    schedule();
  }

  var PRESETS = [["bullet", "• ", ""], ["dash", "- ", ""], ["quotes", "\"", "\""], ["gr", "«", "»"], ["sql", "'", "',"]];
  function affixPresets() {
    var box = el("div", "chips presets");
    PRESETS.forEach(function (p) {
      var b = el("button", "chip small", t("preset." + p[0]));
      b.type = "button";
      b.addEventListener("click", function () {
        var st = activeStep();
        st.opts = C.optsFor(st.tool, st.opts);
        st.opts.prefix = p[1];
        st.opts.suffix = p[2];
        saveSession();
        renderChain();
        renderOpts();
        schedule();
      });
      box.appendChild(b);
    });
    return box;
  }

  function iconBtn(cls, svg, label, fn) {
    var b = el("button", "icon-btn " + cls);
    b.type = "button";
    b.innerHTML = svg;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  }

  // ---------- 5. Text panes ----------
  var statsTimer = null;
  function renderStats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(function () {
      var s = C.stats(S.text);
      $("stats").textContent = t("st.line", { c: fmtNum(s.chars), w: fmtNum(s.words), l: fmtNum(s.lines) });
      $("stats").title = t("st.more");
    }, S.text.length > 50000 ? 400 : 60);
  }

  function setText(text, toastKey) {
    var before = S.text;
    text = String(text);
    if (text.length > C.MAX_TEXT) { text = text.slice(0, C.MAX_TEXT); showToast(t("toast.cut", { n: fmtNum(C.MAX_TEXT) })); }
    S.text = text;
    $("in").value = text;
    saveSession();
    renderStats();
    schedule();
    if (toastKey && before && before !== text) {
      undoToast(t(toastKey), function () {
        S.text = before; $("in").value = before; saveSession(); renderStats(); schedule();
      });
    }
  }

  function onInput() {
    var v = $("in").value;
    if (v.length > C.MAX_TEXT) { v = v.slice(0, C.MAX_TEXT); $("in").value = v; showToast(t("toast.cut", { n: fmtNum(C.MAX_TEXT) })); }
    S.text = v;
    saveSession();
    renderStats();
    schedule();
  }

  function pasteText() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (s) {
          if (typeof s === "string" && s) setText(s, "toast.replaced");
        }, function () { showToast(t("toast.pasteFail")); });
        return;
      }
    } catch (e) {}
    showToast(t("toast.pasteFail"));
  }

  function copyOut() {
    var s = $("out").value;
    if (!s) { showToast(t("toast.empty")); return; }
    var fail = function () { var o = $("out"); o.focus(); o.select(); showToast(t("toast.copyFail")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(s).then(function () { showToast(t("toast.copied")); }, fail);
        return;
      }
    } catch (e) {}
    fail();
  }

  function useOut() {
    var s = $("out").value;
    if (!s && !S.text) return;
    setText(s, "toast.replaced");
  }

  // Files (R33): through orosDialog, local fallback when standalone.
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
  function pickFile(accept) {
    var dlg = dialogHost();
    return Promise.resolve(dlg && typeof dlg.openFile === "function" ? dlg.openFile(accept) : localPickFile(accept));
  }
  function downloadBlob(blob, fileName, mime, types) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: fileName, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;                          // cancel (ok=false) = silent exit
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

  // UTF-8 first; an old Greek Windows file (not valid UTF-8) is read as windows-1253.
  function decodeText(buf) {
    var bytes = new Uint8Array(buf);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""); }
    catch (e) {
      try { return new TextDecoder("windows-1253").decode(bytes); }
      catch (e2) { return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, ""); }
    }
  }
  function readPicked(done) {
    pickFile(OPEN_ACCEPT).then(function (f) {
      if (!f) return;                  // cancel: silent exit
      return readFile(f, done);
    }).catch(function () {});
  }
  function readFile(f, done) {
    if (f.size > FILE_MAX) { showToast(t("toast.big")); return Promise.resolve(); }
    return Promise.resolve(f.arrayBuffer()).then(function (buf) { done(decodeText(buf)); });
  }
  function openFile() {
    readPicked(function (text) { setText(text, "toast.replaced"); });
  }

  var KINDS = {
    txt:  { ext: ".txt",  mime: "text/plain", desc: "Text" },
    csv:  { ext: ".csv",  mime: "text/csv", desc: "CSV" },
    tsv:  { ext: ".tsv",  mime: "text/tab-separated-values", desc: "TSV" },
    md:   { ext: ".md",   mime: "text/markdown", desc: "Markdown" },
    json: { ext: ".json", mime: "application/json", desc: "JSON" }
  };
  function saveOut() {
    var s = $("out").value;
    if (!s) { showToast(t("toast.empty")); return; }
    var k = KINDS[C.outKind(S.chain)] || KINDS.txt, a = {};
    a[k.mime] = [k.ext];
    var base = loadedRecipe() ? loadedRecipe().name : t("app");
    base = base.replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 60) || "text";
    downloadBlob(new Blob([s], { type: k.mime + ";charset=utf-8" }), base + k.ext, k.mime, [{ description: k.desc, accept: a }]);
  }

  function statsDialog() {
    var s = C.stats(S.text);
    var dlg = makeDialog("tt-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    var dl = el("dl", "stats-list");
    [["chars", s.chars], ["noSpace", s.noSpace], ["words", s.words], ["lines", s.lines],
     ["paras", s.paras], ["sentences", s.sentences]].forEach(function (r) {
      dl.appendChild(el("dt", "", t("stats." + r[0])));
      dl.appendChild(el("dd", "", fmtNum(r[1])));
    });
    dl.appendChild(el("dt", "", t("stats.read")));
    dl.appendChild(el("dd", "", s.minutes ? t("stats.min", { n: fmtNum(s.minutes) }) : "—"));
    dlg.appendChild(dl);
    if (!s.exact) dlg.appendChild(el("p", "hint", t("stats.approx")));
    dlg.appendChild(el("div", "dlg-sub2", t("stats.top")));
    var top = C.topWords(S.text, 10);
    if (!top.length) dlg.appendChild(el("p", "hint", t("stats.none")));
    else {
      var ol = el("ol", "top-words");
      top.forEach(function (w) {
        var li = el("li");
        li.appendChild(el("span", "", w.w));
        li.appendChild(el("span", "count", fmtNum(w.n)));
        ol.appendChild(li);
      });
      dlg.appendChild(ol);
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 6. Recipes ----------
  function recipesDialog() {
    var dlg = makeDialog("tt-recipes");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("rec.title")));
    var list = el("ul", "rec-list");
    var sorted = data.recipes.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, loc()) || (a.id < b.id ? -1 : 1);
    });
    if (!sorted.length) dlg.appendChild(el("p", "hint", t("rec.empty")));
    sorted.forEach(function (r) {
      var li = el("li", "rec" + (r.id === S.loaded ? " on" : ""));
      var b = el("button", "rec-btn");
      b.type = "button";
      b.setAttribute("aria-label", t("rec.open", { name: r.name }));
      b.appendChild(el("span", "rec-name", r.name));
      b.appendChild(el("span", "rec-sub", r.steps.map(function (s) { return C.TOOLS[s.tool] ? t("tool." + s.tool) : s.tool; }).join(" → ")));
      b.addEventListener("click", function () { dlg.close(); loadRecipe(r.id); });
      li.appendChild(b);
      li.appendChild(iconBtn("mini", UI.edit, t("rec.rename", { name: r.name }), function () { dlg.close(); nameDialog(r); }));
      li.appendChild(iconBtn("mini danger", UI.x, t("rec.del", { name: r.name }), function () { dlg.close(); deleteRecipe(r.id); }));
      list.appendChild(li);
    });
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions wrap");
    var ex = button(t("rec.export"), "", function () { exportRecipes(); });
    ex.disabled = !data.recipes.length;
    acts.appendChild(ex);
    acts.appendChild(button(t("rec.import"), "", function () { dlg.close(); importRecipes(); }));
    acts.appendChild(button(t("rec.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function loadRecipe(id) {
    var r = null;
    data.recipes.forEach(function (x) { if (x.id === id) r = x; });
    if (!r) return;
    var before = { chain: copyObj(S.chain), active: S.active, loaded: S.loaded, group: S.group };
    S.chain = copyObj(r.steps);
    S.active = 0;
    S.loaded = r.id;
    syncGroup();
    renderGroups();
    changedChain();
    undoToast(t("toast.loaded", { name: r.name }), function () {
      S.chain = before.chain; S.active = before.active; S.loaded = before.loaded; S.group = before.group;
      renderGroups();
      changedChain();
    });
  }

  function nameDialog(existing) {
    if (!existing && data.recipes.length >= C.MAX_RECIPES) { showToast(t("toast.maxRecipes", { n: C.MAX_RECIPES })); return; }
    var dlg = makeDialog("tt-name");
    dlg.appendChild(el("div", "dlg-title", t(existing ? "dlg.renameTitle" : "dlg.saveTitle")));
    var form = el("form");
    form.method = "dialog";
    var lab = el("label", "dlg-lbl", t("dlg.name"));
    lab.setAttribute("for", "tt-name-in");
    var inp = el("input");
    inp.id = "tt-name-in";
    inp.maxLength = C.NAME_LEN;
    inp.autocomplete = "off";
    inp.value = existing ? existing.name : "";
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(lab);
    form.appendChild(inp);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = C.normName(inp.value);
      if (!name) { showToast(t("toast.needName")); inp.focus(); return; }
      if (existing) {
        data.recipes.forEach(function (x) {
          if (x.id === existing.id && x.name !== name) { x.name = name; x.m = Math.max(Date.now(), x.m + 1); }
        });
      } else {
        var id = newId();
        data.recipes.push({ id: id, m: Date.now(), name: name, steps: C.normSteps(S.chain) });
        S.loaded = id;
        saveSession();
        showToast(t("toast.saved"));
      }
      data = C.mergeRecipes(data, data);
      saveNow();
      dlg.close();
      renderChain();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
    inp.select();
  }

  function updateRecipe() {
    var r = loadedRecipe();
    if (!r) return;
    var steps = C.normSteps(S.chain);
    if (JSON.stringify(steps) === JSON.stringify(r.steps)) return;
    var before = copyObj(r);
    r.steps = steps;
    r.m = Math.max(Date.now(), r.m + 1);
    data = C.mergeRecipes(data, data);
    saveNow();
    renderChain();
    undoToast(t("toast.updated"), function () {
      data.recipes.forEach(function (x) {
        if (x.id === before.id) { x.steps = before.steps; x.m = Math.max(Date.now(), x.m + 1); }
      });
      data = C.mergeRecipes(data, data);
      saveNow();
      renderChain();
    });
  }

  function deleteRecipe(id) {
    var x = null;
    data.recipes.forEach(function (y) { if (y.id === id) x = y; });
    if (!x) return;
    var snap = copyObj(x), wasLoaded = S.loaded === id;
    data.tombs[id] = Math.max(Date.now(), x.m);
    data = C.mergeRecipes(data, data);
    saveNow();
    if (wasLoaded) { S.loaded = null; saveSession(); }
    renderChain();
    undoToast(t("toast.deleted"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17: a newer edit resurrects
      data.recipes.push(snap);
      data = C.mergeRecipes(data, data);
      saveNow();
      if (wasLoaded) { S.loaded = snap.id; saveSession(); }
      renderChain();
    });
  }

  function exportRecipes() {
    var s = C.recipesFile(data, new Date().toISOString());
    downloadBlob(new Blob([s], { type: "application/json" }), (LANG === "el" ? "syntages-keimenou" : "text-recipes") + ".json",
      "application/json", [{ description: "JSON", accept: { "application/json": [".json"] } }]);
  }
  // An import adds the file's recipes as new ones (never overwrites).
  function importRecipes() {
    pickFile(".json,application/json").then(function (f) {
      if (!f) return;
      if (f.size > FILE_MAX) { showToast(t("toast.big")); return; }
      return f.text().then(function (s) {
        var r = C.parseRecipesFile(s);
        if (!r.ok) { showToast(t("imp.err." + r.err)); return; }
        var room = C.MAX_RECIPES - data.recipes.length, now = Date.now(), n = 0;
        r.recipes.slice(0, Math.max(0, room)).forEach(function (x) {
          data.recipes.push({ id: newId() + n, m: now, name: x.name, steps: x.steps });
          n++;
        });
        if (!n) { showToast(t("toast.maxRecipes", { n: C.MAX_RECIPES })); return; }
        data = C.mergeRecipes(data, data);
        saveNow();
        renderChain();
        showToast(t("toast.imported", { n: n }));
      });
    }).catch(function () {});
  }

  // ---------- 7. Send to other apps ----------
  function shellWin() {
    try { return window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; }
    catch (e) { return null; }
  }
  function hasApp(id) {
    try {
      var env = window.parent.orosTodayEnv;
      return !!(env && typeof env.apps === "function" && env.apps().some(function (a) { return a.id === id; }));
    } catch (e) { return false; }
  }
  function sendTo(app, target) {
    var w = shellWin();
    if (!w) { showToast(t("toast.noBridge")); return false; }
    try { w.__orosOpenAt(app, target); return true; } catch (e) { showToast(t("toast.noBridge")); return false; }
  }
  function today() {
    try { return new Date().toLocaleDateString(loc()); } catch (e) { return ""; }
  }

  function sendDialog() {
    var s = $("out").value;
    if (!s.trim()) { showToast(t("toast.empty")); return; }
    if (!shellWin()) { showToast(t("toast.noBridge")); return; }
    var dlg = makeDialog("tt-send");
    dlg.appendChild(el("div", "dlg-title", t("send.title")));
    var list = el("div", "send-list");
    var add = function (key, fn) {
      var b = button(t(key), "", function () { dlg.close(); fn(); });
      list.appendChild(b);
    };
    add("send.notes", function () {
      var text = s;
      if (text.length > NOTES_MAX) { text = text.slice(0, NOTES_MAX); showToast(t("toast.notesCut")); }
      sendTo("notes", { add: { title: t("note.title", { d: today() }), text: text } });
    });
    add("send.sheet", function () {
      var r = C.sheetRows(s, SHEET_ROWS, SHEET_COLS);
      if (r.cut) showToast(t("toast.sheetCut"));
      sendTo("spreadsheet", { newSheet: { name: t("sheet.name"), rows: r.rows } });
    });
    add("send.todo", function () {
      var all = C.todoItems(s, 100000);
      if (!all.length) { showToast(t("toast.todoNone")); return; }
      if (all.length > TODO_MAX) showToast(t("toast.todoCut"));
      sendTo("todo", { addItems: { from: t("from"), items: all.slice(0, TODO_MAX) } });
    });
    if (hasApp("textcase")) add("send.case", function () { sendTo("textcase", { text: s }); });
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 8. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" && n.transient({ ns: "texttools", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
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

  // ---------- 9. Keyboard ----------
  function wireKeyboard() {
    // Contract B: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // Ctrl+Enter: run the steps now (also on a long text)
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === "Enter" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        runNow();
      }
    });
  }

  // ---------- 10. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("texttools", sliceGet, sliceSet, STORAGE_KEY, C.mergeRecipes);
  }
  function sliceGet() { return C.mergeRecipes(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.recipes)) return;
    var before = JSON.stringify(data.recipes);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeRecipes(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data.recipes) === before) return;
    if (S.loaded && !loadedRecipe()) { S.loaded = null; saveSession(); }   // deleted elsewhere: the steps stay
    renderChain();
    var open = document.getElementById("tt-recipes");
    if (open && open.open) { open.close(); recipesDialog(); }
  }

  // ---------- 11. Deep link, wiring & boot ----------
  // Target { text }: another app (Case Converter, …) hands over a text.
  // Target { openFile: { token, name, size } }: a .txt / .csv / .tsv from
  // the system's "Open with" or Android Share (BR-FILE-OPEN); the File
  // itself is taken once from the shell with __orosTakeFile(token).
  // Either replaces the Text box with Undo; nothing runs by itself.
  function openTarget(tg) {
    if (!tg || typeof tg !== "object") return;
    if (tg.openFile && typeof tg.openFile === "object") { openFileTarget(tg.openFile); return; }
    if (typeof tg.text !== "string") return;
    if (document.querySelector("dialog[open]")) return;
    setText(tg.text, "toast.replaced");
    $("in").focus();
  }
  function openFileTarget(o) {
    var f = null;
    try {
      var p = window.parent;
      if (typeof o.token === "string" && p && p !== window && typeof p.__orosTakeFile === "function") f = p.__orosTakeFile(o.token);
    } catch (e) { f = null; }
    if (!f || typeof f.arrayBuffer !== "function") return;
    var open = document.querySelector("dialog[open]");
    if (open) open.close();
    var name = String(f.name || o.name || "").slice(0, 120);
    readFile(f, function (text) {
      var had = !!S.text && S.text !== text;
      setText(text, had ? "toast.replaced" : null);    // Undo when it replaced a text
      $("in").focus();
      if (!had && name) showToast(t("toast.opened", { name: name }));
    }).catch(function () {});
  }
  window.__orosOpenAt = openTarget;

  function applyLayout() {
    document.body.classList.toggle("side", prefs.layout === "side");
  }

  function applyI18n() {
    document.title = t("app") + " · orOS";
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    $("in").placeholder = t("in.ph");
    $("recipes-btn").innerHTML = UI.book + "<span></span>";
    $("recipes-btn").lastChild.textContent = t("btn.recipes");
    $("add-step").textContent = t("step.add");
    $("save-recipe").textContent = t("btn.saveRecipe");
    $("apply-btn").textContent = t("btn.apply");
    [["open-btn", "open", "btn.open"], ["paste-btn", "paste", "btn.paste"], ["clear-btn", "clear", "btn.clear"],
     ["layout-btn", "layout", "btn.layout"]].forEach(function (r) {
      var b = $(r[0]);
      b.innerHTML = UI[r[1]];
      b.setAttribute("aria-label", t(r[2]));
      b.title = t(r[2]);
    });
    [["copy-btn", "copy", "btn.copy"], ["use-btn", "use", "btn.use"], ["save-btn", "save", "btn.save"],
     ["send-btn", "send", "btn.send"]].forEach(function (r) {
      var b = $(r[0]);
      b.innerHTML = UI[r[1]] + "<span></span>";
      b.lastChild.textContent = t(r[2]);
      b.setAttribute("aria-label", t(r[2]));   // the label hides on narrow phones
      b.title = t(r[2]);
    });
  }

  function wire() {
    $("in").addEventListener("input", onInput);
    $("stats").addEventListener("click", statsDialog);
    $("open-btn").addEventListener("click", openFile);
    $("paste-btn").addEventListener("click", pasteText);
    $("clear-btn").addEventListener("click", function () { if (S.text) setText("", "toast.cleared"); });
    $("layout-btn").addEventListener("click", function () {
      prefs.layout = prefs.layout === "side" ? "stack" : "side";
      savePrefs();
      applyLayout();
    });
    $("copy-btn").addEventListener("click", copyOut);
    $("use-btn").addEventListener("click", useOut);
    $("save-btn").addEventListener("click", saveOut);
    $("send-btn").addEventListener("click", sendDialog);
    $("apply-btn").addEventListener("click", runNow);
    $("recipes-btn").addEventListener("click", recipesDialog);
    $("add-step").addEventListener("click", addStep);
    $("save-recipe").addEventListener("click", function () { nameDialog(null); });
    $("update-recipe").addEventListener("click", updateRecipe);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") saveSessionNow(); });
    window.addEventListener("pagehide", function () { saveSessionNow(); stopWorker(); });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    loadSession();
    applyI18n();
    applyLayout();
    $("in").value = S.text;
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderGroups();
    renderTools();
    renderChain();
    renderOpts();
    renderStats();
    runNow();
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("texttools");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
