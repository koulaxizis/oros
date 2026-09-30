/* ══════════════════════════════════════════════════════════
   orOS Writer — clean-room port, Wave 1 core
   Contract: iframe citizen. No theme, no notifications subsystem,
   no sync logic — slice registration only. Version lives in shell.js.
   Boot marker: [orOS] writer.js booted
   ══════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ========== SECTION 0: SHELL PALETTE INHERITANCE ========== */
// CRITICAL: CI guard (bump-version.yml G3) greps for these function
// NAMES in every app's JS. Same contract as todo/kanban/notes/weather/mood/time.
// Without them, the app doesn't inherit --bg/--text/--accent/etc.
// from the orOS shell → CI failure + broken visuals.
function inheritPalette() {
  try {
    var pDoc = window.parent.document;
    var pCs = window.parent.getComputedStyle(pDoc.documentElement);
    ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
     "--accent-soft", "--panel-bg", "--border", "--shadow"].forEach(function (v) {
      var val = pCs.getPropertyValue(v).trim();
      if (val) document.documentElement.style.setProperty(v, val);
    });
    var th = pDoc.documentElement.getAttribute("data-theme");
    if (th) document.documentElement.setAttribute("data-theme", th);
  } catch (e) { /* standalone load — CSS fallbacks apply */ }
}

function watchPalette() {
  try {
    var pRoot = window.parent.document.documentElement;
    if (typeof MutationObserver !== "function") return;
    new MutationObserver(inheritPalette).observe(pRoot, {
      attributes: true, attributeFilter: ["data-theme", "data-skin"]
    });
  } catch (e) { /* standalone — nothing to watch */ }
}

inheritPalette();
watchPalette();

/* ===== SECTION 1: REFERENCES & STATE ===== */
const EL = {
  app:         document.getElementById('w-app'),
  tabBar:      document.getElementById('tab-bar'),
  toolbar:     document.getElementById('main-toolbar'),
  editor:      document.getElementById('rich-editor'),
  wrapper:     document.getElementById('rich-wrapper'),
  stylesSel:   document.getElementById('styles-select')
};

const AUTOSAVE_DEBOUNCE_MS = 500;   // Bible: ≤500ms (Notes precedent)

let state = {
  docs: [],            // [{id,title,author,tags,category,html,footnotes:[],comments:[],versions:[],pageSize,margins,header,footer,mtime,del:false}]
  activeTab: null,     // doc id — device-local, NEVER synced
  tabOrder: [],        // ordered doc ids — synced
  settings: {
    smartTypography: true,
    typewriterSound: false
  },
  autocorrect: null,   // { rules:[{find,repl,def}], mtime } — seeded on first AC dialog use
  templates: [],       // custom templates [{id,name,desc,html,mtime}]
  tplTombs: [],        // [{id,ts}] — deleted template tombstones
  seeded: false
};

let saveTimer = null;
let dirty = false;

/* ===== SECTION 2: STRINGS (EN / EL — Bible: EN default, EL full) ===== */
const STRINGS = {
  en: {
    'app.name': 'Writer',
    'tt.undo': 'Undo', 'tt.redo': 'Redo',
    'tt.styles': 'Paragraph style',
    'tt.bold': 'Bold', 'tt.italic': 'Italic',
    'tt.underline': 'Underline', 'tt.strike': 'Strikethrough',
    'tt.indent': 'Increase indent', 'tt.outdent': 'Decrease indent',
    'tt.bullets': 'Bullet list', 'tt.numbers': 'Numbered list',
    'tt.alignLeft': 'Align left', 'tt.alignCenter': 'Align center',
    'tt.alignRight': 'Align right', 'tt.alignJustify': 'Justify',
    'tt.hr': 'Horizontal rule', 'tt.pageBreak': 'Page break',
    'style.p': 'Normal text', 'style.h1': 'Heading 1',
    'style.h2': 'Heading 2', 'style.h3': 'Heading 3',
    'style.h4': 'Heading 4',
    'style.quote': 'Quote', 'style.code': 'Code block',
    'editor.placeholder': 'Start writing…',
    'tab.new': 'New document',
    'tab.close': 'Close',
    'tab.untitled': 'Untitled',
    'doc.new': 'New document',
    'doc.created': 'Document created',
    'doc.saved': 'Document saved',
    'doc.closed': 'Document closed',
    'doc.renamed': 'Document renamed',
    'doc.deleted': 'Document deleted',
    'sync.updated': 'Updated with changes from other devices',
    'tt.find': 'Find and replace',
    'tt.chars': 'Special characters',
    'tt.settings': 'Settings',
    'tt.smartTypography': 'Smart typography',
    'tt.autoCorrect': 'Auto-correction rules',
    'tt.lorem': 'Insert Lorem Ipsum',
    'tt.qf.bold': 'Bold',
    'tt.qf.italic': 'Italic',
    'tt.qf.underline': 'Underline',
    'tt.qf.strike': 'Strikethrough',
    'tt.qf.ulist': 'Bullet list',
    'tt.qf.nlist': 'Numbered list',
    'tt.qf.link': 'Insert link',
    'tt.qf.image': 'Insert image',
    'tt.qf.table': 'Insert table',
    'dialog.findTitle': 'Find and replace',
    'dialog.charsTitle': 'Special characters',
    'dialog.acTitle': 'Auto-correction rules',
    'ac.add': 'Add rule',
    'ac.replace': 'Replace with',
    'ac.reset': 'Reset defaults',
    'ac.saved': 'Rules saved',
    'ac.default': 'Default',
    'find.count': '{current} of {total}',
    'find.none': 'Not found',
    'char.greek': 'Greek',
    'char.math': 'Math',
    'char.arrows': 'Arrows',
    'char.currency': 'Currency',
    'char.punct': 'Punctuation',
    'char.symbols': 'Symbols',
    'char.emoji': 'Emoji',
    'opt.case': 'Match case',
    'opt.word': 'Whole word',
    'opt.format': 'Format',
    'opt.format.any': 'Any format',
    'opt.format.bold': 'Bold only',
    'opt.format.italic': 'Italic only',
    'opt.format.underline': 'Underline only',
    'opt.format.strike': 'Strikethrough only',
    'opt.replace': 'Replace with…',
    'opt.rep1': 'Replace',
    'opt.repall': 'Replace all',
    'link.displayText': 'Display text',
    'table.headerRow': 'Header row',
    'find.replaced.all': 'All occurrences replaced',
    'wx.done': 'Done',
    'wx.cancel': 'Cancel',
    'tt.footnotes': 'Footnotes',
    'fn.title': 'Footnotes',
    'fn.add': 'Add footnote',
    'fn.added': 'Footnote added',
    'fn.empty': 'No footnotes yet — add one with the toolbar button.',
    'fn.jumpHint': 'Jump to reference',
    'cmt.title': 'Comments',
    'cmt.add': 'Add comment',
    'cmt.empty': 'No comments — select text and press the comments button.',
    'cmt.placeholder': 'Write a comment…',
    'cmt.empty.quote': 'Deleted text',
    'cmt.delete': 'Delete comment',
    'tt.toc': 'Table of contents',
    'tt.meta': 'Document metadata',
    'tt.page': 'Page settings',
    'tt.templates': 'Templates',
    'tt.versions': 'Version history',
    'tt.goal': 'Writing goal',
    'meta.title': 'Title',
    'meta.author': 'Author',
    'meta.tags': 'Tags',
    'meta.category': 'Category',
    'meta.tagsAdd': 'Add tag…',
    'meta.appliedLive': 'Metadata applies instantly — no save button',
    'page.size': 'Paper size',
    'page.margins': 'Margins (mm)',
    'page.mTop': 'Top',
    'page.mBottom': 'Bottom',
    'page.mLeft': 'Left',
    'page.mRight': 'Right',
    'page.mReset': 'Reset',
    'page.header': 'Header',
    'page.footer': 'Footer',
    'page.headFootNote': 'Shown on printed page only',
    'page.sizes.a4': 'A4',
    'page.sizes.a3': 'A3',
    'page.sizes.a5': 'A5',
    'page.sizes.b5': 'B5',
    'page.sizes.letter': 'Letter',
    'page.sizes.legal': 'Legal',
    'page.sizes.full-width': 'Full width',
    'toc.title': 'Contents',
    'toc.insert': 'Insert inline',
    'toc.empty': 'No headings — start with a heading style.',
    'toc.unnamed': 'Untitled heading',
    'tpl.title': 'Templates',
    'tpl.blank': 'Blank',
    'tpl.blownote': 'essay / letter / novel / screenplay / poem / meeting notes / blank + customs',
    'tpl.custom': 'Custom',
    'tpl.use': 'Use',
    'tpl.edit': 'Edit',
    'tpl.del': 'Delete',
    'tpl.desc': 'Description',
    'tpl.name': 'Name',
    'tpl.saveCurrent': 'Save current as template',
    'tpl.saved': 'Template saved',
    'tpl.export': 'Export JSON',
    'tpl.import': 'Import JSON',
    'tpl.imported': 'Template imported',
    'tpl.exported': 'Template exported',
    'tpl.imErr': 'Invalid template file',
    'tpl.newDoc': 'New from template',
    'ver.title': 'Version history',
    'ver.auto': 'Auto',
    'ver.manual': 'Manual',
    'ver.restore': 'Restore',
    'ver.delete': 'Delete',
    'ver.snapshot': 'Snapshot',
    'ver.snapshotted': 'Snapshot saved',
    'ver.empty': 'No versions — write something first.',
    'ver.restored': 'Version restored',
    'ver.restoredFull': 'Restored text, footnotes and comments',
    'ver.words': '{n} words',
    'goal.type': 'Goal type',
    'goal.type.words': 'Words',
    'goal.type.chars': 'Characters',
    'goal.type.paras': 'Paragraphs',
    'goal.type.time': 'Time (minutes)',
    'goal.type.sessionWords': 'Session words',
    'goal.target': 'Target',
    'goal.set': 'Set goal',
    'goal.done': 'Goal reached!',
    'goal.done.msg': '🎉 {type} goal reached: {cur}/{target}',
    'goal.lock': 'Lock editing after goal',
    'goal.clear': 'Clear goal',
    'goal.stats.words': '{cur} / {target} words',
    'goal.stats.chars': '{cur} / {target} characters',
    'goal.stats.paras': '{n} paragraphs',
    'goal.stats.time': '{cur} / {target} min',
    'goal.stats.session': '{cur} session words',
    'goal.locked': 'Editing locked — clear or raise the goal to continue',
        'goal.unlockConfirm': 'Unlock editing?',
    'page.settings': 'Page settings',
    'tpl.builtin.essay': 'Essay',
    'tpl.builtin.essay.d': 'Title, introduction, body sections, conclusion.',
    'tpl.builtin.letter': 'Formal letter',
    'tpl.builtin.letter.d': 'Sender, date, recipient, salutation, body, closing.',
    'tpl.builtin.novel': 'Novel chapter',
    'tpl.builtin.novel.d': 'Chapter heading, scene breaks, narrative paragraphs.',
    'tpl.builtin.screenplay': 'Screenplay',
    'tpl.builtin.screenplay.d': 'FADE IN, scene headings, action, dialogue.',
    'tpl.builtin.poem': 'Poem',
    'tpl.builtin.poem.d': 'Title and stanzas with a spare layout.',
    'tpl.builtin.notes': 'Meeting notes',
    'tpl.builtin.notes.d': 'Date, attendees, agenda, decisions, action items.',
    'tpl.builtin.blank': 'Blank',
    'tpl.builtin.blank.d': 'An empty page.',
    'tpl.confirmDel': 'Delete template "{name}"?',
    'tpl.confirmOverwrite': 'A template with this name exists — overwrite?',
    'ver.confirmRestore': 'Restore this version? Current content will be replaced.',
    'ver.confirmDel': 'Delete this version snapshot?',
    'ver.delta': '{n} words',
    'tt.export': 'Export',
    'tt.import': 'Import',
    'io.title.exp': 'Export document',
    'io.title.imp': 'Import document',
    'io.txt.name': 'Plain text',
    'io.txt.desc': 'Text only, no formatting.',
    'io.md.name': 'Markdown',
    'io.md.desc': 'Portable formatted text for writers and editors.',
    'io.md.note': 'More formats coming soon',
    'io.docx.name': 'Word document',
    'io.docx.desc': 'Editable in Word, LibreOffice, Google Docs.',
    'io.docx.note': 'Large documents may take a moment',
    'io.pdf.name': 'PDF',
    'io.pdf.desc': 'Fixed layout, perfect for sharing and printing.',
    'io.rtf.name': 'RTF',
    'io.rtf.desc': 'Rich text usable almost everywhere.',
    'io.rtf.note': 'Universal but lossy',
    'io.html.name': 'HTML',
    'io.html.desc': 'Web-ready with full formatting.',
    'io.orosdoc.name': 'orOS Writer',
    'io.orosdoc.desc': 'Round-trip archive: text, footnotes, comments, metadata.',
    'io.json.name': 'Database (JSON)',
    'io.json.desc': 'Complete slice — all tabs, settings, templates, autocorrect.',
    'io.busy': 'Preparing…',
    'io.ready': '{n} formats available',
    'io.pickFile': 'Choose a file',
    'io.pickFileSub': 'Supported: OROSDOC, DOCX, ODT, RTF, HTML, TXT, MD',
    'io.impOpts': 'How to import?',
    'io.impNew': 'New tab (recommended)',
    'io.impNew.d': 'Everything lands in a fresh document.',
    'io.impAppend': 'Append to current',
    'io.impAppend.d': 'Appended at the end of the active document.',
    'io.impReplace': 'Replace current',
    'io.impReplace.d': 'Dupes current first into Version History.',
    'io.imported': 'Imported',
    'io.importfailed': 'Could not parse this file',
    'io.dbConfirm': 'Restore the full Writer database? Current tabs, documents and settings will be replaced.',
    'io.ddTitle': 'Drop to open',
    'io.ddSub': 'OROSDOC, DOCX, ODT, RTF, HTML, TXT, MD',
    'io.metaLabel': 'Riding along:',
    'io.naming': 'Exports take document title, falls back to untitled.',
  },
  el: {
    'app.name': 'Writer',
    'tt.undo': 'Αναίρεση', 'tt.redo': 'Επανάληψη',
    'tt.styles': 'Στυλ παραγράφου',
    'tt.bold': 'Έντονη γραφή', 'tt.italic': 'Πλάγια γραφή',
    'tt.underline': 'Υπογράμμιση', 'tt.strike': 'Διακριτή διαγραφή',
    'tt.indent': 'Αύξηση εσοχής', 'tt.outdent': 'Μείωση εσοχής',
    'tt.bullets': 'Λίστα κουκκίδων', 'tt.numbers': 'Αριθμημένη λίστα',
    'tt.alignLeft': 'Στοίχιση αριστερά', 'tt.alignCenter': 'Στοίχιση κέντρο',
    'tt.alignRight': 'Στοίχιση δεξιά', 'tt.alignJustify': 'Πλήρης στοίχιση',
    'tt.hr': 'Οριζόντια γραμμή', 'tt.pageBreak': 'Αλλαγή σελίδας',
    'style.p': 'Κανονικό κείμενο', 'style.h1': 'Επικεφαλίδα 1',
    'style.h2': 'Επικεφαλίδα 2', 'style.h3': 'Επικεφαλίδα 3',
    'style.h4': 'Επικεφαλίδα 4',
    'style.quote': 'Παράθεση', 'style.code': 'Μπλοκ κώδικα',
    'editor.placeholder': 'Ξεκίνα να γράφεις…',
    'tab.new': 'Νέο έγγραφο',
    'tab.close': 'Κλείσιμο',
    'tab.untitled': 'Χωρίς τίτλο',
    'doc.new': 'Νέο έγγραφο',
    'doc.created': 'Το έγγραφο δημιουργήθηκε',
    'doc.saved': 'Το έγγραφο αποθηκεύτηκε',
    'doc.closed': 'Το έγγραφο έκλεισε',
    'doc.renamed': 'Το έγγραφο μετονομάστηκε',
    'doc.deleted': 'Το έγγραφο διαγράφηκε',
    'sync.updated': 'Ενημερώθηκε με αλλαγές από άλλες συσκευές',
    'tt.find': 'Αναζήτηση και αντικατάσταση',
    'tt.chars': 'Ειδικοί χαρακτήρες',
    'tt.settings': 'Ρυθμίσεις',
    'tt.smartTypography': 'Έξυπνη τυπογραφία',
    'tt.autoCorrect': 'Κανόνες αυτο-διόρθωσης',
    'tt.lorem': 'Εισαγωγή Lorem Ipsum',
    'tt.qf.bold': 'Έντονη γραφή',
    'tt.qf.italic': 'Πλάγια γραφή',
    'tt.qf.underline': 'Υπογράμμιση',
    'tt.qf.strike': 'Διακριτή διαγραφή',
    'tt.qf.ulist': 'Λίστα κουκκίδων',
    'tt.qf.nlist': 'Αριθμημένη λίστα',
    'tt.qf.link': 'Εισαγωγή συνδέσμου',
    'tt.qf.image': 'Εισαγωγή εικόνας',
    'tt.qf.table': 'Εισαγωγή πίνακα',
    'dialog.findTitle': 'Αναζήτηση και αντικατάσταση',
    'dialog.charsTitle': 'Ειδικοί χαρακτήρες',
    'dialog.acTitle': 'Κανόνες αυτο-διόρθωσης',
    'ac.add': 'Προσθήκη',
    'ac.replace': 'Αντικατάσταση με',
    'ac.reset': 'Επαναφορά',
    'ac.saved': 'Οι κανόνες αποθηκεύτηκαν',
    'ac.default': 'Default',
    'find.count': '{current} από {total}',
    'find.none': 'Δεν βρέθηκε',
    'char.greek': 'Ελληνικά',
    'char.math': 'Μαθηματικά',
    'char.arrows': 'Βέλη',
    'char.currency': 'Νόμισμα',
    'char.punct': 'Στίξη',
    'char.symbols': 'Σύμβολα',
    'char.emoji': 'Emoji',
    'opt.case': 'Διατήρηση κεφαλαίων/μικρών',
    'opt.word': 'Ολόκληρη λέξη',
    'opt.format': 'Μορφή',
    'opt.format.any': 'Οποιαδήποτε μορφή',
    'opt.format.bold': 'Μόνο έντονη',
    'opt.format.italic': 'Μόνο πλάγια',
    'opt.format.underline': 'Μόνο υπογεγραμμένη',
    'opt.format.strike': 'Μόνο διαγραμμένη',
    'opt.replace': 'Αντικατάσταση με…',
    'opt.rep1': 'Αντικατάσταση',
    'opt.repall': 'Αντικατάσταση όλων',
    'link.displayText': 'Κείμενο εμφάνισης',
    'table.headerRow': 'Γραμμή κεφαλίδας',
    'find.replaced.all': 'Όλες οι εμφανίσεις αντικαταστάθηκαν',
    'wx.done': 'Ολοκλήρωση',
    'wx.cancel': 'Ακύρωση',
    'tt.footnotes': 'Υποσημειώσεις',
    'fn.title': 'Υποσημειώσεις',
    'fn.add': 'Προσθήκη υποσημείωσης',
    'fn.added': 'Η υποσημείωση προστέθηκε',
    'fn.empty': 'Καμία υποσημείωση ακόμα — πρόσθεσε με το κουμπί της γραμμής εργαλείων.',
    'fn.jumpHint': 'Μετάβαση στην αναφορά',
    'cmt.title': 'Σχόλια',
    'cmt.add': 'Προσθήκη σχολίου',
    'cmt.empty': 'Κανένα σχόλιο — επίλεξε κείμενο και πάτησε το κουμπί σχολίων.',
    'cmt.placeholder': 'Γράψε ένα σχόλιο…',
    'cmt.empty.quote': 'Διαγραμμένο κείμενο',
    'cmt.delete': 'Διαγραφή σχολίου',
    'tt.toc': 'Πίνακας περιεχομένων',
    'tt.meta': 'Μεταδεδομένα εγγράφου',
    'tt.page': 'Ρυθμίσεις σελίδας',
    'tt.templates': 'Πρότυπα',
    'tt.versions': 'Ιστορικό εκδόσεων',
    'tt.goal': 'Στόχος γραφής',
    'meta.title': 'Τίτλος',
    'meta.author': 'Συγγραφέας',
    'meta.tags': 'Ετικέτες',
    'meta.category': 'Κατηγορία',
    'meta.tagsAdd': 'Προσθήκη…',
    'meta.appliedLive': 'Εφαρμόζεται άμεσα — χωρίς κουμπί αποθήκευσης',
    'page.size': 'Μέγεθος χαρτιού',
    'page.margins': 'Περιθώρια (mm)',
    'page.mTop': 'Πάνω',
    'page.mBottom': 'Κάτω',
    'page.mLeft': 'Αριστερά',
    'page.mRight': 'Δεξιά',
    'page.mReset': 'Επαναφορά',
    'page.header': 'Κεφαλίδα',
    'page.footer': 'Υποσέλιδο',
    'page.headFootNote': 'Εμφανίζεται μόνο στην εκτύπωση',
    'page.sizes.a4': 'A4',
    'page.sizes.a3': 'A3',
    'page.sizes.a5': 'A5',
    'page.sizes.b5': 'B5',
    'page.sizes.letter': 'Letter',
    'page.sizes.legal': 'Legal',
    'page.sizes.full-width': 'Πλήρες πλάτος',
    'toc.title': 'Περιεχόμενα',
    'toc.insert': 'Εισαγωγή inline',
    'toc.empty': 'Καμία επικεφαλίδα — ξεκίνα με style heading.',
    'toc.unnamed': 'Άνευ τίτλου',
    'tpl.title': 'Πρότυπα',
    'tpl.custom': 'Προσαρμοσμένο',
    'tpl.use': 'Χρήση',
    'tpl.edit': 'Επεξεργασία',
    'tpl.del': 'Διαγραφή',
    'tpl.desc': 'Περιγραφή',
    'tpl.name': 'Όνομα',
    'tpl.saveCurrent': 'Αποθήκευση τρέχοντος ως πρότυπο',
    'tpl.saved': 'Το πρότυπο αποθηκεύτηκε',
    'tpl.export': 'Εξαγωγή JSON',
    'tpl.import': 'Εισαγωγή JSON',
    'tpl.imported': 'Το πρότυπο εισήχθη',
    'tpl.exported': 'Το πρότυπο εξάχθηκε',
    'tpl.imErr': 'Μη έγκυρο αρχείο προτύπου',
    'tpl.newDoc': 'Νέο από πρότυπο',
    'ver.title': 'Ιστορικό εκδόσεων',
    'ver.auto': 'Αυτόματο',
    'ver.manual': 'Χειροκίνητο',
    'ver.restore': 'Επαναφορά',
    'ver.delete': 'Διαγραφή',
    'ver.snapshot': 'Snapshot',
    'ver.snapshotted': 'Snapshot αποθηκεύτηκε',
    'ver.empty': 'Καμία έκδοση — γράψε πρώτα κάτι.',
    'ver.restored': 'Η έκδοση επανήλθε',
    'ver.restoredFull': 'Αποκαταστάθηκε κείμενο, υποσημειώσεις και σχόλια',
    'ver.words': '{n} λέξεις',
    'goal.type': 'Τύπος στόχου',
    'goal.type.words': 'Λέξεις',
    'goal.type.chars': 'Χαρακτήρες',
    'goal.type.paras': 'Παράγραφοι',
    'goal.type.time': 'Χρόνος (λεπτά)',
    'goal.type.sessionWords': 'Λέξεις συνεδρίας',
    'goal.target': 'Στόχος',
    'goal.set': 'Ορισμός στόχου',
    'goal.done': 'Ο στόχος επιτεύχθηκε!',
    'goal.done.msg': '🎉 {type} επιτεύχθηκε: {cur}/{target}',
    'goal.lock': 'Μπλοκάρισμα μετά τον στόχο',
    'goal.clear': 'Διαγραφή στόχου',
    'goal.stats.words': '{cur} / {target} λέξεις',
    'goal.stats.chars': '{cur} / {target} χαρακτήρες',
    'goal.stats.paras': '{n} παράγραφοι',
    'goal.stats.time': '{cur} / {target} λεπτά',
    'goal.stats.session': '{cur} λέξεις συνεδρίας',
    'goal.locked': 'Γραφή μπλοκαρισμένη — καθαρίστε ή αυξήστε τον στόχο',
    'goal.unlockConfirm': 'Ξεκλείδωμα;',
    'page.settings': 'Ρυθμίσεις σελίδας',
    'tpl.builtin.essay': 'Δοκίμιο',
    'tpl.builtin.essay.d': 'Τίτλος, εισαγωγή, ενότητες, συμπέρασμα.',
    'tpl.builtin.letter': 'Επίσημη επιστολή',
    'tpl.builtin.letter.d': 'Αποστολέας, ημερομηνία, παραλήπτης, προσφώνηση, σώμα, κλείσιμο.',
    'tpl.builtin.novel': 'Κεφάλαιο μυθιστορήματος',
    'tpl.builtin.novel.d': 'Τίτλος κεφαφαίου, διαχωριστικά σκηνών, αφηγηματικές παράγραφοι.',
    'tpl.builtin.screenplay': 'Σενάριο',
    'tpl.builtin.screenplay.d': 'FADE IN, επικεφαλίδες σκηνών, δράση, διάλογοι.',
    'tpl.builtin.poem': 'Ποίημα',
    'tpl.builtin.poem.d': 'Τίτλος και στροφές σε λιτή διάταξη.',
    'tpl.builtin.notes': 'Σημειώσεις συνάντησης',
    'tpl.builtin.notes.d': 'Ημερομηνία, συμμετέχοντες, ατζέντα, αποφάσεις, ενέργειες.',
    'tpl.builtin.blank': 'Κενό',
    'tpl.builtin.blank.d': 'Μια κενή σελίδα.',
    'tpl.confirmDel': 'Διαγραφή προτύπου «{name}»;',
    'tpl.confirmOverwrite': 'Υπάρχει πρότυπο με αυτό το όνομα — αντικατάσταση;',
    'ver.confirmRestore': 'Επαναφορά αυτής της έκδοσης; Το τρέχον περιεχόμενο θα αντικατασταθεί.',
    'ver.confirmDel': 'Διαγραφή αυτού του snapshot;',
    'ver.delta': '{n} λέξεις',
    'tt.export': 'Εξαγωγή',
    'tt.import': 'Εισαγωγή',
    'io.title.exp': 'Εξαγωγή εγγράφου',
    'io.title.imp': 'Εισαγωγή εγγράφου',
    'io.txt.name': 'Απλό κείμενο',
    'io.txt.desc': 'Μόνο κείμενο, χωρίς μορφοποίηση.',
    'io.md.name': 'Markdown',
    'io.md.desc': 'Φορητό μορφοποιημένο κείμενο για συγγραφείς.',
    'io.md.note': 'Περισσότερες μορφές σύντομα',
    'io.docx.name': 'Document Word',
    'io.docx.desc': 'Επεξεργάσιμο σε Word, LibreOffice, Google Docs.',
    'io.docx.note': 'Μεγάλα έγγραφα ίσως αργήσουν',
    'io.pdf.name': 'PDF',
    'io.pdf.desc': 'Σταθερή διάταξη, ιδανικό για κοινοποίηση και εκτύπωση.',
    'io.rtf.name': 'RTF',
    'io.rtf.desc': 'Πλούσιο κείμενο, σχεδόν παντού συμβατό.',
    'io.rtf.note': 'Καθολικό αλλά απωλεστικό',
    'io.html.name': 'HTML',
    'io.html.desc': 'Έτοιμο για το web με πλήρη μορφοποίηση.',
    'io.orosdoc.name': 'orOS Writer',
    'io.orosdoc.desc': 'Πλήρες αρχείο: κείμενο, υποσημειώσεις, σχόλια, μεταδεδομένα.',
    'io.json.name': 'Βάση δεδομένων (JSON)',
    'io.json.desc': 'Πλήρες slice — όλα τα tabs, ρυθμίσεις, πρότυπα, διορθώσεις.',
    'io.busy': 'Προετοιμασία…',
    'io.ready': '{n} μορφές διαθέσιμες',
    'io.pickFile': 'Επιλογή αρχείου',
    'io.pickFileSub': 'Υποστηρίζονται: OROSDOC, DOCX, ODT, RTF, HTML, TXT, MD',
    'io.impOpts': 'Πώς να γίνει η εισαγωγή;',
    'io.impNew': 'Νέο tab (συνιστάται)',
    'io.impNew.d': 'Όλα καταλήγουν σε νέο έγγραφο.',
    'io.impAppend': 'Προσθήκη στο τρέχον',
    'io.impAppend.d': 'Προστίθεται στο τέλος του τρέχοντος εγγράφου.',
    'io.impReplace': 'Αντικατάσταση τρέχοντος',
    'io.impReplace.d': 'Το τρέχον αποθηκεύεται πρώτα στο Ιστορικό εκδόσεων.',
    'io.imported': 'Εισήχθη',
    'io.importfailed': 'Δεν ήταν δυνατή η ανάγνωση του αρχείου',
    'io.dbConfirm': 'Επαναφορά πλήρους βάσης δεδομένων; Τα τρέχοντα tabs, έγγραφα και ρυθμίσεις θα αντικατασταθούν.',
    'io.ddTitle': 'Άφησε το αρχείο για άνοιγμα',
    'io.ddSub': 'OROSDOC, DOCX, ODT, RTF, HTML, TXT, MD',
    'io.metaLabel': 'Συνοδεύουν:',
    'io.naming': 'Η εξαγωγή παίρνει τον τίτλο του εγγράφου, αλλιώς «Χωρίς τίτλο».'
  }
};

