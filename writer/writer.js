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
    'doc.closed': 'Document closed',
    'doc.renamed': 'Document renamed',
    'doc.deleted': 'Document deleted',
    'sync.updated': 'Updated with changes from other devices',
    'tt.find': 'Find and replace',
    'tt.chars': 'Special characters',
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
    'find.replaced.all': 'All occurrences replaced',
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
    'doc.closed': 'Το έγγραφο έκλεισε',
    'doc.renamed': 'Το έγγραφο μετονομάστηκε',
    'doc.deleted': 'Το έγγραφο διαγράφηκε',
    'sync.updated': 'Ενημερώθηκε με αλλαγές από άλλες συσκευές',
    'tt.find': 'Αναζήτηση και αντικατάσταση',
    'tt.chars': 'Ειδικοί χαρακτήρες',
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
    'char.symbols': 'Símbola',
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
    'find.replaced.all': 'Όλες οι εμφανίσεις αντικαταστάθηκαν',
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
    'opt.format': 'Μορφή',
    'opt.format.any': 'Οποιαδήποτε μορφή',
    'opt.format.bold': 'Μόνο έντονη',
    'opt.format.italic': 'Μόνο πλάγια',
    'opt.format.underline': 'Μόνο υπογραμμένη',
    'opt.format.strike': 'Μόνο διαγραμμένη'
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
  goal:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/><polygon points="8,2 8,14"/></svg>'
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
      'hr': 'hr', 'pagebreak': 'pageBreak'
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

function serialize() {
  return {
    ver: 1,
    docs: state.docs.map(d => ({
      id: d.id, title: d.title, author: d.author, tags: d.tags,
      category: d.category, html: d.html,
      footnotes: d.footnotes || [], comments: d.comments || [],
      versions: (d.versions || []).slice(0, 8),   // retention guard
      pageSize: d.pageSize, margins: d.margins,
      header: d.header, footer: d.footer,
      mtime: d.mtime, del: !!d.del
    })),
    tabOrder: state.tabOrder.filter(id => {
      const d = getDoc(id); return d && !d.del;
    }),
    settings: state.settings,
    autocorrect: state.autocorrect,
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
    versions: Array.isArray(d.versions) ? d.versions.slice(0, 8) : [],
    pageSize: typeof d.pageSize === 'string' ? d.pageSize : 'a4',
    margins: (d.margins && typeof d.margins === 'object') ? d.margins
             : { top: 25, bottom: 25, left: 25, right: 25 },
    header: typeof d.header === 'string' ? d.header : '',
    footer: typeof d.footer === 'string' ? d.footer : '',
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
  binds['btn-footnotes'] = () => toggleFootnotesPanel();
  binds['btn-comments'] = () => toggleCommentsPanel();
  binds['btn-toc'] = () => toggleTocPanel();
  binds['btn-meta'] = () => openMetadataDialog();
  binds['btn-page'] = () => openPageSettings();
  binds['btn-templates'] = () => openTemplates();
  binds['btn-versions'] = () => openVersionsPanel();
  binds['btn-goal'] = () => toggleGoalBar();

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
      showToast('Saved');
    }

    // Ctrl/Cmd + W — close current tab (confirm if dirty)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
      if (state.activeTab) {
        e.preventDefault();
        flushSave();
        closeDoc(state.activeTab);
      }
    }

    // Ctrl/Cmd + T — new tab
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
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
    { class: 'fb-btn', label: t('wx.cancel') === 'wx.cancel' ? 'Close' : 'OK', onClick: () => dlg.close() }
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
    { class: 'fb-btn primary', label: t('wx.cancel') === 'wx.cancel' ? 'OK' : 'Done', onClick: () => dlg.close() }
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
      <input type="text" class="w-field" id="lk-text" placeholder="${t('doc.renamed')}">
      <input type="url" class="w-field" id="lk-url" placeholder="https://…">
    </div>
  `, [
    { class: 'fb-btn', label: t('wx.cancel') === 'wx.cancel' ? 'Cancel' : '✕', onClick: () => dlg.close() },
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
    { class: 'fb-btn', label: '✕', onClick: () => dlg.close() },
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
      <input type="checkbox" id="tbl-h"> <span>${t('opt.word')}</span>
    </div>
  `, [
    { class: 'fb-btn', label: '✕', onClick: () => dlg.close() },
    { class: 'fb-btn primary', label: 'OK', onClick: () => { doInsertTable(dlg); } }
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
    pm.querySelector('.paper-caption').textContent = `${size.w}×${size.h} mm`;
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
    updatePreview();
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
  const headings = Array.from(EL.editor.querySelectorAll('h1,h2,h3,h4'))
    .map((h, i) => ({ id: 'toc-' + i, level: h.tagName.toLowerCase(), text: h.textContent.trim() || t('toc.unnamed') }))
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

function wireHeadingsForToc() {
  // Auto-id headings for anchor links
  EL.editor.addEventListener('input', () => {
    let idx = 0;
    EL.editor.querySelectorAll('h1,h2,h3,h4').forEach(h => {
      if (!h.id || h.id.startsWith('toc-')) h.id = 'toc-' + idx++;
    });
  });
}

function toggleTocPanel() {
  // Simplified: just show inline dialog with TOC list
  const headings = Array.from(EL.editor.querySelectorAll('h1,h2,h3,h4')).map((h,i) => ({
    id: 'toc-' + i, level: h.tagName.toLowerCase(), text: h.textContent.trim() || t('toc.unnamed')
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

/* ----- BOOT INTEGRATION (SECTION 13) ----- */
// Append to existing boot sequence:
// wireHeadingsForToc(); // after bindToolbar/wireEvents

})();
