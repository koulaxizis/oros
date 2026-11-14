// ============================================================
// orOS Base — the app (base/app.js), wave B1: the core
// Bases with tables, typed fields and records; a grid and a card
// view per table with filters, sorting, groups, hidden fields and a
// search box; the record open in a dialog; CSV import and export,
// Open in Spreadsheet (BR-S1), templates, Undo.
// Data: the synced slice "base" (oros-base-data, core.js).
// Device-local: oros-base-prefs { at, w, col } (where you were,
// column widths, collapsed groups; R10).
// Sections:
//   1. Strings + helpers
//   2. Storage + sync slice
//   3. Home: all bases, templates, CSV import
//   4. Base: tables, views, menus
//   5. Grid
//   6. Cards
//   7. Record dialog
//   8. Field dialog
//   9. Filter, sort, group, fields dialogs
//  10. Files: CSV, Spreadsheet
//  11. Toast, palette, deep link, boot
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("base/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var C = window.OrosBaseCore;
  var APP_ID = "base";
  var STORAGE_KEY = C.STORAGE_KEY;
  var PREFS_KEY = "oros-base-prefs";
  var CSV_MAX = 10 * 1024 * 1024;
  var SHEET_ROWS = 499;          // + heading = the Spreadsheet's 500 (BR-S1-2)
  var ROW_H = 36;

  // ---------- 1. Strings + helpers ----------
  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app": "Base", "btn.newBase": "New base", "btn.importCsv": "Import CSV", "btn.fields": "Fields",
      "btn.addRec": "New record", "btn.cancel": "Cancel", "btn.save": "Save", "btn.close": "Close", "btn.undo": "Undo",
      "btn.delete": "Delete", "btn.back": "All bases", "btn.more": "More", "btn.done": "Done",
      "btn.create": "Create", "btn.ok": "OK",
      "empty.title": "No bases yet",
      "empty.text": "A base keeps records with structure: a catalogue, a collection, a project. Start from a template, from scratch or from a CSV file.",
      "space": "{n} of {max} records · {kb} KB on this device",
      "space.warn": "Base is nearly full: {n} of {max} records. Remove old records or export a base before adding many more.",
      "space.full": "Base holds at most {max} records on all your devices together. This one was not added.",
      "full": "This device is out of storage space. The change was not saved.",
      "base.tables": "{n} tables", "base.table1": "1 table", "base.recs": "{n} records", "base.rec1": "1 record",
      "new.title": "New base", "new.name": "Name", "new.blank": "Blank base", "new.blankText": "One empty table to start with.",
      "new.tpl": "Or start from a template", "new.defName": "My base",
      "tpl.books": "Book catalogue", "tpl.books.t": "Titles, authors, ISBN, status, publication date.",
      "tpl.reading": "Reading list", "tpl.reading.t": "What to read, what you are reading, your rating.",
      "tpl.project": "Project tracker", "tpl.project.t": "Tasks with status, priority, owner and due date.",
      "tpl.collection": "Collection", "tpl.collection.t": "Records, stamps, anything: year, condition, value.",
      "tpl.event": "Event guests", "tpl.event.t": "Who is invited, who answered, how many come.",
      "tpl.gear": "Equipment", "tpl.gear.t": "What you own, where it is, warranty until when.",
      "t.titles": "Titles", "t.books": "Books", "t.tasks": "Tasks", "t.items": "Items", "t.guests": "Guests",
      "f.name": "Name", "f.title": "Title", "f.author": "Author", "f.isbn": "ISBN", "f.status": "Status", "f.pubdate": "Publication date",
      "f.pages": "Pages", "f.price": "Price", "f.notes": "Notes", "f.rating": "Rating", "f.finished": "Finished on",
      "f.task": "Task", "f.priority": "Priority", "f.due": "Due date", "f.owner": "Owner", "f.done": "Done",
      "f.category": "Category", "f.year": "Year", "f.condition": "Condition", "f.value": "Value", "f.acquired": "Acquired on",
      "f.email": "Email", "f.phone": "Phone", "f.rsvp": "Answer", "f.people": "People", "f.serial": "Serial number",
      "f.location": "Location", "f.bought": "Bought on", "f.warranty": "Warranty until", "f.works": "Works", "f.genre": "Genre",
      "c.idea": "Idea", "c.writing": "Writing", "c.editing": "Editing", "c.published": "Published",
      "c.toread": "To read", "c.reading": "Reading", "c.read": "Read",
      "c.todo": "To do", "c.doing": "In progress", "c.donec": "Done", "c.low": "Low", "c.mid": "Medium", "c.high": "High",
      "c.mint": "Mint", "c.good": "Good", "c.fair": "Fair", "c.invited": "Invited", "c.yes": "Coming", "c.no": "Not coming", "c.maybe": "Maybe",
      "c.poetry": "Poetry", "c.novel": "Novel", "c.stories": "Short stories", "c.essay": "Essay",
      "v.grid": "Grid", "v.cards": "Cards", "v.newName": "View {n}",
      "tables": "Tables", "table.new": "New table", "table.name": "Table name", "table.defName": "Table {n}",
      "table.fromCsv": "Import a CSV file as a table",
      "menu.renameTable": "Rename table", "menu.primary": "Field that names records", "menu.exportCsv": "Export this view as CSV",
      "menu.sheet": "Open this view in Spreadsheet", "menu.renameView": "Rename view", "menu.dupView": "Duplicate view",
      "menu.newView": "New view", "menu.delView": "Delete view", "menu.delTable": "Delete table",
      "menu.renameBase": "Rename base", "menu.colorBase": "Colour", "menu.importTable": "Import CSV as a new table",
      "menu.delBase": "Delete base",
      "view": "View", "view.new": "New view…", "view.kind": "Show records as", "view.name": "View name",
      "kind.grid": "Grid (rows and columns)", "kind.cards": "Cards",
      "search": "Search in this view", "count": "{n} records", "count1": "1 record", "countOf": "{n} of {all} records",
      "filter": "Filter", "filterN": "Filter ({n})", "sort": "Sort", "sortN": "Sort ({n})", "group": "Group", "groupN": "Group ({n})",
      "f.empty": "(empty)", "f.untitled": "Untitled", 
      "del.base": "Delete the base “{x}” with all its tables and records?",
      "del.table": "Delete the table “{x}” with its {n} records?", "del.field": "Delete the field “{x}” and its values in every record?",
      "del.view": "Delete the view “{x}”? The records stay.", 
      "deleted": "Deleted", "deleted.rec": "Record deleted", "cleared": "Cleared", "pasted": "Pasted into {n} cells",
      "dup.done": "Duplicated", "copyOf": "{x} (copy)",
      "rec.title": "Record", "rec.created": "Created {x}", "rec.modified": "Changed {x}", "rec.dup": "Duplicate",
      "rec.expand": "Open record", "rec.prev": "Previous record", "rec.next": "Next record",
      "rec.computed": "Filled in by Base",
      "fld.new": "New field", "fld.edit": "Edit field", "fld.name": "Field name", "fld.type": "Type", "fld.desc": "Description (optional)",
      "fld.dec": "Decimal places", "fld.sym": "Currency symbol", "fld.time": "Include a time", "fld.max": "Highest rating",
      "fld.choices": "Choices", "fld.addChoice": "Add a choice", "fld.choiceN": "Choice {n}", "fld.colour": "Colour",
      "fld.del": "Delete field", "fld.lost": "{n} values do not fit the new type and will be emptied. Change the type?",
      "fld.conv": "Values converted", "fld.defName": "Field {n}", "fld.hide": "Hide in this view", "fld.sortAsc": "Sort A → Z",
      "fld.sortDesc": "Sort Z → A", "fld.left": "Move left", "fld.right": "Move right",
      "fld.tooMany": "A table holds at most {n} fields.", "fld.nameTaken": "Another field already has this name.",
      "type.text": "Short text", "type.long": "Long text", "type.number": "Number", "type.currency": "Currency",
      "type.percent": "Percent", "type.date": "Date", "type.check": "Checkbox", "type.select": "Single choice",
      "type.multi": "Multiple choice", "type.rating": "Rating", "type.email": "Email", "type.url": "Web address",
      "type.phone": "Phone", "type.auto": "Autonumber", "type.ctime": "Created time", "type.mtime": "Last changed time",
      "type.other": "Newer field type",
      "type.link": "Link to records",
      "type.lookup": "Lookup",
      "type.rollup": "Rollup",
      "type.count": "Count of links",
      "type.formula": "Formula",
      "fld.linkTo": "Link to table",
      "fld.linkOne": "Only one record",
      "fld.linkHint": "The table “{z}” gets a field “{x}” that shows the same links from its side.",
      "fld.linkSelf": "Records of this table link to each other.",
      "fld.via": "Through the link field",
      "fld.from": "Field of the linked records",
      "fld.fn": "Summary",
      "fn.SUM": "Sum",
      "fn.AVG": "Average",
      "fn.MIN": "Smallest",
      "fn.MAX": "Largest",
      "fn.COUNT": "Count of numbers",
      "fn.COUNTA": "Count of filled values",
      "fn.CONCAT": "All, as text",
      "fn.AND": "All ticked",
      "fn.OR": "At least one ticked",
      "fld.noLink": "Add a “Link to records” field to this table first.",
      "fld.expr": "Formula",
      "fld.exprHint": "Write field names in braces, like {Price} * {Copies}. The functions are the Spreadsheet’s (IF, ROUND, CONCATENATE, TODAY…), in English, with a dot for decimals.",
      "fld.insert": "Insert a field",
      "fld.preview": "First record: {x}",
      "fld.exprBad": "There is no field called “{x}” in this table.",
      "fld.asDate": "Show the result as a date",
      "fld.decAuto": "As it comes",
      "fld.typeLocked": "A link field keeps its type. To change it, delete the field.",
      "del.linkField": "Delete “{x}”? Its other side “{y}” in “{z}” and all the links go too.",
      "lnk.title": "Link records",
      "lnk.search": "Search in “{x}”",
      "lnk.new": "New record “{x}”",
      "lnk.add": "Link a record",
      "lnk.unlink": "Unlink {x}",
      "lnk.none": "No records match.",
      "lnk.more": "The first {n} are shown. Search to find others.",
      "lnk.gone": "The linked table was deleted.",
      "lnk.removed": "Links removed",
      "lnk.pasted": "{n} records not found, left out",
      "flt.title": "Filter", "flt.all": "Records that match all of these", "flt.any": "Records that match any of these",
      "flt.add": "Add a condition", "flt.none": "No conditions: every record is shown.", "flt.remove": "Remove condition",
      "flt.value": "Value",
      "op.has": "contains", "op.hasnot": "does not contain", "op.eq": "is", "op.ne": "is not", "op.empty": "is empty",
      "op.nempty": "is not empty", "op.gt": ">", "op.lt": "<", "op.gte": "≥", "op.lte": "≤", "op.neq": "=", "op.nne": "≠",
      "op.deq": "is on", "op.before": "is before", "op.after": "is after", "op.today": "is today", "op.past": "is before today",
      "op.future": "is after today", "op.checked": "is ticked", "op.unchecked": "is not ticked",
      "op.mhas": "has", "op.mhasnot": "does not have",
      "srt.title": "Sort", "srt.add": "Add a sort", "srt.none": "Records keep the order they were added in.",
      "srt.asc": "A → Z, 1 → 9", "srt.desc": "Z → A, 9 → 1",
      "grp.title": "Group", "grp.add": "Add a group", "grp.none": "No groups.", 
      "fl.title": "Fields in this view", "fl.hint": "Untick to hide a field here; it stays in the table and in other views.",
      "fl.showAll": "Show all", "fl.hideAll": "Hide all",
      "sum.sum": "Sum {x}", "sum.filled": "{n} filled", "sum.checked": "{n} ticked",
      "imp.done": "Imported {n} records. Check each field's type in the column header.",
      "imp.skipped": "{n} rows were left out: Base holds at most {max} records.",
      "imp.bad": "This file could not be read as CSV.", "imp.big": "This file is too big (at most 10 MB).",
      "imp.empty": "This file has no rows.",
      "exp.done": "Exported", "sheet.cap": "Only the first {n} records went to the Spreadsheet. Export a CSV for all of them.",
      "sheet.none": "This view has no records.", "sheet.off": "Open orOS to send this view to Spreadsheet.",
      "grid.add": "Add a field", "grid.addRow": "New record", "grid.label": "Records",
      "cards.more": "Show {n} more", "cards.none": "No record matches this view.", "table.empty": "No records yet. Add the first one.",
      "col.gray": "Grey", "col.red": "Red", "col.orange": "Orange", "col.yellow": "Yellow", "col.green": "Green",
      "col.teal": "Teal", "col.blue": "Blue", "col.purple": "Purple", "col.pink": "Pink", "col.brown": "Brown",
      "confirm": "Are you sure?", "notFound": "This record no longer exists.", "readOnly": "Base fills this in by itself."
    },
    el: {
      "app": "Βάση", "btn.newBase": "Νέα βάση", "btn.importCsv": "Εισαγωγή CSV", "btn.fields": "Πεδία",
      "btn.addRec": "Νέα εγγραφή", "btn.cancel": "Άκυρο", "btn.save": "Αποθήκευση", "btn.close": "Κλείσιμο", "btn.undo": "Αναίρεση",
      "btn.delete": "Διαγραφή", "btn.back": "Όλες οι βάσεις", "btn.more": "Περισσότερα", "btn.done": "Έτοιμο",
      "btn.create": "Δημιουργία", "btn.ok": "Εντάξει",
      "empty.title": "Δεν υπάρχει ακόμα καμία βάση",
      "empty.text": "Μια βάση κρατά εγγραφές με δομή: έναν κατάλογο, μια συλλογή, ένα έργο. Ξεκίνα από πρότυπο, από το μηδέν ή από ένα αρχείο CSV.",
      "space": "{n} από {max} εγγραφές · {kb} KB σε αυτή τη συσκευή",
      "space.warn": "Η Βάση σχεδόν γέμισε: {n} από {max} εγγραφές. Σβήσε παλιές εγγραφές ή κάνε εξαγωγή μιας βάσης πριν προσθέσεις πολλές ακόμα.",
      "space.full": "Η Βάση κρατά το πολύ {max} εγγραφές σε όλες τις συσκευές σου μαζί. Αυτή δεν προστέθηκε.",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε.",
      "base.tables": "{n} πίνακες", "base.table1": "1 πίνακας", "base.recs": "{n} εγγραφές", "base.rec1": "1 εγγραφή",
      "new.title": "Νέα βάση", "new.name": "Όνομα", "new.blank": "Κενή βάση", "new.blankText": "Ένας άδειος πίνακας για αρχή.",
      "new.tpl": "Ή ξεκίνα από πρότυπο", "new.defName": "Η βάση μου",
      "tpl.books": "Κατάλογος εκδόσεων", "tpl.books.t": "Τίτλοι, συγγραφείς, ISBN, κατάσταση, ημερομηνία έκδοσης.",
      "tpl.reading": "Λίστα ανάγνωσης", "tpl.reading.t": "Τι θα διαβάσεις, τι διαβάζεις, πώς σου φάνηκε.",
      "tpl.project": "Παρακολούθηση έργου", "tpl.project.t": "Εργασίες με κατάσταση, προτεραιότητα, υπεύθυνο και προθεσμία.",
      "tpl.collection": "Συλλογή", "tpl.collection.t": "Δίσκοι, γραμματόσημα, ό,τι θες: χρονιά, κατάσταση, αξία.",
      "tpl.event": "Καλεσμένοι εκδήλωσης", "tpl.event.t": "Ποιοι καλούνται, ποιοι απάντησαν, πόσοι έρχονται.",
      "tpl.gear": "Εξοπλισμός", "tpl.gear.t": "Τι έχεις, πού βρίσκεται, μέχρι πότε έχει εγγύηση.",
      "t.titles": "Τίτλοι", "t.books": "Βιβλία", "t.tasks": "Εργασίες", "t.items": "Αντικείμενα", "t.guests": "Καλεσμένοι",
      "f.name": "Όνομα", "f.title": "Τίτλος", "f.author": "Συγγραφέας", "f.isbn": "ISBN", "f.status": "Κατάσταση", "f.pubdate": "Ημερομηνία έκδοσης",
      "f.pages": "Σελίδες", "f.price": "Τιμή", "f.notes": "Σημειώσεις", "f.rating": "Βαθμολογία", "f.finished": "Το τελείωσα στις",
      "f.task": "Εργασία", "f.priority": "Προτεραιότητα", "f.due": "Προθεσμία", "f.owner": "Υπεύθυνος", "f.done": "Έγινε",
      "f.category": "Κατηγορία", "f.year": "Χρονιά", "f.condition": "Κατάσταση", "f.value": "Αξία", "f.acquired": "Το απέκτησα στις",
      "f.email": "Email", "f.phone": "Τηλέφωνο", "f.rsvp": "Απάντηση", "f.people": "Άτομα", "f.serial": "Σειριακός αριθμός",
      "f.location": "Τοποθεσία", "f.bought": "Αγοράστηκε στις", "f.warranty": "Εγγύηση έως", "f.works": "Λειτουργεί", "f.genre": "Είδος",
      "c.idea": "Ιδέα", "c.writing": "Γράφεται", "c.editing": "Επιμέλεια", "c.published": "Εκδόθηκε",
      "c.toread": "Για διάβασμα", "c.reading": "Το διαβάζω", "c.read": "Διαβάστηκε",
      "c.todo": "Να γίνει", "c.doing": "Σε εξέλιξη", "c.donec": "Έγινε", "c.low": "Χαμηλή", "c.mid": "Μεσαία", "c.high": "Υψηλή",
      "c.mint": "Άριστη", "c.good": "Καλή", "c.fair": "Μέτρια", "c.invited": "Προσκλήθηκε", "c.yes": "Έρχεται", "c.no": "Δεν έρχεται", "c.maybe": "Ίσως",
      "c.poetry": "Ποίηση", "c.novel": "Μυθιστόρημα", "c.stories": "Διηγήματα", "c.essay": "Δοκίμιο",
      "v.grid": "Πλέγμα", "v.cards": "Κάρτες", "v.newName": "Προβολή {n}",
      "tables": "Πίνακες", "table.new": "Νέος πίνακας", "table.name": "Όνομα πίνακα", "table.defName": "Πίνακας {n}",
      "table.fromCsv": "Εισαγωγή αρχείου CSV ως πίνακα",
      "menu.renameTable": "Μετονομασία πίνακα", "menu.primary": "Πεδίο που ονομάζει τις εγγραφές", "menu.exportCsv": "Εξαγωγή αυτής της προβολής σε CSV",
      "menu.sheet": "Άνοιγμα αυτής της προβολής στο Υπολογιστικό φύλλο", "menu.renameView": "Μετονομασία προβολής", "menu.dupView": "Αντίγραφο προβολής",
      "menu.newView": "Νέα προβολή", "menu.delView": "Διαγραφή προβολής", "menu.delTable": "Διαγραφή πίνακα",
      "menu.renameBase": "Μετονομασία βάσης", "menu.colorBase": "Χρώμα", "menu.importTable": "Εισαγωγή CSV ως νέου πίνακα",
      "menu.delBase": "Διαγραφή βάσης",
      "view": "Προβολή", "view.new": "Νέα προβολή…", "view.kind": "Εμφάνιση εγγραφών ως", "view.name": "Όνομα προβολής",
      "kind.grid": "Πλέγμα (γραμμές και στήλες)", "kind.cards": "Κάρτες",
      "search": "Αναζήτηση σε αυτή την προβολή", "count": "{n} εγγραφές", "count1": "1 εγγραφή", "countOf": "{n} από {all} εγγραφές",
      "filter": "Φίλτρο", "filterN": "Φίλτρο ({n})", "sort": "Ταξινόμηση", "sortN": "Ταξινόμηση ({n})", "group": "Ομάδες", "groupN": "Ομάδες ({n})",
      "f.empty": "(κενό)", "f.untitled": "Χωρίς όνομα", 
      "del.base": "Να διαγραφεί η βάση «{x}» με όλους τους πίνακες και τις εγγραφές της;",
      "del.table": "Να διαγραφεί ο πίνακας «{x}» με τις {n} εγγραφές του;", "del.field": "Να διαγραφεί το πεδίο «{x}» και οι τιμές του σε όλες τις εγγραφές;",
      "del.view": "Να διαγραφεί η προβολή «{x}»; Οι εγγραφές μένουν.", 
      "deleted": "Διαγράφηκε", "deleted.rec": "Η εγγραφή διαγράφηκε", "cleared": "Καθαρίστηκε", "pasted": "Επικολλήθηκε σε {n} κελιά",
      "dup.done": "Έγινε αντίγραφο", "copyOf": "{x} (αντίγραφο)",
      "rec.title": "Εγγραφή", "rec.created": "Δημιουργήθηκε {x}", "rec.modified": "Άλλαξε {x}", "rec.dup": "Αντίγραφο",
      "rec.expand": "Άνοιγμα εγγραφής", "rec.prev": "Προηγούμενη εγγραφή", "rec.next": "Επόμενη εγγραφή",
      "rec.computed": "Το συμπληρώνει η Βάση",
      "fld.new": "Νέο πεδίο", "fld.edit": "Επεξεργασία πεδίου", "fld.name": "Όνομα πεδίου", "fld.type": "Τύπος", "fld.desc": "Περιγραφή (προαιρετικά)",
      "fld.dec": "Δεκαδικά ψηφία", "fld.sym": "Σύμβολο νομίσματος", "fld.time": "Και ώρα", "fld.max": "Μέγιστη βαθμολογία",
      "fld.choices": "Επιλογές", "fld.addChoice": "Προσθήκη επιλογής", "fld.choiceN": "Επιλογή {n}", "fld.colour": "Χρώμα",
      "fld.del": "Διαγραφή πεδίου", "fld.lost": "{n} τιμές δεν ταιριάζουν στον νέο τύπο και θα αδειάσουν. Να αλλάξει ο τύπος;",
      "fld.conv": "Οι τιμές μετατράπηκαν", "fld.defName": "Πεδίο {n}", "fld.hide": "Απόκρυψη σε αυτή την προβολή", "fld.sortAsc": "Ταξινόμηση Α → Ω",
      "fld.sortDesc": "Ταξινόμηση Ω → Α", "fld.left": "Μετακίνηση αριστερά", "fld.right": "Μετακίνηση δεξιά",
      "fld.tooMany": "Ένας πίνακας έχει το πολύ {n} πεδία.", "fld.nameTaken": "Υπάρχει ήδη πεδίο με αυτό το όνομα.",
      "type.text": "Σύντομο κείμενο", "type.long": "Μεγάλο κείμενο", "type.number": "Αριθμός", "type.currency": "Ποσό",
      "type.percent": "Ποσοστό", "type.date": "Ημερομηνία", "type.check": "Τσεκ", "type.select": "Μία επιλογή",
      "type.multi": "Πολλές επιλογές", "type.rating": "Βαθμολογία", "type.email": "Email", "type.url": "Σύνδεσμος",
      "type.phone": "Τηλέφωνο", "type.auto": "Αύξων αριθμός", "type.ctime": "Ώρα δημιουργίας", "type.mtime": "Ώρα τελευταίας αλλαγής",
      "type.other": "Νεότερος τύπος πεδίου",
      "type.link": "Σύνδεση με εγγραφές",
      "type.lookup": "Αναζήτηση από σύνδεση",
      "type.rollup": "Σύνοψη από σύνδεση",
      "type.count": "Πλήθος συνδέσεων",
      "type.formula": "Τύπος",
      "fld.linkTo": "Σύνδεση με τον πίνακα",
      "fld.linkOne": "Μόνο μία εγγραφή",
      "fld.linkHint": "Ο πίνακας «{z}» παίρνει ένα πεδίο «{x}» που δείχνει τις ίδιες συνδέσεις από τη δική του πλευρά.",
      "fld.linkSelf": "Οι εγγραφές αυτού του πίνακα συνδέονται μεταξύ τους.",
      "fld.via": "Μέσω του πεδίου σύνδεσης",
      "fld.from": "Πεδίο των συνδεδεμένων εγγραφών",
      "fld.fn": "Σύνοψη",
      "fn.SUM": "Άθροισμα",
      "fn.AVG": "Μέσος όρος",
      "fn.MIN": "Μικρότερο",
      "fn.MAX": "Μεγαλύτερο",
      "fn.COUNT": "Πλήθος αριθμών",
      "fn.COUNTA": "Πλήθος συμπληρωμένων",
      "fn.CONCAT": "Όλα, ως κείμενο",
      "fn.AND": "Όλα τσεκαρισμένα",
      "fn.OR": "Τουλάχιστον ένα τσεκαρισμένο",
      "fld.noLink": "Πρόσθεσε πρώτα σε αυτόν τον πίνακα ένα πεδίο «Σύνδεση με εγγραφές».",
      "fld.expr": "Τύπος",
      "fld.exprHint": "Γράψε τα ονόματα των πεδίων σε άγκιστρα, π.χ. {Τιμή} * {Αντίτυπα}. Οι συναρτήσεις είναι του Υπολογιστικού φύλλου (IF, ROUND, CONCATENATE, TODAY…), στα αγγλικά, με τελεία για τα δεκαδικά.",
      "fld.insert": "Βάλε πεδίο",
      "fld.preview": "Πρώτη εγγραφή: {x}",
      "fld.exprBad": "Δεν υπάρχει πεδίο «{x}» σε αυτόν τον πίνακα.",
      "fld.asDate": "Δείξε το αποτέλεσμα ως ημερομηνία",
      "fld.decAuto": "Όπως βγαίνει",
      "fld.typeLocked": "Ένα πεδίο σύνδεσης κρατά τον τύπο του. Για να τον αλλάξεις, διάγραψε το πεδίο.",
      "del.linkField": "Διαγραφή του «{x}»; Φεύγουν μαζί η άλλη του πλευρά «{y}» στον πίνακα «{z}» και όλες οι συνδέσεις.",
      "lnk.title": "Σύνδεση εγγραφών",
      "lnk.search": "Αναζήτηση στο «{x}»",
      "lnk.new": "Νέα εγγραφή «{x}»",
      "lnk.add": "Σύνδεσε εγγραφή",
      "lnk.unlink": "Αποσύνδεση: {x}",
      "lnk.none": "Καμία εγγραφή δεν ταιριάζει.",
      "lnk.more": "Φαίνονται οι πρώτες {n}. Ψάξε για να βρεις τις άλλες.",
      "lnk.gone": "Ο συνδεδεμένος πίνακας διαγράφηκε.",
      "lnk.removed": "Οι συνδέσεις αφαιρέθηκαν",
      "lnk.pasted": "{n} εγγραφές δεν βρέθηκαν και έμειναν έξω",
      "flt.title": "Φίλτρο", "flt.all": "Εγγραφές που ταιριάζουν σε όλα αυτά", "flt.any": "Εγγραφές που ταιριάζουν σε κάποιο από αυτά",
      "flt.add": "Προσθήκη συνθήκης", "flt.none": "Χωρίς συνθήκες: φαίνονται όλες οι εγγραφές.", "flt.remove": "Αφαίρεση συνθήκης",
      "flt.value": "Τιμή",
      "op.has": "περιέχει", "op.hasnot": "δεν περιέχει", "op.eq": "είναι", "op.ne": "δεν είναι", "op.empty": "είναι κενό",
      "op.nempty": "δεν είναι κενό", "op.gt": ">", "op.lt": "<", "op.gte": "≥", "op.lte": "≤", "op.neq": "=", "op.nne": "≠",
      "op.deq": "είναι στις", "op.before": "είναι πριν από", "op.after": "είναι μετά από", "op.today": "είναι σήμερα", "op.past": "είναι πριν από σήμερα",
      "op.future": "είναι μετά από σήμερα", "op.checked": "είναι τσεκαρισμένο", "op.unchecked": "δεν είναι τσεκαρισμένο",
      "op.mhas": "έχει", "op.mhasnot": "δεν έχει",
      "srt.title": "Ταξινόμηση", "srt.add": "Προσθήκη ταξινόμησης", "srt.none": "Οι εγγραφές μένουν με τη σειρά που μπήκαν.",
      "srt.asc": "Α → Ω, 1 → 9", "srt.desc": "Ω → Α, 9 → 1",
      "grp.title": "Ομάδες", "grp.add": "Προσθήκη ομάδας", "grp.none": "Χωρίς ομάδες.", 
      "fl.title": "Πεδία σε αυτή την προβολή", "fl.hint": "Ξετσέκαρε για να κρύψεις ένα πεδίο εδώ· μένει στον πίνακα και στις άλλες προβολές.",
      "fl.showAll": "Εμφάνιση όλων", "fl.hideAll": "Απόκρυψη όλων",
      "sum.sum": "Σύνολο {x}", "sum.filled": "{n} συμπληρωμένα", "sum.checked": "{n} τσεκαρισμένα",
      "imp.done": "Μπήκαν {n} εγγραφές. Έλεγξε τον τύπο κάθε πεδίου στην κεφαλίδα της στήλης.",
      "imp.skipped": "{n} γραμμές έμειναν έξω: η Βάση κρατά το πολύ {max} εγγραφές.",
      "imp.bad": "Αυτό το αρχείο δεν διαβάστηκε ως CSV.", "imp.big": "Το αρχείο είναι πολύ μεγάλο (έως 10 MB).",
      "imp.empty": "Το αρχείο δεν έχει γραμμές.",
      "exp.done": "Η εξαγωγή έγινε", "sheet.cap": "Στο Υπολογιστικό φύλλο πήγαν μόνο οι πρώτες {n} εγγραφές. Για όλες, κάνε εξαγωγή σε CSV.",
      "sheet.none": "Αυτή η προβολή δεν έχει εγγραφές.", "sheet.off": "Άνοιξε το orOS για να στείλεις την προβολή στο Υπολογιστικό φύλλο.",
      "grid.add": "Προσθήκη πεδίου", "grid.addRow": "Νέα εγγραφή", "grid.label": "Εγγραφές",
      "cards.more": "Εμφάνιση {n} ακόμα", "cards.none": "Καμία εγγραφή δεν ταιριάζει σε αυτή την προβολή.", "table.empty": "Δεν υπάρχουν εγγραφές ακόμα. Πρόσθεσε την πρώτη.",
      "col.gray": "Γκρι", "col.red": "Κόκκινο", "col.orange": "Πορτοκαλί", "col.yellow": "Κίτρινο", "col.green": "Πράσινο",
      "col.teal": "Γαλαζοπράσινο", "col.blue": "Μπλε", "col.purple": "Μωβ", "col.pink": "Ροζ", "col.brown": "Καφέ",
      "confirm": "Είσαι σίγουρος;", "notFound": "Αυτή η εγγραφή δεν υπάρχει πια.", "readOnly": "Αυτό το συμπληρώνει μόνη της η Βάση."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "base", LANG);

  function t(k, v) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function locale() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  function fmtNum(n) { try { return n.toLocaleString(locale()); } catch (e) { return String(n); } }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(cls, text, fn) {
    var b = el("button", cls, text);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function fmt() { return { lang: LANG, locale: locale() }; }
  function today() { return C.localYmd(Date.now()); }
  function plural(n, one, many) { return n === 1 ? t(one) : t(many, { n: fmtNum(n) }); }

  var ICON = {
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    expand: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    caret: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
    left: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    right: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
  };
  // Static markup only (never data): the icons above.
  function iconBtn(svg, label, cls, fn) {
    var b = el("button", "icon-btn" + (cls ? " " + cls : ""));
    b.type = "button";
    b.innerHTML = svg;
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function setIcon(node, svg, label) {
    node.innerHTML = svg;
    node.setAttribute("aria-label", label);
    node.title = label;
  }

  // ---------- 2. Storage + sync slice ----------
  var data = C.empty();
  var ix = C.index(data);
  var prefs = { at: {}, w: {}, col: {} };

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { data = C.empty(); }
    ix = C.index(data);
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        prefs.at = p.at && typeof p.at === "object" ? p.at : {};
        prefs.w = p.w && typeof p.w === "object" ? p.w : {};
        prefs.col = p.col && typeof p.col === "object" ? p.col : {};
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, C.serialize(data)); return true; }
    catch (e) { toast(t("full")); return false; }
  }
  // Every edit by the person ends here: write, tell sync, repaint.
  function save(next, opts) {
    var before = data;
    data = next;
    ix = C.index(data);
    if (!persist()) { data = before; ix = C.index(data); render(); return false; }
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    if (!(opts && opts.quiet)) render();
    return true;
  }
  function sliceGet() { return C.normalize(data); }
  function sliceSet(incoming) {
    var merged = C.merge(data, incoming);
    if (C.serialize(merged) === C.serialize(data)) return;
    data = merged;
    ix = C.index(data);
    persist();                 // R6: no markDirty for a pull
    if (editing) return;       // the editor's cell repaints when it closes
    render();
    refreshOpenRecord();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }   // 5 args, always
    catch (e) { /* engine busy: the next boot registers again */ }
  }

  function roomFor(n) {
    var have = data.recs.length;
    if (have + n > C.MAX_RECS) { toast(t("space.full", { max: fmtNum(C.MAX_RECS) })); return false; }
    if (have + n > C.MAX_RECS * 0.8 && !roomFor.warned) { roomFor.warned = true; toast(t("space.warn", { n: fmtNum(have + n), max: fmtNum(C.MAX_RECS) })); }
    return true;
  }

  // ---------- where we are ----------
  var cur = { base: "", table: "", view: "" };
  function curBase() { return ix.bases[cur.base] || null; }
  function curTable() { return ix.tables[cur.table] || null; }
  function curView() { return ix.views[cur.view] || null; }
  function fixCur() {
    if (!ix.bases[cur.base]) { cur.base = ""; cur.table = ""; cur.view = ""; return; }
    var tables = ix.baseTables[cur.base] || [];
    if (!ix.tables[cur.table] || ix.tables[cur.table].base !== cur.base) {
      var last = prefs.at[cur.base];
      cur.table = last && ix.tables[last] && ix.tables[last].base === cur.base ? last : (tables[0] ? tables[0].id : "");
    }
    var views = ix.tbViews[cur.table] || [];
    if (!ix.views[cur.view] || ix.views[cur.view].tb !== cur.table) {
      var lv = prefs.at["v:" + cur.table];
      if (lv && ix.views[lv] && ix.views[lv].tb === cur.table) cur.view = lv;
      else {
        var narrow = window.innerWidth < 600;
        var pick = views.filter(function (v) { return v.kind === (narrow ? "cards" : "grid"); })[0] || views[0];
        cur.view = pick ? pick.id : "";
      }
    }
  }
  function remember() {
    if (cur.base) prefs.at.base = cur.base;
    if (cur.base && cur.table) prefs.at[cur.base] = cur.table;
    if (cur.table && cur.view) prefs.at["v:" + cur.table] = cur.view;
    savePrefs();
  }
  function goHome() {
    closeEditor(false);
    cur = { base: "", table: "", view: "" };
    prefs.at.base = "";
    savePrefs();
    render();
  }
  function openBase(id, table, view) {
    closeEditor(false);
    cur.base = id; cur.table = table || ""; cur.view = view || "";
    sel = null;
    fixCur();
    remember();
    render();
    $("content").scrollTop = 0; $("content").scrollLeft = 0;
  }

  // ---------- 3. Home ----------
  function render() {
    fixCur();
    var inBase = !!curBase();
    $("home").hidden = inBase;
    $("basev").hidden = !inBase;
    $("back-btn").hidden = !inBase;
    $("new-btn").hidden = inBase;
    $("import-btn").hidden = inBase;
    $("base-menu-btn").hidden = !inBase;
    $("title").textContent = inBase ? (curBase().name || t("f.untitled")) : t("app");
    document.title = (inBase ? (curBase().name || t("f.untitled")) + " · " : "") + t("app") + " · orOS";
    if (!inBase) renderHome();
    else renderBase();
  }

  function renderHome() {
    var list = $("bases");
    list.textContent = "";
    data.bases.slice().sort(function (a, b) { return b.m - a.m || (a.id < b.id ? -1 : 1); }).forEach(function (b) {
      var tables = ix.baseTables[b.id] || [];
      var n = 0;
      tables.forEach(function (tb) { n += (ix.tbRecs[tb.id] || []).length; });
      var li = el("li");
      var card = btn("base-card col-" + b.color, null, function () { openBase(b.id); });
      card.appendChild(el("span", "base-dot"));
      card.appendChild(el("span", "name", b.name || t("f.untitled")));
      card.appendChild(el("span", "meta", plural(tables.length, "base.table1", "base.tables") + " · " + plural(n, "base.rec1", "base.recs")));
      li.appendChild(card);
      list.appendChild(li);
    });
    $("home-empty").hidden = data.bases.length > 0;
    $("space").textContent = t("space", { n: fmtNum(data.recs.length), max: fmtNum(C.MAX_RECS), kb: fmtNum(Math.ceil(C.size(data) / 1024)) });
  }

  // Templates: built from the string table in the person's language
  // (the names are then their data, like anything they type).
  function ch(keys, colors) {
    return { ch: keys.map(function (k, i) { return { id: "o" + (i + 1), n: t(k), c: colors[i] || "gray" }; }) };
  }
  var TEMPLATES = {
    books: function () {
      return { name: t("tpl.books"), tables: [{ name: t("t.titles"), fields: [
        ["f.title", "text"], ["f.author", "text"], ["f.isbn", "text"],
        ["f.status", "select", ch(["c.idea", "c.writing", "c.editing", "c.published"], ["gray", "blue", "orange", "green"])],
        ["f.genre", "multi", ch(["c.poetry", "c.novel", "c.stories", "c.essay"], ["purple", "blue", "teal", "brown"])],
        ["f.pubdate", "date", {}], ["f.pages", "number", { dec: 0 }], ["f.price", "currency", { dec: 2, sym: "€" }], ["f.notes", "long", {}]
      ] }] };
    },
    reading: function () {
      return { name: t("tpl.reading"), tables: [{ name: t("t.books"), fields: [
        ["f.title", "text"], ["f.author", "text"],
        ["f.status", "select", ch(["c.toread", "c.reading", "c.read"], ["gray", "blue", "green"])],
        ["f.rating", "rating", { max: 5 }], ["f.finished", "date", {}], ["f.notes", "long", {}]
      ] }] };
    },
    project: function () {
      return { name: t("tpl.project"), tables: [{ name: t("t.tasks"), fields: [
        ["f.task", "text"], ["f.status", "select", ch(["c.todo", "c.doing", "c.donec"], ["gray", "blue", "green"])],
        ["f.priority", "select", ch(["c.low", "c.mid", "c.high"], ["teal", "yellow", "red"])],
        ["f.owner", "text"], ["f.due", "date", {}], ["f.done", "check", {}], ["f.notes", "long", {}]
      ] }] };
    },
    collection: function () {
      return { name: t("tpl.collection"), tables: [{ name: t("t.items"), fields: [
        ["f.name", "text"], ["f.category", "select", { ch: [] }], ["f.year", "number", { dec: 0 }],
        ["f.condition", "select", ch(["c.mint", "c.good", "c.fair"], ["green", "blue", "orange"])],
        ["f.value", "currency", { dec: 2, sym: "€" }], ["f.acquired", "date", {}], ["f.notes", "long", {}]
      ] }] };
    },
    event: function () {
      return { name: t("tpl.event"), tables: [{ name: t("t.guests"), fields: [
        ["f.name", "text"], ["f.email", "email"], ["f.phone", "phone"],
        ["f.rsvp", "select", ch(["c.invited", "c.yes", "c.no", "c.maybe"], ["gray", "green", "red", "yellow"])],
        ["f.people", "number", { dec: 0 }], ["f.notes", "long", {}]
      ] }] };
    },
    gear: function () {
      return { name: t("tpl.gear"), tables: [{ name: t("t.items"), fields: [
        ["f.name", "text"], ["f.serial", "text"], ["f.location", "text"], ["f.bought", "date", {}],
        ["f.price", "currency", { dec: 2, sym: "€" }], ["f.warranty", "date", {}], ["f.works", "check", {}]
      ] }] };
    }
  };
  function tableNames() { return { field: t("f.name"), grid: t("v.grid"), cards: t("v.cards"), column: t("fld.defName", { n: "" }).trim() }; }
  function buildTemplate(key) {
    var tpl = TEMPLATES[key](), now = Date.now();
    var bid = C.uid(now);
    var d = C.addBase(data, tpl.name, now, bid);
    tpl.tables.forEach(function (tb) {
      var tid = C.uid(now), pf = C.fid();
      var first = tb.fields[0];
      d = C.addTable(d, bid, tb.name, now, { field: t(first[0]), grid: t("v.grid"), cards: t("v.cards") }, { t: tid, f: pf, v1: C.uid(now), v2: C.uid(now) });
      tb.fields.slice(1).forEach(function (f) { d = C.addField(d, tid, t(f[0]), f[1], f[2] || {}, now); });
    });
    return { data: d, base: bid };
  }

  function newBaseDialog() {
    var d = dialog(t("new.title"));
    var name = input("text", t("new.defName"));
    d.body.appendChild(fld(t("new.name"), name));
    var grid = el("div", "tpl-grid");
    var blank = btn("tpl", null, function () {
      var now = Date.now(), bid = C.uid(now);
      var nd = C.addBase(data, name.value.trim() || t("new.defName"), now, bid);
      nd = C.addTable(nd, bid, t("table.defName", { n: 1 }), now, tableNames());
      d.close();
      if (save(nd)) openBase(bid);
    });
    blank.appendChild(el("span", "tpl-name", t("new.blank")));
    blank.appendChild(el("span", "tpl-text", t("new.blankText")));
    d.body.appendChild(blank);
    d.body.appendChild(el("h3", "sub", t("new.tpl")));
    Object.keys(TEMPLATES).forEach(function (k) {
      var b = btn("tpl", null, function () {
        var r = buildTemplate(k);
        var nm = name.value.trim();
        if (nm && nm !== t("new.defName")) r.data = C.putRow(r.data, "bases", Object.assign({}, C.index(r.data).bases[r.base], { name: nm }), Date.now());
        d.close();
        if (save(r.data)) openBase(r.base);
      });
      b.appendChild(el("span", "tpl-name", t("tpl." + k)));
      b.appendChild(el("span", "tpl-text", t("tpl." + k + ".t")));
      grid.appendChild(b);
    });
    d.body.appendChild(grid);
    d.foot(btn("chip", t("btn.cancel"), function () { d.close(); }));
    d.open();
    name.select();
  }

  // ---------- 4. Base: tables, views, menus ----------
  function renderBase() {
    var tabs = $("tables");
    tabs.textContent = "";
    (ix.baseTables[cur.base] || []).forEach(function (tb) {
      var b = btn("tab" + (tb.id === cur.table ? " on" : ""), tb.name || t("f.untitled"), function () {
        if (tb.id === cur.table) return;
        closeEditor(true);
        cur.table = tb.id; cur.view = ""; sel = null;
        fixCur(); remember(); render();
        $("content").scrollTop = 0; $("content").scrollLeft = 0;
      });
      b.setAttribute("aria-current", tb.id === cur.table ? "page" : "false");
      tabs.appendChild(b);
    });
    tabs.appendChild(iconBtn(ICON.plus, t("table.new"), "tab-add", newTableDialog));

    var vs = $("view-sel");
    vs.textContent = "";
    (ix.tbViews[cur.table] || []).forEach(function (v) {
      var o = el("option", null, v.name || t("f.untitled"));
      o.value = v.id;
      vs.appendChild(o);
    });
    var nv = el("option", null, t("view.new"));
    nv.value = "__new";
    vs.appendChild(nv);
    vs.value = cur.view;

    var v = curView();
    var cfg = v ? v.cfg : { filters: [], sorts: [], groups: [] };
    var nf = cfg.filters.filter(function (c) { return ix.fields[c.f]; }).length;
    $("filter-btn").textContent = nf ? t("filterN", { n: nf }) : t("filter");
    $("filter-btn").classList.toggle("on", nf > 0);
    $("sort-btn").textContent = cfg.sorts.length ? t("sortN", { n: cfg.sorts.length }) : t("sort");
    $("sort-btn").classList.toggle("on", cfg.sorts.length > 0);
    $("group-btn").textContent = cfg.groups.length ? t("groupN", { n: cfg.groups.length }) : t("group");
    $("group-btn").classList.toggle("on", cfg.groups.length > 0);
    var hid = v ? cfg.hidden.filter(function (id) { return ix.fields[id] && ix.fields[id].tb === cur.table; }).length : 0;
    $("fields-btn").classList.toggle("on", hid > 0);
    renderContent();
  }

  var shown = [];      // records of the current view, in order (for the record dialog's next / previous)
  function renderContent() {
    var v = curView(), box = $("content");
    if (!v) { box.textContent = ""; $("count").textContent = ""; return; }
    shown = C.query(ix, v, { today: today(), q: $("q").value, fmt: fmt() });
    var all = (ix.tbRecs[cur.table] || []).length;
    $("count").textContent = shown.length === all ? plural(all, "count1", "count") : t("countOf", { n: fmtNum(shown.length), all: fmtNum(all) });
    if (v.kind === "cards") renderCards(v);
    else renderGrid(v);
  }

  function newTableDialog() {
    var d = dialog(t("table.new"));
    var n = (ix.baseTables[cur.base] || []).length + 1;
    var name = input("text", t("table.defName", { n: n }));
    d.body.appendChild(fld(t("table.name"), name));
    d.body.appendChild(btn("chip", t("table.fromCsv"), function () { d.close(); importCsv(cur.base); }));
    d.foot(btn("chip", t("btn.cancel"), function () { d.close(); }),
      btn("chip pri", t("btn.create"), function () {
        if ((ix.baseTables[cur.base] || []).length >= C.MAX_TABLES) { d.close(); return; }
        var now = Date.now(), tid = C.uid(now);
        var nd = C.addTable(data, cur.base, name.value.trim() || t("table.defName", { n: n }), now, tableNames(), { t: tid, f: C.fid(), v1: C.uid(now), v2: C.uid(now) + "c" });
        d.close();
        if (save(nd)) { cur.table = tid; cur.view = ""; sel = null; fixCur(); remember(); render(); }
      }));
    d.open();
    name.select();
    d.enter(function () { d.foot.last.click(); });
  }

  function menu(title, items) {
    var d = dialog(title, "menu");
    items.forEach(function (it) {
      if (!it) return;
      var b = btn("menu-item" + (it.danger ? " danger" : ""), it.label, function () { d.close(); it.fn(); });
      if (it.disabled) b.disabled = true;
      d.body.appendChild(b);
    });
    d.foot(btn("chip", t("btn.close"), function () { d.close(); }));
    d.open();
  }

  function tableMenu() {
    var tb = curTable(), v = curView();
    if (!tb) return;
    var views = ix.tbViews[tb.id] || [];
    menu(tb.name || t("f.untitled"), [
      { label: t("menu.renameTable"), fn: function () {
        promptDlg(t("menu.renameTable"), t("table.name"), tb.name, function (s) {
          save(C.putRow(data, "tables", Object.assign({}, tb, { name: s || tb.name }), Date.now()));
        });
      } },
      { label: t("menu.primary"), fn: primaryDialog },
      v && { label: t("menu.renameView"), fn: function () {
        promptDlg(t("menu.renameView"), t("view.name"), v.name, function (s) {
          save(C.putRow(data, "views", Object.assign({}, v, { name: s || v.name }), Date.now()));
        });
      } },
      v && { label: t("menu.dupView"), fn: function () {
        var now = Date.now(), id = C.uid(now);
        var nd = C.putRow(data, "views", { id: id, tb: v.tb, name: t("copyOf", { x: v.name }), kind: v.kind, ord: views.length, cfg: JSON.parse(JSON.stringify(v.cfg)) }, now);
        if (save(nd)) { cur.view = id; remember(); render(); toast(t("dup.done")); }
      } },
      { label: t("menu.newView"), fn: newViewDialog },
      v && { label: t("menu.exportCsv"), fn: exportCsv },
      v && sheetOpener() && { label: t("menu.sheet"), fn: openInSheet },
      v && views.length > 1 && { label: t("menu.delView"), danger: true, fn: function () {
        confirmDlg(t("del.view", { x: v.name }), t("btn.delete"), function () { deleteRow(v.id); });
      } },
      { label: t("menu.delTable"), danger: true, fn: function () {
        confirmDlg(t("del.table", { x: tb.name, n: fmtNum((ix.tbRecs[tb.id] || []).length) }), t("btn.delete"), function () { deleteRow(tb.id); });
      } }
    ]);
  }

  function baseMenu() {
    var b = curBase();
    if (!b) return;
    menu(b.name || t("f.untitled"), [
      { label: t("menu.renameBase"), fn: function () {
        promptDlg(t("menu.renameBase"), t("new.name"), b.name, function (s) {
          save(C.putRow(data, "bases", Object.assign({}, b, { name: s || b.name }), Date.now()));
        });
      } },
      { label: t("menu.colorBase"), fn: function () {
        var d = dialog(t("menu.colorBase"));
        var g = el("div", "swatches");
        C.COLORS.forEach(function (c) {
          var s = btn("swatch col-" + c + (c === b.color ? " on" : ""), null, function () {
            d.close();
            save(C.putRow(data, "bases", Object.assign({}, b, { color: c }), Date.now()));
          });
          s.setAttribute("aria-label", t("col." + c));
          s.title = t("col." + c);
          g.appendChild(s);
        });
        d.body.appendChild(g);
        d.foot(btn("chip", t("btn.close"), function () { d.close(); }));
        d.open();
      } },
      { label: t("menu.importTable"), fn: function () { importCsv(b.id); } },
      { label: t("menu.delBase"), danger: true, fn: function () {
        confirmDlg(t("del.base", { x: b.name }), t("btn.delete"), function () { deleteRow(b.id); });
      } }
    ]);
  }

  // Delete any row with Undo (R14: a toast, no native dialog).
  function deleteRow(id, msg) {
    var rows = C.rowsUnder(data, id);
    if (!rows.length) return;
    var wasBase = !!ix.bases[id];
    if (save(C.remove(data, id, Date.now()))) {
      if (wasBase) goHome();
      toast(msg || t("deleted"), function () { save(C.restore(data, rows, Date.now())); });
    }
  }

  function primaryDialog() {
    var tb = curTable();
    var d = dialog(t("menu.primary"));
    var s = el("select");
    (ix.tbFields[tb.id] || []).forEach(function (f) {
      var o = el("option", null, f.name || t("f.untitled"));
      o.value = f.id;
      s.appendChild(o);
    });
    var pf = C.primary(ix, tb.id);
    if (pf) s.value = pf.id;
    d.body.appendChild(fld(t("menu.primary"), s));
    d.foot(btn("chip", t("btn.cancel"), function () { d.close(); }),
      btn("chip pri", t("btn.save"), function () {
        d.close();
        save(C.putRow(data, "tables", Object.assign({}, tb, { pf: s.value }), Date.now()));
      }));
    d.open();
  }

  function newViewDialog() {
    var tb = curTable();
    if (!tb) return;
    var views = ix.tbViews[tb.id] || [];
    var d = dialog(t("menu.newView"));
    var name = input("text", t("v.newName", { n: views.length + 1 }));
    d.body.appendChild(fld(t("view.name"), name));
    var kind = el("select");
    ["grid", "cards"].forEach(function (k) { var o = el("option", null, t("kind." + k)); o.value = k; kind.appendChild(o); });
    d.body.appendChild(fld(t("view.kind"), kind));
    d.foot(btn("chip", t("btn.cancel"), function () { d.close(); }),
      btn("chip pri", t("btn.create"), function () {
        var now = Date.now(), id = C.uid(now);
        var ord = views.reduce(function (m, v) { return Math.max(m, v.ord + 1); }, 0);
        d.close();
        if (save(C.putRow(data, "views", { id: id, tb: tb.id, name: name.value.trim() || t("v.newName", { n: views.length + 1 }), kind: kind.value, ord: ord, cfg: {} }, now))) {
          cur.view = id; remember(); render();
        }
      }));
    d.open();
    name.select();
  }

  // a change to the current view's settings (filters, sorts…); views sync
  function setCfg(patch) {
    var v = curView();
    if (!v) return;
    var cfg = Object.assign({}, v.cfg, patch);
    save(C.putRow(data, "views", Object.assign({}, v, { cfg: cfg }), Date.now()));
  }

  function newRecord(vals, openIt) {
    var tb = curTable();
    if (!tb || !roomFor(1)) return null;
    var v = curView();
    vals = vals || {};
    // a new record inherits the "is" filters of the view, so it does not vanish from it
    if (v) v.cfg.filters.forEach(function (c) {
      var f = ix.fields[c.f];
      if (!f || f.tb !== tb.id || C.COMPUTED[f.type] || vals[f.id] !== undefined) return;
      if (c.op === "eq" && c.v !== undefined && (f.type === "select" || C.isNumType(f.type) || f.type === "date" || f.type === "text")) vals[f.id] = c.v;
      if (c.op === "checked") vals[f.id] = true;
      if (c.op === "has" && f.type === "multi" && c.v) vals[f.id] = [c.v];
    });
    var r = C.addRecord(data, tb.id, vals, Date.now());
    if (!save(r.data)) return null;
    if (openIt) openRecord(r.id);
    return r.id;
  }

  // ---------- 5. Grid ----------
  var sel = null;          // { r: rec id, c: field id }
  var editing = null;      // { rec, f, input, cell }
  var gridState = null;    // { rows, cols, top }

  var DEF_W = { link: 200, lookup: 200, rollup: 120, count: 90, formula: 160, text: 200, long: 260, number: 110, currency: 120, percent: 100, date: 140, check: 70, select: 150,
    multi: 200, rating: 120, email: 210, url: 210, phone: 150, auto: 80, ctime: 170, mtime: 170 };
  function colW(f, isPf) {
    var w = prefs.w[f.id];
    return typeof w === "number" && w >= 60 && w <= 800 ? w : isPf ? Math.max(220, DEF_W[f.type] || 200) : (DEF_W[f.type] || 180);
  }

  function renderGrid(v) {
    var box = $("content");
    var keepTop = box.scrollTop, keepLeft = box.scrollLeft;
    box.textContent = "";
    box.className = "content grid-host";
    var cols = C.visibleFields(ix, v);
    var pf = C.primary(ix, v.tb);
    var rows = C.layout(ix, v, shown, prefs.col[v.id] || {});
    gridState = { rows: rows, cols: cols, view: v, pf: pf };

    var grid = el("div", "grid");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", t("grid.label"));
    grid.setAttribute("aria-rowcount", String(rows.length + 1));
    var widths = cols.map(function (f, i) { return colW(f, i === 0); });
    var total = 48 + widths.reduce(function (a, b) { return a + b; }, 0) + 48;
    grid.style.width = total + "px";
    grid.style.setProperty("--pf-w", (widths[0] || 0) + "px");

    // header
    var head = el("div", "g-row g-head");
    head.setAttribute("role", "row");
    var corner = el("div", "g-cell g-num g-corner");
    head.appendChild(corner);
    cols.forEach(function (f, i) {
      var hc = el("div", "g-cell g-hcell" + (i === 0 ? " g-pf" : "") + (C.isNumField(ix, f) ? " num" : ""));
      hc.setAttribute("role", "columnheader");
      hc.style.width = widths[i] + "px";
      var hb = btn("g-hbtn", null, function () { fieldMenu(f); });
      hb.appendChild(el("span", "g-type", typeMark(f.type)));
      hb.appendChild(el("span", "g-hname", f.name || t("f.untitled")));
      hb.title = (f.name || "") + " · " + typeLabel(f.type);
      hc.appendChild(hb);
      var grip = el("span", "g-grip");
      grip.addEventListener("pointerdown", function (e) { startResize(e, f, hc, grid); });
      hc.appendChild(grip);
      head.appendChild(hc);
    });
    var addCol = el("div", "g-cell g-addcol");
    addCol.appendChild(iconBtn(ICON.plus, t("grid.add"), "g-add", function () { fieldDialog(null); }));
    head.appendChild(addCol);
    grid.appendChild(head);

    var body = el("div", "g-body");
    body.style.height = (rows.length * ROW_H) + "px";
    grid.appendChild(body);

    // summary footer
    var foot = el("div", "g-row g-foot");
    foot.appendChild(el("div", "g-cell g-num"));
    cols.forEach(function (f, i) {
      var c = el("div", "g-cell g-sum" + (i === 0 ? " g-pf" : "") + (C.isNumField(ix, f) ? " num" : ""));
      c.style.width = widths[i] + "px";
      c.textContent = sumText(f, shown);
      foot.appendChild(c);
    });
    foot.appendChild(el("div", "g-cell g-addcol"));
    grid.appendChild(foot);

    var add = btn("g-newrow", null, function () { var id = newRecord(); if (id) { sel = { r: id, c: cols[0].id }; paintRows(true); revealSel(); } });
    add.innerHTML = ICON.plus;
    add.appendChild(el("span", null, t("grid.addRow")));
    grid.appendChild(add);

    if (!rows.length) {
      var hint = el("p", "hint g-empty", (ix.tbRecs[v.tb] || []).length ? t("cards.none") : t("table.empty"));
      grid.appendChild(hint);
    }
    box.appendChild(grid);
    gridState.body = body;
    gridState.widths = widths;
    box.scrollTop = keepTop; box.scrollLeft = keepLeft;
    paintRows(true);
  }

  function typeMark(type) {
    return { text: "Aa", long: "¶", number: "#", currency: "€", percent: "%", date: "▦", check: "☑", select: "◉", multi: "☰",
      rating: "★", email: "@", url: "↗", phone: "☎", auto: "№", ctime: "⏱", mtime: "⏱",
      link: "⇄", lookup: "⤷", rollup: "∑", count: "⇄#", formula: "ƒx" }[type] || "?";
  }
  function typeLabel(type) { return C.TYPES.indexOf(type) >= 0 ? t("type." + type) : t("type.other"); }

  function sumText(f, recs) {
    if (!recs.length) return "";
    var s = C.summary(ix, recs, f);
    if (s.checked !== undefined) return t("sum.checked", { n: fmtNum(s.checked) });
    if (s.sum !== undefined && s.filled) return t("sum.sum", { x: f.type === "rating" ? fmtNum(s.sum) : C.show(ix, f, s.sum, fmt()) });
    return s.filled ? t("sum.filled", { n: fmtNum(s.filled) }) : "";
  }

  var paintQueued = false;
  function paintRows(force) {
    if (!gridState) return;
    var box = $("content"), body = gridState.body;
    var bodyTop = body.offsetTop;
    var first = Math.max(0, Math.floor((box.scrollTop - bodyTop) / ROW_H) - 10);
    var count = Math.ceil(box.clientHeight / ROW_H) + 20;
    var last = Math.min(gridState.rows.length, first + count);
    if (!force && gridState.first === first && gridState.last === last) return;
    gridState.first = first; gridState.last = last;
    if (editing) closeEditor(true);
    body.textContent = "";
    for (var i = first; i < last; i++) body.appendChild(rowEl(gridState.rows[i], i));
  }
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(function () { paintQueued = false; paintRows(false); });
  }

  function rowEl(row, i) {
    var cols = gridState.cols, widths = gridState.widths;
    var r = el("div", "g-row");
    r.style.top = (i * ROW_H) + "px";
    r.setAttribute("role", "row");
    if (row.group) {
      r.className = "g-row g-group d" + row.depth;
      var collapsed = (prefs.col[gridState.view.id] || {})[row.path];
      var gb = btn("g-gbtn" + (collapsed ? "" : " open"), null, function () { toggleGroup(row.path); });
      gb.innerHTML = ICON.caret;
      var lab = el("span", "g-glabel");
      lab.appendChild(el("span", "g-gfield", (row.f.name || "") + ": "));
      lab.appendChild(valueNode(row.first, row.f, true) || el("span", "dim", t("f.empty")));
      gb.appendChild(lab);
      gb.appendChild(el("span", "g-gcount", fmtNum(row.count)));
      r.appendChild(gb);
      return r;
    }
    var rec = row.rec;
    r.dataset.rec = rec.id;
    var num = el("div", "g-cell g-num");
    num.appendChild(el("span", "g-n", String(i + 1)));
    num.appendChild(iconBtn(ICON.expand, t("rec.expand"), "g-exp", function () { openRecord(rec.id); }));
    r.appendChild(num);
    cols.forEach(function (f, c) {
      var cell = el("div", "g-cell g-data" + (c === 0 ? " g-pf" : "") + (C.isNumField(ix, f) ? " num" : "") + " t-" + f.type);
      cell.setAttribute("role", "gridcell");
      cell.style.width = widths[c] + "px";
      cell.dataset.f = f.id;
      if (sel && sel.r === rec.id && sel.c === f.id) cell.classList.add("sel");
      var n = valueNode(rec, f, false);
      if (n) cell.appendChild(n);
      r.appendChild(cell);
    });
    r.appendChild(el("div", "g-cell g-addcol"));
    return r;
  }

  function toggleGroup(path) {
    var v = gridState ? gridState.view : curView();
    if (!v) return;
    var m = prefs.col[v.id] = prefs.col[v.id] || {};
    if (m[path]) delete m[path]; else m[path] = 1;
    savePrefs();
    renderContent();
  }

  // The look of one value (grid cells, cards, group headers). Text only.
  function safeHref(s) {
    s = String(s || "").trim();
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) return "https://" + s;
    return "";
  }
  function valueNode(rec, f, plain) {
    var v = C.value(ix, rec, f);
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return null;
    if (f.type === "link") {
      var lw = el("span", "pills");
      v.forEach(function (id) { lw.appendChild(el("span", "pill lnk", recName(id))); });
      return lw;
    }
    if (C.isErr(v)) return el("span", "val err", v);
    if (f.type === "select") {
      var o = C.optOf(f, v);
      return o ? el("span", "pill col-" + o.c, o.n || "—") : null;
    }
    if (f.type === "multi") {
      var w = el("span", "pills");
      v.forEach(function (id) { var o2 = C.optOf(f, id); if (o2) w.appendChild(el("span", "pill col-" + o2.c, o2.n || "—")); });
      return w;
    }
    if (f.type === "check") return el("span", "tick", "✓");
    if (f.type === "rating") {
      var s = el("span", "stars");
      var max = f.opt && f.opt.max || 5;
      for (var i = 1; i <= max; i++) s.appendChild(el("span", i <= v ? "on" : "off", "★"));
      s.setAttribute("aria-label", v + "/" + max);
      return s;
    }
    if (f.type === "url" && !plain) {
      var href = safeHref(v);
      if (href) {
        var a = el("a", "link", v);
        a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
        a.addEventListener("click", function (e) { e.stopPropagation(); });
        return a;
      }
    }
    var txt = C.text(ix, rec, f, fmt());
    if (f.type === "long") txt = txt.split("\n")[0];
    return el("span", "val", txt);
  }

  // the name of a record: its primary field's text
  function recName(id) {
    var r = ix.recs[id];
    var pf = r ? C.primary(ix, r.t) : null;
    return (r && pf && pf.type !== "link" && C.text(ix, r, pf, fmt())) || t("f.untitled");
  }

  // column resize (device-local widths)
  function startResize(e, f, hc, grid) {
    e.preventDefault(); e.stopPropagation();
    var x0 = e.clientX, w0 = hc.getBoundingClientRect().width;
    var target = e.target;
    try { target.setPointerCapture(e.pointerId); } catch (er) {}
    function move(ev) {
      var w = Math.max(60, Math.min(800, Math.round(w0 + ev.clientX - x0)));
      prefs.w[f.id] = w;
      hc.style.width = w + "px";
    }
    function up() {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      savePrefs();
      renderContent();
    }
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  function fieldMenu(f) {
    var v = curView(), tb = curTable();
    var pf = C.primary(ix, tb.id);
    var order = C.visibleFields(ix, v).map(function (x) { return x.id; });
    var at = order.indexOf(f.id);
    function move(dir) {
      var full = C.orderedFields(ix, v).map(function (x) { return x.id; });
      var i = full.indexOf(f.id), j = i + dir;
      if (j < 1 || j >= full.length || i < 1) return;
      var tmp = full[i]; full[i] = full[j]; full[j] = tmp;
      setCfg({ order: full });
    }
    menu(f.name || t("f.untitled"), [
      { label: t("fld.edit"), fn: function () { fieldDialog(f); } },
      { label: t("fld.sortAsc"), fn: function () { setCfg({ sorts: [{ f: f.id, d: 1 }] }); } },
      { label: t("fld.sortDesc"), fn: function () { setCfg({ sorts: [{ f: f.id, d: -1 }] }); } },
      pf && f.id !== pf.id && at > 1 && { label: t("fld.left"), fn: function () { move(-1); } },
      pf && f.id !== pf.id && at < order.length - 1 && { label: t("fld.right"), fn: function () { move(1); } },
      pf && f.id !== pf.id && { label: t("fld.hide"), fn: function () { setCfg({ hidden: v.cfg.hidden.concat([f.id]) }); } },
      pf && f.id !== pf.id && { label: t("fld.del"), danger: true, fn: function () {
        confirmDlg(delFieldText(f), t("btn.delete"), function () { deleteRow(f.id); });
      } }
    ]);
  }

  // selection + keyboard
  function cellAt(recId, fid) {
    if (!gridState) return null;
    var row = gridState.body.querySelector('.g-row[data-rec="' + cssId(recId) + '"]');
    return row ? row.querySelector('.g-data[data-f="' + cssId(fid) + '"]') : null;
  }
  function cssId(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, ""); }
  function select(recId, fid) {
    if (!gridState) return;
    var old = gridState.body.querySelector(".g-data.sel");
    if (old) old.classList.remove("sel");
    sel = { r: recId, c: fid };
    var c = cellAt(recId, fid);
    if (c) c.classList.add("sel");
  }
  function recRows() { return gridState ? gridState.rows.filter(function (r) { return !r.group; }) : []; }
  function rowIndexOf(recId) {
    var rows = gridState.rows;
    for (var i = 0; i < rows.length; i++) if (!rows[i].group && rows[i].rec.id === recId) return i;
    return -1;
  }
  function revealSel() {
    if (!sel || !gridState) return;
    var i = rowIndexOf(sel.r);
    if (i < 0) return;
    var box = $("content"), top = gridState.body.offsetTop + i * ROW_H;
    var headH = 36, footH = 36;
    if (top < box.scrollTop + headH) box.scrollTop = top - headH;
    else if (top + ROW_H > box.scrollTop + box.clientHeight - footH) box.scrollTop = top + ROW_H - box.clientHeight + footH;
    paintRows(false);
    var c = cellAt(sel.r, sel.c);
    if (c) {
      c.classList.add("sel");
      var ci = gridState.cols.map(function (f) { return f.id; }).indexOf(sel.c);
      if (ci > 0) {
        var left = c.offsetLeft, pfw = 48 + gridState.widths[0];
        if (left - pfw < box.scrollLeft) box.scrollLeft = Math.max(0, left - pfw);
        else if (left + c.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = left + c.offsetWidth - box.clientWidth;
      }
    }
  }
  function moveSel(dr, dc) {
    if (!gridState || !gridState.cols.length) return;
    var rows = recRows();
    if (!rows.length) return;
    if (!sel || rowIndexOf(sel.r) < 0) { select(rows[0].rec.id, gridState.cols[0].id); revealSel(); return; }
    var ids = rows.map(function (r) { return r.rec.id; });
    var ri = ids.indexOf(sel.r), ci = gridState.cols.map(function (f) { return f.id; }).indexOf(sel.c);
    if (ci < 0) ci = 0;
    ri = Math.max(0, Math.min(ids.length - 1, ri + dr));
    ci = Math.max(0, Math.min(gridState.cols.length - 1, ci + dc));
    select(ids[ri], gridState.cols[ci].id);
    revealSel();
  }

  function onGridClick(e) {
    if (!gridState) return;
    var cell = e.target.closest && e.target.closest(".g-data");
    if (!cell) return;
    var row = cell.parentNode, recId = row.dataset.rec, fid = cell.dataset.f;
    var f = ix.fields[fid], rec = ix.recs[recId];
    if (!f || !rec) return;
    var wasSel = sel && sel.r === recId && sel.c === fid;
    select(recId, fid);
    $("content").focus({ preventScroll: true });
    if (f.type === "check") { setVal(rec, f, C.value(ix, rec, f) === true ? null : true); return; }
    if (f.type === "rating") {
      var star = e.target.closest(".stars > span");
      if (star) {
        var n = [].indexOf.call(star.parentNode.children, star) + 1;
        setVal(rec, f, C.value(ix, rec, f) === n ? null : n);
        return;
      }
    }
    if (wasSel && e.detail < 2) startEdit();
  }

  function onGridKey(e) {
    if (!gridState || editing || e.target.closest && e.target.closest("dialog")) return;
    if (e.target !== $("content")) return;
    var k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); moveSel(1, 0); }
    else if (k === "ArrowUp") { e.preventDefault(); moveSel(-1, 0); }
    else if (k === "ArrowLeft") { e.preventDefault(); moveSel(0, -1); }
    else if (k === "ArrowRight") { e.preventDefault(); moveSel(0, 1); }
    else if (k === "Tab") { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1); }
    else if (k === "Enter" && sel) {
      e.preventDefault();
      if (e.shiftKey || e.ctrlKey || e.metaKey) openRecord(sel.r); else startEdit();
    }
    else if (k === " " && sel) {
      var f = ix.fields[sel.c], rec = ix.recs[sel.r];
      if (f && rec && f.type === "check") { e.preventDefault(); setVal(rec, f, C.value(ix, rec, f) === true ? null : true); }
      else if (f && rec) { e.preventDefault(); openRecord(sel.r); }
    }
    else if ((k === "Delete" || k === "Backspace") && sel) {
      e.preventDefault();
      var f2 = ix.fields[sel.c], r2 = ix.recs[sel.r];
      if (!f2 || !r2 || C.COMPUTED[f2.type]) return;
      var old = C.value(ix, r2, f2);
      if (old === undefined) return;
      if (f2.type === "link") {
        if (save(C.setLinks(data, f2.id, r2.id, [], Date.now()))) {
          toast(t("lnk.removed"), function () { save(C.setLinks(data, f2.id, r2.id, old, Date.now())); });
        }
        return;
      }
      setVal(r2, f2, null);
      toast(t("cleared"), function () { var o = {}; o[f2.id] = old; save(C.setValues(data, r2.id, o, Date.now())); });
    }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && sel) {
      var f3 = ix.fields[sel.c];
      if (f3 && /^(text|long|number|currency|percent|email|url|phone)$/.test(f3.type)) { e.preventDefault(); startEdit(k); }
      else if (f3 && f3.type === "link") { e.preventDefault(); startEdit(); }
    }
  }

  function setVal(rec, f, v) {
    var p = {};
    p[f.id] = v;
    save(C.setValues(data, rec.id, p, Date.now()));
    revealSel();
  }

  // the in-cell editor
  function startEdit(firstChar) {
    if (!sel || !gridState) return;
    var f = ix.fields[sel.c], rec = ix.recs[sel.r];
    if (!f || !rec) return;
    if (f.type === "link") { linkPicker(rec, f); return; }
    if (C.COMPUTED[f.type]) { toast(t("readOnly")); return; }
    if (C.TYPES.indexOf(f.type) < 0) { openRecord(rec.id); return; }
    if (f.type === "long" || f.type === "multi" || f.type === "check" || f.type === "rating") { openRecord(rec.id, f.id); return; }
    revealSel();
    var cell = cellAt(rec.id, f.id);
    if (!cell) return;
    var inp = editorFor(f, C.value(ix, rec, f));
    if (firstChar !== undefined && inp.tagName === "INPUT" && /^(text|search|email|url|tel)$/.test(inp.type)) inp.value = firstChar;
    cell.textContent = "";
    cell.classList.add("editing");
    cell.appendChild(inp);
    editing = { rec: rec.id, f: f.id, input: inp, cell: cell };
    inp.focus();
    if (firstChar === undefined && inp.select && inp.tagName === "INPUT") try { inp.select(); } catch (er) {}
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); closeEditor(true); moveSel(1, 0); $("content").focus({ preventScroll: true }); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeEditor(false); $("content").focus({ preventScroll: true }); }
      else if (e.key === "Tab") { e.preventDefault(); closeEditor(true); moveSel(0, e.shiftKey ? -1 : 1); $("content").focus({ preventScroll: true }); }
    });
    if (inp.tagName === "SELECT") inp.addEventListener("change", function () { closeEditor(true); $("content").focus({ preventScroll: true }); });
    inp.addEventListener("blur", function () { setTimeout(function () { if (editing && editing.input === inp) closeEditor(true); }, 0); });
  }

  // An input for a value of a field (grid editor and record dialog).
  function editorFor(f, v) {
    var inp;
    if (f.type === "select") {
      inp = el("select");
      var none = el("option", null, "—"); none.value = ""; inp.appendChild(none);
      (f.opt.ch || []).forEach(function (o) { var op = el("option", null, o.n || "—"); op.value = o.id; inp.appendChild(op); });
      inp.value = v || "";
      return inp;
    }
    if (f.type === "long") {
      inp = el("textarea");
      inp.rows = 4;
      inp.value = v || "";
      inp.maxLength = 50000;
      return inp;
    }
    inp = el("input");
    if (f.type === "date") {
      inp.type = f.opt && f.opt.time ? "datetime-local" : "date";
      inp.value = v || "";
      return inp;
    }
    inp.type = { email: "email", url: "url", phone: "tel" }[f.type] || "text";
    if (C.isNumType(f.type)) {
      inp.inputMode = "decimal";
      inp.value = v === undefined ? "" : String(v);
    } else inp.value = v === undefined ? "" : String(v);
    inp.maxLength = 2000;
    inp.autocomplete = "off";
    return inp;
  }
  function readEditor(f, inp) {
    var s = inp.value;
    if (C.isNumType(f.type)) {
      if (!s.trim()) return null;
      var n = C.parseNum(s);
      return n === null ? undefined : n;          // undefined = not valid: keep the old value
    }
    if (f.type === "date") return s ? s : null;
    if (f.type === "select") return s || null;
    return s.trim() ? s : null;
  }

  function closeEditor(commit) {
    if (!editing) return;
    var e = editing;
    editing = null;
    var f = ix.fields[e.f], rec = ix.recs[e.rec];
    if (commit && f && rec) {
      var nv = readEditor(f, e.input);
      if (nv !== undefined) {
        var p = {}; p[f.id] = nv;
        var next = C.setValues(data, rec.id, p, Date.now());
        if (C.serialize(next) !== C.serialize(data)) { save(next); return; }
      }
    }
    if (e.cell && e.cell.isConnected) {
      e.cell.classList.remove("editing");
      e.cell.textContent = "";
      var r2 = ix.recs[e.rec], f2 = ix.fields[e.f];
      var n = r2 && f2 ? valueNode(r2, f2, false) : null;
      if (n) e.cell.appendChild(n);
    }
  }

  // Paste rows of text (a spreadsheet's copy) from the selected cell on.
  function onPaste(e) {
    if (!gridState || editing || !sel) return;
    if (document.activeElement !== $("content")) return;
    var txt = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!txt) return;
    e.preventDefault();
    var lines = txt.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map(function (l) { return l.split("\t"); });
    var rows = recRows().map(function (r) { return r.rec.id; });
    var cols = gridState.cols;
    var ri = rows.indexOf(sel.r), ci = cols.map(function (f) { return f.id; }).indexOf(sel.c);
    if (ri < 0 || ci < 0) return;
    var undo = [], created = [], n = 0, d = data, now = Date.now();
    var need = Math.max(0, ri + lines.length - rows.length);
    if (need && (gridState.view.cfg.groups.length || !roomFor(need))) need = 0;
    for (var k = 0; k < need; k++) {
      var r = C.addRecord(d, cur.table, {}, now + k);
      d = r.data; rows.push(r.id); created.push(r.id);
    }
    var dix = C.index(d), oldLinks = [], missing = 0;
    lines.forEach(function (cells, li) {
      var recId = rows[ri + li];
      if (!recId) return;
      var patch = {}, old = {};
      cells.forEach(function (s, cj) {
        var f = cols[ci + cj];
        if (!f || C.COMPUTED[f.type]) return;
        if (f.type === "link") {
          // names of the other table's records, comma separated
          var pfT = C.primary(dix, f.opt.to), ids = [];
          s.split(/\s*,\s*/).forEach(function (name) {
            var key = C.fold(name.trim());
            if (!key) return;
            var hit = pfT && (dix.tbRecs[f.opt.to] || []).filter(function (r) { return C.fold(C.text(dix, r, pfT).trim()) === key; })[0];
            if (hit) ids.push(hit.id); else missing++;
          });
          oldLinks.push([recId, f.id, (C.value(dix, dix.recs[recId], f) || []).slice()]);
          d = C.setLinks(d, f.id, recId, ids, now);
          n++;
          return;
        }
        var val = C.fromText(f, s);
        old[f.id] = C.value(dix, dix.recs[recId], f);
        patch[f.id] = val === undefined ? null : val;
        n++;
      });
      if (created.indexOf(recId) < 0) undo.push([recId, old]);
      d = C.setValues(d, recId, patch, now);
    });
    if (!save(d)) return;
    toast(t("pasted", { n: fmtNum(n) }) + (missing ? " · " + t("lnk.pasted", { n: fmtNum(missing) }) : ""), function () {
      var u = data, t2 = Date.now();
      oldLinks.forEach(function (x) { u = C.setLinks(u, x[1], x[0], x[2], t2); });
      undo.forEach(function (x) {
        var o = {};
        Object.keys(x[1]).forEach(function (k2) { o[k2] = x[1][k2] === undefined ? null : x[1][k2]; });
        u = C.setValues(u, x[0], o, t2);
      });
      created.forEach(function (id) { u = C.remove(u, id, t2); });
      save(u);
    });
  }

  // ---------- 6. Cards ----------
  var cardLimit = 200;
  function renderCards(v) {
    gridState = null;
    var box = $("content");
    var keep = box.scrollTop;
    box.textContent = "";
    box.className = "content cards-host";
    var fields = C.visibleFields(ix, v);
    var pf = fields[0];
    var rest = fields.slice(1, 7);
    var rows = C.layout(ix, v, shown, prefs.col[v.id] || {});
    var wrap = el("div", "cards");
    var shownN = 0;
    var list = null;
    rows.some(function (row) {
      if (row.group) {
        var collapsed = (prefs.col[v.id] || {})[row.path];
        var gb = btn("c-group d" + row.depth + (collapsed ? "" : " open"), null, function () { toggleGroup(row.path); });
        var caret = el("span", "c-caret"); caret.innerHTML = ICON.caret; gb.appendChild(caret);
        gb.appendChild(el("span", "g-gfield", (row.f.name || "") + ": "));
        gb.appendChild(valueNode(row.first, row.f, true) || el("span", "dim", t("f.empty")));
        gb.appendChild(el("span", "g-gcount", fmtNum(row.count)));
        wrap.appendChild(gb);
        list = null;
        return false;
      }
      if (shownN >= cardLimit) return true;
      shownN++;
      if (!list) { list = el("ul", "c-list"); wrap.appendChild(list); }
      var rec = row.rec;
      var li = el("li");
      var card = btn("card-rec", null, function () { openRecord(rec.id); });
      var title = pf ? C.text(ix, rec, pf, fmt()) : "";
      card.appendChild(el("span", "c-title" + (title ? "" : " dim"), title || t("f.untitled")));
      var dl = el("span", "c-fields");
      rest.forEach(function (f) {
        var n = valueNode(rec, f, true);
        if (!n) return;
        var line = el("span", "c-line");
        line.appendChild(el("span", "c-label", f.name));
        line.appendChild(n);
        dl.appendChild(line);
      });
      card.appendChild(dl);
      li.appendChild(card);
      list.appendChild(li);
      return false;
    });
    var total = rows.filter(function (r) { return !r.group; }).length;
    if (total > shownN) {
      wrap.appendChild(btn("chip c-more", t("cards.more", { n: fmtNum(Math.min(200, total - shownN)) }), function () { cardLimit += 200; renderContent(); }));
    }
    if (!rows.length) wrap.appendChild(el("p", "hint", (ix.tbRecs[v.tb] || []).length ? t("cards.none") : t("table.empty")));
    box.appendChild(wrap);
    box.scrollTop = keep;
  }

  // ---------- 7. Record dialog ----------
  var recDlg = null;       // { id, d, focus }
  function openRecord(id, focusField) {
    closeEditor(true);
    var rec = ix.recs[id];
    if (!rec) { toast(t("notFound")); return; }
    if (recDlg) recDlg.d.close();
    var d = dialog(t("rec.title"), "rec");
    recDlg = { id: id, d: d };
    d.onclose(function () { if (recDlg && recDlg.d === d) recDlg = null; renderContent(); });
    fillRecord(focusField);
    d.open();
    var focusEl = focusField && d.body.querySelector('[data-f="' + cssId(focusField) + '"]');
    if (focusEl) focusEl.focus();
  }
  function refreshOpenRecord() {
    if (!recDlg) return;
    if (!ix.recs[recDlg.id]) { recDlg.d.close(); return; }
    var a = document.activeElement;
    if (a && recDlg.d.node.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;   // do not pull the field away from the typist
    fillRecord();
  }
  function fillRecord(focusField) {
    var d = recDlg.d, rec = ix.recs[recDlg.id];
    var tb = ix.tables[rec.t];
    var v = curView();
    var fields = v && v.tb === rec.t ? C.orderedFields(ix, v) : (ix.tbFields[rec.t] || []);
    var pf = C.primary(ix, rec.t);
    d.title.textContent = (pf && C.text(ix, rec, pf, fmt())) || t("f.untitled");
    d.body.textContent = "";
    fields.forEach(function (f) {
      var wrap = el("div", "fld rec-fld t-" + f.type);
      var lab = el("span", "rec-label");
      lab.appendChild(el("span", "g-type", typeMark(f.type)));
      lab.appendChild(document.createTextNode(" " + (f.name || t("f.untitled"))));
      wrap.appendChild(lab);
      if (f.opt && f.opt.desc) wrap.appendChild(el("span", "hint", f.opt.desc));
      wrap.appendChild(recEditor(rec, f));
      d.body.appendChild(wrap);
    });
    var meta = el("p", "hint rec-meta",
      t("rec.created", { x: C.text(ix, rec, { id: "c", type: "ctime", opt: {} }, fmt()) }) + " · " +
      t("rec.modified", { x: C.text(ix, rec, { id: "m", type: "mtime", opt: {} }, fmt()) }));
    d.body.appendChild(meta);
    var idx = shown.map(function (r) { return r.id; }).indexOf(rec.id);
    var prev = iconBtn(ICON.left, t("rec.prev"), "", function () { if (idx > 0) { recDlg.id = shown[idx - 1].id; fillRecord(); } });
    var next = iconBtn(ICON.right, t("rec.next"), "", function () { if (idx >= 0 && idx < shown.length - 1) { recDlg.id = shown[idx + 1].id; fillRecord(); } });
    prev.disabled = idx <= 0; next.disabled = idx < 0 || idx >= shown.length - 1;
    d.foot(prev, next, el("span", "spacer"),
      btn("chip danger", t("btn.delete"), function () {
        var id = rec.id;
        d.close();
        deleteRow(id, t("deleted.rec"));
      }),
      btn("chip", t("rec.dup"), function () {
        if (!roomFor(1)) return;
        var vals = {};
        Object.keys(rec.v).forEach(function (k) { vals[k] = rec.v[k]; });
        var now = Date.now();
        var r = C.addRecord(data, rec.t, vals, now);
        if (save(C.copyLinks(r.data, rec.id, r.id, now))) { recDlg.id = r.id; fillRecord(); toast(t("dup.done")); }
      }),
      btn("chip pri", t("btn.done"), function () { d.close(); }));
    void tb;
    void focusField;
  }
  function recEditor(rec, f) {
    var v = C.value(ix, rec, f);
    function put(val) {
      var p = {}; p[f.id] = val;
      var next = C.setValues(data, rec.id, p, Date.now());
      if (C.serialize(next) !== C.serialize(data)) save(next, { quiet: true });
    }
    if (f.type === "link") return linkEditor(rec, f);
    if (C.COMPUTED[f.type] || C.TYPES.indexOf(f.type) < 0) {
      var ro = el("div", "rec-ro");
      var n = valueNode(rec, f, true);
      ro.appendChild(n || el("span", "dim", "—"));
      ro.title = t("rec.computed");
      return ro;
    }
    if (f.type === "check") {
      var lab = el("label", "opt");
      var cb = el("input"); cb.type = "checkbox"; cb.checked = v === true; cb.dataset.f = f.id;
      cb.addEventListener("change", function () { put(cb.checked ? true : null); });
      lab.appendChild(cb);
      lab.appendChild(el("span", null, f.name));
      return lab;
    }
    if (f.type === "rating") {
      var max = f.opt && f.opt.max || 5;
      var box = el("div", "rate");
      box.setAttribute("role", "radiogroup");
      box.setAttribute("aria-label", f.name);
      for (var i = 1; i <= max; i++) (function (n) {
        var b = btn("star" + (v >= n ? " on" : ""), "★", function () {
          var cur2 = C.value(ix, ix.recs[rec.id], f);
          var nv = cur2 === n ? null : n;
          put(nv);
          [].forEach.call(box.children, function (c, k) { c.classList.toggle("on", nv !== null && k < nv); });
        });
        b.setAttribute("aria-label", n + "/" + max);
        if (n === 1) b.dataset.f = f.id;
        box.appendChild(b);
      })(i);
      return box;
    }
    if (f.type === "multi") {
      var mb = el("div", "multi-box");
      (f.opt.ch || []).forEach(function (o, k) {
        var l2 = el("label", "pill-opt col-" + o.c);
        var c2 = el("input"); c2.type = "checkbox"; c2.checked = Array.isArray(v) && v.indexOf(o.id) >= 0;
        if (k === 0) c2.dataset.f = f.id;
        c2.addEventListener("change", function () {
          var curV = C.value(ix, ix.recs[rec.id], f) || [];
          var nv2 = curV.filter(function (x) { return x !== o.id; });
          if (c2.checked) nv2.push(o.id);
          put(nv2.length ? nv2 : null);
        });
        l2.appendChild(c2);
        l2.appendChild(el("span", null, o.n || "—"));
        mb.appendChild(l2);
      });
      if (!(f.opt.ch || []).length) mb.appendChild(el("span", "hint", t("fld.choices") + ": —"));
      return mb;
    }
    var inp = editorFor(f, v);
    inp.dataset.f = f.id;
    var timer = 0;
    function commit() {
      clearTimeout(timer);
      var nv = readEditor(f, inp);
      if (nv !== undefined) put(nv);
    }
    if (inp.tagName === "SELECT" || inp.type === "date" || inp.type === "datetime-local") inp.addEventListener("change", commit);
    else {
      inp.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(commit, 500); });
      inp.addEventListener("blur", commit);
      inp.addEventListener("change", commit);
    }
    if ((f.type === "url" || f.type === "email") && v) {
      var wrap = el("div", "with-link");
      wrap.appendChild(inp);
      var href = f.type === "email" ? "mailto:" + v : safeHref(v);
      if (href) {
        var a = el("a", "icon-btn"); a.innerHTML = ICON.expand; a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
        a.setAttribute("aria-label", v); a.title = v;
        wrap.appendChild(a);
      }
      return wrap;
    }
    return inp;
  }

  // ---------- 7b. Links: the record's chips and the picker ----------
  function linkEditor(rec, f) {
    var box = el("div", "link-box");
    if (!ix.tables[f.opt.to]) { box.appendChild(el("span", "hint", t("lnk.gone"))); return box; }
    var cur = C.value(ix, rec, f) || [];
    var ul = el("ul", "link-list");
    cur.forEach(function (id) {
      var li = el("li", "pill lnk");
      var name = recName(id);
      li.appendChild(btn("lnk-open", name, function () { openRecord(id); }));
      li.appendChild(iconBtn(ICON.x, t("lnk.unlink", { x: name }), "lnk-x", function () {
        var now2 = Date.now(), list = (C.value(ix, ix.recs[rec.id], f) || []).filter(function (x) { return x !== id; });
        save(C.setLinks(data, f.id, rec.id, list, now2), { quiet: true });
        refreshOpenRecord();
      }));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    var add = btn("chip small", t("lnk.add"), function () { linkPicker(ix.recs[rec.id], f); });
    add.dataset.f = f.id;
    if (f.opt.one && cur.length) add.hidden = true;
    box.appendChild(add);
    return box;
  }
  // Pick the records a record links to. Each tap links or unlinks at once.
  var PICK_MAX = 100;
  function linkPicker(rec, f) {
    var tbT = ix.tables[f.opt.to];
    if (!rec || !tbT) { toast(t("lnk.gone")); return; }
    var d = dialog(t("lnk.title"), "picker");
    var q = input("search", "");
    q.placeholder = t("lnk.search", { x: tbT.name });
    q.setAttribute("aria-label", q.placeholder);
    d.body.appendChild(q);
    var list = el("ul", "pick-list");
    d.body.appendChild(list);
    var note = el("p", "hint");
    d.body.appendChild(note);
    function paint() {
      var r = ix.recs[rec.id];
      if (!r) { d.close(); return; }
      var cur = C.value(ix, r, f) || [];
      var key = C.fold(q.value.trim());
      var all = (ix.tbRecs[f.opt.to] || []).filter(function (x) { return !(f.opt.inv === f.id && x.id === r.id); });
      var hits = key ? all.filter(function (x) { return C.fold(recName(x.id)).indexOf(key) >= 0; }) : all;
      // linked first, then the rest in the table's order
      hits = hits.filter(function (x) { return cur.indexOf(x.id) >= 0; }).concat(hits.filter(function (x) { return cur.indexOf(x.id) < 0; }));
      list.textContent = "";
      hits.slice(0, PICK_MAX).forEach(function (x) {
        var on = cur.indexOf(x.id) >= 0;
        var li = el("li");
        var b = btn("pick" + (on ? " on" : ""), recName(x.id), function () {
          var now = Date.now(), now0 = C.value(ix, ix.recs[rec.id], f) || [];
          var next = now0.indexOf(x.id) >= 0 ? now0.filter(function (y) { return y !== x.id; }) : f.opt.one ? [x.id] : now0.concat([x.id]);
          save(C.setLinks(data, f.id, rec.id, next, now), { quiet: true });
          if (f.opt.one && next.length) { d.close(); return; }
          paint();
        });
        b.setAttribute("aria-pressed", on ? "true" : "false");
        li.appendChild(b);
        list.appendChild(li);
      });
      note.textContent = !hits.length ? t("lnk.none") : hits.length > PICK_MAX ? t("lnk.more", { n: fmtNum(PICK_MAX) }) : "";
      var exact = key && all.some(function (x) { return C.fold(recName(x.id)) === key; });
      newBtn.hidden = !key || exact;
      newBtn.textContent = t("lnk.new", { x: q.value.trim() });
    }
    var newBtn = btn("chip small", "", function () {
      var name = q.value.trim();
      var pfT = C.primary(ix, f.opt.to);
      if (!name || !roomFor(1)) return;
      var vals = {};
      if (pfT && !C.NOSTORE[pfT.type]) vals[pfT.id] = name;
      var now = Date.now();
      var made = C.addRecord(data, f.opt.to, vals, now);
      var cur = C.value(ix, ix.recs[rec.id], f) || [];
      if (save(C.setLinks(made.data, f.id, rec.id, f.opt.one ? [made.id] : cur.concat([made.id]), now + 1), { quiet: true })) {
        q.value = "";
        if (f.opt.one) { d.close(); return; }
        paint();
      }
    });
    newBtn.hidden = true;
    d.body.insertBefore(newBtn, note);
    var tm = 0;
    q.addEventListener("input", function () { clearTimeout(tm); tm = setTimeout(paint, 150); });
    d.onclose(function () { renderContent(); refreshOpenRecord(); });
    d.foot(btn("chip pri", t("btn.done"), function () { d.close(); }));
    paint();
    d.open();
    q.focus();
  }

  // ---------- 8. Field dialog ----------
  function fieldDialog(f) {
    var tb = curTable();
    if (!tb) return;
    var list = ix.tbFields[tb.id] || [];
    if (!f && list.length >= C.MAX_FIELDS) { toast(t("fld.tooMany", { n: C.MAX_FIELDS })); return; }
    var d = dialog(f ? t("fld.edit") : t("fld.new"));
    var name = input("text", f ? f.name : t("fld.defName", { n: list.length + 1 }));
    d.body.appendChild(fld(t("fld.name"), name));
    var type = el("select");
    C.TYPES.forEach(function (k) { var o = el("option", null, t("type." + k)); o.value = k; type.appendChild(o); });
    if (f && C.TYPES.indexOf(f.type) < 0) { var o2 = el("option", null, t("type.other")); o2.value = f.type; type.appendChild(o2); }
    type.value = f ? f.type : "text";
    var pf = C.primary(ix, tb.id);
    if (f && pf && pf.id === f.id) {
      // the primary field names records: keep it a kind of text
      [].forEach.call(type.options, function (o) { if (!/^(text|long|email|url|phone|number|auto|date|formula)$/.test(o.value)) o.disabled = true; });
    }
    // a link field keeps its type, and an existing field does not become one
    if (f && f.type === "link") type.disabled = true;
    else if (f) [].forEach.call(type.options, function (o) { if (o.value === "link") o.disabled = true; });
    d.body.appendChild(fld(t("fld.type"), type));
    if (f && f.type === "link") d.body.appendChild(el("p", "hint", t("fld.typeLocked")));
    var optBox = el("div", "opt-box");
    d.body.appendChild(optBox);
    var desc = el("textarea"); desc.rows = 2; desc.maxLength = 1000; desc.value = f && f.opt.desc || "";
    var opt = JSON.parse(JSON.stringify(f ? f.opt : {}));
    var links = list.filter(function (x) { return x.type === "link" && ix.tables[x.opt.to]; });
    var exprBox = null;                          // the formula as people write it
    if (f && f.type === "formula") exprBox = C.exprNames(ix, tb.id, f.opt.expr);
    function decSelect(cur, set) {
      var s2 = el("select");
      var a0 = el("option", null, t("fld.decAuto")); a0.value = ""; s2.appendChild(a0);
      for (var k = 0; k <= 8; k++) { var ok = el("option", null, String(k)); ok.value = String(k); s2.appendChild(ok); }
      s2.value = typeof cur === "number" ? String(cur) : "";
      s2.addEventListener("change", function () { set(s2.value === "" ? undefined : +s2.value); });
      return fld(t("fld.dec"), s2);
    }
    function paintOpts() {
      optBox.textContent = "";
      var ty = type.value;
      if (ty === "link") {
        var others = ix.baseTables[tb.base] || [];
        if (!f) {
          var to = el("select");
          others.forEach(function (x) { var o4 = el("option", null, x.name || t("f.untitled")); o4.value = x.id; to.appendChild(o4); });
          if (!opt.to || !ix.tables[opt.to]) opt.to = (others.filter(function (x) { return x.id !== tb.id; })[0] || tb).id;
          to.value = opt.to;
          to.addEventListener("change", function () { opt.to = to.value; paintOpts(); });
          optBox.appendChild(fld(t("fld.linkTo"), to));
        }
        var l1 = el("label", "opt");
        var one = el("input"); one.type = "checkbox"; one.checked = opt.one === true;
        one.addEventListener("change", function () { if (one.checked) opt.one = true; else delete opt.one; });
        l1.appendChild(one); l1.appendChild(el("span", null, t("fld.linkOne")));
        optBox.appendChild(l1);
        var toT = ix.tables[opt.to];
        if (toT && opt.to === tb.id) optBox.appendChild(el("p", "hint", t("fld.linkSelf")));
        else if (toT) {
          var inv = f ? ix.fields[f.opt.inv] : null;
          optBox.appendChild(el("p", "hint", t("fld.linkHint", { x: inv ? inv.name : invName(tb, toT), z: toT.name })));
        }
      } else if (ty === "lookup" || ty === "rollup" || ty === "count") {
        if (!links.length) { optBox.appendChild(el("p", "hint", t("fld.noLink"))); return; }
        if (!links.some(function (x) { return x.id === opt.via; })) opt.via = links[0].id;
        var via = fieldSelect(links, opt.via);
        via.addEventListener("change", function () { opt.via = via.value; delete opt.f; paintOpts(); });
        optBox.appendChild(fld(t("fld.via"), via));
        if (ty === "count") return;
        var far = (ix.tbFields[ix.fields[opt.via].opt.to] || []).filter(function (x) { return x.id !== opt.via && x.id !== ix.fields[opt.via].opt.inv; });
        if (!far.length) return;
        if (!far.some(function (x) { return x.id === opt.f; })) {
          // a rollup starts on the first field with numbers
          var numF = ty === "rollup" ? far.filter(function (x) { return C.isNumField(ix, x); })[0] : null;
          opt.f = (numF || far[0]).id;
        }
        var from = fieldSelect(far, opt.f);
        from.addEventListener("change", function () { opt.f = from.value; });
        optBox.appendChild(fld(t("fld.from"), from));
        if (ty === "rollup") {
          var fn = el("select");
          C.ROLL_FNS.forEach(function (k) { var o5 = el("option", null, t("fn." + k)); o5.value = k; fn.appendChild(o5); });
          fn.value = opt.fn || "SUM";
          opt.fn = fn.value;
          fn.addEventListener("change", function () { opt.fn = fn.value; });
          optBox.appendChild(fld(t("fld.fn"), fn));
          optBox.appendChild(decSelect(opt.dec, function (v) { if (v === undefined) delete opt.dec; else opt.dec = v; }));
        }
      } else if (ty === "formula") {
        var ta = el("textarea", "expr");
        ta.rows = 3; ta.maxLength = C.MAX_EXPR; ta.spellcheck = false;
        ta.value = exprBox || "";
        ta.setAttribute("dir", "ltr");
        var preview = el("p", "hint expr-out");
        var ins = el("select");
        var i0 = el("option", null, t("fld.insert")); i0.value = ""; ins.appendChild(i0);
        list.forEach(function (x) { if (!f || x.id !== f.id) { var o6 = el("option", null, x.name); o6.value = x.id; ins.appendChild(o6); } });
        ins.setAttribute("aria-label", t("fld.insert"));
        ins.addEventListener("change", function () {
          var x = ix.fields[ins.value];
          ins.value = "";
          if (!x) return;
          var token = "{" + x.name.replace(/[\\}]/g, "\\$&") + "}";
          var a = ta.selectionStart, b = ta.selectionEnd;
          ta.value = ta.value.slice(0, a) + token + ta.value.slice(b);
          ta.focus();
          ta.selectionStart = ta.selectionEnd = a + token.length;
          exprBox = ta.value; preview2();
        });
        var tmF = 0;
        function preview2() {
          var r = C.exprIds(ix, tb.id, ta.value);
          if (r.bad !== undefined) { preview.textContent = t("fld.exprBad", { x: r.bad }); return; }
          var first = (ix.tbRecs[tb.id] || [])[0];
          if (!first) { preview.textContent = ""; return; }
          var tmp = C.putRow(data, "fields", { id: f ? f.id : "fpreview", tb: tb.id, name: name.value || "x", type: "formula", ord: f ? f.ord : 1e8, opt: Object.assign({}, opt, { expr: r.expr }) }, Date.now());
          var tix = C.index(tmp);
          var tf = tix.fields[f ? f.id : "fpreview"];
          preview.textContent = t("fld.preview", { x: (tf && tix.recs[first.id] && C.text(tix, tix.recs[first.id], tf, fmt())) || "—" });
        }
        ta.addEventListener("input", function () { exprBox = ta.value; clearTimeout(tmF); tmF = setTimeout(preview2, 300); });
        optBox.appendChild(fld(t("fld.expr"), ta));
        optBox.appendChild(el("p", "hint", t("fld.exprHint")));
        optBox.appendChild(ins);
        optBox.appendChild(preview);
        optBox.appendChild(decSelect(opt.dec, function (v) { if (v === undefined) delete opt.dec; else opt.dec = v; preview2(); }));
        var l2 = el("label", "opt");
        var asD = el("input"); asD.type = "checkbox"; asD.checked = opt.as === "date";
        asD.addEventListener("change", function () { if (asD.checked) opt.as = "date"; else delete opt.as; preview2(); });
        l2.appendChild(asD); l2.appendChild(el("span", null, t("fld.asDate")));
        optBox.appendChild(l2);
        preview2();
      } else if (ty === "number" || ty === "currency" || ty === "percent") {
        var dec = input("number", String(typeof opt.dec === "number" ? opt.dec : ty === "currency" ? 2 : 0));
        dec.min = 0; dec.max = 8;
        dec.addEventListener("input", function () { opt.dec = Math.max(0, Math.min(8, parseInt(dec.value, 10) || 0)); });
        optBox.appendChild(fld(t("fld.dec"), dec));
        if (ty === "currency") {
          var sym = input("text", opt.sym || "€"); sym.maxLength = 6;
          sym.addEventListener("input", function () { opt.sym = sym.value; });
          optBox.appendChild(fld(t("fld.sym"), sym));
        }
      } else if (ty === "date") {
        var l = el("label", "opt");
        var cb = el("input"); cb.type = "checkbox"; cb.checked = opt.time === true;
        cb.addEventListener("change", function () { opt.time = cb.checked; });
        l.appendChild(cb); l.appendChild(el("span", null, t("fld.time")));
        optBox.appendChild(l);
      } else if (ty === "rating") {
        var mx = el("select");
        for (var i = 3; i <= 10; i++) { var o = el("option", null, String(i)); o.value = String(i); mx.appendChild(o); }
        mx.value = String(opt.max || 5);
        mx.addEventListener("change", function () { opt.max = +mx.value; });
        optBox.appendChild(fld(t("fld.max"), mx));
      } else if (ty === "select" || ty === "multi") {
        if (!Array.isArray(opt.ch)) opt.ch = [];
        var fs = el("fieldset");
        fs.appendChild(el("legend", null, t("fld.choices")));
        var ul = el("ul", "opt-list");
        opt.ch.forEach(function (c, k) {
          var li = el("li");
          var nm = input("text", c.n); nm.maxLength = 120;
          nm.setAttribute("aria-label", t("fld.choiceN", { n: k + 1 }));
          nm.addEventListener("input", function () { c.n = nm.value; });
          var col = el("select", "col-sel");
          col.setAttribute("aria-label", t("fld.colour"));
          C.COLORS.forEach(function (cc) { var o3 = el("option", null, t("col." + cc)); o3.value = cc; col.appendChild(o3); });
          col.value = c.c;
          col.className = "col-sel col-" + c.c;
          col.addEventListener("change", function () { c.c = col.value; col.className = "col-sel col-" + c.c; });
          li.appendChild(nm); li.appendChild(col);
          li.appendChild(iconBtn(ICON.x, t("btn.delete"), "danger", function () { opt.ch.splice(k, 1); paintOpts(); }));
          ul.appendChild(li);
        });
        fs.appendChild(ul);
        var add = btn("chip small", t("fld.addChoice"), function () {
          if (opt.ch.length >= C.MAX_OPTS) return;
          opt.ch.push({ id: C.oid(), n: "", c: C.COLORS[opt.ch.length % C.COLORS.length] });
          paintOpts();
          var last = optBox.querySelectorAll(".opt-list input");
          if (last.length) last[last.length - 1].focus();
        });
        fs.appendChild(add);
        optBox.appendChild(fs);
      }
    }
    type.addEventListener("change", paintOpts);
    paintOpts();
    d.body.appendChild(fld(t("fld.desc"), desc));
    var buttons = [];
    if (f && (!pf || pf.id !== f.id)) {
      buttons.push(btn("chip danger", t("fld.del"), function () {
        d.close();
        confirmDlg(delFieldText(f), t("btn.delete"), function () { deleteRow(f.id); });
      }));
      buttons.push(el("span", "spacer"));
    }
    buttons.push(btn("chip", t("btn.cancel"), function () { d.close(); }));
    buttons.push(btn("chip pri", t("btn.save"), function () {
      var nm = name.value.trim() || (f ? f.name : t("fld.defName", { n: list.length + 1 }));
      var clash = list.some(function (x) { return (!f || x.id !== f.id) && C.fold(x.name) === C.fold(nm); });
      if (clash) { toast(t("fld.nameTaken")); name.focus(); return; }
      if (opt.ch) opt.ch = opt.ch.filter(function (c) { return c.n.trim(); });
      if (desc.value.trim()) opt.desc = desc.value; else delete opt.desc;
      var now = Date.now(), ty = type.value;
      if ((ty === "lookup" || ty === "rollup" || ty === "count") && (!opt.via || (ty !== "count" && !opt.f))) { toast(t("fld.noLink")); return; }
      if (ty === "formula") {
        var ex = C.exprIds(ix, tb.id, exprBox || "");
        if (ex.bad !== undefined) { toast(t("fld.exprBad", { x: ex.bad })); return; }
        opt.expr = ex.expr;
      }
      if (!f && ty === "link") {
        var toT = ix.tables[opt.to];
        if (!toT) return;
        if (toT.id !== tb.id && (ix.tbFields[toT.id] || []).length >= C.MAX_FIELDS) { toast(t("fld.tooMany", { n: C.MAX_FIELDS })); return; }
        d.close();
        save(C.addLinkField(data, tb.id, nm, toT.id, now, invName(tb, toT), null, opt.one === true));
        return;
      }
      if (!f) {
        d.close();
        var nd = C.addField(data, tb.id, nm, ty, opt, now);
        save(nd);
        return;
      }
      if (type.value !== f.type) {
        var r = C.convert(data, f.id, type.value, opt, now);
        r.data = C.putRow(r.data, "fields", Object.assign({}, C.index(r.data).fields[f.id], { name: nm }), now);
        d.close();
        if (r.lost) confirmDlg(t("fld.lost", { n: fmtNum(r.lost) }), t("btn.ok"), function () { applyConvert(r.data); });
        else applyConvert(r.data);
        return;
      }
      d.close();
      save(C.putRow(data, "fields", Object.assign({}, f, { name: nm, opt: opt }), now));
    }));
    d.foot.apply(null, buttons);
    d.open();
    if (!f) name.select();
  }
  // the name of a link field's other side: the table's name, made unique there
  function invName(tb, toT) {
    var names = (ix.tbFields[toT.id] || []).map(function (x) { return C.fold(x.name); });
    var base = tb.name || t("f.untitled"), nm = base, k = 2;
    while (names.indexOf(C.fold(nm)) >= 0) nm = base + " " + k++;
    return nm;
  }
  function delFieldText(f) {
    var inv = f.type === "link" && f.opt.inv !== f.id ? ix.fields[f.opt.inv] : null;
    if (inv) return t("del.linkField", { x: f.name, y: inv.name, z: (ix.tables[inv.tb] || {}).name || "" });
    return t("del.field", { x: f.name });
  }
  function applyConvert(next) {
    var before = data;
    if (save(next)) toast(t("fld.conv"), function () {
      // Undo: the old field and values come back with fresh times
      var rows = [];
      before.fields.forEach(function (x) { rows.push({ kind: "fields", row: x }); });
      before.recs.forEach(function (x) { rows.push({ kind: "recs", row: x }); });
      save(C.restore(data, rows.filter(function (r) {
        var cur2 = r.kind === "fields" ? ix.fields[r.row.id] : ix.recs[r.row.id];
        return cur2 && C.canon(cur2) !== C.canon(r.row);
      }), Date.now()));
    });
  }

  // ---------- 9. Filter, sort, group, fields dialogs ----------
  function opLabel(type, op) {
    if (C.isNumType(type)) return t({ eq: "op.neq", ne: "op.nne" }[op] || "op." + op);
    if (C.isDateType(type)) return t(op === "eq" ? "op.deq" : "op." + op);
    if (type === "multi") return t({ has: "op.mhas", hasnot: "op.mhasnot" }[op] || "op." + op);
    return t("op." + op);
  }
  // a field's kind as the B1 type name the filter menu speaks
  function kt(f) {
    var k = C.kindOf(ix, f);
    return { num: "number", date: "date", stamp: "ctime", list: "text", text: "text" }[k] || k;
  }
  function fieldSelect(fields, val) {
    var s = el("select");
    fields.forEach(function (f) { var o = el("option", null, f.name || t("f.untitled")); o.value = f.id; s.appendChild(o); });
    if (val) s.value = val;
    return s;
  }
  function filterDialog() {
    var v = curView();
    if (!v) return;
    var fields = ix.tbFields[v.tb] || [];
    var d = dialog(t("flt.title"));
    var conds = v.cfg.filters.filter(function (c) { return ix.fields[c.f]; }).map(function (c) { return JSON.parse(JSON.stringify(c)); });
    var conj = v.cfg.conj;
    function commit() { setCfg({ filters: conds, conj: conj }); }
    function paint() {
      d.body.textContent = "";
      var cj = el("select");
      [["and", "flt.all"], ["or", "flt.any"]].forEach(function (x) { var o = el("option", null, t(x[1])); o.value = x[0]; cj.appendChild(o); });
      cj.value = conj;
      cj.addEventListener("change", function () { conj = cj.value; commit(); });
      d.body.appendChild(cj);
      if (!conds.length) d.body.appendChild(el("p", "hint", t("flt.none")));
      conds.forEach(function (c, i) {
        var row = el("div", "cond");
        var f = ix.fields[c.f];
        var fs = fieldSelect(fields, c.f);
        fs.addEventListener("change", function () {
          var nf = ix.fields[fs.value];
          conds[i] = { f: nf.id, op: C.opsFor(kt(nf))[0] };
          commit(); paint();
        });
        var ops = el("select");
        C.opsFor(kt(f)).filter(function (op) { return op !== "any" && op !== "none"; }).forEach(function (op) {
          var o = el("option", null, opLabel(kt(f), op)); o.value = op; ops.appendChild(o);
        });
        ops.value = c.op;
        ops.addEventListener("change", function () { c.op = ops.value; if (!C.needsValue(c.op)) delete c.v; commit(); paint(); });
        row.appendChild(fs); row.appendChild(ops);
        if (C.needsValue(c.op)) {
          var w;
          if (f.type === "select" || f.type === "multi") {
            w = el("select");
            var none = el("option", null, "—"); none.value = ""; w.appendChild(none);
            (f.opt.ch || []).forEach(function (o) { var op2 = el("option", null, o.n || "—"); op2.value = o.id; w.appendChild(op2); });
            w.value = c.v || "";
            w.addEventListener("change", function () { if (w.value) c.v = w.value; else delete c.v; commit(); });
          } else if (C.isDateType(kt(f))) {
            w = input("date", c.v || "");
            w.addEventListener("change", function () { if (w.value) c.v = w.value; else delete c.v; commit(); });
          } else {
            w = input("text", c.v === undefined ? "" : String(c.v));
            if (C.isNumType(kt(f))) w.inputMode = "decimal";
            var tm = 0;
            w.addEventListener("input", function () {
              clearTimeout(tm);
              tm = setTimeout(function () {
                var s = w.value;
                if (!s.trim()) delete c.v;
                else if (C.isNumType(kt(f))) { var n = C.parseNum(s); if (n === null) return; c.v = n; }
                else c.v = s;
                commit();
              }, 300);
            });
          }
          w.setAttribute("aria-label", t("flt.value"));
          row.appendChild(w);
        }
        row.appendChild(iconBtn(ICON.x, t("flt.remove"), "danger", function () { conds.splice(i, 1); commit(); paint(); }));
        d.body.appendChild(row);
      });
      if (fields.length && conds.length < 30) d.body.appendChild(btn("chip small", t("flt.add"), function () {
        var f0 = fields[0];
        conds.push({ f: f0.id, op: C.opsFor(kt(f0))[0] });
        commit(); paint();
      }));
    }
    paint();
    d.foot(btn("chip pri", t("btn.done"), function () { d.close(); }));
    d.open();
  }

  function orderDialog(kind) {
    var v = curView();
    if (!v) return;
    var fields = (ix.tbFields[v.tb] || []).filter(function (f) { return kind === "sorts" || f.type !== "long"; });
    var d = dialog(t(kind === "sorts" ? "srt.title" : "grp.title"));
    var list = v.cfg[kind].filter(function (s) { return ix.fields[s.f]; }).map(function (s) { return { f: s.f, d: s.d }; });
    var max = kind === "sorts" ? 5 : 3;
    function commit() { var p = {}; p[kind] = list; setCfg(p); }
    function paint() {
      d.body.textContent = "";
      if (!list.length) d.body.appendChild(el("p", "hint", t(kind === "sorts" ? "srt.none" : "grp.none")));
      list.forEach(function (s, i) {
        var row = el("div", "cond");
        var fs = fieldSelect(fields, s.f);
        fs.addEventListener("change", function () { s.f = fs.value; commit(); });
        var dir = el("select");
        [[1, "srt.asc"], [-1, "srt.desc"]].forEach(function (x) { var o = el("option", null, t(x[1])); o.value = String(x[0]); dir.appendChild(o); });
        dir.value = String(s.d);
        dir.addEventListener("change", function () { s.d = +dir.value; commit(); });
        row.appendChild(fs); row.appendChild(dir);
        row.appendChild(iconBtn(ICON.x, t("flt.remove"), "danger", function () { list.splice(i, 1); commit(); paint(); }));
        d.body.appendChild(row);
      });
      if (list.length < max && fields.length) d.body.appendChild(btn("chip small", t(kind === "sorts" ? "srt.add" : "grp.add"), function () {
        var used = {}; list.forEach(function (s) { used[s.f] = 1; });
        var f = fields.filter(function (x) { return !used[x.id]; })[0];
        if (!f) return;
        list.push({ f: f.id, d: 1 }); commit(); paint();
      }));
    }
    paint();
    d.foot(btn("chip pri", t("btn.done"), function () { d.close(); }));
    d.open();
  }

  function fieldsDialog() {
    var v = curView();
    if (!v) return;
    var d = dialog(t("fl.title"));
    var pf = C.primary(ix, v.tb);
    function paint() {
      var vv = ix.views[v.id];
      d.body.textContent = "";
      d.body.appendChild(el("p", "hint", t("fl.hint")));
      var all = C.orderedFields(ix, vv);
      var hid = {}; vv.cfg.hidden.forEach(function (id) { hid[id] = 1; });
      var ul = el("ul", "fl-list");
      all.forEach(function (f, i) {
        var li = el("li");
        var l = el("label", "opt");
        var cb = el("input"); cb.type = "checkbox"; cb.checked = !hid[f.id];
        if (pf && f.id === pf.id) cb.disabled = true;
        cb.addEventListener("change", function () {
          var h = vv.cfg.hidden.filter(function (x) { return x !== f.id; });
          if (!cb.checked) h.push(f.id);
          setCfg({ hidden: h }); paint();
        });
        l.appendChild(cb);
        l.appendChild(el("span", "g-type", typeMark(f.type)));
        l.appendChild(el("span", null, f.name || t("f.untitled")));
        li.appendChild(l);
        var ids = all.map(function (x) { return x.id; });
        function mv(dir) {
          var j = i + dir;
          if (j < 1 || j >= ids.length) return;
          var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
          setCfg({ order: ids }); paint();
        }
        if (!pf || f.id !== pf.id) {
          var up = iconBtn(ICON.up, t("fld.left"), "", function () { mv(-1); });
          up.disabled = i <= 1;
          var dn = iconBtn(ICON.down, t("fld.right"), "", function () { mv(1); });
          dn.disabled = i >= all.length - 1;
          li.appendChild(up); li.appendChild(dn);
        }
        ul.appendChild(li);
      });
      d.body.appendChild(ul);
      var bar = el("div", "bar");
      bar.appendChild(btn("chip small", t("fl.showAll"), function () { setCfg({ hidden: [] }); paint(); }));
      bar.appendChild(btn("chip small", t("fl.hideAll"), function () {
        setCfg({ hidden: all.filter(function (f) { return !pf || f.id !== pf.id; }).map(function (f) { return f.id; }) }); paint();
      }));
      d.body.appendChild(bar);
    }
    paint();
    d.foot(btn("chip", t("grid.add"), function () { d.close(); fieldDialog(null); }), el("span", "spacer"), btn("chip pri", t("btn.done"), function () { d.close(); }));
    d.open();
  }

  // ---------- dialogs (R32: centered; R14: no native dialogs) ----------
  function dialog(title, cls) {
    var node = el("dialog", cls || "");
    var head = el("h2", null, title);
    var body = el("div", "dlg-body");
    var foot = el("div", "bar end dlg-foot");
    node.appendChild(head); node.appendChild(body); node.appendChild(foot);
    document.body.appendChild(node);
    var onClose = [];
    var api = {
      node: node, title: head, body: body,
      foot: function () {
        foot.textContent = "";
        [].slice.call(arguments).forEach(function (b) { if (b) foot.appendChild(b); });
        api.foot.last = foot.lastChild;
      },
      open: function () {
        if (typeof node.showModal === "function") node.showModal(); else node.setAttribute("open", "");
      },
      close: function () {
        if (!node.isConnected) return;
        try { node.close(); } catch (e) {}
        node.remove();
        onClose.forEach(function (fn) { fn(); });
      },
      onclose: function (fn) { onClose.push(fn); },
      enter: function (fn) {
        node.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); fn(); }
        });
      }
    };
    node.addEventListener("cancel", function (e) { e.preventDefault(); api.close(); });
    node.addEventListener("click", function (e) { if (e.target === node) api.close(); });
    return api;
  }
  function input(type, value) {
    var i = el("input");
    i.type = type;
    i.value = value == null ? "" : value;
    if (type === "text") i.maxLength = 120;
    return i;
  }
  function fld(label, control) {
    var w = el("label", "fld");
    w.appendChild(el("span", null, label));
    w.appendChild(control);
    return w;
  }
  function confirmDlg(text, okLabel, fn) {
    var d = dialog(t("confirm"));
    d.body.appendChild(el("p", null, text));
    d.foot(btn("chip", t("btn.cancel"), function () { d.close(); }), btn("chip pri danger-pri", okLabel, function () { d.close(); fn(); }));
    d.open();
  }
  function promptDlg(title, label, value, fn) {
    var d = dialog(title);
    var i = input("text", value);
    d.body.appendChild(fld(label, i));
    function ok() { var s = i.value.trim(); d.close(); fn(s); }
    d.foot(btn("chip", t("btn.cancel"), function () { d.close(); }), btn("chip pri", t("btn.save"), ok));
    d.enter(ok);
    d.open();
    i.select();
  }

  // ---------- 10. Files: CSV, Spreadsheet ----------
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  // standalone (no shell) only: R33 allows a local fallback there
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
  // baseId: add the table to that base; none = a new base named after the file
  function importCsv(baseId) {
    var host = dialogHost(), acc = ".csv,.tsv,.txt,text/csv,text/plain";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    Promise.resolve(pick).then(function (file) {
      if (!file) return;
      return importFile(file, baseId);
    }).catch(function () { toast(t("imp.bad")); });
  }
  function importFile(file, baseId) {
    if (file.size > CSV_MAX) { toast(t("imp.big")); return Promise.resolve(false); }
    return file.text().then(function (text) {
      var rows = C.parseCsv(text);
      if (!rows.length) { toast(t("imp.empty")); return false; }
      if (rows.length < 2 && !rows[0].length) { toast(t("imp.bad")); return false; }
      var name = String(file.name || "").replace(/\.[^.]+$/, "").slice(0, 120) || t("table.defName", { n: 1 });
      var now = Date.now(), d = data, bid = baseId;
      if (!bid || !ix.bases[bid]) { bid = C.uid(now); d = C.addBase(d, name, now, bid); }
      if (d.recs.length >= C.MAX_RECS) { toast(t("space.full", { max: fmtNum(C.MAX_RECS) })); return false; }
      var r = C.importRows(d, bid, name, rows, now, tableNames());
      if (!save(r.data)) return false;
      openBase(bid, r.table);
      toast(t("imp.done", { n: fmtNum(r.count) }) + (r.skipped ? " " + t("imp.skipped", { n: fmtNum(r.skipped), max: fmtNum(C.MAX_RECS) }) : ""));
      return true;
    });
  }
  // the ASCII part of a name for a file
  function slug(s) {
    var x = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
    return x || "base";
  }
  function exportCsv() {
    var v = curView(), tb = curTable(), b = curBase();
    if (!v) return;
    var fields = C.visibleFields(ix, v);
    var text = C.toCsv(ix, fields, shown);
    var name = (slug(b.name) === slug(tb.name) ? slug(b.name) : slug(b.name) + "_" + slug(tb.name)) + ".csv";
    var host = dialogHost();
    var opts = { text: text, filename: name, mime: "text/csv", types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] };
    if (host && typeof host.saveFile === "function") {
      host.saveFile(opts).then(function (r) { if (r && r.ok) toast(t("exp.done")); });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  function sheetOpener() {
    try { return typeof window.parent.__orosOpenAt === "function" && window.parent !== window ? window.parent : null; }
    catch (e) { return null; }
  }
  // BR-S1: this view as a new sheet (same columns as the CSV)
  function openInSheet() {
    var p = sheetOpener(), v = curView(), tb = curTable();
    if (!p) { toast(t("sheet.off")); return; }
    if (!v) return;
    if (!shown.length) { toast(t("sheet.none")); return; }
    var fields = C.visibleFields(ix, v).slice(0, 64);
    var recs = shown;
    if (recs.length > SHEET_ROWS) { toast(t("sheet.cap", { n: fmtNum(SHEET_ROWS) })); recs = recs.slice(0, SHEET_ROWS); }
    p.__orosOpenAt("spreadsheet", { newSheet: { name: (tb.name || t("app")).slice(0, 31), rows: C.toTable(ix, fields, recs) } });
  }

  // ---------- 11. Toast, palette, deep link, boot ----------
  var toastTimer = 0, toastUndo = null;
  function toast(msg, undo) {
    var box = $("toast"), b = $("toast-btn");
    $("toast-text").textContent = msg;
    toastUndo = undo || null;
    b.hidden = !undo;
    b.textContent = t("btn.undo");
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); toastUndo = null; }, undo ? 7000 : 3500);
  }

  var PAL_VARS = ["--bg", "--bar-bg", "--text", "--text-dim", "--accent", "--accent-hover",
    "--accent-soft", "--accent-ink", "--panel-bg", "--border", "--danger", "--ok", "--warn", "--font-stack"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      if (pRoot === document.documentElement) return;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      document.documentElement.setAttribute("data-skin", pRoot.getAttribute("data-skin") || "");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      if (window.parent === window) return;
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme", "style"] });
    } catch (e) { /* standalone */ }
  }

  // target = { base, table?, view?, rec? }
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object") return;
    var b = typeof target.base === "string" ? target.base : "";
    if (!ix.bases[b]) {
      if (typeof target.rec === "string" && ix.recs[target.rec]) {
        var rt = ix.tables[ix.recs[target.rec].t];
        if (rt) b = rt.base;
      }
      if (!ix.bases[b]) return;
    }
    var tbl = typeof target.table === "string" && ix.tables[target.table] && ix.tables[target.table].base === b ? target.table : "";
    if (typeof target.rec === "string" && ix.recs[target.rec] && ix.tables[ix.recs[target.rec].t].base === b) tbl = ix.recs[target.rec].t;
    var view = typeof target.view === "string" && ix.views[target.view] && ix.views[target.view].tb === tbl ? target.view : "";
    closeAllDialogs();
    openBase(b, tbl, view);
    if (typeof target.rec === "string" && ix.recs[target.rec]) {
      if (gridState) {
        var pf = gridState.cols[0];
        if (rowIndexOf(target.rec) >= 0 && pf) { sel = { r: target.rec, c: pf.id }; revealSel(); }
      }
      openRecord(target.rec);
    }
  };
  function closeAllDialogs() {
    [].forEach.call(document.querySelectorAll("dialog"), function (d) { try { d.close(); } catch (e) {} d.remove(); });
    recDlg = null;
  }
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) { window.__orosOpenAt(pending); return true; }
      }
    } catch (e) { /* standalone */ }
    return false;
  }

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    $("tables").setAttribute("aria-label", t("tables"));
    document.title = t("app") + " · orOS";
  }

  function wire() {
    setIcon($("back-btn"), ICON.back, t("btn.back"));
    setIcon($("base-menu-btn"), ICON.more, t("btn.more"));
    setIcon($("table-menu-btn"), ICON.more, t("btn.more"));
    $("back-btn").addEventListener("click", goHome);
    $("new-btn").addEventListener("click", newBaseDialog);
    $("import-btn").addEventListener("click", function () { importCsv(""); });
    $("base-menu-btn").addEventListener("click", baseMenu);
    $("table-menu-btn").addEventListener("click", tableMenu);
    $("add-rec-btn").addEventListener("click", function () { newRecord(null, true); });
    $("filter-btn").addEventListener("click", filterDialog);
    $("sort-btn").addEventListener("click", function () { orderDialog("sorts"); });
    $("group-btn").addEventListener("click", function () { orderDialog("groups"); });
    $("fields-btn").addEventListener("click", fieldsDialog);
    $("view-sel").addEventListener("change", function () {
      var val = $("view-sel").value;
      if (val === "__new") { $("view-sel").value = cur.view; newViewDialog(); return; }
      closeEditor(true);
      cur.view = val; sel = null; cardLimit = 200;
      remember(); render();
    });
    var qt = 0;
    $("q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { cardLimit = 200; renderContent(); }, 200); });
    var content = $("content");
    content.addEventListener("scroll", schedulePaint, { passive: true });
    content.addEventListener("click", onGridClick);
    content.addEventListener("dblclick", function (e) {
      var cell = e.target.closest && e.target.closest(".g-data");
      if (cell && !editing) startEdit();
    });
    content.addEventListener("keydown", onGridKey);
    document.addEventListener("paste", onPaste);
    $("toast-btn").addEventListener("click", function () {
      var fn = toastUndo;
      toastUndo = null;
      $("toast").classList.remove("show");
      if (fn) fn();
    });
    window.addEventListener("resize", schedulePaint);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !document.querySelector("dialog") && !editing && curBase()) { e.preventDefault(); goHome(); }
    });
    window.addEventListener("pagehide", function () { closeEditor(true); });
  }

  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    if (!takePending()) {
      var last = prefs.at.base;
      if (last && ix.bases[last]) { cur.base = last; fixCur(); }
      render();
    }
  }
  boot();
})();