function t(key) {
  const lang = (window.orosLang === 'el') ? 'el' : 'en';
  const pack = STRINGS[lang] || STRINGS.en;
  return pack[key] !== undefined ? pack[key]
       : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
}

/* ===== SECTION 3: SVG ICONS (inline, 16×16 — Bible R9:
   buttons EMPTY in HTML, JS paints; NO ForkAwesome) ===== */
const ICONS = {
  undo:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6a3.5 3.5 0 1 1 0 7H6"/><path d="M3 7l3-3M3 7l3 3"/></svg>',
  redo:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7H7a3.5 3.5 0 1 0 0 7h3"/><path d="M13 7l-3-3M13 7l-3 3"/></svg>',
  bold:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4 2h5a3 3 0 0 1 2.2 5 3.2 3.2 0 0 1-.7 6H4zm2 2v2.2h2.6a1.1 1.1 0 1 0 0-2.2zm0 4.2V12h3.1a1.4 1.4 0 1 0 0-2.8z"/></svg>',
  italic: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="5" y1="3" x2="12" y2="3"/><line x1="4" y1="13" x2="11" y2="13"/><line x1="9.5" y1="3" x2="6.5" y2="13"/></svg>',
  underline: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v5a4 4 0 0 0 8 0V2"/><line x1="3" y1="14" x2="13" y2="14"/></svg>',
  strike: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 8h10"/><path d="M5 5.5C5 4.1 6.3 3 8.4 3c1.8 0 3 .8 3.2 2M5 10.5c.3 1.6 1.8 2.5 3.6 2.5 1.9 0 3-1 3.2-2.3"/></svg>',
  indent: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h6M7 8h6M7 13h6"/><path d="M3 5.5L5 8l-2 2.5" transform="translate(0,-0.5)"/></svg>',
  outdent:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h6M7 8h6M7 13h6"/><path d="M5 5.5L3 8l2 2.5" transform="translate(0,-0.5)"/></svg>',
  bullets:'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="3" cy="4" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="3" cy="12" r="1.5"/><rect x="7" y="3.2" width="7" height="1.6" rx="0.8"/><rect x="7" y="7.2" width="7" height="1.6" rx="0.8"/><rect x="7" y="11.2" width="7" height="1.6" rx="0.8"/></svg>',
  numbers:'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><text x="1" y="5.5" font-size="5.5">1</text><text x="1" y="9.5" font-size="5.5">2</text><text x="1" y="13.5" font-size="5.5">3</text><rect x="7" y="3.2" width="7" height="1.4" rx="0.7"/><rect x="7" y="7.2" width="7" height="1.4" rx="0.7"/><rect x="7" y="11.2" width="7" height="1.4" rx="0.7"/></svg>',
  alignLeft:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="10" y2="8"/><line x1="2" y1="12" x2="12" y2="12"/></svg>',
  alignCenter:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="3" y1="12" x2="13" y2="12"/></svg>',
  alignRight:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="4" y1="12" x2="14" y2="12"/></svg>',
  alignJustify:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg>',
  hr:     '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="8" x2="14" y2="8"/><circle cx="5" cy="8" r="0.8" fill="currentColor"/><circle cx="8" cy="8" r="0.8" fill="currentColor"/><circle cx="11" cy="8" r="0.8" fill="currentColor"/></svg>',
  pageBreak:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 3h8v3H4z" fill="currentColor" stroke="none"/><line x1="2" y1="9" x2="14" y2="9" stroke-dasharray="1.5 1.5"/><line x1="2" y1="13" x2="6" y2="13"/><line x1="8" y1="13" x2="14" y2="13"/></svg>',
  find:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5"/><line x1="12" y1="12" x2="14.5" y2="14.5"/></svg>',
  chars:  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="4" height="4" rx="1"/><rect x="9" y="3" width="4" height="4" rx="1"/><rect x="3" y="9" width="4" height="4" rx="1"/><rect x="9" y="9" width="4" height="4" rx="1"/><text x="5" y="6.5" font-size="4" text-anchor="middle" fill="currentColor" stroke="none">Σ</text><text x="11" y="6.5" font-size="4" text-anchor="middle" fill="currentColor" stroke="none">A</text><text x="5" y="12.5" font-size="4" text-anchor="middle" fill="currentColor" stroke="none">1</text><text x="11" y="12.5" font-size="4" text-anchor="middle" fill="currentColor" stroke="none">+</text></svg>',
  check:  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,7 7,11 12,5"/></svg>',
  trash:  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h8"/><path d="M6 7v6M10 7v6"/><path d="M3 4h10"/><path d="M7 4V3h2v1"/></svg>',
  prev:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="10,3 5,8 10,13"/></svg>',
  next:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,3 11,8 6,13"/></svg>',
  fn:     '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12.5V4.5a2 2 0 0 1 2-2h4"/><path d="M3.5 12.5a2 2 0 0 0 2 2h4"/><path d="M7.5 3.5h5"/><path d="M7.5 6h3"/><text x="12.5" y="12.5" font-size="6" fill="currentColor" stroke="none" text-anchor="middle" font-weight="700">1</text></svg>',
  cmt:    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11v8h-6l-3.5 2.5v-2.5h-1.5z"/><path d="M5 6.5h6M5 8.5h4"/></svg>',
  toc:    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="13" y2="3"/><line x1="3" y1="6" x2="9" y2="6"/><line x1="3" y1="9" x2="11" y2="9"/><line x1="3" y1="12" x2="8" y2="12"/></svg>',
  meta:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 6h4M6 10h4"/><circle cx="9" cy="14" r="1"/></svg>',
  page:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12" rx="1"/><line x1="6" y1="5" x2="10" y2="5"/><line x1="6" y1="9" x2="10" y2="9"/><line x1="6" y1="13" x2="10" y2="13"/></svg>',
  tpl:    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M7 3v10M10 6h-4M10 10h-4"/><path d="M12 12l2 2M14 12l-2 2"/></svg>',
  versions:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/><path d="M12 12l-2 2M14 12l-2 2"/></svg>',
  goal:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/><polygon points="8,2 8,14"/></svg>',
  export: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3h12v-3"/><path d="M8 11V2"/><path d="M5 5l3-3 3 3"/></svg>',
  import: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3h12v-3"/><path d="M8 2v9"/><path d="M5 8l3 3 3-3"/></svg>',
  close:  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  plus:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  lorem:  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11"/><path d="M2.5 8h7"/><path d="M2.5 11.5h9"/></svg>',
  settings:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M2.7 8h1.8M11.5 8h1.8M4.2 4.2l1.3 1.3M10.5 10.5l1.3 1.3M11.8 4.2l-1.3 1.3M5.5 10.5l-1.3 1.3"/></svg>'
};

function paintIcons() {
  document.querySelectorAll('.tb-btn').forEach(btn => {
    const key = btn.id.replace(/^btn-/, '').replace(/-/g, '');
    const map = {
      'undo': 'undo', 'redo': 'redo', 'bold': 'bold', 'italic': 'italic',
      'underline': 'underline', 'strike': 'strike',
      'indent': 'indent', 'outdent': 'outdent',
      'bullets': 'bullets', 'numbers': 'numbers',
      'alignleft': 'alignLeft', 'aligncenter': 'alignCenter',
      'alignright': 'alignRight', 'alignjustify': 'alignJustify',
      'hr': 'hr', 'pagebreak': 'pageBreak',
      'find': 'find', 'chars': 'chars',
      'footnotes': 'fn', 'comments': 'cmt',
      'toc': 'toc', 'meta': 'meta', 'page': 'page',
      'templates': 'tpl', 'versions': 'versions', 'goal': 'goal',
      'export': 'export', 'import': 'import', 'lorem': 'lorem', 'settings': 'settings'
    };
    const ic = map[key];
    if (ic && ICONS[ic]) btn.innerHTML = ICONS[ic];
  });
}

/* ===== SECTION 4: SMALL UTILITIES ===== */
function uid() {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {   // attribute-safe (covers quotes — beta bug #3)
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastEl = null, toastTimer = null;
function showToast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'w-toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;                 // textContent — never innerHTML
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2600);
}

function escapeRegex(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// Serialize editor content WITHOUT transient UI artifacts (find marks).
// Clone → strip → innerHTML: the live DOM (and open find bar) are untouched.
function editorHTMLForSave() {
  const clone = EL.editor.cloneNode(true);
  clone.querySelectorAll('mark.find-hit, mark.find-hit-active').forEach(m => {
    const frag = document.createDocumentFragment();
    while (m.firstChild) frag.appendChild(m.firstChild);
    m.replaceWith(frag);
  });
  return clone.innerHTML;
}

function applyI18n() {
  document.documentElement.lang =
    (window.orosLang === 'el') ? 'el' : 'en';
  document.title = t('app.name');
  EL.editor.setAttribute('data-placeholder', t('editor.placeholder'));
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}

/* ===== SECTION 5: TAB BAR RENDERING ===== */
function getDoc(id) { return state.docs.find(d => d.id === id); }
function activeDoc() { return getDoc(state.activeTab); }

function renderTabs() {
  EL.tabBar.innerHTML = '';
  state.tabOrder.forEach(id => {
    const doc = getDoc(id);
    if (!doc || doc.del) return;

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab' + (id === state.activeTab ? ' active' : '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', id === state.activeTab ? 'true' : 'false');
    tab.title = doc.title || t('tab.untitled');

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = doc.title || t('tab.untitled');
    label.addEventListener('dblclick', startTabRename.bind(null, id, label));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.title = t('tab.close');
    close.innerHTML = ICONS.close;
    close.addEventListener('click', e => {
      e.stopPropagation();
      closeDoc(id);
    });

    tab.appendChild(label);
    tab.appendChild(close);
    tab.addEventListener('click', () => activateTab(id));
    EL.tabBar.appendChild(tab);
  });

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'tab-new';
  newBtn.title = t('tab.new');
  newBtn.innerHTML = ICONS.plus;
  newBtn.addEventListener('click', () => createDoc());
  EL.tabBar.appendChild(newBtn);
}

function startTabRename(id, labelEl) {
  const doc = getDoc(id);
  if (!doc) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-label-input';
  input.value = doc.title || '';
  input.maxLength = 120;
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const v = input.value.trim();
    if (v && v !== doc.title) {
      doc.title = v;
      doc.mtime = Date.now();
      scheduleSave();
      renderTabs();
      showToast(t('doc.renamed'));
    } else {
      renderTabs();
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = doc.title || ''; input.blur(); }
  });
}

/* ===== SECTION 6: DOCS CRUD ===== */
function createDoc(opts) {
  opts = opts || {};
  const doc = {
    id: uid(),
    title: opts.title || '',
    author: '',
    tags: [],
    category: '',
    html: opts.html || '',
    footnotes: [],
    comments: [],
    versions: [],
    pageSize: 'a4',
    margins: { top: 25, bottom: 25, left: 25, right: 25 },
    header: '', footer: '',
    mtime: Date.now(),
    del: false
  };
  state.docs.push(doc);
  state.tabOrder.push(doc.id);
  state.activeTab = doc.id;
  scheduleSave();
  renderTabs();
  renderEditor();
  EL.editor.focus();
  if (!opts.silent) showToast(t('doc.created'));
  return doc;
}

function activateTab(id) {
  if (getDoc(id)) {
    flushSave();
    state.activeTab = id;   // device-local, not saved into slice
    renderTabs();
    renderEditor();
    EL.editor.focus();
  }
}

function closeDoc(id) {
  flushSave();
  state.tabOrder = state.tabOrder.filter(x => x !== id);
  if (state.activeTab === id) {
    state.activeTab = state.tabOrder[state.tabOrder.length - 1] || null;
  }
  // Doc stays in state.docs — openable again via future manager; tab closes only.
  scheduleSave();
  renderTabs();
  renderEditor();
  showToast(t('doc.closed'));
}

/* ===== SECTION 7: SLICE — LOAD / SAVE / MERGE ===== */
const SLICE_KEY = 'oros-writer-data';

// Retention guard: manual snapshots always survive; only the newest
// 8 auto versions travel in the slice (document feature, not backup).
function capVersions(vers) {
  const manual = vers.filter(v => v.manual);
  const auto = vers.filter(v => !v.manual).slice(-8);
  return manual.concat(auto).sort((a, b) => a.ts - b.ts);
}

function serialize() {
  return {
    ver: 1,
    docs: state.docs.map(d => ({
      id: d.id, title: d.title, author: d.author, tags: d.tags,
      category: d.category, html: d.html,
      footnotes: d.footnotes || [], comments: d.comments || [],
      versions: capVersions(d.versions || []),
      pageSize: d.pageSize, margins: d.margins,
      header: d.header, footer: d.footer,
      goal: (d.goal && typeof d.goal === 'object') ? {
        type: d.goal.type, target: d.goal.target, lock: !!d.goal.lock,
        startTs: d.goal.startTs || 0, startWords: d.goal.startWords || 0
      } : null,
      mtime: d.mtime, del: !!d.del
    })),
    tabOrder: state.tabOrder.filter(id => {
      const d = getDoc(id); return d && !d.del;
    }),
    settings: state.settings,
    autocorrect: state.autocorrect,
    templates: state.templates || [],
    tplTombs: state.tplTombs || [],
    seeded: state.seeded
  };
}

function hydrate(raw) {
  if (!raw || typeof raw !== 'object') return;
  if (!Array.isArray(raw.docs)) raw.docs = [];
  state.docs = raw.docs.filter(d => d && typeof d.id === 'string').map(d => ({
    id: d.id,
    title: typeof d.title === 'string' ? d.title : '',
    author: typeof d.author === 'string' ? d.author : '',
    tags: Array.isArray(d.tags) ? d.tags : [],
    category: typeof d.category === 'string' ? d.category : '',
    html: typeof d.html === 'string' ? d.html : '',
    footnotes: Array.isArray(d.footnotes) ? d.footnotes : [],
    comments: Array.isArray(d.comments) ? d.comments : [],
    versions: Array.isArray(d.versions) ? capVersions(d.versions) : [],
    pageSize: typeof d.pageSize === 'string' ? d.pageSize : 'a4',
    margins: (d.margins && typeof d.margins === 'object') ? d.margins
             : { top: 25, bottom: 25, left: 25, right: 25 },
    header: typeof d.header === 'string' ? d.header : '',
    footer: typeof d.footer === 'string' ? d.footer : '',
    goal: (d.goal && typeof d.goal === 'object' && d.goal.target)
          ? { type: d.goal.type, target: d.goal.target, lock: !!d.goal.lock,
              startTs: d.goal.startTs || 0, startWords: d.goal.startWords || 0 }
          : null,
    mtime: Number(d.mtime) || 0,
    del: !!d.del
  }));
  state.tabOrder = Array.isArray(raw.tabOrder)
    ? raw.tabOrder.filter(id => getDoc(id))
    : state.docs.filter(d => !d.del).map(d => d.id);
  state.seeded = !!raw.seeded;
  state.settings = (raw.settings && typeof raw.settings === 'object')
    ? raw.settings : state.settings;
  state.autocorrect = (raw.autocorrect && Array.isArray(raw.autocorrect.rules))
    ? raw.autocorrect : null;
  state.templates = Array.isArray(raw.templates) ? raw.templates
    .filter(x => x && typeof x.id === 'string' && typeof x.name === 'string') : [];
  state.tplTombs = Array.isArray(raw.tplTombs) ? raw.tplTombs
    .filter(x => x && typeof x.id === 'string') : [];
  // activeTab: device-local — restore best effort from tabOrder
  if (!getDoc(state.activeTab)) {
    state.activeTab = state.tabOrder[0] || null;
  }
}

// Entity LWW per doc + tombstones (R5/R17) — no Date.now() inside merge
function mergeSlices(local, remote) {
  if (!remote || typeof remote !== 'object') return local;
  const byId = {};
  const ids = new Set();
  [].concat(local.docs || [], remote.docs || []).forEach(d => ids.add(d.id));

  ids.forEach(id => {
    const L = (local.docs || []).find(d => d.id === id);
    const R = (remote.docs || []).find(d => d.id === id);
    if (!R) { byId[id] = L; return; }               // local-only
    if (!L) { byId[id] = R; return; }               // remote-only
    byId[id] = (R.mtime >= L.mtime) ? R : L;        // LWW per entity
  });

  // tabOrder: prefer the newer doc's owner side, dedup, drop deleted
  const base = (remote.tabOrder || local.tabOrder || [])
    .filter(id => byId[id] && !byId[id].del);
  (local.tabOrder || []).forEach(id => {
    if (byId[id] && !byId[id].del && base.indexOf(id) === -1) base.push(id);
  });

  // Templates: LWW per entity, respecting tombstones (deleted wins over
  // stale-but-newer edit? No — mtime vs tombstone ts: newer wins.)
  const tombs = {};
  [].concat(local.tplTombs || [], remote.tplTombs || []).forEach(tb => {
    if (!tombs[tb.id] || tb.ts > tombs[tb.id]) tombs[tb.id] = tb.ts;
  });
  const tplById = {};
  [].concat(local.templates || [], remote.templates || []).forEach(tp => {
    if (tombs[tp.id] >= (tp.mtime || 0)) return;   // tombstoned
    if (!tplById[tp.id] || (tp.mtime || 0) >= (tplById[tp.id].mtime || 0)) tplById[tp.id] = tp;
  });

  const lm = (local.autocorrect && local.autocorrect.mtime) || 0;
  const rm = (remote.autocorrect && remote.autocorrect.mtime) || 0;
  const lset = (local.settings && local.settings._mtime) || 0;
  const rset = (remote.settings && remote.settings._mtime) || 0;

  return {
    ver: 1,
    docs: Object.keys(byId).map(k => byId[k]),
    tabOrder: base,
    settings: (rset >= lset) ? remote.settings : local.settings,
    autocorrect: (rm >= lm) ? remote.autocorrect : local.autocorrect,
    templates: Object.keys(tplById).map(k => tplById[k]),
    tplTombs: Object.keys(tombs).map(k => ({ id: k, ts: tombs[k] })),
    seeded: local.seeded || remote.seeded
  };
}

// ===== ============ CONTRACT B: SLICE REGISTRATION ============ =====
// Verified against sync.js v0.9 API:
//   orosSync.registerSlice(name, getter, setter, storageKey?, mergeFn?)
//   orosSync.markDirty()
// - getter: MUST reflect live editor content → flushSave() first,
//   so a pull/push mid-session never misses keystrokes inside
//   the 500ms debounce window.
// - setter: receives (data, info) — info.merged === true means the
//   value came from a merge (toast), not a wholesale overwrite.
// - storageKey: lets the engine install a closed-app proxy that
//   reads/writes 'oros-writer-data' directly — the slice travels
//   in pushes/pulls EVEN WHEN the app is closed.
// - mergeFn: entity-LWW per doc + tabOrder union — makes the
//   app divergence-guard-exempt (merge-capable slices park
//   nothing; both sides converge on live registration).
// The engine also fires reconcile("register") automatically
// ~100ms after live registration — no app-side pull needed.

function sliceGet() {
  flushSave();               // capture editor → state before read
  return serialize();
}

function sliceSet(data, info) {
  if (!data || typeof data !== 'object') return;
  hydrate(data);             // full sanity-checked hydrate (Section 7)
  renderTabs();
  renderEditor();
  if (info && info.merged) showToast(t('sync.updated'));
}

function registerSlice() {
  if (window.orosSync && typeof window.orosSync.registerSlice === 'function') {
    window.orosSync.registerSlice(
      'writer',              // slice name in the cloud payload
      sliceGet,              // getter
      sliceSet,              // setter
      SLICE_KEY,             // localStorage key for closed-app proxy
      mergeSlices            // mergeFn — deterministic, no Date.now()
    );
  } else {
    // Standalone mode: localStorage only
    try { hydrate(JSON.parse(localStorage.getItem(SLICE_KEY) || 'null')); } catch (e) {}
  }
}

function localPersist() {
  try { localStorage.setItem(SLICE_KEY, JSON.stringify(serialize())); }
  catch (e) { /* quota — the shell snapshots/export remain the safety net */ }
}

/* ===== SECTION 8: SAVE PIPELINE (dirty → 500ms debounce) ===== */
function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
}

function flushSave() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  if (state.activeTab) {
    const doc = activeDoc();
    if (doc) {
      doc.html = editorHTMLForSave();   // strips transient find-hit marks
      doc.mtime = Date.now();
    }
  }
  localPersist();
  if (window.orosSync && typeof window.orosSync.markDirty === 'function') {
    window.orosSync.markDirty();   // core engine: 5s debounce → reconcile
  }
}

/* ===== SECTION 9: RENDER EDITOR FROM ACTIVE DOC ===== */
function renderEditor() {
  const doc = activeDoc();
  EL.editor.innerHTML = doc ? (doc.html || '') : '';
  EL.editor.classList.toggle('editor-empty', !doc || !EL.editor.textContent.trim());
  EL.editor.setAttribute('data-page-size', doc ? doc.pageSize : 'a4');
  updateEmptyState();
  footnotesAfterRender();          // renumber + refresh panel (Wave 3)
  commentsAfterRender();           // refresh comment cards (Wave 3)
  goalAfterRender();               // goal bar + reading progress (Wave 4)
}

function updateEmptyState() {
  const doc = activeDoc();
  EL.editor.classList.toggle('editor-empty',
    !doc || !EL.editor.textContent.trim());
}

/* ===== SECTION 10: TOOLBAR COMMANDS (execCommand era for Wave 1;
   blocks deprecated — Wave 2+ may move to Selection API if needed) ===== */
function exec(cmd, val) {
  EL.editor.focus();
  document.execCommand(cmd, false, val || null);
  scheduleSave();
}

function bindToolbar() {
  const binds = {
    'btn-undo':    () => exec('undo'),
    'btn-redo':    () => exec('redo'),
    'btn-bold':    () => exec('bold'),
    'btn-italic':  () => exec('italic'),
    'btn-underline': () => exec('underline'),
    'btn-strike':  () => exec('strikeThrough'),
    'btn-indent':  () => exec('indent'),
    'btn-outdent': () => exec('outdent'),
    'btn-bullets': () => exec('insertUnorderedList'),
    'btn-numbers': () => exec('insertOrderedList'),
    'btn-align-left':    () => exec('justifyLeft'),
    'btn-align-center':  () => exec('justifyCenter'),
    'btn-align-right':   () => exec('justifyRight'),
    'btn-align-justify': () => exec('justifyFull')
  };

  binds['btn-find'] = () => toggleFindBar();
  binds['btn-chars'] = () => openCharsDialog();

  // btn-lorem does not exist in the static HTML — built here on purpose
  // (single-row toolbar, inherits .tb-btn styling). Placed right after
  // btn-chars: same "insert stuff" group.
  let loremBtn = document.getElementById('btn-lorem');
  if (!loremBtn) {
    loremBtn = document.createElement('button');
    loremBtn.type = 'button';
    loremBtn.id = 'btn-lorem';
    loremBtn.className = 'tb-btn';
    loremBtn.title = t('tt.lorem');
    loremBtn.setAttribute('aria-label', t('tt.lorem'));
    loremBtn.innerHTML = ICONS.lorem;
    const charsBtn = document.getElementById('btn-chars');
    if (charsBtn && charsBtn.parentNode) {
      charsBtn.parentNode.insertBefore(loremBtn, charsBtn.nextSibling);
    } else {
      EL.toolbar.appendChild(loremBtn);
    }
  }
  binds['btn-lorem'] = () => insertLorem();
  binds['btn-footnotes'] = () => toggleFootnotesPanel();
  binds['btn-comments'] = () => toggleCommentsPanel();
  binds['btn-toc'] = () => toggleTocPanel();
  binds['btn-meta'] = () => openMetadataDialog();
  binds['btn-page'] = () => openPageSettings();
  binds['btn-templates'] = () => openTemplates();
  binds['btn-versions'] = () => openVersionsPanel();
  binds['btn-goal'] = () => toggleGoalBar();
  binds['btn-export'] = () => openExportDialog();
  binds['btn-import'] = () => openImportDialog();

  // btn-settings — same dynamic pattern as btn-lorem (R9 icon painting;
  // guarded so a static HTML button, if ever added, is not duplicated)
  let setBtn = document.getElementById('btn-settings');
  if (!setBtn) {
    setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.id = 'btn-settings';
    setBtn.className = 'tb-btn';
    setBtn.title = t('tt.settings');
    setBtn.setAttribute('aria-label', t('tt.settings'));
    setBtn.innerHTML = ICONS.settings;
    EL.toolbar.appendChild(setBtn);
  }
  binds['btn-settings'] = () => openSettingsDialog();

  Object.keys(binds).forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', binds[id]);
  });

  EL.stylesSel.addEventListener('change', () => {
    const v = EL.stylesSel.value;
    EL.editor.focus();
    if (v === 'p') {
      document.execCommand('formatBlock', false, 'p');
    } else if (v === 'pre' || v === 'blockquote') {
      document.execCommand('formatBlock', false, v);
    } else {
      document.execCommand('formatBlock', false, v);
    }
    scheduleSave();
  });

  document.getElementById('btn-hr').addEventListener('click', () => {
    exec('insertHorizontalRule');
  });

  document.getElementById('btn-page-break').addEventListener('click', () => {
    EL.editor.focus();
    const marker = document.createElement('div');
    marker.className = 'page-break-marker';
    marker.contentEditable = 'false';
    insertNodeAtCursor(marker);
    insertNodeAtCursor(document.createElement('p'));
    scheduleSave();
  });

  // Quick Format menu binding (Alt+Right-click)
  EL.editor.addEventListener('contextmenu', (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    openQuickFormat(e.clientX, e.clientY);
  });
}

function insertNodeAtCursor(node) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && sel.getRangeAt(0).collapsed === false) {
    sel.getRangeAt(0).deleteContents();
  }
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.insertNode(node);
  } else {
    EL.editor.appendChild(node);
  }
}

/* ===== SECTION 11: EVENT WIRING ===== */
function wireEvents() {
  // Input — track dirty state and empty-state placeholder
  EL.editor.addEventListener('input', () => {
    dirty = true;
    updateEmptyState();
    scheduleSave();
  });

  // Goal bar + reading progress live refresh (Wave 4)
  EL.editor.addEventListener('input', goalAfterInput);

  // Keyup — special handling for placeholder visibility (edge case: paste via menu)
  EL.editor.addEventListener('keyup', updateEmptyState);

  // Smart typography: transform quotes/dashes/ellipsis right after input
  EL.editor.addEventListener('input', () => {
    if (state.settings.smartTypography) smartTransformLastInsert();
  });

  // Auto-correction: check the word just typed when Space is pressed
  EL.editor.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setTimeout(autoCorrectLastWord, 0);
    }
  });

  // Ctrl/Cmd + F — open find bar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (findBar) findBar.hidden = false;
      else toggleFindBar();
      const inp = findBar.querySelector('input[type="text"]');
      inp.focus(); inp.select();
    }
  });

  // Focus — ensure editor is always ready after tab switch
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.activeTab) {
      flushSave();
    }
  });

  // Before unload — warn if dirty and unsaved (mobile/desktop safety)
  window.addEventListener('beforeunload', (e) => {
    if (dirty && window.oros) {
      // Shell handles sync-on-close; we don't need redundant warning
    }
  });
}

/* ===== SECTION 12: KEYBOARD SHORTCUTS (Bible: avoid browser-reserved combos) ===== */
function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + S — manual save trigger (feedback only — autosave runs anyway)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flushSave();
      showToast(t('doc.saved'));
    }

    // Ctrl+Alt+W — close current tab (browser-reserved-safe combo:
    // plain Ctrl+W closes the browser tab and ignores preventDefault)
    if (e.ctrlKey && e.altKey && !e.metaKey && e.key.toLowerCase() === 'w') {
      if (state.activeTab) {
        e.preventDefault();
        flushSave();
        closeDoc(state.activeTab);
      }
    }

    // Ctrl+Alt+T — new tab (plain Ctrl/T opens a browser tab)
    if (e.ctrlKey && e.altKey && !e.metaKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      createDoc();
    }

    // F2 — rename current tab (alt to dblclick)
    if (e.key === 'F2' && state.activeTab) {
      e.preventDefault();
      const doc = activeDoc();
      const tab = EL.tabBar.querySelector('.tab.active .tab-label');
      if (tab) startTabRename(state.activeTab, tab);
    }

    // Escape — deselect any open UI (future panels)
    if (e.key === 'Escape') {
      // Future: close any open modals/panels
    }
  });
}

/* ===== SECTION 13: BOOT SEQUENCE ===== */
function boot() {
  try {
    // 1. Paint icons first (so buttons have SVG on mount)
    paintIcons();

    // 2. Apply i18n (language + placeholder)
    applyI18n();

    // 3. Register slice (load from localStorage if standalone)
    registerSlice();

    // 4. Render tabs + editor from hydrated state
    renderTabs();
    renderEditor();

    // 5. Bind UI events
    bindToolbar();
    wireEvents();
    bindShortcuts();
    wireFootnoteRefClicks();
    wireCommentMarkEvents();
    startFootnoteObserver();
    wireGoalBar();
    wireReadingProgress();
    ioWireDragDrop();

    // 6. First render — set initial dirty flag based on content
    dirty = false;

    // 7. Boot marker (console log for debugging)
    console.log('[orOS] writer.js booted');

  } catch (err) {
    console.error('[orOS] writer boot failed:', err);
  }
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ===== SECTION 14: DIALOGS & FIND BAR =====

/* ----- Native dialog helpers ----- */
let charsDlg = null;
let acDlg = null;
let findBar = null;

function openDialog(title, bodyHTML, footerButtons) {
  let dlg = document.createElement('dialog');
  dlg.className = 'w-dialog';
  dlg.setAttribute('aria-modal', 'true');

  let head = document.createElement('div');
  head.className = 'w-dialog-head';

  let titleEl = document.createElement('h3');
  titleEl.className = 'w-dialog-title';
  titleEl.textContent = title;

  let closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'w-dialog-close';
  closeBtn.innerHTML = ICONS.close;
  closeBtn.onclick = () => dlg.close();

  head.appendChild(titleEl);
  head.appendChild(closeBtn);

  let body = document.createElement('div');
  body.className = 'w-dialog-body';
  body.innerHTML = bodyHTML;

  let foot = document.createElement('div');
  foot.className = 'w-dialog-foot';
  if (footerButtons && Array.isArray(footerButtons)) {
    footerButtons.forEach(btnConf => {
      let btn = document.createElement('button');
      btn.type = 'button';
      btn.className = btnConf.class || 'fb-btn';
      btn.textContent = btnConf.label;
      btn.onclick = btnConf.onClick;
      foot.appendChild(btn);
    });
  }

  dlg.appendChild(head);
  dlg.appendChild(body);
  dlg.appendChild(foot);

  // Close on outside click or Esc (native)
  dlg.showModal();
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  return dlg;
}

/* ----- FIND & REPLACE BAR ----- */
let findState = {
  query: '',
  hits: [],
  index: -1,
  wrap: true,
  matchCase: false,
  wholeWord: false,
  formatOnly: false,
  formatFilter: null // 'bold'|'italic'|'underline'|'strike'|null
};

function toggleFindBar() {
  if (findBar) {
    findBar.hidden = !findBar.hidden;
    if (!findBar.hidden) {
      findBar.querySelector('input[type="text"]').focus();
      findBar.querySelector('input[type="text"]').select();
    }
    return;
  }

  findBar = document.createElement('div');
  findBar.className = 'find-bar';
  findBar.setAttribute('role', 'search');
  findBar.hidden = false;
  EL.toolbar.parentNode.insertBefore(findBar, EL.toolbar.nextSibling);

  const html = `
    <input type="text" placeholder="${t('tt.find')}" aria-label="Search text">
    <span class="find-count"></span>
    <button type="button" class="fb-btn" data-action="prev">${ICONS.prev||ICONS.indent}</button>
    <button type="button" class="fb-btn primary" data-action="next">${ICONS.next||ICONS.indent}</button>
    <span class="tb-sep"></span>
    <label class="fb-opt"><input type="checkbox" id="opt-case"> ${t('opt.case')}</label>
    <label class="fb-opt"><input type="checkbox" id="opt-word"> ${t('opt.word')}</label>
    <select id="opt-fmt" class="styles-select" style="max-width:150px;">
      <option value="">${t('opt.format.any')}</option>
      <option value="bold">${t('opt.format.bold')}</option>
      <option value="italic">${t('opt.format.italic')}</option>
      <option value="underline">${t('opt.format.underline')}</option>
      <option value="strike">${t('opt.format.strike')}</option>
    </select>
    <input type="text" id="rep-text" placeholder="${t('opt.replace')}" style="min-width:100px;">
    <button type="button" class="fb-btn" data-action="rep1" title="${t('opt.rep1')}">${t('opt.rep1')}</button>
    <button type="button" class="fb-btn primary" data-action="repall" title="${t('opt.repall')}">${t('opt.repall')}</button>
  `;
  findBar.innerHTML = html;

  // Wire events
  const input = findBar.querySelector('input[type="text"]');
  input.addEventListener('input', () => {
    findState.query = input.value;
    findAndMark();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findNext();
    }
    if (e.key === 'Escape') {
      findBar.hidden = true;
      EL.editor.focus();
    }
  });

  findBar.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const act = e.currentTarget.dataset.action;
      if (act === 'prev') findPrev();
      else if (act === 'next') findNext();
      else if (act === 'rep1') replaceOne();
      else if (act === 'repall') replaceAll();
    });
  });

  document.getElementById('opt-case').addEventListener('change', findAndMark);
  document.getElementById('opt-word').addEventListener('change', findAndMark);
  document.getElementById('opt-fmt').addEventListener('change', findAndMark);

  // Dedicated search button (adjacent to prev — no Enter-only flow)
  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'fb-btn';
  searchBtn.title = t('tt.find');
  searchBtn.innerHTML = ICONS.find;
  searchBtn.addEventListener('click', findAndMark);
  findBar.insertBefore(searchBtn, findBar.children[3]);
}

function findAndMark() {
  clearHighlights();
  if (!findBar) return;
  findState.query = findBar.querySelector('input[type="text"]').value;
  if (!findState.query) { updateCount(0, 0); return; }

  findState.matchCase = document.getElementById('opt-case').checked;
  findState.wholeWord = document.getElementById('opt-word').checked;
  findState.formatFilter = document.getElementById('opt-fmt').value || null;

  const walker = document.createTreeWalker(EL.editor, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach(node => {
    const txt = node.nodeValue;
    if (!txt) return;
    if (findState.formatFilter &&
        !nodeHasFormat(node.parentElement, findState.formatFilter)) return;

    const flags = findState.matchCase ? 'g' : 'gi';
    const body = escapeRegex(findState.query);
    const pattern = findState.wholeWord ? '\\b' + body + '\\b' : body;
    const matches = [...txt.matchAll(new RegExp(pattern, flags))];
    highlightMatches(node, matches);
  });

  if (findState.hits.length > 0) { findState.index = 0; highlightActive(); }
  else updateCount(0, 0);
}

// Format check walks up to the editor — bold/italic/etc. are
// inherited properties. Ignores find-hit marks themselves.
function nodeHasFormat(el, fmt) {
  while (el && el !== EL.editor) {
    if (el.classList && el.classList.contains('find-hit')) { el = el.parentElement; continue; }
    const cs = getComputedStyle(el);
    if (fmt === 'bold'      && parseInt(cs.fontWeight, 10) >= 600) return true;
    if (fmt === 'italic'    && cs.fontStyle === 'italic') return true;
    if (fmt === 'underline' && cs.textDecorationLine.indexOf('underline') !== -1) return true;
    if (fmt === 'strike'    && cs.textDecorationLine.indexOf('line-through') !== -1) return true;
    el = el.parentElement;
  }
  return false;
}

function highlightMatches(textNode, matches) {
  matches.forEach((m) => {
    const start = m.index;
    const end = start + m[0].length;
    if (start < 0 || end > textNode.nodeValue.length) return;

    const before = textNode.nodeValue.slice(0, start);
    const match = textNode.nodeValue.slice(start, end);
    const after = textNode.nodeValue.slice(end);

    const fragment = document.createDocumentFragment();
    if (before) fragment.appendChild(document.createTextNode(before));

    const span = document.createElement('mark');
    span.className = 'find-hit';
    span.textContent = match;
    fragment.appendChild(span);

    if (after) fragment.appendChild(document.createTextNode(after));

    textNode.parentNode.replaceChild(fragment, textNode);

    findState.hits.push(span);
  });
}

function clearHighlights() {
  findState.hits.forEach(hit => {
    const parent = hit.parentNode;
    const frag = document.createDocumentFragment();
    while (hit.firstChild) frag.appendChild(hit.firstChild);
    parent.replaceChild(frag, hit);
  });
  findState.hits = [];
  findState.index = -1;
}

function findNext() {
  if (findState.hits.length === 0) return;
  findState.index = (findState.index + 1) % findState.hits.length;
  highlightActive();
}

function findPrev() {
  if (findState.hits.length === 0) return;
  findState.index = (findState.index - 1 + findState.hits.length) % findState.hits.length;
  highlightActive();
}

function highlightActive() {
  findState.hits.forEach((hit, i) => {
    hit.classList.toggle('find-hit-active', i === findState.index);
  });
  const active = findState.hits[findState.index];
  if (active) {
    active.scrollIntoView({ block: 'center', inline: 'nearest' });
    const range = document.createRange();
    range.selectNode(active);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  updateCount(findState.hits.length, findState.index + 1);
}

function updateCount(total, curr) {
  const countEl = findBar.querySelector('.find-count');
  if (total === 0) countEl.textContent = t('find.none');
  else countEl.textContent = t('find.count').replace('{current}', curr).replace('{total}', total);
}

function replaceOne() {
  if (findState.index < 0 || findState.index >= findState.hits.length) return;
  const hit = findState.hits[findState.index];
  const rep = findBar.querySelector('#rep-text').value;
  hit.textContent = rep;
  scheduleSave();
  findNext();
}

function replaceAll() {
  if (findState.query === '') return;
  const rep = findBar.querySelector('#rep-text').value;
  findState.hits.forEach(hit => { hit.textContent = rep; });
  scheduleSave();
  clearHighlights();
  showToast(t('find.replaced.all'));
}

// ===== SECTION 15: WRITING TOOLS =====

/* ----- SPECIAL CHARACTERS ----- */
const CHAR_SETS = {
  greek: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ αβγδεζηθικλμνξοπρσςτυφχψω άέήίόύώ ΆΈΉΊΌΎΏ ΪΫΐΰ',
  math:  '±×÷≈≠≤≥∞∫∑√∂∆πµ°′″№¬∅∈∉⊂⊃∪∩∴∵∝¹²³₀₁₂₃½¼¾⅓⅔',
  arrows:'←↑→↓↔↕⇐⇒⇑⇓↦↗↘↖↩↪⇄⇆',
  currency:'€$£¥₽₹₺₴₩₫¢¤฿₿',
  punct: '«»„“”‚‘’—–…‹›…­!؟؛،·',
  symbols:'©®™§¶†‡•◦※♠♣♥♦♪♫☼☁★☆☐☑☒✓✗⚠⚑⚪⚫',
  emoji:  '😀😄😊😉😍🤔😐😴😢😡🥳😎🤩🫠🙃😈🤖👍👎👏🙏💪🤝✍️📖✏️📝📌📎🗓️☕🍕🎉🎂🏠🌍🌙⭐🔥💧'
};

let charsDlgRef = null;

function openCharsDialog() {
  const dlg = openDialog(t('dialog.charsTitle'), '', [
    { class: 'fb-btn', label: t('wx.cancel'), onClick: () => dlg.close() }
  ]);
  charsDlgRef = dlg;

  const body = dlg.querySelector('.w-dialog-body');
  const tabs = document.createElement('div');
  tabs.className = 'chars-tabs';
  Object.keys(CHAR_SETS).forEach(k => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'chars-tab' + (k === 'greek' ? ' active' : '');
    tab.textContent = t('char.' + k);
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.chars-tab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      renderCharGrid(k);
    });
    tabs.appendChild(tab);
  });
  body.appendChild(tabs);

  const gridWrap = document.createElement('div');
  body.appendChild(gridWrap);

  function renderCharGrid(setKey) {
    gridWrap.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'char-grid';
    [...CHAR_SETS[setKey]].forEach(ch => {
      if (ch === ' ') return;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'char-cell' + (setKey === 'emoji' ? ' is-emoji' : '');
      cell.textContent = ch;
      cell.title = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      cell.addEventListener('click', () => {
        insertTextAtCursor(ch);
        scheduleSave();
      });
      grid.appendChild(cell);
    });
    gridWrap.appendChild(grid);
  }
  renderCharGrid('greek');
}

function insertTextAtCursor(text) {
  EL.editor.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    EL.editor.appendChild(document.createTextNode(text));
  }
}

/* ----- SMART TYPOGRAPHY (post-input transforms at caret) ----- */
const ST_PAIRS = {
  '"': ['\u201C', '\u201D'],   // curly double quotes, direction by context
  "'": ['\u2018', '\u2019'],   // curly apostrophes
  '--': null,                   // handled as triggers below
  '...': '\u2026'
};

function smartTransformLastInsert() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  if (node.nodeType !== 3) return;
  const caret = sel.getRangeAt(0).startOffset;
  if (caret < 1) return;

  const before = node.nodeValue.slice(0, caret);
  let transformed = false;
  const range = document.createRange();

  // Dash sequences
  const dash = before.match(/(\-\-\-|\-\-)$/);
  if (dash) {
    const rep = dash[1] === '---' ? '\u2014' : '\u2013';
    node.nodeValue = before.slice(0, caret - dash[1].length) + rep + node.nodeValue.slice(caret);
    range.setStart(node, caret - dash[1].length + rep.length);
    range.setEnd(node, caret - dash[1].length + rep.length);
    transformed = true;
  }

  // Ellipsis
  if (!transformed && /\.\.\.$/.test(before)) {
    node.nodeValue = before.slice(0, caret - 3) + '\u2026' + node.nodeValue.slice(caret);
    range.setStart(node, caret - 2);
    range.setEnd(node, caret - 2);
    transformed = true;
  }

  // Curly quotes (direction: opening if previous char is start/space/open-bracket)
  if (!transformed && /["']$/.test(before)) {
    const q = before.slice(-1);
    const prev = before.slice(0, -1).slice(-1);
    const isOpen = prev === '' || /[\s\(\[\{>\u2013\u2014\u201C\u2018]/.test(prev);
    const pair = ST_PAIRS[q];
    const rep = isOpen ? pair[0] : pair[1];
    node.nodeValue = before.slice(0, caret - 1) + rep + node.nodeValue.slice(caret);
    range.setStart(node, caret);
    range.setEnd(node, caret);
    transformed = true;
  }

  if (transformed) {
    sel.removeAllRanges();
    sel.addRange(range);
    scheduleSave();
  }
}

/* ----- AUTO-CORRECTION RULES ----- */
const AC_DEFAULTS = [
  { find: '(c)',  repl: '©',  def: true },
  { find: '(tm)', repl: '™',  def: true },
  { find: '->',   repl: '→',  def: true },
  { find: '1/2',  repl: '½',  def: true },
  { find: '(r)',  repl: '®',  def: true }
];

function acRules() {
  if (!state.autocorrect || !Array.isArray(state.autocorrect.rules)) return AC_DEFAULTS;
  return state.autocorrect.rules;
}

function autoCorrectLastWord() {
  const rules = acRules();
  if (!rules.length) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  if (node.nodeType !== 3) return;
  const caret = sel.getRangeAt(0).startOffset;
  const before = node.nodeValue.slice(0, caret);
  const word = before.slice(-24);

  for (const rule of rules) {
    if (rule && rule.find && word.endsWith(rule.find)) {
      const range = document.createRange();
      range.setStart(node, caret - rule.find.length);
      range.setEnd(node, caret);
      range.deleteContents();
      range.insertNode(document.createTextNode(rule.repl));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      scheduleSave();
      return;
    }
  }
}

let acDlgRef = null;

function openAcDialog() {
  const dlg = openDialog(t('dialog.acTitle'), '', [
    { class: 'fb-btn', label: t('ac.reset'), onClick: resetAcDefaults },
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => dlg.close() }
  ]);
  acDlgRef = dlg;
  const body = dlg.querySelector('.w-dialog-body');
  renderAcBody(body);
}

function renderAcBody(body) {
  body.innerHTML = '';
  const rows = document.createElement('div');
  rows.className = 'ac-rows';
  acRules().forEach((rule, idx) => {
    const row = document.createElement('div');
    row.className = 'ac-row';

    const f = document.createElement('input');
    f.type = 'text'; f.className = 'w-field';
    f.value = rule.find; f.readOnly = true;
    const arrow = document.createElement('span');
    arrow.className = 'ac-arrow'; arrow.textContent = '→';
    const r = document.createElement('input');
    r.type = 'text'; r.className = 'w-field';
    r.value = rule.repl; r.readOnly = true;

    const badge = rule.def
      ? (b => { b.className = 'ac-badge'; b.textContent = t('ac.default'); return b; })(document.createElement('span'))
      : document.createElement('span');

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ac-icon-btn danger';
    del.innerHTML = ICONS.trash;
    del.title = t('doc.deleted');
    del.addEventListener('click', () => {
      state.autocorrect.rules.splice(idx, 1);
      state.autocorrect.mtime = Date.now();
      scheduleSave();
      renderAcBody(body);
    });

    row.append(f, arrow, r, badge, del);
    rows.appendChild(row);
  });
  body.appendChild(rows);

  const add = document.createElement('div');
  add.className = 'ac-add-row';
  add.innerHTML = `
    <input type="text" class="w-field" id="ac-new-find" placeholder="&hellip;">
    <span class="ac-arrow">→</span>
    <input type="text" class="w-field" id="ac-new-repl" placeholder="${t('ac.replace')}">
    <button type="button" class="fb-btn primary" id="ac-new-add">+</button>
  `;
  body.appendChild(add);

  add.querySelector('#ac-new-add').addEventListener('click', () => {
    const fnd = add.querySelector('#ac-new-find').value.trim();
    const rpl = add.querySelector('#ac-new-repl').value;
    if (!fnd || !rpl) return;
    if (!state.autocorrect) state.autocorrect = { rules: [], mtime: Date.now() };
    state.autocorrect.rules.push({ find: fnd, repl: rpl, def: false });
    state.autocorrect.mtime = Date.now();
    scheduleSave();
    renderAcBody(body);
  });
}

function resetAcDefaults() {
  state.autocorrect = {
    rules: JSON.parse(JSON.stringify(AC_DEFAULTS)),
    mtime: Date.now()
  };
  scheduleSave();
  if (acDlgRef) renderAcBody(acDlgRef.querySelector('.w-dialog-body'));
  showToast(t('ac.saved'));
}

/* ----- LOREM IPSUM ----- */
const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';

function insertLorem() {
  const p = document.createElement('p');
  p.textContent = LOREM;
  insertNodeAtCursor(p);
  scheduleSave();
}

/* ----- SETTINGS (app-scoped, minimal: typography + auto-correct) ----- */
function openSettingsDialog() {
  const dlg = openDialog(t('tt.settings'), `
    <div class="form-grid">
      <label class="full" style="text-align:left;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="set-smart" ${state.settings.smartTypography ? 'checked' : ''}>
        ${t('tt.smartTypography')}
      </label>
    </div>
  `, [
    { class: 'fb-btn', label: t('tt.autoCorrect'), onClick: () => openAcDialog() },
    { class: 'fb-btn primary', label: 'OK', onClick: () => dlg.close() }
  ]);

  // Live-apply, autosave design — no save button. _mtime drives the
  // settings LWW branch in mergeSlices (Section 7).
  dlg.querySelector('#set-smart').addEventListener('change', (e) => {
    state.settings.smartTypography = e.target.checked;
    state.settings._mtime = Date.now();
    scheduleSave();
  });
}

/* ----- QUICK FORMAT MENU (Alt+Right-click) ----- */
let qfMenu = null;

function closeQfMenu() {
  if (qfMenu) { qfMenu.remove(); qfMenu = null; }
}

function openQuickFormat(x, y) {
  closeQfMenu();
  const sel = window.getSelection();
  const hasSel = sel && sel.rangeCount && !sel.getRangeAt(0).collapsed;

  qfMenu = document.createElement('div');
  qfMenu.className = 'qf-menu';

  const items = [
    { key: 'tt.qf.bold',   cmd: 'bold',   check: () => document.queryCommandState('bold') },
    { key: 'tt.qf.italic', cmd: 'italic', check: () => document.queryCommandState('italic') },
    { key: 'tt.qf.underline', cmd: 'underline', check: () => document.queryCommandState('underline') },
    { key: 'tt.qf.strike', cmd: 'strikeThrough', check: () => document.queryCommandState('strikeThrough') },
    null,
    { key: 'tt.qf.ulist', cmd: 'insertUnorderedList', check: () => document.queryCommandState('insertUnorderedList') },
    { key: 'tt.qf.nlist', cmd: 'insertOrderedList', check: () => document.queryCommandState('insertOrderedList') },
    null,
    { key: 'tt.qf.link',  action: () => openLinkDialog() },
    { key: 'tt.qf.image', action: () => openImageDialog() },
    { key: 'tt.qf.table', action: () => openTableDialog() }
  ];

  items.forEach(item => {
    if (item === null) {
      const sep = document.createElement('div');
      sep.className = 'qf-sep';
      qfMenu.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qf-item';
    const label = document.createElement('span');
    label.textContent = t(item.key);
    btn.appendChild(label);
    const check = document.createElement('span');
    check.className = 'qf-check';
    check.innerHTML = ICONS.check;
    btn.appendChild(check);

    if (item.cmd) {
      let on = false;
      try { on = hasSel && item.check(); } catch (e) { on = false; }
      if (on) btn.classList.add('on');
      btn.addEventListener('click', () => { exec(item.cmd); closeQfMenu(); });
    } else if (item.action) {
      btn.addEventListener('click', () => { closeQfMenu(); item.action(); });
    }
    qfMenu.appendChild(btn);
  });

  document.body.appendChild(qfMenu);

  // Clamp within viewport
  const rect = qfMenu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  qfMenu.style.left = px + 'px';
  qfMenu.style.top = py + 'px';

  setTimeout(() => {
    document.addEventListener('click', closeQfOnce, { once: true });
    document.addEventListener('contextmenu', closeQfOnce, { once: true });
  }, 0);
}
function closeQfOnce() { closeQfMenu(); }

/* ----- LINK / IMAGE / TABLE DIALOGS ----- */
function openLinkDialog() {
  const selText = (() => {
    const sel = window.getSelection();
    return (sel && sel.rangeCount) ? sel.toString() : '';
  })();
  const dlg = openDialog(t('tt.qf.link'), `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <input type="text" class="w-field" id="lk-text" placeholder="${t('link.displayText')}">
      <input type="url" class="w-field" id="lk-url" placeholder="https://…">
    </div>
  `, [
    { class: 'fb-btn', label: t('wx.cancel'), onClick: () => dlg.close() },
    { class: 'fb-btn primary', label: 'OK', onClick: () => { doInsertLink(dlg); } }
  ]);
  dlg.querySelector('#lk-text').value = selText;
}

function doInsertLink(dlg) {
  const text = dlg.querySelector('#lk-text').value.trim();
  const url = dlg.querySelector('#lk-url').value.trim();
  if (!url) return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) sel.getRangeAt(0).deleteContents();
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text || url;
  insertNodeAtCursor(a);
  insertNodeAtCursor(document.createTextNode(' '));
  scheduleSave();
  dlg.close();
}

function openImageDialog() {
  const dlg = openDialog(t('tt.qf.image'), `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <input type="url" class="w-field" id="img-url" placeholder="https://…">
      <input type="file" accept="image/*" id="img-file" class="w-field" style="height:auto;padding:6px;">
      <input type="text" class="w-field" id="img-cap" placeholder="Caption">
    </div>
  `, [
    { class: 'fb-btn', label: t('wx.cancel'), onClick: () => dlg.close() },
    { class: 'fb-btn primary', label: 'OK', onClick: () => { doInsertImage(dlg); } }
  ]);

  dlg.querySelector('#img-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { dlg.querySelector('#img-url').value = reader.result; };
    reader.readAsDataURL(file);
  });
}

function doInsertImage(dlg) {
  const url = dlg.querySelector('#img-url').value.trim();
  const cap = dlg.querySelector('#img-cap').value.trim();
  if (!url) return;
  const fig = document.createElement('figure');
  fig.style.margin = '1em 0';
  fig.style.textAlign = 'center';
  const img = document.createElement('img');
  img.src = url;
  img.style.maxWidth = '100%';
  fig.appendChild(img);
  if (cap) {
    const c = document.createElement('figcaption');
    c.textContent = cap;
    c.style.fontSize = '0.85em';
    c.style.color = 'var(--text-dim)';
    fig.appendChild(c);
  }
  insertNodeAtCursor(fig);
  scheduleSave();
  dlg.close();
}

function openTableDialog() {
  const dlg = openDialog(t('tt.qf.table'), `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="number" class="w-field" id="tbl-r" min="1" max="20" value="3" style="width:70px;"> ×
        <input type="number" class="w-field" id="tbl-c" min="1" max="10" value="3" style="width:70px;">
      </label>
      <label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="tbl-h"> ${t('table.headerRow')}</label>
    </div>
  `, [
    { class: 'fb-btn', label: '✕', onClick: () => dlg.close() },
    { class: 'fb-btn', label: t('wx.cancel'), onClick: () => dlg.close() },
  ]);
}

function doInsertTable(dlg) {
  const rows = Math.max(1, Math.min(20, parseInt(dlg.querySelector('#tbl-r').value, 10) || 3));
  const cols = Math.max(1, Math.min(10, parseInt(dlg.querySelector('#tbl-c').value, 10) || 3));
  const withHeader = dlg.querySelector('#tbl-h').checked;

  const tbl = document.createElement('table');
  tbl.style.borderCollapse = 'collapse';
  tbl.style.width = '100%';
  tbl.style.margin = '1em 0';
  for (let r = 0; r < rows + (withHeader ? 1 : 0); r++) {
    const tr = tbl.insertRow();
    for (let c = 0; c < cols; c++) {
      const cell = tr.insertCell();
      cell.style.border = '1px solid var(--border)';
      cell.style.padding = '6px 10px';
      cell.textContent = '\u00A0';
      if (withHeader && r === 0) cell.style.background = 'var(--panel-bg)';
    }
  }
  insertNodeAtCursor(tbl);
  insertNodeAtCursor(document.createElement('p'));
  scheduleSave();
  dlg.close();
}

// ===== SECTION 16: FOOTNOTES =====
//
// Model:
//   In text:   <sup class="fn-ref" data-fn="FN_ID">n</sup>
//   In slice:  doc.footnotes = [{ id:'FN_ID', text:'…' }]
// The DOM ORDER of the refs defines numbering (1..n, renumbered on
// every structural change). Panel entries are rendered in ref
// order — numeric sorting, never alphabetical.
//
// Invariants:
//   · Every sup.fn-ref has a matching entry (orphan refs removed).
//   · Every entry has at least one ref (orphan entries removed).
//   · Deleting ref text in the editor removes the entry too
//     (MutationObserver → cleanup, debounced 300ms).

let fnPanel = null;
let fnObserver = null;
let fnCleanupTimer = null;
let fnSuspendObserver = false;

/* ----- Helpers ----- */
function fnRefs() {
  return Array.from(EL.editor.querySelectorAll('sup.fn-ref'));
}

function fnDoc() {
  const doc = activeDoc();
  if (doc && !Array.isArray(doc.footnotes)) doc.footnotes = [];
  return doc;
}

function fnEntry(id) {
  const doc = fnDoc();
  return doc ? doc.footnotes.find(f => f.id === id) : null;
}

/* ----- Renumber: DOM order → 1..n. Returns true if changed. ----- */
function renumberFootnotes() {
  let changed = false;
  fnRefs().forEach((ref, i) => {
    const n = String(i + 1);
    if (ref.textContent !== n) { ref.textContent = n; changed = true; }
  });
  return changed;
}

/* ----- Orphan cleanup: refs without entries & entries without refs ----- */
function cleanupFootnotes() {
  const doc = fnDoc();
  if (!doc) return false;
  let changed = false;

  // refs pointing nowhere → remove the ref
  fnRefs().forEach(ref => {
    if (!fnEntry(ref.dataset.fn)) { ref.remove(); changed = true; }
  });

  // entries without any ref → remove the entry
  const ids = new Set(fnRefs().map(r => r.dataset.fn));
  const before = doc.footnotes.length;
  doc.footnotes = doc.footnotes.filter(f => ids.has(f.id));
  if (doc.footnotes.length !== before) changed = true;

  if (renumberFootnotes()) changed = true;

  if (changed) {
    if (fnPanel && !fnPanel.hidden) renderFootnotesPanel();
    scheduleSave();
  }
  return changed;
}

/* ----- Add: sup at cursor + empty entry + renumber ----- */
function addFootnote() {
  const doc = fnDoc();
  if (!doc) return;
  const id = 'fn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = { id: id, text: '' };
  doc.footnotes.push(entry);

  fnSuspendObserver = true;
  const sup = document.createElement('sup');
  sup.className = 'fn-ref';
  sup.dataset.fn = id;
  sup.textContent = '*';
  insertNodeAtCursor(sup);
  renumberFootnotes();
  fnSuspendObserver = false;

  scheduleSave();
  if (!fnPanel || fnPanel.hidden) toggleFootnotesPanel();
  renderFootnotesPanel();
  showToast(t('fn.added'));

  // focus the new entry's textarea after render
  const ta = fnPanel && fnPanel.querySelector('[data-fn-input="' + id + '"]');
  if (ta) { ta.focus(); }
}

/* ----- Bidirectional jump: ref ⇄ entry ----- */
function jumpToEntry(id) {
  if (!fnPanel || fnPanel.hidden) toggleFootnotesPanel();
  renderFootnotesPanel();
  const entry = fnPanel.querySelector('[data-fn-entry="' + id + '"]');
  if (!entry) return;
  entry.scrollIntoView({ block: 'center', behavior: 'smooth' });
  entry.classList.remove('flash');
  void entry.offsetWidth;           // restart animation
  entry.classList.add('flash');
}

function jumpToRef(id) {
  const ref = EL.editor.querySelector('sup.fn-ref[data-fn="' + id + '"]');
  if (!ref) return;
  ref.scrollIntoView({ block: 'center', behavior: 'smooth' });
  ref.classList.remove('hl');
  void ref.offsetWidth;
  ref.classList.add('hl');
  setTimeout(() => ref.classList.remove('hl'), 1200);
  const range = document.createRange();
  range.setStartBefore(ref);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ----- Panel ----- */
function toggleFootnotesPanel() {
  if (!fnPanel) buildFootnotesPanel();
  fnPanel.hidden = !fnPanel.hidden;
  const commentsOpen = document.getElementById('cmt-panel');
  if (!fnPanel.hidden) {
    if (commentsOpen && !commentsOpen.hidden) commentsOpen.hidden = true;
    EL.wrapper.classList.add('has-side-panel');
    renderFootnotesPanel();
  } else {
    EL.wrapper.classList.remove('has-side-panel');
  }
}

function buildFootnotesPanel() {
  fnPanel = document.createElement('div');
  fnPanel.className = 'side-panel';
  fnPanel.id = 'fn-panel';
  fnPanel.hidden = true;

  const head = document.createElement('div');
  head.className = 'side-panel-head';
  head.innerHTML =
    '<h3 class="side-panel-title">' + esc(t('fn.title')) +
    ' <span class="side-panel-count" data-fn-count></span></h3>';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sp-close';
  closeBtn.innerHTML = ICONS.close;
  closeBtn.title = t('tab.close');
  closeBtn.addEventListener('click', () => toggleFootnotesPanel());
  head.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'side-panel-body';
  body.setAttribute('data-fn-body', '');

  const foot = document.createElement('div');
  foot.className = 'side-panel-foot';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'fb-btn primary';
  addBtn.textContent = '+ ' + t('fn.add');
  addBtn.addEventListener('click', addFootnote);
  foot.appendChild(addBtn);

  fnPanel.append(head, body, foot);
  EL.wrapper.appendChild(fnPanel);
}

/* Render: entries in REF ORDER (DOM position), never alphabetical,
   never storage order. */
function renderFootnotesPanel() {
  if (!fnPanel) return;
  const doc = fnDoc();
  const body = fnPanel.querySelector('[data-fn-body]');
  if (!body) return;
  body.innerHTML = '';

  const refs = fnRefs();
  fnPanel.querySelector('[data-fn-count]').textContent = String(refs.length);

  if (!doc || refs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fn-empty';
    empty.textContent = t('fn.empty');
    body.appendChild(empty);
    return;
  }

  const seen = new Set();
  refs.forEach(ref => {
    const id = ref.dataset.fn;
    if (seen.has(id)) return;               // multiple refs → one entry
    seen.add(id);
    const entry = fnEntry(id);
    if (!entry) return;

    const row = document.createElement('div');
    row.className = 'fn-entry';
    row.dataset.fnEntry = id;

    const num = document.createElement('div');
    num.className = 'fn-entry-num';
    num.textContent = ref.textContent;
    num.title = t('fn.jumpHint');
    num.addEventListener('click', () => jumpToRef(id));

    const ta = document.createElement('div');
    ta.className = 'fn-entry-text';
    ta.contentEditable = 'true';
    ta.dataset.fnInput = id;
    ta.textContent = entry.text || '';
    ta.addEventListener('input', () => {
      const e = fnEntry(id);
      if (e) { e.text = ta.textContent; scheduleSave(); }
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ta.blur();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'fn-entry-del';
    del.innerHTML = ICONS.trash;
    del.title = t('cmt.delete');
    del.addEventListener('click', () => {
      // remove ALL refs of this entry from the text
      fnSuspendObserver = true;
      EL.editor.querySelectorAll('sup.fn-ref[data-fn="' + id + '"]').forEach(r => r.remove());
      fnSuspendObserver = false;
      const d = fnDoc();
      if (d) d.footnotes = d.footnotes.filter(f => f.id !== id);
      renumberFootnotes();
      scheduleSave();
      renderFootnotesPanel();
    });

    row.append(num, ta, del);
    body.appendChild(row);
  });
}

/* ----- Click on ref in editor → jump to entry ----- */
function wireFootnoteRefClicks() {
  EL.editor.addEventListener('click', (e) => {
    const ref = e.target.closest('sup.fn-ref');
    if (ref && ref.dataset.fn) jumpToEntry(ref.dataset.fn);
  });
}

/* ----- MutationObserver: live orphan cleanup + renumber ----- */
function startFootnoteObserver() {
  if (fnObserver) fnObserver.disconnect();
  fnObserver = new MutationObserver(() => {
    if (fnSuspendObserver) return;
    clearTimeout(fnCleanupTimer);
    fnCleanupTimer = setTimeout(() => {
      cleanupFootnotes();
      cleanupComments();
    }, 300);
  });
  fnObserver.observe(EL.editor, {
    childList: true, subtree: true, characterData: true
  });
}

/* ----- Restore on tab switch: cleanup after render (handles docs
   whose refs were edited/deleted elsewhere in the meantime) ----- */
function footnotesAfterRender() {
  renumberFootnotes();
  if (fnPanel && !fnPanel.hidden) renderFootnotesPanel();
}

// ===== SECTION 17: COMMENTS =====
//
// Model:
//   In text:   <mark class="cmt-mark" data-cmt="CMT_ID">quoted text</mark>
//   In slice:  doc.comments = [{ id, quote, text, ts }]
//
// Behavior (faithful to the beta audit requirements):
//   · Add requires an ACTIVE SELECTION (capture quote at creation).
//   · Deleting the marked text in the editor removes the comment
//     automatically (observer → cleanup).
//   · Bidirectional: click mark → card scroll+flash; click card
//     quote → mark scroll+flash; hover either side → both highlight.
//   · Meta = TIMESTAMP ONLY (no user labels).
//   · Every mark has an entry; every entry has a mark.

let cmtPanel = null;
let cmtSuspendObserver = false;

/* ----- Helpers ----- */
function cmtMarks() {
  return Array.from(EL.editor.querySelectorAll('mark.cmt-mark'));
}

function cmtDoc() {
  const doc = activeDoc();
  if (doc && !Array.isArray(doc.comments)) doc.comments = [];
  return doc;
}

function cmtEntry(id) {
  const doc = cmtDoc();
  return doc ? doc.comments.find(c => c.id === id) : null;
}

/* ----- Cleanup: marks without entries & entries without marks ----- */
function cleanupComments() {
  const doc = cmtDoc();
  if (!doc) return false;
  let changed = false;

  cmtMarks().forEach(mark => {
    if (!cmtEntry(mark.dataset.cmt)) { mark.remove(); changed = true; }
  });

  const ids = new Set(cmtMarks().map(m => m.dataset.cmt));
  const before = doc.comments.length;
  doc.comments = doc.comments.filter(c => ids.has(c.id));
  if (doc.comments.length !== before) changed = true;

  if (changed) {
    if (cmtPanel && !cmtPanel.hidden) renderCommentsPanel();
    scheduleSave();
  }
  return changed;
}

/* ----- Add: wrap the selection in a mark, create entry ----- */
function addComment() {
  const doc = cmtDoc();
  if (!doc) return;

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.getRangeAt(0).collapsed) {
    showToast(t('cmt.empty'));
    return;
  }

  const id = 'cm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = { id: id, quote: sel.toString(), text: '', ts: Date.now() };
  doc.comments.push(entry);

  cmtSuspendObserver = true;
  try {
    const range = sel.getRangeAt(0);
    const mark = document.createElement('mark');
    mark.className = 'cmt-mark';
    mark.dataset.cmt = id;
    range.surroundContents(mark);
    sel.removeAllRanges();
    const after = document.createRange();
    after.setStartAfter(mark);
    after.collapse(true);
    sel.addRange(after);
  } catch (e) {
    cmtSuspendObserver = false;
    doc.comments = doc.comments.filter(c => c.id !== id);
    showToast(t('cmt.empty'));
    return;
  }
  cmtSuspendObserver = false;

  scheduleSave();
  if (!cmtPanel || cmtPanel.hidden) toggleCommentsPanel();
  renderCommentsPanel();

  const ta = cmtPanel && cmtPanel.querySelector('[data-cmt-input="' + id + '"]');
  if (ta) ta.focus();
}

/* ----- Bidirectional jumps + hover highlight ----- */
function jumpToCard(id) {
  if (!cmtPanel || cmtPanel.hidden) toggleCommentsPanel();
  renderCommentsPanel();
  const card = cmtPanel.querySelector('[data-cmt-card="' + id + '"]');
  if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
}

function jumpToMark(id) {
  const mark = EL.editor.querySelector('mark.cmt-mark[data-cmt="' + id + '"]');
  if (!mark) return;
  mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setPairHighlight(id, true);
  setTimeout(() => setPairHighlight(id, false), 1200);
}

function setPairHighlight(id, on) {
  const mark = EL.editor.querySelector('mark.cmt-mark[data-cmt="' + id + '"]');
  const card = cmtPanel && cmtPanel.querySelector('[data-cmt-card="' + id + '"]');
  if (mark) mark.classList.toggle('hl', on);
  if (card) card.classList.toggle('flash', on);
}

/* ----- Panel ----- */
function toggleCommentsPanel() {
  if (!cmtPanel) buildCommentsPanel();
  cmtPanel.hidden = !cmtPanel.hidden;
  const fnOpen = document.getElementById('fn-panel');
  if (!cmtPanel.hidden) {
    if (fnOpen && !fnOpen.hidden) fnOpen.hidden = true;
    EL.wrapper.classList.add('has-side-panel');
    renderCommentsPanel();
  } else {
    EL.wrapper.classList.remove('has-side-panel');
  }
}

function buildCommentsPanel() {
  cmtPanel = document.createElement('div');
  cmtPanel.className = 'side-panel';
  cmtPanel.id = 'cmt-panel';
  cmtPanel.hidden = true;

  const head = document.createElement('div');
  head.className = 'side-panel-head';
  head.innerHTML =
    '<h3 class="side-panel-title">' + esc(t('cmt.title')) +
    ' <span class="side-panel-count" data-cmt-count></span></h3>';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sp-close';
  closeBtn.innerHTML = ICONS.close;
  closeBtn.title = t('tab.close');
  closeBtn.addEventListener('click', () => toggleCommentsPanel());
  head.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'side-panel-body';
  body.setAttribute('data-cmt-body', '');

  const foot = document.createElement('div');
  foot.className = 'side-panel-foot';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'fb-btn primary';
  addBtn.textContent = '+ ' + t('cmt.add');
  addBtn.addEventListener('click', () => {
    // Selection survives while the panel is open (requirement):
    // we do NOT touch the editor selection here — addComment()
    // reads whatever is selected at click time.
    addComment();
  });
  foot.appendChild(addBtn);

  cmtPanel.append(head, body, foot);
  EL.wrapper.appendChild(cmtPanel);
}

function renderCommentsPanel() {
  if (!cmtPanel) return;
  const doc = cmtDoc();
  const body = cmtPanel.querySelector('[data-cmt-body]');
  if (!body) return;
  body.innerHTML = '';

  const marks = cmtMarks();
  cmtPanel.querySelector('[data-cmt-count]').textContent = String(marks.length);

  if (!doc || marks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fn-empty';
    empty.textContent = t('cmt.empty');
    body.appendChild(empty);
    return;
  }

  const seen = new Set();
  marks.forEach(mark => {
    const id = mark.dataset.cmt;
    if (seen.has(id)) return;
    seen.add(id);
    const entry = cmtEntry(id);
    if (!entry) return;

    const card = document.createElement('div');
    card.className = 'cmt-card';
    card.dataset.cmtCard = id;

    // Quote (click → jump to mark in text)
    const quote = document.createElement('div');
    quote.className = 'cmt-quote';
    quote.textContent = '“' + (entry.quote || mark.textContent || t('cmt.empty.quote')) + '”';
    quote.title = t('fn.jumpHint');
    quote.addEventListener('click', () => jumpToMark(id));
    card.appendChild(quote);

    // Comment text (editable)
    const ta = document.createElement('div');
    ta.className = 'cmt-text';
    ta.contentEditable = 'true';
    ta.dataset.cmtInput = id;
    ta.textContent = entry.text || '';
    ta.addEventListener('input', () => {
      const e = cmtEntry(id);
      if (e) { e.text = ta.textContent; scheduleSave(); }
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ta.blur();
    });
    card.appendChild(ta);

    // Meta: timestamp only
    const meta = document.createElement('div');
    meta.className = 'cmt-meta';
    const ts = document.createElement('span');
    ts.className = 'cmt-ts';
    ts.textContent = formatTs(entry.ts);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cmt-del';
    del.innerHTML = ICONS.trash;
    del.title = t('cmt.delete');
    del.addEventListener('click', () => {
      cmtSuspendObserver = true;
      EL.editor.querySelectorAll('mark.cmt-mark[data-cmt="' + id + '"]').forEach(m => m.remove());
      cmtSuspendObserver = false;
      const d = cmtDoc();
      if (d) d.comments = d.comments.filter(c => c.id !== id);
      scheduleSave();
      renderCommentsPanel();
    });
    meta.append(ts, del);
    card.appendChild(meta);

    // Hover on card → highlight the mark in the editor
    card.addEventListener('mouseenter', () => setPairHighlight(id, true));
    card.addEventListener('mouseleave', () => setPairHighlight(id, false));

    body.appendChild(card);
  });
}

/* ----- Timestamp (locale-aware, short) ----- */
function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const lang = (window.orosLang === 'el') ? 'el-GR' : 'en-GB';
  return d.toLocaleDateString(lang) + ' ' +
         d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

/* ----- Click / hover on mark in editor ----- */
function wireCommentMarkEvents() {
  EL.editor.addEventListener('click', (e) => {
    const mark = e.target.closest('mark.cmt-mark');
    if (mark && mark.dataset.cmt) jumpToCard(mark.dataset.cmt);
  });
  EL.editor.addEventListener('mouseover', (e) => {
    const mark = e.target.closest('mark.cmt-mark');
    if (mark && mark.dataset.cmt) setPairHighlight(mark.dataset.cmt, true);
  });
  EL.editor.addEventListener('mouseout', (e) => {
    const mark = e.target.closest('mark.cmt-mark');
    if (mark && mark.dataset.cmt) setPairHighlight(mark.dataset.cmt, false);
  });
}

/* ----- Restore after tab switch / sync apply ----- */
function commentsAfterRender() {
  if (cmtPanel && !cmtPanel.hidden) renderCommentsPanel();
}

// ===== SECTION 18: DOCUMENT META / PAGE SETTINGS / TOC =====

let metaDlg = null;
let pageDlg = null;
let tocPanel = null;
let tocObserver = null;

/* ----- METADATA PANEL ----- */
function openMetadataDialog() {
  const doc = activeDoc();
  if (!doc) return;

  metaDlg = openDialog(t('tt.meta'), '', [
    { class: 'fb-btn primary', label: 'OK', onClick: () => metaDlg.close() }
  ]);
  const body = metaDlg.querySelector('.w-dialog-body');
  body.innerHTML = `
    <div class="form-grid">
      <label>${t('meta.title')}</label>
      <input type="text" class="w-field" id="meta-title" value="${esc(doc.title || '')}">
      
      <label>${t('meta.author')}</label>
      <input type="text" class="w-field" id="meta-author" value="${esc(doc.author || '')}">
      
      <label>${t('meta.category')}</label>
      <input type="text" class="w-field" id="meta-category" value="${esc(doc.category || '')}">
      
      <label>${t('meta.tags')}</label>
      <div class="full">
        <input type="text" class="w-field" id="meta-tags-new" placeholder="${t('meta.tagsAdd')}">
        <div class="form-tags-row" id="meta-tags-list"></div>
      </div>
    </div>
  `;

  renderMetaTags(doc.tags || []);

  // Live sync to doc (no save button needed per design)
  document.getElementById('meta-title').addEventListener('input', (e) => {
    doc.title = e.target.value.trim();
    renderTabs();
    document.title = t('app.name') + ' — ' + (doc.title || t('tab.untitled'));
    scheduleSave();
  });

  document.getElementById('meta-author').addEventListener('input', (e) => {
    doc.author = e.target.value;
    scheduleSave();
  });

  document.getElementById('meta-category').addEventListener('input', (e) => {
    doc.category = e.target.value;
    scheduleSave();
  });

  document.getElementById('meta-tags-new').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !(doc.tags || []).includes(val)) {
        doc.tags = doc.tags || [];
        doc.tags.push(val);
        e.target.value = '';
        renderMetaTags(doc.tags);
        scheduleSave();
      }
    }
  });
}

function renderMetaTags(tags) {
  const list = document.getElementById('meta-tags-list');
  if (!list) return;
  list.innerHTML = '';
  (tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.addEventListener('click', () => {
      const d = activeDoc();
      if (d && d.tags) {
        d.tags = d.tags.filter(t => t !== tag);
        renderMetaTags(d.tags);
        scheduleSave();
      }
    });
    chip.appendChild(del);
    list.appendChild(chip);
  });
}

/* ----- PAGE SETTINGS ----- */
const PAPER_SIZES = {
  'full-width': { w: 'auto', h: 'auto', label: 'page.sizes.full-width' },
  'a4':         { w: 210, h: 297, label: 'page.sizes.a4' },
  'a3':         { w: 297, h: 420, label: 'page.sizes.a3' },
  'a5':         { w: 148, h: 210, label: 'page.sizes.a5' },
  'b5':         { w: 176, h: 250, label: 'page.sizes.b5' },
  'letter':     { w: 216, h: 279, label: 'page.sizes.letter' },
  'legal':      { w: 216, h: 356, label: 'page.sizes.legal' }
};

function openPageSettings() {
  const doc = activeDoc();
  if (!doc) return;

  pageDlg = openDialog(t('page.settings'), '', [
    { class: 'fb-btn', label: t('page.mReset'), onClick: resetMargins },
    { class: 'fb-btn primary', label: 'OK', onClick: () => pageDlg.close() }
  ]);

  const body = pageDlg.querySelector('.w-dialog-body');
  body.innerHTML = `
    <div class="form-grid">
      <label>${t('page.size')}</label>
      <select class="w-field" id="page-size">
        ${Object.entries(PAPER_SIZES).map(([k, v]) => 
          `<option value="${k}" ${doc.pageSize === k ? 'selected' : ''}>${t(v.label)}</option>`
        ).join('')}
      </select>

      <label>${t('page.margins')}</label>
      <div class="margin-grid full">
        <input type="number" class="w-field" id="m-top" min="0" max="100" value="${doc.margins.top}">
        <input type="number" class="w-field" id="m-right" min="0" max="100" value="${doc.margins.right}">
        <input type="number" class="w-field" id="m-bottom" min="0" max="100" value="${doc.margins.bottom}">
        <input type="number" class="w-field" id="m-left" min="0" max="100" value="${doc.margins.left}">
      </div>
      <div class="margins-labels full">
        <span>↑</span><span>→</span><span>↓</span><span>←</span>
      </div>

      <label>${t('page.header')}</label>
      <input type="text" class="w-field full" id="page-header" placeholder="${t('page.headFootNote')}" value="${esc(doc.header || '')}">

      <label>${t('page.footer')}</label>
      <input type="text" class="w-field full" id="page-footer" placeholder="${t('page.headFootNote')}" value="${esc(doc.footer || '')}">

      <div class="full paper-preview">
        <div class="paper-preview-inner" id="preview-paper">
          <div class="paper-margin-box" style="--pv-m:${Math.min(doc.margins.top,30)}px;"></div>
        </div>
        <div class="paper-caption"></div>
      </div>
    </div>
  `;

  // Wire events
  const sizeSel = document.getElementById('page-size');
  sizeSel.addEventListener('change', () => {
    doc.pageSize = sizeSel.value;
    EL.editor.setAttribute('data-page-size', doc.pageSize);
    updatePreview();
    scheduleSave();
  });

  ['top','right','bottom','left'].forEach(side => {
    const inp = document.getElementById('m-' + side);
    inp.addEventListener('input', () => {
      doc.margins[side] = Math.max(0, Math.min(100, parseInt(inp.value) || 0));
      updatePreview();
      scheduleSave();
    });
  });

  document.getElementById('page-header').addEventListener('input', (e) => {
    doc.header = e.target.value;
    scheduleSave();
  });

  document.getElementById('page-footer').addEventListener('input', (e) => {
    doc.footer = e.target.value;
    scheduleSave();
  });

  function updatePreview() {
    const pm = document.getElementById('preview-paper');
    if (!pm) return;
    const size = PAPER_SIZES[doc.pageSize];
    if (size.w === 'auto') {
      pm.style.width = 'calc(100% - 48px)';
      pm.style.height = '120px';
    } else {
      const scale = 0.25;
      pm.style.width = (size.w * scale) + 'px';
      pm.style.height = (size.h * scale) + 'px';
    }
    const m = Math.min(doc.margins.top, 30);
    pm.querySelector('.paper-margin-box').style.setProperty('--pv-m', m + 'px');
    const cap = pageDlg.querySelector('.paper-caption');
    if (cap) cap.textContent = `${size.w}×${size.h} mm`;
  }
  updatePreview();
}

function resetMargins() {
  const doc = activeDoc();
  if (!doc) return;
  doc.margins = { top: 25, bottom: 25, left: 25, right: 25 };
  if (pageDlg) {
    ['top','right','bottom','left'].forEach(side => {
      const el = pageDlg.querySelector('#m-' + side);
      if (el) el.value = '25';
    });
    const pm = pageDlg.querySelector('#preview-paper');
    if (pm) {
      const size = PAPER_SIZES[doc.pageSize] || PAPER_SIZES.a4;
      if (size.w === 'auto') {
        pm.style.width = 'calc(100% - 48px)';
        pm.style.height = '120px';
      } else {
        pm.style.width = (size.w * 0.25) + 'px';
        pm.style.height = (size.h * 0.25) + 'px';
      }
      const mb = pm.querySelector('.paper-margin-box');
      if (mb) mb.style.setProperty('--pv-m', '25px');
    }
  }
  scheduleSave();
}

/* ----- TABLE OF CONTENTS (inline) ----- */
function insertInlineToc() {
  const toc = generateTocHTML();
  if (!toc) { showToast(t('toc.empty')); return; }
  insertNodeAtCursor(document.createRange().createContextualFragment(toc));
  scheduleSave();
}

function generateTocHTML() {
  // assign REAL ids to the live headings — anchors must resolve
  let n = 0;
  EL.editor.querySelectorAll('h1,h2,h3,h4').forEach(h => {
    if (!h.id) h.id = 'toc-' + n++;
  });
  const headings = Array.from(EL.editor.querySelectorAll('h1,h2,h3,h4'))
    .map(h => ({ id: h.id, level: h.tagName.toLowerCase(), text: h.textContent.trim() || t('toc.unnamed') }))
    .filter(h => h.text);

  if (headings.length === 0) return null;

  let html = '<div class="toc-inline">';
  html += '<ol>';
  headings.forEach(h => {
    html += `<li class="toc-h${h.level.replace('h','')}"><a href="#${h.id}">${escAttr(h.text)}</a></li>`;
  });
  html += '</ol></div>';
  return html;
}

function toggleTocPanel() {
  // Ensure headings carry stable ids so TOC entries are clickable
  EL.editor.querySelectorAll('h1,h2,h3,h4').forEach((h, i) => {
    if (!h.id) h.id = 'toc-' + i;
  });
  const headings = Array.from(EL.editor.querySelectorAll('h1,h2,h3,h4')).map((h,i) => ({
    id: h.id || 'toc-' + i, level: h.tagName.toLowerCase(), text: h.textContent.trim() || t('toc.unnamed')
  })).filter(h => h.text);

  if (headings.length === 0) {
    showToast(t('toc.empty'));
    return;
  }

  const dlg = openDialog(t('toc.title'), '', [
    { class: 'fb-btn', label: t('toc.insert'), onClick: () => { insertInlineToc(); dlg.close(); } },
    { class: 'fb-btn primary', label: 'Close', onClick: () => dlg.close() }
  ]);

  const body = dlg.querySelector('.w-dialog-body');
  const ul = document.createElement('ul');
  ul.className = 'toc-list';
  headings.forEach(h => {
    const li = document.createElement('li');
    li.className = 'toc-item toc-' + h.level;
    li.innerHTML = `<span class="toc-level">${h.level.toUpperCase()}</span><span class="toc-title">${esc(h.text)}</span>`;
    li.addEventListener('click', () => {
      const target = EL.editor.querySelector('#' + h.id);
      if (target) {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        const range = document.createRange();
        range.setStartBefore(target);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        dlg.close();
      }
    });
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

// ===== SECTION 19: TEMPLATES & VERSION HISTORY =====

/* ----- TEMPLATES -----
   Built-ins: seeded, read-only (badge "Built-in"). Customs: full CRUD,
   import/export JSON. All stored in state.templates — synced, LWW per
   entity with tombstones (see slice patch below). Rendering grids
   built-ins + customs immediately, no manual refresh. */

const TPL_BUILTIN = [
  { id: 'essay',     builtin: true, name: 'tpl.builtin.essay',     desc: 'tpl.builtin.essay.d',
    html: '<h1>Essay title</h1><p>Introduction…</p><h2>Section</h2><p>Body…</p><h2>Conclusion</h2><p>Summing up…</p>' },
  { id: 'letter',    builtin: true, name: 'tpl.builtin.letter',    desc: 'tpl.builtin.letter.d',
    html: '<p style="text-align:right">City, date</p><p>Recipient<br>Address</p><p>Dear Sir or Madam,</p><p>Body…</p><p>Sincerely,<br>Your name</p>' },
  { id: 'novel',     builtin: true, name: 'tpl.builtin.novel',     desc: 'tpl.builtin.novel.d',
    html: '<h1>Chapter One</h1><p>Narrative…</p><p>* * *</p><p>Next scene…</p>' },
  { id: 'screenplay',builtin: true, name: 'tpl.builtin.screenplay',desc: 'tpl.builtin.screenplay.d',
    html: '<p><strong>FADE IN:</strong></p><h3>INT. ROOM — DAY</h3><p>Action description.</p><p><strong>CHARACTER</strong><br>(dialogue)</p>' },
  { id: 'poem',      builtin: true, name: 'tpl.builtin.poem',      desc: 'tpl.builtin.poem.d',
    html: '<h1>Poem title</h1><p>First stanza…</p><p>&nbsp;</p><p>Second stanza…</p>' },
  { id: 'notes',     builtin: true, name: 'tpl.builtin.notes',    desc: 'tpl.builtin.notes.d',
    html: '<h1>Meeting notes</h1><p>Date / attendees…</p><h2>Agenda</h2><ul><li>Item…</li></ul><h2>Decisions</h2><ul><li>Decision…</li></ul><h2>Action items</h2><ul><li>Who — what — when…</li></ul>' },
  { id: 'blank',     builtin: true, name: 'tpl.builtin.blank',    desc: 'tpl.builtin.blank.d', html: '' }
];

function allTemplates() {
  const customs = state.templates || [];
  return TPL_BUILTIN.concat(customs);
}

let tplDlg = null;

function openTemplates() {
  tplDlg = openDialog(t('tpl.title'), '', [
    { class: 'fb-btn', label: t('tpl.export'), onClick: exportTemplateJson },
    { class: 'fb-btn', label: t('tpl.import'), onClick: importTemplateJson },
    { class: 'fb-btn', label: t('tpl.saveCurrent'), onClick: saveCurrentAsTemplate },
    { class: 'fb-btn primary', label: 'OK', onClick: () => tplDlg.close() }
  ]);
  renderTemplates();
}

function renderTemplates() {
  const body = tplDlg.querySelector('.w-dialog-body');
  body.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'tpl-grid';

  allTemplates().forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'tpl-card';

    const nm = document.createElement('div');
    nm.className = 'tpl-name';
    nm.textContent = tpl.builtin ? t(tpl.name) : tpl.name;

    const ds = document.createElement('div');
    ds.className = 'tpl-desc';
    ds.textContent = tpl.builtin ? t(tpl.desc) : (tpl.desc || '');

    card.append(nm, ds);

    const actions = document.createElement('div');
    actions.className = 'tpl-actions';

    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'fb-btn primary';
    use.textContent = t('tpl.use');
    use.addEventListener('click', () => {
      createDoc({ html: tpl.html, title: tpl.builtin ? t(tpl.name) : tpl.name, silent: true });
      tplDlg.close();
    });
    actions.appendChild(use);

    if (!tpl.builtin) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ac-icon-btn';
      edit.title = t('tpl.edit');
      edit.textContent = '✎';
      edit.addEventListener('click', () => editTemplate(tpl));
      actions.appendChild(edit);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ac-icon-btn danger';
      del.title = t('tpl.del');
      del.innerHTML = ICONS.trash;
      del.addEventListener('click', () => {
        if (!confirm(t('tpl.confirmDel').replace('{name}', tpl.name))) return;
        state.templates = state.templates.filter(x => x.id !== tpl.id);
        state.tplTombs = state.tplTombs || [];
        state.tplTombs.push({ id: tpl.id, ts: Date.now() });   // tombstone
        scheduleSave();
        renderTemplates();
      });
      actions.appendChild(del);
    } else {
      const badge = document.createElement('span');
      badge.className = 'tpl-badge';
      badge.textContent = 'Built-in';
      card.appendChild(badge);
    }

    card.appendChild(actions);
    grid.appendChild(card);
  });

  body.appendChild(grid);
}

function saveCurrentAsTemplate() {
  const doc = activeDoc();
  if (!doc) return;
  const name = prompt(t('tpl.name'), doc.title || '');
  if (!name) return;
  const existing = (state.templates || []).find(x => x.name === name);
  if (existing && !confirm(t('tpl.confirmOverwrite'))) return;

  const tpl = {
    id: existing ? existing.id : 'tp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name,
    desc: '',
    html: editorHTMLForSave(),
    mtime: Date.now()
  };
  if (existing) { Object.assign(existing, tpl); }
  else {
    state.templates = state.templates || [];
    state.templates.push(tpl);
  }
  scheduleSave();
  renderTemplates();
  showToast(t('tpl.saved'));
}

function editTemplate(tpl) {
  const dlg = openDialog(t('tpl.edit'), `
    <div class="form-grid">
      <label>${t('tpl.name')}</label>
      <input type="text" class="w-field" id="et-name" value="${escAttr(tpl.name)}">
      <label>${t('tpl.desc')}</label>
      <input type="text" class="w-field" id="et-desc" value="${escAttr(tpl.desc || '')}">
    </div>
  `, [
    { class: 'fb-btn', label: 'OK', onClick: () => {
        tpl.name = document.getElementById('et-name').value.trim() || tpl.name;
        tpl.desc = document.getElementById('et-desc').value;
        tpl.mtime = Date.now();
        scheduleSave();
        dlg.close();
        renderTemplates();
      } }
  ]);
}

function exportTemplateJson() {
  const data = JSON.stringify({ orOSTemplates: state.templates || [] }, null, 2);
  downloadBlob(data, 'oros-writer-templates.json', 'application/json');
  showToast(t('tpl.exported'));
}

function importTemplateJson() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.addEventListener('change', () => {
    const file = inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const arr = Array.isArray(parsed) ? parsed : parsed.orOSTemplates;
        if (!Array.isArray(arr)) throw new Error('bad');
        state.templates = state.templates || [];
        arr.forEach(tpl => {
          if (!tpl || typeof tpl.name !== 'string' || typeof tpl.html !== 'string') return;
          const id = (typeof tpl.id === 'string') ? tpl.id
            : 'tp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const existing = state.templates.find(x => x.name === tpl.name);
          if (existing) { Object.assign(existing, tpl, { id: existing.id, mtime: Date.now() }); }
          else { state.templates.push({ id, name: tpl.name, desc: tpl.desc || '', html: tpl.html, mtime: Date.now() }); }
        });
        scheduleSave();
        if (tplDlg) renderTemplates();
        showToast(t('tpl.imported'));
      } catch (e) {
        showToast(t('tpl.imErr'));
      }
    };
    reader.readAsText(file);
  });
  inp.click();
}

/* ----- VERSION HISTORY -----
   Per-doc versions: 8 auto (every 30s IF content changed) + unlimited-enough
   manual snapshots. Manual: green badge + dedicated delete. Restore puts
   back text AND footnotes AND comments. Lives inside doc (LWW sync).
   Distinct from orOS core DB snapshots — this is a document feature. */

let verPanel = null;
let verTimer = null;

function openVersionsPanel() {
  const doc = activeDoc();
  if (!doc) return;

  // Auto-version tick: every 30s, if content changed since last version
  clearInterval(verTimer);
  verTimer = setInterval(() => {
    const d = activeDoc();
    if (!d || d !== doc) { clearInterval(verTimer); return; }
    maybeAutoVersion(d);
  }, 30000);

  const dlg = openDialog(t('ver.title'), '', [
    { class: 'fb-btn', label: t('ver.snapshot'), onClick: () => {
        takeManualSnapshot(doc);
        renderVersions(dlg, doc);
      } },
    { class: 'fb-btn primary', label: 'OK', onClick: () => { clearInterval(verTimer); dlg.close(); } }
  ]);
  dlg.addEventListener('close', () => clearInterval(verTimer));
  renderVersions(dlg, doc);
}

function renderVersions(dlg, doc) {
  const body = dlg.querySelector('.w-dialog-body');
  body.innerHTML = '';
  if (!doc.versions || doc.versions.length === 0) {
    const e = document.createElement('div');
    e.className = 'ver-empty';
    e.textContent = t('ver.empty');
    body.appendChild(e);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'ver-list';

  // newest first
  doc.versions.slice().reverse().forEach(v => {
    const li = document.createElement('li');
    li.className = 'ver-item';

    const ts = document.createElement('span');
    ts.className = 'ver-ts';
    ts.textContent = formatTs(v.ts);

    const words = document.createElement('span');
    words.className = 'ver-words';
    words.textContent = t('ver.delta').replace('{n}', countWordsInHtml(v.html));

    li.append(ts, words);

    if (v.manual) {
      const badge = document.createElement('span');
      badge.className = 'ver-badge';
      badge.textContent = t('ver.manual');
      li.appendChild(badge);
    } else {
      const badge = document.createElement('span');
      badge.className = 'ac-badge';
      badge.textContent = t('ver.auto');
      li.appendChild(badge);
    }

    const acts = document.createElement('span');
    acts.className = 'ver-item-actions';

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'fb-btn';
    restore.textContent = t('ver.restore');
    restore.addEventListener('click', () => {
      if (!confirm(t('ver.confirmRestore'))) return;
      restoreVersion(doc, v);
      renderVersions(dlg, doc);
    });

    acts.appendChild(restore);

    // Dedicated delete ONLY for manual snapshots (requirement)
    if (v.manual) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ac-icon-btn danger';
      del.title = t('ver.delete');
      del.innerHTML = ICONS.trash;
      del.addEventListener('click', () => {
        if (!confirm(t('ver.confirmDel'))) return;
        doc.versions = doc.versions.filter(x => x !== v);
        scheduleSave();
        renderVersions(dlg, doc);   // immediate UI removal, no stale state
      });
      acts.appendChild(del);
    }

    li.appendChild(acts);
    ul.appendChild(li);
  });

  body.appendChild(ul);
}

function countWordsInHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  // strip annotation chrome before counting
  tmp.querySelectorAll('sup.fn-ref').forEach(x => x.remove());
  const words = tmp.textContent.trim().split(/\s+/).filter(Boolean);
  // beta bug fix: punctuation between spaces ('word - word') is NOT a word
  return words.filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

function maybeAutoVersion(doc) {
  flushSave();
  const current = doc.html || '';
  const last = doc.versions && doc.versions.length
    ? doc.versions[doc.versions.length - 1].html : null;
  if (current === last) return;

  doc.versions = doc.versions || [];
  doc.versions.push({ ts: Date.now(), html: current, manual: false });
  // Cap: keep the newest 8 auto versions (manual ones never dropped by cap)
  const manual = doc.versions.filter(v => v.manual);
  const auto = doc.versions.filter(v => !v.manual).slice(-8);
  doc.versions = doc.versions.filter(v => v.manual)
    .concat(auto)
    .sort((a, b) => a.ts - b.ts);
  scheduleSave();
}

function takeManualSnapshot(doc) {
  flushSave();
  doc.versions = doc.versions || [];
  doc.versions.push({ ts: Date.now(), html: doc.html || '', manual: true });
  scheduleSave();
  showToast(t('ver.snapshotted'));
}

function restoreVersion(doc, v) {
  // Full-fidelity restore: text + footnotes + comments
  // Snapshot the CURRENT state first (safety — restoring is undoable via its own entry)
  takeManualSnapshot(doc);

  doc.html = v.html;
  doc.mtime = Date.now();
  flushSave();

  EL.editor.innerHTML = doc.html;
  fnSuspendObserver = true;
  cmtSuspendObserver = true;
  renumberFootnotes();
  cleanupFootnotes();
  cleanupComments();
  fnSuspendObserver = false;
  cmtSuspendObserver = false;

  footnotesAfterRender();
  commentsAfterRender();
  renderTabs();
  scheduleSave();
  showToast(t('ver.restored') + ' — ' + t('ver.restoredFull'));
}

// ===== SECTION 20: GOAL TRACKER + READING PROGRESS =====
//
// Goal model (per doc, RENDER-DERIVED where possible):
//   doc.goal = { type:'words'|'chars'|'paras'|'time'|'sessionWords',
//                target:number, lock:boolean, startTs:number, startWords:number }
//   Words/chars/paras: measured from live editor — never stored.
//   Session words: delta from startWords — startTs/startWords stored (they
//     define the session anchor); the CURRENT count is always derived.
//   Time: minutes elapsed since goal was set — derived from Date.now().
// The goal itself syncs (part of doc, LWW) but RUNTIME state (lock armed,
// done-fired flag) is device-local.

let goalRuntime = { fired: false };   // device-local: toast once per achievement

/* ----- Stats (shared with the goal bar) ----- */
function editorStats() {
  const clone = document.createElement('div');
  clone.innerHTML = editorHTMLForSave();
  clone.querySelectorAll('sup.fn-ref').forEach(x => x.remove());
  const text = clone.textContent || '';
  const words = text.trim().split(/\s+/).filter(Boolean)
    .filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  const paras = Array.from(clone.children)
    .filter(el => el.tagName === 'P' && el.textContent.trim()).length;
  return { words: words, chars: text.replace(/\s+/g, ' ').trim().length, paras: paras };
}

/* ----- Toggle / render the bar ----- */
function toggleGoalBar(forceOn) {
  const bar = document.getElementById('goal-bar');
  const goal = activeDoc() && activeDoc().goal;
  if (forceOn || !goal) { openGoalDialog(); return; }
  bar.hidden = !bar.hidden;
  if (!bar.hidden) updateGoalBar();
}

function openGoalDialog() {
  const doc = activeDoc();
  if (!doc) return;
  const g = doc.goal || { type: 'words', target: 500, lock: false };

  const dlg = openDialog(t('tt.goal'), `
    <div class="form-grid">
      <label>${t('goal.type')}</label>
      <select class="w-field" id="g-type">
        <option value="words" ${g.type==='words'?'selected':''}>${t('goal.type.words')}</option>
        <option value="chars" ${g.type==='chars'?'selected':''}>${t('goal.type.chars')}</option>
        <option value="paras" ${g.type==='paras'?'selected':''}>${t('goal.type.paras')}</option>
        <option value="time" ${g.type==='time'?'selected':''}>${t('goal.type.time')}</option>
        <option value="sessionWords" ${g.type==='sessionWords'?'selected':''}>${t('goal.type.sessionWords')}</option>
      </select>
      <label>${t('goal.target')}</label>
      <input type="number" class="w-field" id="g-target" min="1" value="${g.target}">
      <label class="full" style="text-align:left;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="g-lock" ${g.lock?'checked':''}> ${t('goal.lock')}
      </label>
    </div>
  `, [
    { class: 'fb-btn', label: t('goal.clear'), onClick: () => {
        doc.goal = null;
        scheduleSave();
        dlg.close();
        document.getElementById('goal-bar').hidden = true;
        unlockEditor();
      } },
    { class: 'fb-btn primary', label: t('goal.set'), onClick: () => {
        const type = document.getElementById('g-type').value;
        const target = Math.max(1, parseInt(document.getElementById('g-target').value, 10) || 1);
        const st = editorStats();
        doc.goal = {
          type: type, target: target,
          lock: document.getElementById('g-lock').checked,
          startTs: Date.now(), startWords: st.words
        };
        goalRuntime.fired = false;
        scheduleSave();
        dlg.close();
        const bar = document.getElementById('goal-bar');
        bar.hidden = false;
        updateGoalBar();
      } }
  ]);
}

/* ----- Progress computation ----- */
function goalProgress(goal) {
  const st = editorStats();
  let cur = 0, pct = 0, done = false, statsLabel = '';
  switch (goal.type) {
    case 'words':
      cur = st.words; break;
    case 'chars':
      cur = st.chars; break;
    case 'paras':
      cur = st.paras; break;
    case 'time':
      cur = Math.floor((Date.now() - goal.startTs) / 60000); break;
    case 'sessionWords':
      cur = Math.max(0, st.words - (goal.startWords || 0)); break;
  }
  pct = Math.min(100, Math.round(cur / goal.target * 100));
  done = cur >= goal.target;

  const typeKey = { words:'goal.stats.words', chars:'goal.stats.chars',
                    time:'goal.stats.time', sessionWords:'goal.stats.session' }[goal.type];
  if (goal.type === 'paras') {
    statsLabel = t('goal.stats.paras').replace('{n}', String(st.paras)) +
                 ' · ' + cur + ' / ' + goal.target;
  } else {
    statsLabel = t(typeKey).replace('{cur}', String(cur)).replace('{target}', String(goal.target));
  }
  return { cur: cur, pct: pct, done: done, statsLabel: statsLabel, stats: st };
}

function updateGoalBar() {
  const doc = activeDoc();
  const bar = document.getElementById('goal-bar');
  if (!doc || !doc.goal) { bar.hidden = true; return; }

  const p = goalProgress(doc.goal);
  bar.classList.toggle('done', p.done);

  const label = document.getElementById('goal-label');
  label.textContent = p.done ? t('goal.done') : t('tt.goal');

  // stats INLINE next to the label (requirement — not a separate block)
  document.getElementById('goal-stats').textContent = p.statsLabel + ' · ' + p.pct + '%';

  document.getElementById('goal-fill').style.width = p.pct + '%';

  // Lock button reflects state
  const lockBtn = document.getElementById('goal-lock');
  lockBtn.classList.toggle('on', doc.goal.lock && p.done);

  // Achieved: emit once + arm lock
  if (p.done && !goalRuntime.fired) {
    goalRuntime.fired = true;
    const typeStr = {
      words: t('goal.type.words'), chars: t('goal.type.chars'),
      paras: t('goal.type.paras'), time: t('goal.type.time'),
      sessionWords: t('goal.type.sessionWords')
    }[doc.goal.type];
    showToast(t('goal.done.msg')
      .replace('{type}', typeStr)
      .replace('{cur}', String(p.cur))
      .replace('{target}', String(doc.goal.target)));
    if (window.orosSync && typeof window.orosSync.emit === 'function') {
      window.orosSync.emit({ ns: 'writer', kind: 'goal' });   // Notification-worthy (Wave 6 refines)
    }
  }
  if (p.done && doc.goal.lock) lockEditor();
  else unlockEditor();
}

/* ----- Lock: hard input block via beforeinput guard ----- */
function lockEditor() {
  if (!EL.editor.dataset.goalLocked) {
    EL.editor.dataset.goalLocked = '1';
    document.getElementById('w-app').classList.add('goal-lock');
  }
}
function unlockEditor() {
  delete EL.editor.dataset.goalLocked;
  document.getElementById('w-app').classList.remove('goal-lock');
}

/* ----- Goal bar wiring (once, in wireEvents) ----- */
function wireGoalBar() {
  const lockBtn = document.getElementById('goal-lock');
  lockBtn.addEventListener('click', () => {
    const doc = activeDoc();
    if (!doc || !doc.goal) return;
    const p = goalProgress(doc.goal);
    if (p.done && doc.goal.lock) {
      if (confirm(t('goal.unlockConfirm'))) {
        doc.goal.lock = false;
        scheduleSave();
        unlockEditor();
      }
    } else {
      doc.goal.lock = !doc.goal.lock;
      if (!p.done) doc.goal.lock = false;   // lock only makes sense after done
      scheduleSave();
      updateGoalBar();
    }
  });

  document.getElementById('goal-clear').addEventListener('click', () => {
    const doc = activeDoc();
    if (!doc) return;
    doc.goal = null;
    scheduleSave();
    document.getElementById('goal-bar').hidden = true;
    unlockEditor();
  });

  // Hard input block when locked
  EL.editor.addEventListener('beforeinput', (e) => {
    if (EL.editor.dataset.goalLocked) {
      e.preventDefault();
      showToast(t('goal.locked'));
    }
  });
}

/* ----- Reading progress bar ----- */
function updateReadingProgress() {
  const el = document.getElementById('reading-progress');
  const ed = EL.editor;
  const max = ed.scrollHeight - ed.clientHeight;
  const pct = max <= 0 ? (ed.textContent.trim() ? 100 : 0)
            : Math.min(100, Math.round(ed.scrollTop / max * 100));
  el.querySelector('.reading-progress-fill').style.width = pct + '%';
}

function wireReadingProgress() {
  const el = document.getElementById('reading-progress');
  el.hidden = false;
  EL.editor.addEventListener('scroll', updateReadingProgress, { passive: true });
  updateReadingProgress();
}

/* ----- Refresh hooks: keep bar + progress live on every edit ----- */
function goalAfterInput() {
  const doc = activeDoc();
  const bar = document.getElementById('goal-bar');
  if (doc && doc.goal && !bar.hidden) updateGoalBar();
  updateReadingProgress();
}

function goalAfterRender() {
  const doc = activeDoc();
  const bar = document.getElementById('goal-bar');
  if (doc && doc.goal) { bar.hidden = false; goalRuntime.fired = false; updateGoalBar(); }
  else { bar.hidden = true; unlockEditor(); }
  updateReadingProgress();
}



/* ===== SECTION 21: WAVE 5 — I/O — CORE + NATIVE EXPORTS ===== */
//
// Conventions (Bible-grade notes for future waves):
//   · Every export is LOCAL only — downloadBlob(), no network, ever.
//   · Filename = document title (fallback via i18n), sanitized for
//     Windows/macOS/Linux: no \ / : * ? " < > |, capped at 120 chars.
//   · OROSDOC = full round-trip archive (html + footnotes + comments
//     + metadata + page setup). JSON = the entire slice (all tabs,
//     settings, templates, autocorrect) — mirrors manual DB export.
//   · Exports NEVER mutate the live editor: everything is built from
//     editorHTMLForSave() clones (find-hit marks already stripped).
//   · RTF/DOCX/PDF exporters (ioExportRtf/ioExportDocx/ioExportPdf)
//     are hoisted declarations from the following parts of Wave 5.

/* ----- Filename helper ----- */
function ioBaseName(doc) {
  const base = (doc && doc.title && doc.title.trim()) || t('tab.untitled');
  return base.replace(/[\\\/:*?"<>|]+/g, '-')
             .replace(/\s+/g, ' ')
             .trim()
             .slice(0, 120) || t('tab.untitled');
}

/* ----- Export clone (annotation-safe DOM source) ----- */
const IO_BLOCK_RE = /^(P|DIV|H1|H2|H3|H4|BLOCKQUOTE|PRE|UL|OL|DL|TABLE|FIGURE|HR)$/;

function ioExportClone() {
  const c = document.createElement('div');
  c.innerHTML = editorHTMLForSave();
  return c;
}

function ioUnwrap(el) {
  const frag = document.createDocumentFragment();
  while (el.firstChild) frag.appendChild(el.firstChild);
  el.replaceWith(frag);
}

/* ----- PLAIN TEXT (TXT) ----- */
function ioWalkText(n) {
  let out = '';
  (function walk(node) {
    Array.from(node.childNodes).forEach(ch => {
      if (ch.nodeType === 3) { out += ch.nodeValue; return; }
      if (ch.nodeName === 'BR') { out += '\n'; return; }
      if (ch.nodeName === 'HR') { out += (out.endsWith('\n') ? '' : '\n') + '\n'; return; }
      if (ch.nodeType === 1 && ch.classList && ch.classList.contains('page-break-marker')) {
        out += (out.endsWith('\n') ? '' : '\n') + '\n'; return;
      }
      walk(ch);
      if (IO_BLOCK_RE.test(ch.nodeName)) out += '\n\n';
    });
  })(n);
  return out;
}

function ioToPlainText() {
  const c = ioExportClone();
  // footnote refs → [n] (keeps citation numbers readable)
  c.querySelectorAll('sup.fn-ref').forEach(s => {
    s.replaceWith(document.createTextNode('[' + (s.textContent || '') + ']'));
  });
  c.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);
  c.querySelectorAll('.toc-inline').forEach(el => {
    // TOC makes no sense in plain text — drop it
    el.remove();
  });
  return ioWalkText(c)
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ----- MARKDOWN ----- */
let MD_FN_DEFS = [];   // collected during the inline walk: [{n, id}]

function ioInlineMd(node) {
  let s = '';
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) { s += ch.nodeValue; return; }
    switch (ch.nodeName) {
      case 'BR': s += '\n'; break;
      case 'STRONG': case 'B': s += '**' + ioInlineMd(ch) + '**'; break;
      case 'EM': case 'I': s += '*' + ioInlineMd(ch) + '*'; break;
      case 'U': s += '__' + ioInlineMd(ch) + '__'; break;
      case 'DEL': case 'S': case 'STRIKE':
        s += '~~' + ioInlineMd(ch) + '~~'; break;
      case 'CODE': s += '`' + ch.textContent + '`'; break;
      case 'A': {
        const href = ch.getAttribute('href') || '';
        const label = ioInlineMd(ch).trim() || href;
        s += (href ? '[' + label + '](' + href + ')' : label);
        break;
      }
      case 'IMG': {
        const src = ch.getAttribute('src') || '';
        const alt = ch.getAttribute('alt') || '';
        s += (src ? '![' + alt + '](' + src + ')' : alt);
        break;
      }
      case 'SUP': {
        if (ch.classList && ch.classList.contains('fn-ref')) {
          const n = (ch.textContent || '').trim();
          MD_FN_DEFS.push({ n: n, id: ch.getAttribute('data-fn') });
          s += '[^' + n + ']';
        } else s += ch.textContent;
        break;
      }
      default:
        // comment marks and anything unknown: unwrap transparently
        s += ioInlineMd(ch);
    }
  });
  return s;
}

function ioListMd(listEl, ordered, depth) {
  const pad = '  '.repeat(depth);
  let out = '';
  let n = 1;
  Array.from(listEl.children).forEach(li => {
    if (li.nodeName !== 'LI') return;
    const marker = ordered ? (n++ ) + '. ' : '- ';
    // single block child of LI that is itself a list → recurse inline
    const inner = ioBlocksMd(li, depth + 1).trim();
    const first = li.children.length === 1 &&
                  /^(UL|OL)$/.test(li.children[0].nodeName)
      ? ioInlineMd(li.firstChild)  // covered below by nested pass
      : '';
    if (first && inner.indexOf('\n') === -1) {
      out += pad + marker + first + '\n';
    } else if (inner.indexOf('\n') !== -1) {
      out += pad + marker + ioInlineMd(li).trim() + '\n' + inner;
    } else {
      out += pad + marker + ioInlineMd(li).trim() + '\n';
    }
  });
  return out;
}

function ioBlocksMd(node, depth) {
  let out = '';
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) {
      const txt = ch.nodeValue.trim();
      if (txt) out += txt + '\n\n';
      return;
    }
    if (ch.nodeType !== 1) return;
    if (ch.classList && ch.classList.contains('page-break-marker')) {
      out += '---\n\n'; return;
    }
    if (ch.classList && ch.classList.contains('toc-inline')) return;  // drop
    switch (ch.nodeName) {
      case 'H1': case 'H2': case 'H3': case 'H4': {
        const lvl = parseInt(ch.nodeName.slice(1), 10);
        out += '#'.repeat(lvl) + ' ' + ioInlineMd(ch).trim() + '\n\n';
        break;
      }
      case 'P': {
        const txt = ioInlineMd(ch).trim();
        if (txt) out += txt + '\n\n';
        break;
      }
      case 'BLOCKQUOTE': {
        const q = ioBlocksMd(ch, depth).trim()
          .split('\n').map(l => '> ' + l).join('\n');
        if (q) out += q + '\n\n';
        break;
      }
      case 'PRE':
        out += '```\n' + ch.textContent.replace(/\n$/, '') + '\n```\n\n';
        break;
      case 'HR': out += '---\n\n'; break;
      case 'UL': out += ioListMd(ch, false, depth) + '\n'; break;
      case 'OL': out += ioListMd(ch, true, depth) + '\n'; break;
      case 'TABLE': {
        const rows = Array.from(ch.querySelectorAll('tr'));
        if (rows.length) {
          rows.forEach((tr, ri) => {
            const cells = Array.from(tr.children).map(td => ioInlineMd(td).trim().replace(/\|/g, '\\|'));
            out += '| ' + cells.join(' | ') + ' |\n';
            if (ri === 0) out += '|' + cells.map(() => ' --- ').join('|') + '|\n';
          });
          out += '\n';
        }
        break;
      }
      case 'FIGURE': {
        const img = ch.querySelector('img');
        const cap = ch.querySelector('figcaption');
        if (img) out += ioInlineMd(img) + '\n\n';
        if (cap) out += '*' + ioInlineMd(cap).trim() + '*\n\n';
        break;
      }
      default:
        out += ioBlocksMd(ch, depth);
    }
  });
  return out;
}

function ioToMarkdown(doc) {
  MD_FN_DEFS = [];
  const c = ioExportClone();
  c.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);
  let md = ioBlocksMd(c, 0).replace(/\n{3,}/g, '\n\n').trim();

  const defs = MD_FN_DEFS
    .map(d => {
      const e = (doc.footnotes || []).find(f => f.id === d.id);
      return e ? '[^' + d.n + ']: ' + (e.text || '') : null;
    })
    .filter(Boolean);
  if (defs.length) md += '\n\n' + defs.join('\n');
  return md + '\n';
}

/* ----- STANDALONE HTML ----- */
function ioToStandaloneHTML(doc) {
  const c = ioExportClone();
  const lang = (window.orosLang === 'el') ? 'el' : 'en';
  const metaBits = [];

  // Footnotes appendix — ref DOM order, numbered (never alphabetical)
  const seen = new Set();
  const fns = [];
  c.querySelectorAll('sup.fn-ref').forEach(ref => {
    const id = ref.getAttribute('data-fn');
    if (!id || seen.has(id)) return;
    seen.add(id);
    const e = (doc.footnotes || []).find(f => f.id === id);
    if (e) fns.push({ n: ref.textContent, text: e.text || '' });
  });

  if (doc.author) metaBits.push('<meta name="author" content="' + escAttr(doc.author) + '">');
  if (doc.tags && doc.tags.length)
    metaBits.push('<meta name="keywords" content="' + escAttr(doc.tags.join(', ')) + '">');
  if (doc.category) metaBits.push('<meta name="subject" content="' + escAttr(doc.category) + '">');

  let body = c.innerHTML;
  if (fns.length) {
    body += '<section class="footnotes"><hr><ol>' +
      fns.map(f => '<li id="fn' + escAttr(f.n) + '">' + esc(f.text) + '</li>').join('') +
      '</ol></section>';
  }

  return '<!DOCTYPE html>\n<html lang="' + lang + '">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(doc.title || t('tab.untitled')) + '</title>\n' + metaBits.join('\n') + '\n' +
    '<style>\n' +
    'body{font-family:"Nunito",-apple-system,"Segoe UI",sans-serif;line-height:1.8;' +
    'max-width:720px;margin:0 auto;padding:48px 24px;color:#222;background:#fff}\n' +
    'sup.fn-ref{font-size:0.72em;vertical-align:super}\n' +
    '.footnotes{margin-top:3em;font-size:0.9em;color:#444}\n' +
    'blockquote{border-left:3px solid #bbb;margin:1em 0;padding:0.3em 1em;color:#444}\n' +
    'code,pre{font-family:"Courier New",monospace;background:#f4f4f4;border-radius:4px}\n' +
    'code{padding:2px 6px}pre{padding:12px 16px;overflow-x:auto}\n' +
    'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}\n' +
    'img{max-width:100%}figure{margin:1em 0;text-align:center}\n' +
    '.page-break-marker{border:none;border-top:1px solid #bbb;height:0;margin:2em 0}\n' +
    '@media print{body{padding:0}}\n' +
    '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
}

/* ----- OROSDOC (round-trip archive) ----- */
function ioBuildOrosDoc(doc) {
  flushSave();
  return JSON.stringify({
    orosWriter: true, ver: 1,
    doc: {
      title: doc.title, author: doc.author, tags: doc.tags,
      category: doc.category, html: doc.html,
      footnotes: doc.footnotes || [], comments: doc.comments || [],
      pageSize: doc.pageSize, margins: doc.margins,
      header: doc.header || '', footer: doc.footer || ''
    }
  }, null, 2);
}

/* ----- Individual export actions (RTF/DOCX/PDF wired in parts 3-4) ----- */
function ioExportTxt(doc) {
  downloadBlob(ioToPlainText(), ioBaseName(doc) + '.txt', 'text/plain');
}
function ioExportMd(doc) {
  downloadBlob(ioToMarkdown(doc), ioBaseName(doc) + '.md', 'text/markdown');
}
function ioExportHtml(doc) {
  downloadBlob(ioToStandaloneHTML(doc), ioBaseName(doc) + '.html', 'text/html');
}
function ioExportOrosDoc(doc) {
  downloadBlob(ioBuildOrosDoc(doc), ioBaseName(doc) + '.orosdoc', 'application/json');
}
function ioExportJSON() {
  flushSave();
  downloadBlob(JSON.stringify(serialize(), null, 2),
    'oros-writer-database.json', 'application/json');
}

/* ----- EXPORT DIALOG ----- */
function openExportDialog() {
  const doc = activeDoc();
  if (!doc) return;

  const dlg = openDialog(t('io.title.exp'), '', [
    { class: 'fb-btn primary', label: 'OK', onClick: () => dlg.close() }
  ]);
  const body = dlg.querySelector('.w-dialog-body');

  const formats = [
    { ext: 'txt',     name: 'io.txt.name',     desc: 'io.txt.desc',     fn: () => { ioExportTxt(doc); dlg.close(); } },
    { ext: 'md',      name: 'io.md.name',      desc: 'io.md.desc',      fn: () => { ioExportMd(doc); dlg.close(); } },
    { ext: 'html',    name: 'io.html.name',    desc: 'io.html.desc',    fn: () => { ioExportHtml(doc); dlg.close(); } },
    { ext: 'rtf',     name: 'io.rtf.name',     desc: 'io.rtf.desc',    note: 'io.rtf.note',  fn: () => { dlg.close(); ioExportRtf(doc); } },
    { ext: 'docx',    name: 'io.docx.name',    desc: 'io.docx.desc',    note: 'io.docx.note', fn: () => { dlg.close(); ioExportDocx(doc); } },
    { ext: 'pdf',     name: 'io.pdf.name',     desc: 'io.pdf.desc',     fn: () => { dlg.close(); ioExportPdf(doc); } },
    { ext: 'orosdoc', name: 'io.orosdoc.name', desc: 'io.orosdoc.desc', fn: () => { ioExportOrosDoc(doc); dlg.close(); } },
    { ext: 'json',    name: 'io.json.name',    desc: 'io.json.desc',    fn: () => { ioExportJSON(); dlg.close(); } }
  ];

  const list = document.createElement('div');
  list.className = 'io-list';

  formats.forEach(f => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'io-row';

    const ext = document.createElement('span');
    ext.className = 'io-ext';
    ext.textContent = '.' + f.ext;

    const wrap = document.createElement('span');
    wrap.className = 'io-txt';
    const nm = document.createElement('span');
    nm.className = 'io-name';
    nm.textContent = t(f.name);
    const ds = document.createElement('span');
    ds.className = 'io-desc';
    ds.textContent = t(f.desc);
    wrap.append(nm, ds);

    row.append(ext, wrap);
    row.addEventListener('click', f.fn);
    list.appendChild(row);

    if (f.note) {
      const nt = document.createElement('div');
      nt.className = 'io-note';
      nt.textContent = '· ' + t(f.note);
      nt.style.marginTop = f.ext === 'rtf' ? '0' : '0';
      list.appendChild(nt);
    }
  });
  body.appendChild(list);

  // Metadata rides along (transparent to the user)
  const chips = [];
  if (doc.author) chips.push(doc.author);
  if (doc.category) chips.push(doc.category);
  (doc.tags || []).forEach(tag => chips.push('#' + tag));
  if (chips.length) {
    const meta = document.createElement('div');
    meta.className = 'io-meta';
    const lbl = document.createElement('span');
    lbl.className = 'io-meta-chip';
    lbl.textContent = t('io.metaLabel');
    meta.appendChild(lbl);
    chips.forEach(c => {
      const chip = document.createElement('span');
      chip.className = 'io-meta-chip';
      chip.textContent = c;
      meta.appendChild(chip);
    });
    body.appendChild(meta);
  }

  const naming = document.createElement('div');
  naming.className = 'io-note';
  naming.style.marginTop = '10px';
  naming.textContent = t('io.naming');
  body.appendChild(naming);
}

/* ===== SECTION 22: WAVE 5 — RTF + DOCX EXPORTERS (native) ===== */
//
// Philosophy: NO external libraries. RTF is written by hand with
// \uXXXX escapes (Greek-safe: each UTF-16 unit becomes \uN?, the
// standard trick readers like Word/LibreOffice combine correctly
// for surrogate pairs). DOCX is a hand-rolled minimal OOXML package:
// ZIP with STORE method (no compression) + own CRC32 — fully valid
// OPC, opens in Word, LibreOffice, Google Docs.
//
// Known v1 limits (deliberate, documented in io.*.desc strings):
//   · RTF lists are literal "- / n." markers (lossy, flagged in UI).
//   · DOCX images become a caption placeholder (embedding media parts
//     is a possible future wave — flagged here, not hidden).
//   · Footnotes/comments append as an end-of-document section.

/* ---------- Shared: page geometry (mm → twips) ---------- */
function ioMmToTwips(mm) { return Math.round(mm * 1440 / 25.4); }

function ioPageSizeMm(doc) {
  const s = PAPER_SIZES[doc.pageSize] || PAPER_SIZES.a4;
  if (s.w === 'auto') return PAPER_SIZES.a4;   // full-width → A4 paper
  return s;
}

/* ================================================================
   RTF EXPORTER
   ================================================================ */
function rtfEsc(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s.charAt(i);
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (c <= 127) out += ch;
    else {
      let n = c;
      if (n > 32767) n -= 65536;          // RTF wants signed 16-bit
      out += '\\u' + n + '?';
    }
  }
  return out;
}

/* Group wrapper: wraps text with RTF format toggles */
function rtfWrap(text, fmt) {
  if (!text) return '';
  let on = '', off = '';
  if (fmt.b)      { on += '\\b ';     off = '\\b0 ' + off; }
  if (fmt.i)      { on += '\\i ';     off = '\\i0 ' + off; }
  if (fmt.u)      { on += '\\ul ';    off = '\\ul0 ' + off; }
  if (fmt.strike) { on += '\\strike '; off = '\\strike0 ' + off; }
  if (fmt.sup)    { on += '\\super '; off = '\\sup0 ' + off; }
  return on ? '{' + on + text + off + '}' : text;
}

/* Inline walker for RTF (uses rtfWrap for grouping) */
function rtfInlineRe(node, fmt) {
  let out = '';
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) {
      out += rtfWrap(rtfEsc(ch.nodeValue.replace(/[\r\n\t]+/g, ' ')), fmt);
      return;
    }
    if (ch.nodeName === 'BR') { out += '\\line '; return; }
    if (ch.nodeName === 'IMG') return;   // images not carried by RTF v1
    const map = { STRONG: 'b', B: 'b', EM: 'i', I: 'i', U: 'u',
                  DEL: 'strike', S: 'strike', STRIKE: 'strike', SUP: 'sup' };
    if (map[ch.nodeName]) {
      out += rtfInlineRe(ch, Object.assign({}, fmt, _obj(map[ch.nodeName])));
    } else {
      out += rtfInlineRe(ch, fmt);
    }
  });
  return out;
}
function _obj(v) { const o = {}; o[v] = true; return o; }

function rtfBlocks(node) {
  let out = '';
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) {
      const txt = ch.nodeValue.trim();
      if (txt) out += '\\pard\\sa200 ' + rtfEsc(txt) + '\\par\n';
      return;
    }
    if (ch.nodeType !== 1) return;
    if (ch.classList && ch.classList.contains('page-break-marker')) {
      out += '\\page\n'; return;
    }
    if (ch.classList && ch.classList.contains('toc-inline')) return;
    switch (ch.nodeName) {
      case 'H1': case 'H2': case 'H3': case 'H4': {
        const fs = { H1: '40', H2: '32', H3: '27', H4: '24' }[ch.nodeName];
        out += '\\pard\\sb240\\sa120\\keep\\b\\fs' + fs + ' ' +
               rtfInlineRe(ch, { b: true }) + '\\par\n';
        break;
      }
      case 'P': {
        const txt = rtfInlineRe(ch, {});
        out += txt ? '\\pard\\sa200 ' + txt + '\\par\n' : '\\pard\\par\n';
        break;
      }
      case 'BLOCKQUOTE':
        out += '\\pard\\li567\\sa200 ' + rtfInlineRe(ch, {}) + '\\par\n';
        break;
      case 'PRE':
        out += '\\pard\\f0\\fs20\\sa200 ' +
               rtfEsc(ch.textContent.replace(/\n$/, '')) + '\\par\n';
        break;
      case 'HR':
        out += '\\pard\\brdrb\\brdrs\\brdrw10\\sa200\\par\n';
        break;
      case 'UL': case 'OL': {
        let n = 1;
        Array.from(ch.children).forEach(li => {
          if (li.nodeName !== 'LI') return;
          const marker = ch.nodeName === 'OL' ? (n++) + '. ' : '- ';
          out += '\\pard\\fi-284\\li567\\sa120 ' + rtfEsc(marker) +
                 rtfInlineRe(li, {}) + '\\par\n';
        });
        break;
      }
      case 'TABLE': {
        Array.from(ch.querySelectorAll('tr')).forEach(tr => {
          const cells = Array.from(tr.children)
            .map(td => rtfInlineRe(td, {}));
          out += '\\pard\\sa120 ' + cells.join('\\tab ') + '\\par\n';
        });
        break;
      }
      default: out += rtfBlocks(ch);
    }
  });
  return out;
}

function ioExportRtf(doc) {
  flushSave();
  showToast(t('io.busy'));
  setTimeout(() => {
    const c = ioExportClone();
    c.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);
    const pg = ioPageSizeMm(doc);
    const meta = [];
    if (doc.title)   meta.push('{\\title ' + rtfEsc(doc.title) + '}');
    if (doc.author) meta.push('{\\author ' + rtfEsc(doc.author) + '}');
    if (doc.category) meta.push('{\\subject ' + rtfEsc(doc.category) + '}');
    if (doc.tags && doc.tags.length)
      meta.push('{\\keywords ' + rtfEsc(doc.tags.join(', ')) + '}');

    let body = rtfBlocks(c);

    // Footnotes / comments appendix (end-of-document section)
    const app = [];
    if ((doc.footnotes || []).length) {
      app.push('\\pard\\sb240\\b\\fs24 ' + rtfEsc('Notes') + '\\par\n');
      const seen = new Set();
      c.querySelectorAll('sup.fn-ref').forEach(ref => {
        const id = ref.getAttribute('data-fn');
        if (!id || seen.has(id)) return;
        seen.add(id);
        const e = doc.footnotes.find(f => f.id === id);
        if (e) app.push('\\pard\\sa120 ' + rtfEsc('[' + ref.textContent + '] ') +
                        rtfEsc(e.text || '') + '\\par\n');
      });
    }
    if ((doc.comments || []).length) {
      app.push('\\pard\\sb240\\b\\fs24 ' + rtfEsc('Comments') + '\\par\n');
      doc.comments.forEach(cm => {
        app.push('\\pard\\sa120 ' +
          rtfEsc('\u201C' + (cm.quote || '') + '\u201D \u2014 ' + (cm.text || '')) +
          '\\par\n');
      });
    }
    if (app.length) body += '\\page\n' + app.join('');

    const rtf = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fswiss Calibri;}}' +
      '\\f1\\fs22\\viewkind4\\uc1' +
      (meta.length ? '{\\info' + meta.join('') + '}' : '') +
      '\\paperw' + ioMmToTwips(pg.w) + '\\paperh' + ioMmToTwips(pg.h) +
      '\\margl' + ioMmToTwips(doc.margins.left) +
      '\\margr' + ioMmToTwips(doc.margins.right) +
      '\\margt' + ioMmToTwips(doc.margins.top) +
      '\\margb' + ioMmToTwips(doc.margins.bottom) + '\n' +
      body + '}';

    downloadBlob(rtf, ioBaseName(doc) + '.rtf', 'application/rtf');
  }, 30);
}

/* ================================================================
   DOCX EXPORTER — hand-rolled ZIP (STORE) + CRC32 + OOXML
   ================================================================ */

/* ----- CRC32 (IEEE, reflected) ----- */
function ioCrc32(u8) {
  if (!ioCrc32.T) {
    ioCrc32.T = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      ioCrc32.T[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = ioCrc32.T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ----- ZIP writer, method 0 (STORE), no extras ----- */
function ioZipStore(files) {   // files: [{name, data:Uint8Array}]
  const chunks = [], central = [];
  const d = new Date();
  const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  const enc = new TextEncoder();
  let offset = 0;

  files.forEach(f => {
    const nameB = enc.encode(f.name);
    const crc = ioCrc32(f.data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);   // local file header sig
    lh.setUint16(4, 20, true);           // version needed
    lh.setUint16(6, 0, true);            // flags (names are ASCII)
    lh.setUint16(8, 0, true);            // method = STORE
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, nameB.length, true);
    lh.setUint16(28, 0, true);          // extra len
    chunks.push(new Uint8Array(lh.buffer), nameB, f.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);   // central dir sig
    cd.setUint16(4, 20, true);           // version made by
    cd.setUint16(6, 20, true);           // version needed
    cd.setUint16(8, 0, true);            // flags
    cd.setUint16(10, 0, true);           // method
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, nameB.length, true);
    cd.setUint32(42, offset, true);      // local header offset
    central.push(new Uint8Array(cd.buffer), nameB);

    offset += 30 + nameB.length + f.data.length;
  });

  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);

  const all = chunks.concat(central, [new Uint8Array(eocd.buffer)]);
  const total = all.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  all.forEach(c => { out.set(c, p); p += c.length; });
  return out;
}

function ioEncStr(s) { return new TextEncoder().encode(s); }

/* ----- OOXML: runs (inline formatting) ----- */
function dxRun(text, pr) {
  let rPr = '';
  if (pr.b)      rPr += '<w:b/>';
  if (pr.i)      rPr += '<w:i/>';
  if (pr.u)      rPr += '<w:u w:val="single"/>';
  if (pr.strike) rPr += '<w:strike/>';
  if (pr.sup)    rPr += '<w:vertAlign w:val="superscript"/>';
  return '<w:r>' + (rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '') +
         '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
}

function dxRuns(node, pr) {
  let out = '';
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) {
      out += dxRun(ch.nodeValue.replace(/[\r\n\t]+/g, ' '), pr);
      return;
    }
    if (ch.nodeName === 'BR') { out += '<w:r><w:br/></w:r>'; return; }
    if (ch.nodeName === 'IMG') {
      const alt = ch.getAttribute('alt') || '';
      out += dxRun(alt ? '[image: ' + alt + ']' : '[image]', pr);
      return;
    }
    const map = { STRONG: 'b', B: 'b', EM: 'i', I: 'i', U: 'u',
                  DEL: 'strike', S: 'strike', STRIKE: 'strike', SUP: 'sup' };
    if (map[ch.nodeName]) out += dxRuns(ch, Object.assign({}, pr, _obj(map[ch.nodeName])));
    else out += dxRuns(ch, pr);
  });
  return out;
}

function dxPara(runsXml, opts) {
  opts = opts || {};
  let pPr = '';
  if (opts.style) pPr += '<w:pStyle w:val="' + opts.style + '"/>';
  if (opts.ind)   pPr += '<w:ind w:left="' + opts.ind + '" w:hanging="284"/>';
  if (opts.jc)    pPr += '<w:jc w:val="' + opts.jc + '"/>';
  if (opts.border) pPr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>';
  return runsXml || pPr
    ? '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + (runsXml || '') + '</w:p>'
    : '<w:p/>';
}

/* ----- OOXML: blocks ----- */
function dxBlocks(node) {
  let out = '';
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) {
      const txt = ch.nodeValue.trim();
      if (txt) out += dxPara(dxRun(txt, {}));
      return;
    }
    if (ch.nodeType !== 1) return;
    if (ch.classList && ch.classList.contains('page-break-marker')) {
      out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; return;
    }
    if (ch.classList && ch.classList.contains('toc-inline')) return;
    switch (ch.nodeName) {
      case 'H1': out += dxPara(dxRuns(ch, {}), { style: 'Heading1' }); break;
      case 'H2': out += dxPara(dxRuns(ch, {}), { style: 'Heading2' }); break;
      case 'H3': out += dxPara(dxRuns(ch, {}), { style: 'Heading3' }); break;
      case 'H4': out += dxPara(dxRuns(ch, {}), { style: 'Heading4' }); break;
      case 'P': out += dxPara(dxRuns(ch, {})); break;
      case 'BLOCKQUOTE': out += dxPara(dxRuns(ch, {}), { style: 'Quote' }); break;
      case 'PRE':
        ch.textContent.split('\n').forEach(line =>
          out += dxPara(dxRun(line, {}), { style: 'Code' }));
        break;
      case 'HR': out += dxPara('', { border: true }); break;
      case 'UL': case 'OL': {
        let n = 1;
        Array.from(ch.children).forEach(li => {
          if (li.nodeName !== 'LI') return;
          const marker = ch.nodeName === 'OL' ? (n++) + '. ' : '\u2022 ';
          out += dxPara(dxRun(marker, {}) + dxRuns(li, {}), { ind: 567 });
        });
        break;
      }
      case 'TABLE': {
        const rows = Array.from(ch.querySelectorAll('tr'));
        if (!rows.length) break;
        const cols = rows[0].children.length || 1;
        out += '<w:tbl><w:tblPr><w:tblBorders>' +
          '<w:top w:val="single" w:sz="4" w:color="auto"/>' +
          '<w:left w:val="single" w:sz="4" w:color="auto"/>' +
          '<w:bottom w:val="single" w:sz="4" w:color="auto"/>' +
          '<w:right w:val="single" w:sz="4" w:color="auto"/>' +
          '<w:insideH w:val="single" w:sz="4" w:color="auto"/>' +
          '<w:insideV w:val="single" w:sz="4" w:color="auto"/>' +
          '</w:tblBorders><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
          '<w:tblGrid>' + Array(cols).fill('<w:gridCol/>').join('') + '</w:tblGrid>';
        rows.forEach(tr => {
          out += '<w:tr>';
          Array.from(tr.children).forEach(tc => {
            out += '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' +
                   dxPara(dxRuns(tc, {})) + '</w:tc>';
          });
          out += '</w:tr>';
        });
        out += '</w:tbl>';
        break;
      }
      case 'FIGURE': {
        const cap = ch.querySelector('figcaption');
        out += dxPara(dxRuns(ch.querySelector('img') || ch, {}), { jc: 'center' });
        if (cap) out += dxPara(dxRuns(cap, {}), { jc: 'center' });
        break;
      }
      default: out += dxBlocks(ch);
    }
  });
  return out;
}

/* ----- Package assembly ----- */
function ioExportDocx(doc) {
  flushSave();
  showToast(t('io.busy'));
  setTimeout(() => {
    const c = ioExportClone();
    c.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);
    const pg = ioPageSizeMm(doc);

    let body = dxBlocks(c);

    // Footnotes / comments appendix
    const app = [];
    if ((doc.footnotes || []).length) {
      app.push(dxPara(dxRun('Notes', { b: true }), { style: 'Heading2' }));
      const seen = new Set();
      c.querySelectorAll('sup.fn-ref').forEach(ref => {
        const id = ref.getAttribute('data-fn');
        if (!id || seen.has(id)) return;
        seen.add(id);
        const e = doc.footnotes.find(f => f.id === id);
        if (e) app.push(dxPara(dxRun('[' + ref.textContent + '] ', { super: false }) +
                               dxRun(e.text || '', {})));
      });
    }
    if ((doc.comments || []).length) {
      app.push(dxPara(dxRun('Comments', { b: true }), { style: 'Heading2' }));
      doc.comments.forEach(cm => {
        app.push(dxPara(
          dxRun('\u201C' + (cm.quote || '') + '\u201D', { i: true }) +
          dxRun(' \u2014 ' + (cm.text || ''), {})));
      });
    }
    if (app.length) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + app.join('');

    const sectPr =
      '<w:sectPr><w:pgSz w:w="' + ioMmToTwips(pg.w) + '" w:h="' + ioMmToTwips(pg.h) + '"/>' +
      '<w:pgMar w:top="' + ioMmToTwips(doc.margins.top) +
      '" w:right="' + ioMmToTwips(doc.margins.right) +
      '" w:bottom="' + ioMmToTwips(doc.margins.bottom) +
      '" w:left="' + ioMmToTwips(doc.margins.left) +
      '" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

    const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>';

    const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>';

    const STYLE = function (id, name, sz, b) {
      return '<w:style w:type="paragraph" w:styleId="' + id + '">' +
        '<w:name w:val="' + name + '"/><w:basedOn w:val="Normal"/>' +
        '<w:pPr><w:keepNext/><w:outlineLvl w:val="' +
        (id === 'Heading1' ? 0 : id === 'Heading2' ? 1 : id === 'Heading3' ? 2 : 3) + '"/></w:pPr>' +
        '<w:rPr>' + (b ? '<w:b/>' : '') + '<w:sz w:val="' + sz + '"/></w:rPr></w:style>';
    };

    const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr>' +
      '</w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      STYLE('Heading1', 'heading 1', '40', true) +
      STYLE('Heading2', 'heading 2', '32', true) +
      STYLE('Heading3', 'heading 3', '27', true) +
      STYLE('Heading4', 'heading 4', '24', true) +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="quote"/>' +
      '<w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/>' +
      '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>' +
      '</w:styles>';

    const CORE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
      ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
      ' xmlns:dcterms="http://purl.org/dc/terms/"' +
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(doc.title || t('tab.untitled')) + '</dc:title>' +
      (doc.author ? '<dc:creator>' + esc(doc.author) + '</dc:creator>' : '') +
      (doc.category ? '<dc:subject>' + esc(doc.category) + '</dc:subject>' : '') +
      (doc.tags && doc.tags.length ? '<cp:keywords>' + esc(doc.tags.join(', ')) + '</cp:keywords>' : '') +
      '</cp:coreProperties>';

    const DOC = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + body + sectPr + '</w:body></w:document>';

    const zip = ioZipStore([
      { name: '[Content_Types].xml', data: ioEncStr(CT) },
      { name: '_rels/.rels',         data: ioEncStr(RELS) },
      { name: 'docProps/core.xml',   data: ioEncStr(CORE) },
      { name: 'word/styles.xml',      data: ioEncStr(STYLES) },
      { name: 'word/document.xml',   data: ioEncStr(DOC) }
    ]);

    downloadBlob(zip, ioBaseName(doc) + '.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }, 30);
}

/* ===== SECTION 23: WAVE 5 — PDF EXPORTER (lazy jsPDF) ===== */
//
// jsPDF + NotoSans-Regular load ON DEMAND (PDF only) — boot stays
// clean. NotoSans covers Greek fully (fixes the historical
// mojibake in PDF exports). Bold/italic map onto the same face
// (single TTF) — headings still get size weight, body loses faux
// bold: documented v1 tradeoff, swap in NotoSans-Bold.ttf later
// if wanted. Images become [image] placeholders (same as DOCX v1).

const IO_VENDOR_JSPDF = 'vendor/jspdf.umd.min.js';
const IO_VENDOR_NOTO  = 'vendor/NotoSans-Regular.ttf';

function ioLoadScript(src) {
  return new Promise((res, rej) => {
    if (window.jspdf && window.jspdf.jsPDF) return res();
    if (document.querySelector('script[data-io-vendor="jspdf"]')) {
      // someone else is loading it — wait politely
      const iv = setInterval(() => {
        if (window.jspdf && window.jspdf.jsPDF) { clearInterval(iv); res(); }
      }, 50);
      return;
    }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.ioVendor = 'jspdf';
    s.onload = () => res();
    s.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

function ioFetchFontB64(url) {
  // Cache-bust using version of font file (vendor folder hash would be ideal,
  // falling back to timestamp when building). For now use timestamp on dev
  // to force reload when font is updated locally.
  return fetch(url + '?t=' + Date.now())
    .then(r => { if (!r.ok) throw new Error('font http ' + r.status); return r.arrayBuffer(); })
    .then(buf => {
      const u8 = new Uint8Array(buf);
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < u8.length; i += CHUNK)
        bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
      return btoa(bin);
    });
}

/* Collect inline runs [{text,b,i,u,sup}] — shared by the PDF writer */
function ioCollectRuns(node, fmt, out) {
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) {
      out.push({ text: ch.nodeValue, b: fmt.b, i: fmt.i, u: fmt.u, sup: fmt.sup });
      return;
    }
    if (ch.nodeName === 'BR') { out.push({ text: '\n', br: true }); return; }
    if (ch.nodeName === 'IMG') {
      const alt = ch.getAttribute('alt') || '';
      out.push({ text: alt ? ' [image: ' + alt + '] ' : ' [image] ', b: fmt.b, i: fmt.i, u: fmt.u, sup: fmt.sup });
      return;
    }
    const map = { STRONG: 'b', B: 'b', EM: 'i', I: 'i', U: 'u',
                  DEL: 'strike', S: 'strike', STRIKE: 'strike', SUP: 'sup' };
    if (map[ch.nodeName]) {
      const f = Object.assign({}, fmt); f[map[ch.nodeName]] = true;
      ioCollectRuns(ch, f, out);
    } else ioCollectRuns(ch, fmt, out);
  });
}

function ioExportPdf(doc) {
  flushSave();
  showToast(t('io.busy'));
  ioLoadScript(IO_VENDOR_JSPDF)
    .then(() => ioFetchFontB64(IO_VENDOR_NOTO))
    .then(fontB64 => {
      const JsPDF = window.jspdf.jsPDF;
      const pg = ioPageSizeMm(doc);
      const pdf = new JsPDF({ unit: 'mm', format: [pg.w, pg.h], compress: true });

      pdf.addFileToVFS('NotoSans-Regular.ttf', fontB64);
      pdf.addFont('NotoSans-Regular.ttf', 'noto', 'normal');
      pdf.addFont('NotoSans-Regular.ttf', 'noto', 'bold');
      pdf.addFont('NotoSans-Regular.ttf', 'noto', 'italic');
      pdf.addFont('NotoSans-Regular.ttf', 'noto', 'bolditalic');
      pdf.setFont('noto', 'normal');

      const ML = doc.margins.left, MR = doc.margins.right;
      const MT = doc.margins.top, MB = doc.margins.bottom;
      const maxX = pg.w - MR;
      let y = MT;

      const newPage = () => { pdf.addPage([pg.w, pg.h]); y = MT; };
      const need = h => { if (y + h > pg.h - MB - 6) newPage(); };

      const styleOf = r => (r.b && r.i) ? 'bolditalic' : r.b ? 'bold' : r.i ? 'italic' : 'normal';

      /* word-flow renderer — formats survive line breaks */
      function writeRuns(runs, o) {
        o = o || {};
        const fs = o.fs || 11;
        const lh = fs * 0.3528 * 1.62;
        const startX = o.x != null ? o.x : ML;
        let x = startX;

        pdf.setTextColor(o.color || '#1a1a1a');
        // flatten to word tokens
        const words = [];
        runs.forEach(r => {
          if (r.br) { words.push({ br: true }); return; }
          String(r.text || '').split(/\s+/).forEach(w => {
            if (w) words.push({ t: w, f: r });
          });
        });

        let lineFirst = true;
        let i = 0;
        while (i < words.length) {
          const w = words[i++];
          if (w.br) {
            y += lh; need(lh); x = startX; lineFirst = true;
            continue;
          }
          const sfs = w.f.sup ? fs * 0.68 : fs;
          pdf.setFont('noto', styleOf(w.f));
          pdf.setFontSize(sfs);
          let wordW = pdf.getTextWidth(w.t);
          const spW = pdf.getTextWidth(' ');
          if (!lineFirst) wordW += spW;
          if (!lineFirst && x + wordW > maxX) {
            y += lh; need(lh); x = startX; lineFirst = true;
            wordW = pdf.getTextWidth(w.t);
          }
          const x0 = x;
          if (!lineFirst) x += spW;
          const dy = w.f.sup ? -(fs * 0.14) : 0;
          pdf.text(w.t, x, y + dy);
          if (w.f.u) pdf.line(x, y + 1.4, x + wordW, y + 1.4);
          x += pdf.getTextWidth(w.t);
          lineFirst = false;
        }
        y += lh;
      }

      /* block walker */
      function writeBlocks(node) {
        Array.from(node.childNodes).forEach(ch => {
          if (ch.nodeType === 3) {
            const txt = ch.nodeValue.trim();
            if (txt) { need(8); writeRuns([{ text: txt }], {}); }
            return;
          }
          if (ch.nodeType !== 1) return;
          if (ch.classList && ch.classList.contains('page-break-marker')) { newPage(); return; }
          if (ch.classList && ch.classList.contains('toc-inline')) return;
          switch (ch.nodeName) {
            case 'H1': case 'H2': case 'H3': case 'H4': {
              const fsz = { H1: 22, H2: 17, H3: 14, H4: 12.5 }[ch.nodeName];
              y += 5; need(fsz * 0.6);
              const runs = []; ioCollectRuns(ch, {}, runs);
              writeRuns(runs, { fs: fsz, color: '#000000' });
              y += 2;
              break;
            }
            case 'P': {
              const runs = []; ioCollectRuns(ch, {}, runs);
              if (runs.length) writeRuns(runs, {});
              else y += 4;
              break;
            }
            case 'BLOCKQUOTE': {
              y += 3;
              const runs = []; ioCollectRuns(ch, {}, runs);
              writeRuns(runs, { x: ML + 8, fs: 10.5, color: '#444444' });
              y += 3;
              break;
            }
            case 'PRE': {
              pdf.setFont('courier', 'normal'); pdf.setFontSize(9);
              ch.textContent.replace(/\n$/, '').split('\n').forEach(line => {
                need(5);
                pdf.text(line, ML + 4, y);
                y += 5;
              });
              y += 3;
              break;
            }
            case 'HR': {
              need(8); y += 4;
              pdf.setDrawColor('#888888'); pdf.setLineWidth(0.3);
              pdf.line(ML, y, maxX, y);
              y += 4;
              break;
            }
            case 'UL': case 'OL': {
              let n = 1;
              Array.from(ch.children).forEach(li => {
                if (li.nodeName !== 'LI') return;
                const marker = ch.nodeName === 'OL' ? (n++) + '. ' : '\u2022 ';
                const runs = []; ioCollectRuns(li, {}, runs);
                runs.unshift({ text: marker });
                writeRuns(runs, { x: ML + 6, fs: 11 });
              });
              y += 2;
              break;
            }
            case 'TABLE': {
              Array.from(ch.querySelectorAll('tr')).forEach(tr => {
                const cells = Array.from(tr.children)
                  .map(tc => tc.textContent.trim()).join('   |   ');
                need(6);
                pdf.setFont('noto', 'normal'); pdf.setFontSize(10);
                const lines = pdf.splitTextToSize(cells, maxX - ML - 6);
                lines.forEach(ln => { pdf.text(ln, ML + 6, y); y += 5; });
                y += 1.5;
              });
              y += 2;
              break;
            }
            case 'FIGURE': {
              const img = ch.querySelector('img');
              const cap = ch.querySelector('figcaption');
              need(8);
              writeRuns([{ text: img ? '[image' + (img.alt ? ': ' + img.alt : '') + ']' : '' }]
                .filter(r => r.text), { fs: 10, color: '#666666' });
              if (cap) writeRuns((() => { const r = []; ioCollectRuns(cap, {}, r); return r; })(),
                { fs: 9.5, color: '#666666' });
              break;
            }
            default: writeBlocks(ch);
          }
        });
      }

      const c = ioExportClone();
      c.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);
      writeBlocks(c);

      // Footnotes / comments appendix
      const app = [];
      const seen = new Set();
      c.querySelectorAll('sup.fn-ref').forEach(ref => {
        const id = ref.getAttribute('data-fn');
        if (!id || seen.has(id)) return;
        seen.add(id);
        const e = (doc.footnotes || []).find(f => f.id === id);
        if (e) app.push({ text: '[' + ref.textContent + '] ' + (e.text || '') });
      });
      (doc.comments || []).forEach(cm => {
        app.push({ text: '\u201C' + (cm.quote || '') + '\u201D \u2014 ' + (cm.text || ''), i: true });
      });
      if (app.length) {
        newPage();
        y += 2;
        writeRuns([{ text: 'Notes', b: true }], { fs: 16 });
        app.forEach(a => writeRuns([{ text: a.text, i: a.i }], { fs: 10 }));
      }

      // Headers / footers / page numbers — every page, finalized pass
      const pages = pdf.internal.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        if (doc.header) {
          pdf.setFont('noto', 'normal'); pdf.setFontSize(8.5);
          pdf.setTextColor('#777777');
          pdf.text(String(doc.header), ML, Math.max(MT - 5, 6));
        }
        if (doc.footer) {
          pdf.setFont('noto', 'normal'); pdf.setFontSize(8.5);
          pdf.setTextColor('#777777');
          pdf.text(String(doc.footer), ML, pg.h - Math.max(MB - 8, 6));
        }
        pdf.setFont('noto', 'normal'); pdf.setFontSize(8.5);
        pdf.setTextColor('#999999');
        pdf.text(p + ' / ' + pages, pg.w - MR, pg.h - Math.max(MB - 8, 6), { align: 'right' });
      }

      pdf.save(ioBaseName(doc) + '.pdf');
    })
    .catch(err => {
      console.error('[orOS] writer PDF export failed:', err);
      showToast(t('io.importfailed'));
    });
}

/* ===== SECTION 24: WAVE 5 — IMPORT (parsers + dialog + apply) ===== */

/* ----- RTF parser (scanner, unicode-aware, lossy formatting) ----- */
function ioParseRtf(raw) {
  const skipRe = /\\(?:fonttbl|colortbl|stylesheet|info|pict|listtable|listoverridetable|themedata|colorschememapping|latentstyles|datastore|generator)/;
  let out = '', i = 0, depth = 0, skipDepth = -1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '{') {
      depth++;
      if (skipDepth === -1 && skipRe.test(raw.slice(i, i + 34))) skipDepth = depth;
      i++; continue;
    }
    if (ch === '}') {
      if (skipDepth === depth) skipDepth = -1;
      depth--;
      i++; continue;
    }
    if (skipDepth !== -1) { i++; continue; }
    if (ch === '\\') {
      const cw = raw.slice(i).match(/^\\([a-zA-Z]+)(-?\d+)? ?/);
      if (cw) {
        const w = cw[1], num = cw[2];
        if (w === 'par' || w === 'line') out += '\n';
        else if (w === 'tab') out += '\t';
        else if (w === 'u' && num !== undefined) {
          let n = parseInt(num, 10);
          if (n < 0) n += 65536;
          out += String.fromCharCode(n);
          i += cw[0].length;
          // swallow the \'hh fallback byte Word writes after \uN
          if (/^\\'[0-9a-fA-F]{2}/.test(raw.slice(i))) i += 4;
          else if (raw[i] === '?') i++;
          continue;
        }
        i += cw[0].length; continue;
      }
      const hex = raw.slice(i).match(/^\\'([0-9a-fA-F]{2})/);
      if (hex) {
        out += String.fromCharCode(parseInt(hex[1], 16));
        i += hex[0].length; continue;
      }
      if (/^\\[{}\\]/.test(raw.slice(i))) { out += raw[i + 1]; i += 2; continue; }
      i++; continue;
    }
    out += ch; i++;
  }
  return out;
}

/* ----- Mini Markdown parser ----- */
function ioMdInline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[\^(\d+)\]/g, '<sup class="fn-ref" data-mdfn="$1">$1</sup>');
  return s;
}

function ioParseMd(text, footnoteDefs) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  footnoteDefs = footnoteDefs || {};

  function block(from, to) {
    let html = '', para = [], i = from;
    const flush = () => {
      if (para.length) {
        html += '<p>' + ioMdInline(para.join(' ')) + '</p>';
        para = [];
      }
    };
    while (i <= to) {
      const L = lines[i];
      const h = L.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flush(); html += '<h' + h[1].length + '>' + ioMdInline(h[2]) + '</h' + h[1].length + '>'; i++; continue; }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(L)) { flush(); html += '<hr>'; i++; continue; }
      if (/^\s*```/.test(L)) {
        flush(); i++;
        const buf = [];
        while (i <= to && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;   // closing fence
        html += '<pre>' + esc(buf.join('\n')) + '</pre>';
        continue;
      }
      if (/^\s*>\s?/.test(L)) {
        flush();
        const buf = [];
        while (i <= to && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        html += '<blockquote>' + blockFromLines(buf) + '</blockquote>';
        continue;
      }
      if (/^\s*[-*+]\s+/.test(L) || /^\s*\d+\.\s+/.test(L)) {
        flush();
        const ordered = /^\s*\d+\./.test(L);
        html += ordered ? '<ol>' : '<ul>';
        while (i <= to && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
          html += '<li>' + ioMdInline(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')) + '</li>';
          i++;
        }
        html += ordered ? '</ol>' : '</ul>';
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(L)) {
        // table: header row + separator + body rows
        flush();
        const rows = [];
        while (i <= to && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
        if (rows.length >= 2 && /^[\s|:-]+$/.test(rows[1])) {
          const cells = r => r.trim().replace(/^\||\|$/g, '').split('|')
            .map(c => c.trim());
          html += '<table><tr>' + cells(rows[0]).map(c => '<th>' + ioMdInline(c) + '</th>').join('') + '</tr>';
          for (let r = 2; r < rows.length; r++)
            html += '<tr>' + cells(rows[r]).map(c => '<td>' + ioMdInline(c) + '</td>').join('') + '</tr>';
          html += '</table>';
          continue;
        }
        // not a real table — fall through as paragraph text
        para.push(rows.join(' '));
        continue;
      }
      if (/^\[\^(\d+)\]:\s?(.*)$/.test(L)) {   // footnote def — strip, stored separately
        i++; continue;
      }
      if (!L.trim()) { flush(); i++; continue; }
      para.push(L.trim());
      i++;
    }
    flush();
    return html;
  }

  function blockFromLines(buf) {
    let html = '';
    // simple: paragraphs only inside quotes (nesting rare in practice)
    html = buf.map(l => l.trim()).filter(Boolean)
      .map(l => '<p>' + ioMdInline(l) + '</p>').join('');
    return html;
  }

  const html = block(0, lines.length - 1);

  // footnotes: convert data-mdfn refs into real ids + entries
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const footnotes = [];
  wrap.querySelectorAll('sup.fn-ref[data-mdfn]').forEach(sup => {
    const n = sup.getAttribute('data-mdfn');
    const txt = footnoteDefs[n];
    if (txt === undefined) { sup.remove(); return; }
    const nid = 'fn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    sup.removeAttribute('data-mdfn');
    sup.setAttribute('data-fn', nid);
    footnotes.push({ id: nid, text: txt });
  });

  const firstH = wrap.querySelector('h1,h2,h3,h4,p');
  const title = firstH ? firstH.textContent.trim().slice(0, 80) : '';
  return { title: title, html: wrap.innerHTML, footnotes: footnotes, comments: [] };
}

/* ----- TXT parser ----- */
function ioParseTxt(text) {
  const clean = String(text).replace(/\r\n?/g, '\n');
  const paras = clean.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const html = paras.map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
  const first = paras[0] || '';
  const title = first && first.length <= 80 ? first : '';
  return { title: title, html: html, footnotes: [], comments: [] };
}

/* ----- HTML parser (sanitized) ----- */
function ioParseHtml(text) {
  const dom = new DOMParser().parseFromString(String(text), 'text/html');
  dom.querySelectorAll('script,style,iframe,object,embed,noscript,link,meta,form,input,button')
    .forEach(n => n.remove());
  dom.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(a => {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'srcdoc' ||
          ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value))) {
        el.removeAttribute(a.name);
      }
    });
  });
  const ttl = dom.querySelector('title');
  const h1 = dom.querySelector('h1');
  const title = (ttl && ttl.textContent.trim()) ||
                (h1 && h1.textContent.trim().slice(0, 80)) || '';
  return { title: title, html: dom.body ? dom.body.innerHTML : '', footnotes: [], comments: [] };
}

/* ----- OROSDOC parser ----- */
function ioParseOrosDoc(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.orosWriter !== true || !obj.doc) throw new Error('not orosdoc');
  const d = obj.doc;
  return {
    title: typeof d.title === 'string' ? d.title : '',
    author: typeof d.author === 'string' ? d.author : '',
    category: typeof d.category === 'string' ? d.category : '',
    tags: Array.isArray(d.tags) ? d.tags : [],
    html: typeof d.html === 'string' ? d.html : '',
    footnotes: Array.isArray(d.footnotes) ? d.footnotes : [],
    comments: Array.isArray(d.comments) ? d.comments : []
  };
}

/* ----- Dispatch: file → parsed payload (async) ----- */
function ioParseFile(file) {
  const extTop = (file.name.split('.').pop() || '').toLowerCase();
  if (extTop === 'docx' || extTop === 'odt') return ioParseZipDoc(file, extTop);
  return new Promise((resolve, reject) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read fail'));
    reader.onload = () => {
      const text = reader.result;
      try {
        if (ext === 'orosdoc') return resolve(Object.assign({ kind: 'doc' }, ioParseOrosDoc(text)));

        if (ext === 'json') {
          const obj = JSON.parse(text);
          if (obj && Array.isArray(obj.docs)) {
            // full Writer database export → restore offer
            return resolve({ kind: 'db', data: obj });
          }
          if (obj && obj.orosWriter === true) {
            return resolve(Object.assign({ kind: 'doc' }, ioParseOrosDoc(text)));
          }
          throw new Error('unknown json');
        }

        if (ext === 'txt')  return resolve(Object.assign({ kind: 'doc' }, ioParseTxt(text)));
        if (ext === 'html' || ext === 'htm') return resolve(Object.assign({ kind: 'doc' }, ioParseHtml(text)));
        if (ext === 'rtf') {
          const txt = ioParseRtf(text);
          return resolve(Object.assign({ kind: 'doc' }, ioParseTxt(txt)));
        }
        if (ext === 'md' || ext === 'markdown') {
          // peel footnote definitions first ([^n]: text)
          const defs = {};
          const peeled = String(text).replace(/\r\n?/g, '\n').replace(/^\[\^(\d+)\]:\s?(.*)$/gm,
            (m, n, d) => { defs[n] = d; return ''; });
          return resolve(Object.assign({ kind: 'doc' }, ioParseMd(peeled, defs)));
        }
        reject(new Error('unsupported: ' + ext));
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsText(file);
  });
}

/* ----- Annotation remap (fresh ids — append/replace never clash) ----- */
function ioPrepareImport(parsed) {
  const wrap = document.createElement('div');
  wrap.innerHTML = parsed.html || '';
  const footnotes = [], comments = [];
  wrap.querySelectorAll('sup.fn-ref').forEach(sup => {
    const old = sup.getAttribute('data-fn');
    const e = (parsed.footnotes || []).find(f => f.id === old);
    const nid = 'fn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    sup.setAttribute('data-fn', nid);
    sup.textContent = '*';
    if (e) footnotes.push({ id: nid, text: e.text || '' });
    else sup.remove();
  });
  wrap.querySelectorAll('mark.cmt-mark').forEach(mark => {
    const old = mark.getAttribute('data-cmt');
    const e = (parsed.comments || []).find(f => f.id === old);
    const nid = 'cm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    mark.setAttribute('data-cmt', nid);
    if (e) comments.push({ id: nid, quote: e.quote || mark.textContent, text: e.text || '', ts: e.ts || Date.now() });
    else ioUnwrap(mark);
  });
  return { html: wrap.innerHTML, footnotes: footnotes, comments: comments };
}

/* ----- Apply (mode: new | append | replace) ----- */
function ioApplyImport(parsed, mode) {
  const title = (parsed.title || '').trim();

  if (mode === 'new') {
    const prep = ioPrepareImport(parsed);
    const doc = createDoc({ title: title, html: prep.html, silent: true });
    doc.footnotes = prep.footnotes;
    doc.comments = prep.comments;
    if (parsed.author)   doc.author = parsed.author;
    if (parsed.category) doc.category = parsed.category;
    if (Array.isArray(parsed.tags) && parsed.tags.length) doc.tags = parsed.tags.slice();
    renderTabs();
    renderEditor();
    scheduleSave();
    showToast(t('io.imported'));
    return;
  }

  flushSave();
  const doc = activeDoc();
  if (!doc) return;
  const prep = ioPrepareImport(parsed);

  if (mode === 'append') {
    doc.html = (doc.html || '') + prep.html;
    doc.footnotes = (doc.footnotes || []).concat(prep.footnotes);
    doc.comments = (doc.comments || []).concat(prep.comments);
    doc.mtime = Date.now();
  } else if (mode === 'replace') {
    takeManualSnapshot(doc);           // current state → Version History first
    doc.html = prep.html;
    doc.footnotes = prep.footnotes;
    doc.comments = prep.comments;
    if (title) doc.title = title;
    doc.mtime = Date.now();
  }

  fnSuspendObserver = true;
  cmtSuspendObserver = true;
  EL.editor.innerHTML = doc.html;
  renumberFootnotes();
  cleanupFootnotes();
  cleanupComments();
  fnSuspendObserver = false;
  cmtSuspendObserver = false;

  renderTabs();
  footnotesAfterRender();
  commentsAfterRender();
  updateEmptyState();
  scheduleSave();
  showToast(t('io.imported'));
}

/* ----- IMPORT DIALOG ----- */
function openImportDialog(prefile) {
  const dlg = openDialog(t('io.title.imp'), '', [
    { class: 'fb-btn primary', label: t('tt.import'), onClick: () => { /* wired after parse */ } }
  ]);
  const body = dlg.querySelector('.w-dialog-body');
  const foot = dlg.querySelector('.w-dialog-foot');

  const hint = document.createElement('div');
  hint.className = 'io-note';
  hint.style.marginTop = '0';
  hint.textContent = t('io.pickFileSub');
  body.appendChild(hint);

  const pick = document.createElement('label');
  pick.className = 'file-pick-btn';
  pick.style.marginTop = '8px';
  pick.innerHTML = ICONS.import + ' ' + esc(t('io.pickFile')) +
    '<input type="file" accept=".orosdoc,.docx,.odt,.rtf,.html,.htm,.txt,.md,.markdown,.json">';
  const inp = pick.querySelector('input');
  body.appendChild(pick);

  const busy = document.createElement('div');
  busy.className = 'io-busy';
  busy.style.display = 'none';
  busy.innerHTML = '<span class="io-spinner"></span>' + esc(t('io.busy'));
  body.appendChild(busy);

  let parsed = null, fileBase = '';

  // shared pipeline — used by the file picker AND drag & drop
  function ioPickDropped(file) {
    fileBase = file.name.replace(/\.[^.]+$/, '');
    busy.style.display = 'flex';
    pick.style.display = 'none';

    ioParseFile(file)
      .then(res => {
        busy.style.display = 'none';
        if (res.kind === 'db') {
          if (confirm(t('io.dbConfirm'))) {
            hydrate(res.data);
            renderTabs();
            renderEditor();
            scheduleSave();
            showToast(t('io.imported'));
            dlg.close();
          } else {
            busy.style.display = 'none';
            pick.style.display = '';
            inp.value = '';
          }
          return;
        }
        parsed = res;
        renderOptions();
      })
      .catch(err => {
        console.error('[orOS] writer import failed:', err);
        busy.style.display = 'none';
        pick.style.display = '';
        inp.value = '';
        showToast(t('io.importfailed'));
      });
  }

  inp.addEventListener('change', () => {
    const file = inp.files[0];
    if (file) ioPickDropped(file);
  });

  // Drag & drop hands us a File directly (Section 25)
  if (prefile) ioPickDropped(prefile);

  function renderOptions() {
    body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'io-name';
    title.style.marginBottom = '6px';
    title.textContent = (parsed.title || fileBase || 'Document');
    body.appendChild(title);

    const lbl = document.createElement('div');
    lbl.className = 'io-note';
    lbl.style.marginTop = '0';
    lbl.textContent = t('io.impOpts');
    body.appendChild(lbl);

    const opts = document.createElement('div');
    opts.className = 'imp-opts';
    const modes = [
      { id: 'new',     key: 'io.impNew',     dkey: 'io.impNew.d' },
      { id: 'append',  key: 'io.impAppend',  dkey: 'io.impAppend.d' },
      { id: 'replace', key: 'io.impReplace', dkey: 'io.impReplace.d' }
    ];
    modes.forEach((m, i) => {
      const lab = document.createElement('label');
      lab.className = 'imp-opt' + (i === 0 ? ' sel' : '');
      lab.innerHTML = '<input type="radio" name="io-mode" value="' + m.id + '"' +
        (i === 0 ? ' checked' : '') + '><span><strong>' + esc(t(m.key)) + '</strong>' +
        '<div class="io-desc">' + esc(t(m.dkey)) + '</div></span>';
      lab.addEventListener('click', () => {
        opts.querySelectorAll('.imp-opt').forEach(x => x.classList.remove('sel'));
        lab.classList.add('sel');
      });
      opts.appendChild(lab);
    });
    body.appendChild(opts);

    // wire the footer Import button
    foot.innerHTML = '';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'fb-btn primary';
    go.textContent = t('tt.import');
    go.addEventListener('click', () => {
      const sel = opts.querySelector('input[name="io-mode"]:checked');
      ioApplyImport(parsed, sel ? sel.value : 'new');
      dlg.close();
    });
    foot.appendChild(go);
  }
}

/* ===== SECTION 25: WAVE 5 — DOCX/ODT IMPORT (native ZIP) + DRAG & DROP ===== */
//
// No libraries: the ZIP central directory is walked by hand and
// deflated entries expand via the native DecompressionStream
// ('deflate-raw'). DOCX → word/document.xml, ODT → content.xml.
// Formatting import is deliberately conservative: headings,
// bold/italic/underline/strike/superscript, tables, line breaks.
// Word list numbering lives in numbering.xml — imported as plain
// paragraphs for now (possible future wave). Known conservative
// read: w:b w:val="0" inside a run is ignored (rare in practice).

/* ----- ZIP reader (EOCD scan → central dir → inflate) ----- */
function ioReadZip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return Promise.reject(new Error('zip: no eocd'));
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen  = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen  = dv.getUint16(p + 32, true);
    entries.push({
      method: dv.getUint16(p + 10, true),
      csize:  dv.getUint32(p + 20, true),
      lho:     dv.getUint32(p + 42, true),
      name:    new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen))
    });
    p += 46 + nameLen + extraLen + commLen;
  }
  return Promise.all(entries.map(e => {
    const lName  = dv.getUint16(e.lho + 26, true);
    const lExtra = dv.getUint16(e.lho + 28, true);
    const start  = e.lho + 30 + lName + lExtra;
    const data   = u8.subarray(start, start + e.csize);
    if (e.method === 0) return { name: e.name, data: data };
    if (e.method === 8) {
      return new Response(
        new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      ).arrayBuffer().then(ab => ({ name: e.name, data: new Uint8Array(ab) }));
    }
    return { name: e.name, data: new Uint8Array(0) };
  }));
}

/* ----- Entry point for DOCX / ODT ----- */
function ioParseZipDoc(file, ext) {
  const isDocx = ext === 'docx';
  const readAb = (file.arrayBuffer
    ? file.arrayBuffer()
    : new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('read fail'));
        fr.readAsArrayBuffer(file);
      }));
  return readAb
    .then(buf => ioReadZip(buf))
    .then(entries => {
      const f = entries.find(e => e.name === (isDocx ? 'word/document.xml' : 'content.xml'));
      if (!f) throw new Error(isDocx ? 'not a docx package' : 'not an odt package');
      const dom = new DOMParser().parseFromString(
        new TextDecoder().decode(f.data), 'application/xml');
      if (dom.getElementsByTagName('parsererror').length) throw new Error('xml parse error');
      return isDocx ? ioParseDocxXml(dom) : ioParseOdtXml(dom);
    })
    .then(res => Object.assign({ kind: 'doc' }, res));
}

/* ----- DOCX: word/document.xml → HTML ----- */
const IO_NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function ioDxRuns(node) {
  let out = '';
  Array.from(node.childNodes).forEach(n => {
    if (n.nodeType !== 1) return;
    const ln = n.localName;
    if (ln === 'r') {
      let b = false, i = false, u = false, strike = false, sup = false, txt = '';
      Array.from(n.children).forEach(c => {
        const cl = c.localName;
        if (cl === 'rPr') {
          Array.from(c.children).forEach(pr => {
            const pl = pr.localName;
            if (pl === 'b') b = true;
            if (pl === 'i') i = true;
            if (pl === 'u') u = true;
            if (pl === 'strike') strike = true;
            if (pl === 'vertAlign' && pr.getAttributeNS(IO_NS_W, 'val') === 'superscript') sup = true;
          });
        } else if (cl === 't') txt += c.textContent;
        else if (cl === 'tab') txt += '\t';
        else if (cl === 'br') txt += '\n';
      });
      if (!txt) return;
      let h = esc(txt).replace(/\n/g, '<br>').replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
      if (strike) h = '<del>' + h + '</del>';
      if (u)      h = '<u>' + h + '</u>';
      if (i)      h = '<em>' + h + '</em>';
      if (b)      h = '<strong>' + h + '</strong>';
      if (sup)    h = '<sup>' + h + '</sup>';
      out += h;
    } else if (ln === 'hyperlink') {
      out += ioDxRuns(n);
    } else if (ln === 'br') {
      out += '<br>';
    }
  });
  return out;
}

function ioDxPara(p) {
  let style = '';
  Array.from(p.children).forEach(c => {
    if (c.localName === 'pPr') {
      Array.from(c.children).forEach(pp => {
        if (pp.localName === 'pStyle')
          style = pp.getAttributeNS(IO_NS_W, 'val') || pp.getAttribute('w:val') || '';
      });
    }
  });
  const inner = ioDxRuns(p);
  const m = /^heading\s*(\d)/i.exec(style);
  if (m && +m[1] >= 1 && +m[1] <= 4) return '<h' + m[1] + '>' + inner + '</h' + m[1] + '>';
  if (/quote/i.test(style)) return '<blockquote>' + inner + '</blockquote>';
  return '<p>' + inner + '</p>';
}

function ioParseDocxXml(dom) {
  const body = dom.getElementsByTagNameNS(IO_NS_W, 'body')[0];
  if (!body) throw new Error('docx: no body');
  let html = '';
  Array.from(body.children).forEach(ch => {
    const ln = ch.localName;
    if (ln === 'p') {
      html += ioDxPara(ch);
    } else if (ln === 'tbl') {
      html += '<table style="border-collapse:collapse;width:100%;">';
      Array.from(ch.getElementsByTagNameNS(IO_NS_W, 'tr')).forEach(tr => {
        html += '<tr>';
        Array.from(tr.children).forEach(tc => {
          if (tc.localName !== 'tc') return;
          let cells = '';
          Array.from(tc.children).forEach(tcp => {
            if (tcp.localName === 'p') cells += ioDxPara(tcp);
          });
          html += '<td style="border:1px solid var(--border);padding:6px 10px;">' + cells + '</td>';
        });
        html += '</tr>';
      });
      html += '</table>';
    }
    // sectPr and anything else skipped
  });
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const first = wrap.querySelector('h1,h2,h3,h4,p');
  return { title: first ? first.textContent.trim().slice(0, 80) : '',
           html: html, footnotes: [], comments: [] };
}

/* ----- ODT: content.xml → HTML ----- */
const IO_NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

function ioOdInline(el) {
  let out = '';
  Array.from(el.childNodes).forEach(n => {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const ln = n.localName;
    if (ln === 'line-break') out += '\n';
    else if (ln === 'tab') out += '\t';
    else if (ln === 's') out += ' ';
    else if (ln === 'span' || ln === 'a') out += ioOdInline(n);
    else out += n.textContent;   // unknown inline → safe text only
  });
  return out;
}

function ioOdFix(s) {
  return esc(s).replace(/\n/g, '<br>').replace(/\t/g, ' ');
}

function ioParseOdtXml(dom) {
  let root = null;
  Array.from(dom.getElementsByTagNameNS('*', 'text')).forEach(el => {
    if (!root && el.localName === 'text') root = el;   // office:text
  });
  if (!root) throw new Error('odt: no body');
  let html = '';
  Array.from(root.children).forEach(ch => {
    const ln = ch.localName;
    if (ln === 'h') {
      const lvl = parseInt(
        ch.getAttributeNS(IO_NS_TEXT, 'outline-level') ||
        ch.getAttribute('text:outline-level') || '1', 10) || 1;
      const l = Math.min(4, Math.max(1, lvl));
      html += '<h' + l + '>' + ioOdFix(ioOdInline(ch)) + '</h' + l + '>';
    } else if (ln === 'p') {
      html += '<p>' + ioOdFix(ioOdInline(ch)) + '</p>';
    } else if (ln === 'list') {
      html += '<ul>';
      Array.from(ch.getElementsByTagNameNS(IO_NS_TEXT, 'list-item')).forEach(li => {
        let inner = '';
        Array.from(li.children).forEach(c => {
          if (c.localName === 'p') inner += '<p>' + ioOdFix(ioOdInline(c)) + '</p>';
        });
        html += '<li>' + inner + '</li>';
      });
      html += '</ul>';
    } else if (ln === 'table') {
      html += '<table style="border-collapse:collapse;width:100%;">';
      Array.from(ch.getElementsByTagNameNS('*', 'table-row')).forEach(tr => {
        html += '<tr>';
        Array.from(tr.children).forEach(tc => {
          if (tc.localName !== 'table-cell') return;
          let cells = '';
          Array.from(tc.getElementsByTagNameNS(IO_NS_TEXT, 'p')).forEach(tp => {
            cells += '<p>' + ioOdFix(ioOdInline(tp)) + '</p>';
          });
          html += '<td style="border:1px solid var(--border);padding:6px 10px;">' + cells + '</td>';
        });
        html += '</tr>';
      });
      html += '</table>';
    }
  });
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const first = wrap.querySelector('h1,h2,h3,h4,p');
  return { title: first ? first.textContent.trim().slice(0, 80) : '',
           html: html, footnotes: [], comments: [] };
}

/* ----- DRAG & DROP (overlay rides on .rich-wrapper — the
   positioned ancestor; pointer-events:none lets drops pass) ----- */
let ddOverlay = null, ddCounter = 0;

function ioDndHasFiles(e) {
  return e.dataTransfer &&
    Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
}

function ioShowDd(on) {
  if (on && !ddOverlay) {
    ddOverlay = document.createElement('div');
    ddOverlay.className = 'dd-overlay';
    ddOverlay.innerHTML =
      '<svg class="dd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>' +
      '<div class="dd-title">' + esc(t('io.ddTitle')) + '</div>' +
      '<div class="dd-sub">' + esc(t('io.ddSub')) + '</div>';
    EL.wrapper.appendChild(ddOverlay);
  }
  if (ddOverlay) ddOverlay.hidden = !on;
}

function ioWireDragDrop() {
  const app = EL.app;
  app.addEventListener('dragenter', e => {
    if (!ioDndHasFiles(e)) return;
    e.preventDefault();
    ddCounter++;
    ioShowDd(true);
  });
  app.addEventListener('dragover', e => {
    if (ioDndHasFiles(e)) e.preventDefault();
  });
  app.addEventListener('dragleave', e => {
    e.preventDefault();
    if (--ddCounter <= 0) { ddCounter = 0; ioShowDd(false); }
  });
  app.addEventListener('drop', e => {
    e.preventDefault();
    ddCounter = 0;
    ioShowDd(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (['orosdoc','json','docx','odt','rtf','html','htm','txt','md','markdown']
        .indexOf(ext) === -1) {
      showToast(t('io.importfailed'));
      return;
    }
    openImportDialog(f);   // reuses the full mode-selection flow
  });
}

})();
