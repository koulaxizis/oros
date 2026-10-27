/* ══════════════════════════════════════════════════════════
   orOS Writer — clean-room port, Wave 1 core
   Contract: iframe citizen. No theme, no notifications subsystem,
   no sync logic — slice registration only. Version lives in shell.js.
   Boot marker: "writer.js v<ver> boot" (Bible Part VI pattern)
   ══════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ----- BOOT MARKER (stale-file detection, R3) ----- */
var SCRIPT_V = '';
(function () {
  var m = (document.currentScript && document.currentScript.src || '').match(/[?&]v=([^&#]+)/);
  SCRIPT_V = m ? m[1] : '';
  console.log('writer.js v' + (SCRIPT_V || '?') + ' boot');
})();

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
  tabOrder: [],        // OPEN tabs — DEVICE-LOCAL (oros-writer-prefs)
  seen: {},            // doc ids this device has already shown — device-local
  settings: {
    smartTypography: true,
    typewriterSound: false
  },
  autocorrect: null,   // { rules:[{find,repl,def}], mtime } — seeded on first AC dialog use
  templates: [],       // custom templates [{id,name,desc,html,mtime}]
  tplTombs: [],        // [{id,ts}] — deleted template tombstones
  seeded: false,
  userDict: {}         // "my dictionary": { word: +addedAt | -removedAt } (spell.js)
};

let saveTimer = null;
let dirty = false;

// R8: the sync engine and the language live on the PARENT (shell)
// window — this iframe's own window has neither.
function syncApi() {
  try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
  catch (e) { return window.orosSync || null; }
}
// The shell re-opens the app on a language toggle, so one boot-time
// mirror keeps every existing window.orosLang read in this file valid.
// orosI18n (../i18n.js): the full language code, a pack language included.
try {
  window.orosLang = window.orosI18n ? window.orosI18n.lang() :
                    ((window.parent && window.parent.orosLang) ||
                     localStorage.getItem('oros-lang') || 'en');
} catch (e) { window.orosLang = 'en'; }
// Locale for dates and numbers (el-GR, en-GB, de-DE …).
function loc() {
  return window.orosI18n ? window.orosI18n.locale(window.orosLang)
                         : (window.orosLang === 'el' ? 'el-GR' : 'en-GB');
}

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
    'doc.created': 'Document created',
    'doc.saved': 'Document saved',
    'doc.closed': 'Document closed',
    'doc.renamed': 'Document renamed',
    'doc.deleted': 'Document deleted',
    'tt.find': 'Find and replace',
    'tt.chars': 'Special characters',
    'tt.settings': 'Settings',
    'tt.ask': 'Ask the Assistant about the selected text',
    'tt.sendApp': 'Send to an app (the selected text, or the whole document)',
    'ask.m.sum': 'Summarize', 'ask.m.rephrase': 'Rephrase', 'ask.m.fix': 'Fix spelling & grammar',
    'ask.m.other': 'Ask something else…', 'ask.empty': 'Write or select some text first',
    'ask.sum': 'Summarize this text from my document:',
    'ask.rephrase': 'Rephrase this text from my document, keeping its meaning and language:',
    'ask.fix': 'Correct the spelling and grammar of this text from my document and give me the corrected text:',
    'ask.other': 'About this text from my document:',
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
    'dialog.charsTitle': 'Special characters',
    'dialog.acTitle': 'Auto-correction rules',
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
    'table.insert': 'Insert',
    'find.replaced.all': 'All occurrences replaced',
    'wx.done': 'Done',
    'wx.cancel': 'Cancel',
    'ac.del': 'Delete rule',
    'tt.footnotes': 'Footnotes',
    'tt.comments': 'Comments',
    'fn.title': 'Footnotes',
    'fn.add': 'Add footnote',
    'fn.added': 'Footnote added',
    'fn.empty': 'No footnotes yet — add one with the toolbar button.',
    'fn.jumpHint': 'Jump to reference',
    'cmt.title': 'Comments',
    'cmt.add': 'Add comment',
    'cmt.empty': 'No comments — select text and press the comments button.',
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
    'tpl.builtin.essay.html': '<h1>Essay title</h1><p>Introduction…</p><h2>Section</h2><p>Body…</p><h2>Conclusion</h2><p>Summing up…</p>',
    'tpl.builtin.letter.html': '<p style="text-align:right">City, date</p><p>Recipient<br>Address</p><p>Dear Sir or Madam,</p><p>Body…</p><p>Sincerely,<br>Your name</p>',
    'tpl.builtin.novel.html': '<h1>Chapter One</h1><p>Narrative…</p><p>* * *</p><p>Next scene…</p>',
    'tpl.builtin.screenplay.html': '<p><strong>FADE IN:</strong></p><h3>INT. ROOM — DAY</h3><p>Action description.</p><p><strong>CHARACTER</strong><br>(dialogue)</p>',
    'tpl.builtin.poem.html': '<h1>Poem title</h1><p>First stanza…</p><p>&nbsp;</p><p>Second stanza…</p>',
    'tpl.builtin.notes.html': '<h1>Meeting notes</h1><p>Date / attendees…</p><h2>Agenda</h2><ul><li>Item…</li></ul><h2>Decisions</h2><ul><li>Decision…</li></ul><h2>Action items</h2><ul><li>Who — what — when…</li></ul>',
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
    'io.orosdoc.desc': 'Round-trip archive: text, pictures, footnotes, comments, metadata. Unzip it to see the files.',
    'io.json.name': 'Database (JSON)',
    'io.json.desc': 'Complete slice — all tabs, settings, templates, autocorrect.',
    'io.busy': 'Preparing…',
    'io.pickFile': 'Choose a file',
    'io.pickFileSub': 'Supported: OROSDOC, DOCX, ODT, RTF, HTML, TXT, MD, PDF',
    'io.impOpts': 'How to import?',
    'io.impNew': 'New tab (recommended)',
    'io.impNew.d': 'Everything lands in a fresh document.',
    'io.impAppend': 'Append to current',
    'io.impAppend.d': 'Appended at the end of the active document.',
    'io.impReplace': 'Replace current',
    'io.impReplace.d': 'Dupes current first into Version History.',
    'io.imported': 'Imported',
    'io.importfailed': 'Could not parse this file',
    'io.pdfNoText': 'This PDF has no text to take (a scan?). Open it in Library, or make it searchable first in Scanner & PDF.',
    'io.pickFolder': 'Open an unzipped .orosdoc folder…',
    'io.gdocs': 'From Google Docs…',
    'io.gdocsWait': 'Sign in to Google, then pick one document.',
    'io.newer': 'This file was made by a newer orOS. Update orOS to open it.',
    'io.dbConfirm': 'Merge this Writer backup? Its documents, templates and settings come back; documents that exist only here are kept.',
    'io.dbKept': 'Backup merged. {n} document(s) differed: the newer text is kept, the other copy is in Version history.',
    'io.ddTitle': 'Drop to open',
    'io.ddSub': 'OROSDOC, DOCX, ODT, RTF, HTML, TXT, MD, PDF',
    'io.metaLabel': 'Riding along:',
    'io.naming': 'Exports take document title, falls back to untitled.',
    'io.pickFirst': 'Pick a file first',
    'io.exportfailed': 'Export failed',
    'io.needDoc': 'Write something or open a document first',
    'save.quota': 'Storage is full — recent changes could not be saved on this device. Export or remove large images.',
    'io.notes': 'Notes',
    'io.comments': 'Comments',
    'tt.docs': 'Documents',
    'docs.title': 'Documents',
    'docs.search': 'Search documents…',
    'docs.empty': 'No documents yet.',
    'docs.none': 'Nothing matches your search.',
    'docs.isOpen': 'Open tab',
    'docs.delete': 'Delete document',
    'docs.confirmDel': 'Delete “{name}”? It is removed from all your devices (Undo available for a few seconds).',
    'docs.words': '{n} words',
    'doc.restored': 'Document restored',
    'wx.undo': 'Undo',
    'wx.ok': 'OK',
    'wx.delete': 'Delete',
    'wx.confirm': 'Confirm',
    'tpl.builtinBadge': 'Built-in',
    'tpl.deleted': 'Template deleted',
    'img.caption': 'Caption',
    'meta.tagAddBtn': 'Add tag',
    'cmt.needSel': 'Select some text first, then add the comment.',
    'cmt.oneBlock': 'A comment must stay within one paragraph — select less text.',
    'ver.autoNote': 'Auto versions: at most one every 5 minutes while you write; the newest 8 are kept (fewer for very long documents). Manual snapshots are never dropped.',
    'goal.lockArmed': 'Editing will lock when the goal is reached',
    'tt.insert': 'Insert',
    'tt.view': 'View',
    'tbl.bar': 'Table tools',
    'tbl.rowAbove': 'Row above',
    'tbl.rowBelow': 'Row below',
    'tbl.colLeft': 'Column left',
    'tbl.colRight': 'Column right',
    'tbl.delRow': 'Delete row',
    'tbl.delCol': 'Delete column',
    'tbl.delTable': 'Delete table',
    'view.focus': 'Focus mode',
    'view.unitP': 'Focus on the paragraph',
    'view.unitS': 'Focus on the sentence',
    'view.tw': 'Typewriter scrolling',
    'view.wc': 'Show word count',
    'view.stats': 'Statistics…',
    'focus.exit': 'Exit focus mode',
    'stats.title': 'Statistics',
    'stats.doc': 'Document',
    'stats.sel': 'Selection',
    'stats.words': 'Words',
    'stats.chars': 'Characters (with spaces)',
    'stats.charsNs': 'Characters (no spaces)',
    'stats.paras': 'Paragraphs',
    'stats.sents': 'Sentences',
    'stats.read': 'Reading time',
    'stats.speak': 'Speaking time',
    'stats.min': '{n} min',
    'stats.lt1': 'under 1 min',
    'stats.note': 'Reading at about 230 words a minute, speaking at about 130.',
    'wc.sel': '{s} of {n} words',
    'tt.review': 'Review',
    'rv.spell': 'Check spelling',
    'rv.lang': 'Spelling of this document',
    'rv.langAuto': 'English and Greek (automatic)',
    'rv.langEn': 'English only',
    'rv.langEl': 'Greek only',
    'rv.langNone': 'Don’t check this document',
    'rv.track': 'Track changes',
    'rv.changes': 'Changes…',
    'rv.merge': 'Mail merge…',
    'rv.dict': 'My dictionary…',
    'sp.noSugg': 'No suggestions',
    'sp.add': 'Add to my dictionary',
    'sp.ignore': 'Ignore',
    'sp.added': '“{w}” added to your dictionary',
    'sp.failed': 'The spelling dictionary could not be loaded, so the browser’s own spelling check is used for now.',
    'set.spell': 'Check spelling (English and Greek)',
    'set.spellNote': 'The dictionaries download once, when first needed (about 0.2 MB for English, 2.1 MB for Greek), and then work offline.',
    'ud.title': 'My dictionary',
    'ud.note': 'Words you added are never marked as mistakes, on all your devices.',
    'ud.empty': 'No words yet. Right-click (or tap) a marked word and choose “Add to my dictionary”.',
    'ud.ph': 'Add a word',
    'ud.add': 'Add',
    'ud.remove': 'Remove “{w}”',
    'tc.on': 'Tracking changes',
    'tc.offT': 'Tracking changes is off',
    'tc.title': 'Changes',
    'tc.empty': 'No tracked changes in this document.',
    'tc.ins': 'Inserted',
    'tc.del': 'Deleted',
    'tc.accept': 'Accept',
    'tc.reject': 'Reject',
    'tc.acceptAll': 'Accept all',
    'tc.rejectAll': 'Reject all',
    'tc.allAccepted': 'All changes accepted',
    'tc.allRejected': 'All changes rejected',
    'tc.who': 'Your name for tracked changes',
    'tc.whoNote': 'Kept on this device only. Empty: the name of the device.',
    'tc.exportNote': 'Tracked changes are exported as if accepted.',
    'mm.title': 'Mail merge',
    'mm.noFields': 'This document has no fields yet. Type a field name between double braces where the data should go, for example {{FirstName}}, then open Mail merge again.',
    'mm.data': 'Data',
    'mm.contacts': 'Contacts',
    'mm.csv': 'CSV file…',
    'mm.label': 'Label',
    'mm.allContacts': 'All contacts',
    'mm.fields': 'Fields in the document',
    'mm.columns': 'Available: {list}',
    'mm.missing': 'Not in the data, left empty: {list}',
    'mm.record': 'Record {i} of {n}',
    'mm.prev': 'Previous record',
    'mm.next': 'Next record',
    'mm.out': 'Output',
    'mm.outPdf': 'One PDF',
    'mm.outZip': 'A PDF for each record (ZIP)',
    'mm.outDoc': 'One new document',
    'mm.go': 'Create',
    'mm.noRows': 'No records.',
    'mm.csvBad': 'Could not read this CSV file.',
    'mm.busy': 'Creating {i} of {n}…',
    'mm.done': 'Mail merge done: {n} records',
    'mm.capped': 'Only the first {n} records are used.',
    'mm.docTitle': '{title} (mail merge)'
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
    'doc.created': 'Το έγγραφο δημιουργήθηκε',
    'doc.saved': 'Το έγγραφο αποθηκεύτηκε',
    'doc.closed': 'Το έγγραφο έκλεισε',
    'doc.renamed': 'Το έγγραφο μετονομάστηκε',
    'doc.deleted': 'Το έγγραφο διαγράφηκε',
    'tt.find': 'Αναζήτηση και αντικατάσταση',
    'tt.chars': 'Ειδικοί χαρακτήρες',
    'tt.settings': 'Ρυθμίσεις',
    'tt.ask': 'Ρώτα τον Βοηθό για το επιλεγμένο κείμενο',
    'tt.sendApp': 'Στείλε σε εφαρμογή (το επιλεγμένο κείμενο ή όλο το έγγραφο)',
    'ask.m.sum': 'Σύνοψη', 'ask.m.rephrase': 'Αναδιατύπωση', 'ask.m.fix': 'Διόρθωση ορθογραφίας και γραμματικής',
    'ask.m.other': 'Άλλη ερώτηση…', 'ask.empty': 'Γράψε ή επίλεξε πρώτα κείμενο',
    'ask.sum': 'Κάνε μια σύνοψη αυτού του κειμένου από το έγγραφό μου:',
    'ask.rephrase': 'Ξαναγράψε αυτό το κείμενο από το έγγραφό μου, με το ίδιο νόημα και στην ίδια γλώσσα:',
    'ask.fix': 'Διόρθωσε την ορθογραφία και τη γραμματική αυτού του κειμένου από το έγγραφό μου και δώσε μου το διορθωμένο κείμενο:',
    'ask.other': 'Σχετικά με αυτό το κείμενο από το έγγραφό μου:',
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
    'dialog.charsTitle': 'Ειδικοί χαρακτήρες',
    'dialog.acTitle': 'Κανόνες αυτο-διόρθωσης',
    'ac.replace': 'Αντικατάσταση με',
    'ac.reset': 'Επαναφορά',
    'ac.saved': 'Οι κανόνες αποθηκεύτηκαν',
    'ac.default': 'Προεπιλογή',
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
    'table.insert': 'Εισαγωγή',
    'find.replaced.all': 'Όλες οι εμφανίσεις αντικαταστάθηκαν',
    'wx.done': 'Ολοκλήρωση',
    'wx.cancel': 'Ακύρωση',
    'ac.del': 'Διαγραφή κανόνα',
    'tt.footnotes': 'Υποσημειώσεις',
    'tt.comments': 'Σχόλια',
    'fn.title': 'Υποσημειώσεις',
    'fn.add': 'Προσθήκη υποσημείωσης',
    'fn.added': 'Η υποσημείωση προστέθηκε',
    'fn.empty': 'Καμία υποσημείωση ακόμα — πρόσθεσε με το κουμπί της γραμμής εργαλείων.',
    'fn.jumpHint': 'Μετάβαση στην αναφορά',
    'cmt.title': 'Σχόλια',
    'cmt.add': 'Προσθήκη σχολίου',
    'cmt.empty': 'Κανένα σχόλιο — επίλεξε κείμενο και πάτησε το κουμπί σχολίων.',
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
    'ver.title': 'Ιστορικό εκδόσεων',
    'ver.auto': 'Αυτόματο',
    'ver.manual': 'Χειροκίνητο',
    'ver.restore': 'Επαναφορά',
    'ver.delete': 'Διαγραφή',
    'ver.snapshot': 'Στιγμιότυπο',
    'ver.snapshotted': 'Snapshot αποθηκεύτηκε',
    'ver.empty': 'Καμία έκδοση — γράψε πρώτα κάτι.',
    'ver.restored': 'Η έκδοση επανήλθε',
    'ver.restoredFull': 'Αποκαταστάθηκε κείμενο, υποσημειώσεις και σχόλια',
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
    'tpl.builtin.essay.html': '<h1>Τίτλος δοκιμίου</h1><p>Εισαγωγή…</p><h2>Ενότητα</h2><p>Κύριο μέρος…</p><h2>Συμπέρασμα</h2><p>Σύνοψη…</p>',
    'tpl.builtin.letter.html': '<p style="text-align:right">Πόλη, ημερομηνία</p><p>Παραλήπτης<br>Διεύθυνση</p><p>Αξιότιμε κύριε / Αξιότιμη κυρία,</p><p>Κείμενο…</p><p>Με εκτίμηση,<br>Το όνομά σας</p>',
    'tpl.builtin.novel.html': '<h1>Κεφάλαιο πρώτο</h1><p>Αφήγηση…</p><p>* * *</p><p>Επόμενη σκηνή…</p>',
    'tpl.builtin.screenplay.html': '<p><strong>ΑΝΟΙΓΜΑ:</strong></p><h3>ΕΣΩΤ. ΔΩΜΑΤΙΟ — ΜΕΡΑ</h3><p>Περιγραφή δράσης.</p><p><strong>ΧΑΡΑΚΤΗΡΑΣ</strong><br>(διάλογος)</p>',
    'tpl.builtin.poem.html': '<h1>Τίτλος ποιήματος</h1><p>Πρώτη στροφή…</p><p>&nbsp;</p><p>Δεύτερη στροφή…</p>',
    'tpl.builtin.notes.html': '<h1>Σημειώσεις σύσκεψης</h1><p>Ημερομηνία / συμμετέχοντες…</p><h2>Ατζέντα</h2><ul><li>Θέμα…</li></ul><h2>Αποφάσεις</h2><ul><li>Απόφαση…</li></ul><h2>Ενέργειες</h2><ul><li>Ποιος — τι — πότε…</li></ul>',
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
    'io.orosdoc.desc': 'Πλήρες αρχείο: κείμενο, εικόνες, υποσημειώσεις, σχόλια, μεταδεδομένα. Με αποσυμπίεση βλέπεις τα αρχεία του.',
    'io.json.name': 'Βάση δεδομένων (JSON)',
    'io.json.desc': 'Πλήρες slice — όλα τα tabs, ρυθμίσεις, πρότυπα, διορθώσεις.',
    'io.busy': 'Προετοιμασία…',
    'io.pickFile': 'Επιλογή αρχείου',
    'io.pickFileSub': 'Υποστηρίζονται: OROSDOC, DOCX, ODT, RTF, HTML, TXT, MD, PDF',
    'io.impOpts': 'Πώς να γίνει η εισαγωγή;',
    'io.impNew': 'Νέο tab (συνιστάται)',
    'io.impNew.d': 'Όλα καταλήγουν σε νέο έγγραφο.',
    'io.impAppend': 'Προσθήκη στο τρέχον',
    'io.impAppend.d': 'Προστίθεται στο τέλος του τρέχοντος εγγράφου.',
    'io.impReplace': 'Αντικατάσταση τρέχοντος',
    'io.impReplace.d': 'Το τρέχον αποθηκεύεται πρώτα στο Ιστορικό εκδόσεων.',
    'io.imported': 'Εισήχθη',
    'io.importfailed': 'Δεν ήταν δυνατή η ανάγνωση του αρχείου',
    'io.pdfNoText': 'Αυτό το PDF δεν έχει κείμενο να πάρω (σάρωση;). Άνοιξέ το στη Βιβλιοθήκη ή κάν’ το πρώτα αναζητήσιμο στον Σαρωτή & PDF.',
    'io.pickFolder': 'Άνοιγμα αποσυμπιεσμένου φακέλου .orosdoc…',
    'io.gdocs': 'Από το Google Docs…',
    'io.gdocsWait': 'Συνδέσου στη Google και διάλεξε ένα έγγραφο.',
    'io.newer': 'Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.',
    'io.dbConfirm': 'Συγχώνευση αυτού του αντιγράφου ασφαλείας; Τα έγγραφα, τα πρότυπα και οι ρυθμίσεις του επανέρχονται· όσα έγγραφα υπάρχουν μόνο εδώ διατηρούνται.',
    'io.dbKept': 'Το αντίγραφο συγχωνεύτηκε. {n} έγγραφα διέφεραν: κρατήθηκε το νεότερο κείμενο και το άλλο αντίγραφο μπήκε στο Ιστορικό εκδόσεων.',
    'io.ddTitle': 'Άφησε το αρχείο για άνοιγμα',
    'io.ddSub': 'OROSDOC, DOCX, ODT, RTF, HTML, TXT, MD, PDF',
    'io.metaLabel': 'Συνοδεύουν:',
    'io.naming': 'Η εξαγωγή παίρνει τον τίτλο του εγγράφου, αλλιώς «Χωρίς τίτλο».',
    'io.pickFirst': 'Επίλεξε πρώτα ένα αρχείο',
    'io.exportfailed': 'Η εξαγωγή απέτυχε',
    'io.needDoc': 'Γράψε κάτι ή άνοιξε πρώτα ένα έγγραφο',
    'save.quota': 'Ο χώρος αποθήκευσης γέμισε — οι πρόσφατες αλλαγές δεν αποθηκεύτηκαν σε αυτή τη συσκευή. Κάνε εξαγωγή ή αφαίρεσε μεγάλες εικόνες.',
    'io.notes': 'Σημειώσεις',
    'io.comments': 'Σχόλια',
    'tt.docs': 'Έγγραφα',
    'docs.title': 'Έγγραφα',
    'docs.search': 'Αναζήτηση εγγράφων…',
    'docs.empty': 'Δεν υπάρχουν έγγραφα ακόμα.',
    'docs.none': 'Τίποτα δεν ταιριάζει με την αναζήτηση.',
    'docs.isOpen': 'Ανοιχτή καρτέλα',
    'docs.delete': 'Διαγραφή εγγράφου',
    'docs.confirmDel': 'Διαγραφή του «{name}»; Αφαιρείται από όλες τις συσκευές σου (η Αναίρεση είναι διαθέσιμη για λίγα δευτερόλεπτα).',
    'docs.words': '{n} λέξεις',
    'doc.restored': 'Το έγγραφο επανήλθε',
    'wx.undo': 'Αναίρεση',
    'wx.ok': 'OK',
    'wx.delete': 'Διαγραφή',
    'wx.confirm': 'Επιβεβαίωση',
    'tpl.builtinBadge': 'Ενσωματωμένο',
    'tpl.deleted': 'Το πρότυπο διαγράφηκε',
    'img.caption': 'Λεζάντα',
    'meta.tagAddBtn': 'Προσθήκη ετικέτας',
    'cmt.needSel': 'Επίλεξε πρώτα κείμενο και μετά πρόσθεσε το σχόλιο.',
    'cmt.oneBlock': 'Το σχόλιο πρέπει να μένει μέσα σε μία παράγραφο — επίλεξε λιγότερο κείμενο.',
    'ver.autoNote': 'Αυτόματες εκδόσεις: το πολύ μία ανά 5 λεπτά γραφής· κρατιούνται οι 8 νεότερες (λιγότερες σε πολύ μεγάλα έγγραφα). Τα χειροκίνητα στιγμιότυπα δεν σβήνονται ποτέ.',
    'goal.lockArmed': 'Η επεξεργασία θα κλειδώσει μόλις επιτευχθεί ο στόχος',
    'tt.insert': 'Εισαγωγή',
    'tt.view': 'Προβολή',
    'tbl.bar': 'Εργαλεία πίνακα',
    'tbl.rowAbove': 'Γραμμή πάνω',
    'tbl.rowBelow': 'Γραμμή κάτω',
    'tbl.colLeft': 'Στήλη αριστερά',
    'tbl.colRight': 'Στήλη δεξιά',
    'tbl.delRow': 'Διαγραφή γραμμής',
    'tbl.delCol': 'Διαγραφή στήλης',
    'tbl.delTable': 'Διαγραφή πίνακα',
    'view.focus': 'Λειτουργία εστίασης',
    'view.unitP': 'Εστίαση στην παράγραφο',
    'view.unitS': 'Εστίαση στην πρόταση',
    'view.tw': 'Κύλιση γραφομηχανής',
    'view.wc': 'Εμφάνιση πλήθους λέξεων',
    'view.stats': 'Στατιστικά…',
    'focus.exit': 'Έξοδος από την εστίαση',
    'stats.title': 'Στατιστικά',
    'stats.doc': 'Έγγραφο',
    'stats.sel': 'Επιλογή',
    'stats.words': 'Λέξεις',
    'stats.chars': 'Χαρακτήρες (με κενά)',
    'stats.charsNs': 'Χαρακτήρες (χωρίς κενά)',
    'stats.paras': 'Παράγραφοι',
    'stats.sents': 'Προτάσεις',
    'stats.read': 'Χρόνος ανάγνωσης',
    'stats.speak': 'Χρόνος ομιλίας',
    'stats.min': '{n} λεπτά',
    'stats.lt1': 'κάτω από 1 λεπτό',
    'stats.note': 'Ανάγνωση με περίπου 230 λέξεις το λεπτό, ομιλία με περίπου 130.',
    'wc.sel': '{s} από {n} λέξεις',
    'tt.review': 'Έλεγχος',
    'rv.spell': 'Ορθογραφικός έλεγχος',
    'rv.lang': 'Ορθογραφία αυτού του εγγράφου',
    'rv.langAuto': 'Ελληνικά και αγγλικά (αυτόματα)',
    'rv.langEn': 'Μόνο αγγλικά',
    'rv.langEl': 'Μόνο ελληνικά',
    'rv.langNone': 'Χωρίς έλεγχο σε αυτό το έγγραφο',
    'rv.track': 'Παρακολούθηση αλλαγών',
    'rv.changes': 'Αλλαγές…',
    'rv.merge': 'Συγχώνευση αλληλογραφίας…',
    'rv.dict': 'Το λεξικό μου…',
    'sp.noSugg': 'Καμία πρόταση',
    'sp.add': 'Προσθήκη στο λεξικό μου',
    'sp.ignore': 'Παράβλεψη',
    'sp.added': 'Η λέξη «{w}» προστέθηκε στο λεξικό σου',
    'sp.failed': 'Το λεξικό ορθογραφίας δεν φορτώθηκε, οπότε προς το παρόν γίνεται ο έλεγχος του προγράμματος περιήγησης.',
    'set.spell': 'Ορθογραφικός έλεγχος (ελληνικά και αγγλικά)',
    'set.spellNote': 'Τα λεξικά κατεβαίνουν μία φορά, όταν χρειαστούν πρώτη φορά (περίπου 2,1 MB τα ελληνικά, 0,2 MB τα αγγλικά), και μετά λειτουργούν χωρίς σύνδεση.',
    'ud.title': 'Το λεξικό μου',
    'ud.note': 'Οι λέξεις που πρόσθεσες δεν σημειώνονται ποτέ ως λάθος, σε όλες τις συσκευές σου.',
    'ud.empty': 'Δεν υπάρχουν λέξεις ακόμη. Κάνε δεξί κλικ (ή πάτησε) σε μια σημειωμένη λέξη και διάλεξε «Προσθήκη στο λεξικό μου».',
    'ud.ph': 'Πρόσθεσε μια λέξη',
    'ud.add': 'Προσθήκη',
    'ud.remove': 'Αφαίρεση της λέξης «{w}»',
    'tc.on': 'Οι αλλαγές παρακολουθούνται',
    'tc.offT': 'Η παρακολούθηση αλλαγών είναι ανενεργή',
    'tc.title': 'Αλλαγές',
    'tc.empty': 'Δεν υπάρχουν καταγεγραμμένες αλλαγές σε αυτό το έγγραφο.',
    'tc.ins': 'Προσθήκη',
    'tc.del': 'Διαγραφή',
    'tc.accept': 'Αποδοχή',
    'tc.reject': 'Απόρριψη',
    'tc.acceptAll': 'Αποδοχή όλων',
    'tc.rejectAll': 'Απόρριψη όλων',
    'tc.allAccepted': 'Όλες οι αλλαγές έγιναν δεκτές',
    'tc.allRejected': 'Όλες οι αλλαγές απορρίφθηκαν',
    'tc.who': 'Το όνομά σου στις αλλαγές',
    'tc.whoNote': 'Μένει μόνο σε αυτή τη συσκευή. Αν το αφήσεις κενό, μπαίνει το όνομα της συσκευής.',
    'tc.exportNote': 'Οι καταγεγραμμένες αλλαγές εξάγονται σαν να έγιναν δεκτές.',
    'mm.title': 'Συγχώνευση αλληλογραφίας',
    'mm.noFields': 'Το έγγραφο δεν έχει ακόμη πεδία. Γράψε το όνομα ενός πεδίου μέσα σε διπλά άγκιστρα εκεί που μπαίνουν τα στοιχεία, για παράδειγμα {{Όνομα}}, και άνοιξε ξανά τη Συγχώνευση αλληλογραφίας.',
    'mm.data': 'Στοιχεία',
    'mm.contacts': 'Επαφές',
    'mm.csv': 'Αρχείο CSV…',
    'mm.label': 'Ετικέτα',
    'mm.allContacts': 'Όλες οι επαφές',
    'mm.fields': 'Πεδία του εγγράφου',
    'mm.columns': 'Διαθέσιμα: {list}',
    'mm.missing': 'Δεν υπάρχουν στα στοιχεία και μένουν κενά: {list}',
    'mm.record': 'Εγγραφή {i} από {n}',
    'mm.prev': 'Προηγούμενη εγγραφή',
    'mm.next': 'Επόμενη εγγραφή',
    'mm.out': 'Αποτέλεσμα',
    'mm.outPdf': 'Ένα PDF',
    'mm.outZip': 'Ένα PDF για κάθε εγγραφή (ZIP)',
    'mm.outDoc': 'Ένα νέο έγγραφο',
    'mm.go': 'Δημιουργία',
    'mm.noRows': 'Δεν υπάρχουν εγγραφές.',
    'mm.csvBad': 'Δεν ήταν δυνατή η ανάγνωση αυτού του αρχείου CSV.',
    'mm.busy': 'Δημιουργία {i} από {n}…',
    'mm.done': 'Η συγχώνευση ολοκληρώθηκε: {n} εγγραφές',
    'mm.capped': 'Χρησιμοποιούνται μόνο οι πρώτες {n} εγγραφές.',
    'mm.docTitle': '{title} (συγχώνευση)'
  }
};

if (window.orosI18n) window.orosI18n.table(STRINGS, 'writer', window.orosLang);

function t(key) {
  const pack = STRINGS[window.orosLang] || STRINGS.en;
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
  chars:  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="4" height="4" rx="1"/><rect x="9" y="3" width="4" height="4" rx="1"/><rect x="3" y="9" width="4" height="4" rx="1"/><rect x="9" y="9" width="4" height="4" rx="1"/><text x="5" y="6.5" font-size="4" text-anchor="middle" fill="currentColor" stroke="none">&#931;</text><text x="11" y="6.5" font-size="4" text-anchor="middle" fill="currentColor" stroke="none">A</text><text x="5" y="12.5" font-size="4" text-anchor="middle" fill="currentColor" stroke="none">1</text><text x="11" y="12.5" font-size="4" text-anchor="middle" fill="currentColor" stroke="none">+</text></svg>',
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
  sendApp: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h5v5"/><path d="M14 2L7.5 8.5"/><path d="M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/></svg>',
  ask:    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8l1.4 3.6 3.6 1.4-3.6 1.4L8 11.8 6.6 8.2 3 6.8l3.6-1.4z"/><path d="M12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>',
  settings:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M2.7 8h1.8M11.5 8h1.8M4.2 4.2l1.3 1.3M10.5 10.5l1.3 1.3M11.8 4.2l-1.3 1.3M5.5 10.5l-1.3 1.3"/></svg>',
  docs:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>',
  insert: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 5.5v5M5.5 8h5"/></svg>',
  view:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  rowUp:  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="12" height="6" rx="1"/><path d="M8 1.5v5M5.5 4h5"/></svg>',
  rowDown:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="6" rx="1"/><path d="M8 9.5v5M5.5 12h5"/></svg>',
  colLeft:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="6" height="12" rx="1"/><path d="M1.5 8h5M4 5.5v5"/></svg>',
  colRight:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="6" height="12" rx="1"/><path d="M9.5 8h5M12 5.5v5"/></svg>',
  delRow: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="12" height="6" rx="1"/><path d="M6 6.5l4 3M10 6.5l-4 3"/></svg>',
  delCol: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="6" height="12" rx="1"/><path d="M6.5 6l3 4M9.5 6l-3 4"/></svg>',
  thead:  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6.5h12" /><rect x="2" y="2.5" width="12" height="4" fill="currentColor" stroke="none" opacity=".45"/></svg>',
  delTable:'<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6.5h12M6 2.5v11"/><path d="M9 9l3 3M12 9l-3 3"/></svg>',
  review: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 9.5L3.6 3.5l1.8 6M2.4 7.6h2.4"/><path d="M7 9.5v-6h1.4a1.4 1.4 0 0 1 0 2.8H7h1.7a1.6 1.6 0 0 1 0 3.2z"/><path d="M9.5 12.2l2 2 3.3-4.4"/></svg>',
  lock:   '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>'
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
      'export': 'export', 'import': 'import', 'lorem': 'lorem', 'settings': 'settings',
      'insert': 'insert', 'view': 'view', 'review': 'review'
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

/* ----- Toasts (Five-Axes ②) -----
   Informational → shell transient() (falls back to the local toast on a
   stale bundle). Undo-bearing → ALWAYS local (closure never leaves the
   frame), 8s. Lazy singleton, top-right, text first, action second. */
let toastEl = null, toastTimer = null;
function localToast(msg, action) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'w-toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  // A modal <dialog> makes everything outside it inert → an Undo button
  // on <body> could not be clicked. Host the toast in the TOP dialog.
  const host = Array.from(document.querySelectorAll('dialog[open]')).pop() || document.body;
  if (toastEl.parentNode !== host) host.appendChild(toastEl);
  toastEl.textContent = '';
  toastEl.appendChild(document.createTextNode(String(msg)));   // never innerHTML
  if (action && typeof action.fn === 'function') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'w-toast-act';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      clearTimeout(toastTimer);
      toastEl.classList.remove('visible');
      action.fn();
    });
    toastEl.appendChild(b);
  }
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'),
    action ? 8000 : 5000);
}

function showToast(msg) {
  try {
    const n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
    if (n && typeof n.transient === 'function' &&
        n.transient({ ns: 'writer', title: String(msg) })) return;
  } catch (e) { /* cross-frame hiccup → local */ }
  localToast(msg);
}

function undoToast(msg, fn) {
  localToast(msg, { label: t('wx.undo'), fn: fn });
}

function escapeRegex(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- Wave 2: unified file dialogs (dialogs.js) ----------
// dialogHost(): the Writer runs in a same-origin iframe inside the
// orOS shell — window.parent.orosDialog is the host. Standalone
// (opened directly), both lookups fail and we return null: every
// caller then keeps its legacy anchor-download / input behavior.
function dialogHost() {
  try {
    const w = window;
    if (w.orosDialog && typeof w.orosDialog.saveFile === 'function') return w.orosDialog;
    if (w.parent && w.parent !== w && w.parent.orosDialog &&
        typeof w.parent.orosDialog.saveFile === 'function') return w.parent.orosDialog;
  } catch (e) { /* cross-origin parent — treat as standalone */ }
  return null;
}

// Standalone fallback picker (only when no orosDialog exists at all).
// One-shot hidden input, listener-clean, cancel -> null.
function localPickFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept || '';
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      try { inp.remove(); } catch (e) {}
      resolve(f || null);
    });
    inp.addEventListener('cancel', () => {
      try { inp.remove(); } catch (e) {}
      resolve(null);
    });
    document.body.appendChild(inp);
    inp.click();
  });
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const host = dialogHost();
  if (host) {
    // Wave 2: unified save dialog (native picker on Chromium, download
    // fallback inside dialogs.js otherwise). Cancel (ok:false) is a
    // SILENT exit — the returned boolean is the success flag callers
    // may consume; fire-and-forget callers are unaffected.
    return host.saveFile({ blob: blob, filename: filename, mime: mime })
      .then(res => !!(res && res.ok));
  }
  // Standalone fallback — original anchor download, unchanged.
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  return Promise.resolve(true);
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
  document.documentElement.lang = window.orosLang || 'en';
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

// Untitled docs are labelled by their opening words (cached per html)
const tabSnipCache = {};
function tabLabel(doc) {
  if (doc.title) return doc.title;
  const c = tabSnipCache[doc.id];
  if (c && c.html === doc.html) return c.snip || t('tab.untitled');
  const snip = docPlainText(doc.html).trim().replace(/\s+/g, ' ').slice(0, 32);
  tabSnipCache[doc.id] = { html: doc.html, snip: snip };
  return snip || t('tab.untitled');
}

// The editor is always editable, so a blank page must behave like a
// document. Doc-level actions materialize one on demand (lazy — never at
// boot, so two fresh devices do not seed duplicate empty docs, R16).
function ensureDoc() {
  const cur = activeDoc();
  if (cur && !cur.del) return cur;
  const d = createDoc({ silent: true, keepEditor: true });
  EL.editor.setAttribute('data-page-size', d.pageSize);
  dirty = true;
  flushSave();               // capture anything already on the page
  return d;
}

function renderTabs() {
  EL.tabBar.innerHTML = '';

  // Documents manager — every doc (open or closed) is reachable here
  const docsBtn = document.createElement('button');
  docsBtn.type = 'button';
  docsBtn.className = 'tab-docs';
  docsBtn.title = t('tt.docs');
  docsBtn.setAttribute('aria-label', t('tt.docs'));
  docsBtn.innerHTML = ICONS.docs;
  docsBtn.addEventListener('click', openDocsManager);
  EL.tabBar.appendChild(docsBtn);

  state.tabOrder.forEach(id => {
    const doc = getDoc(id);
    if (!doc || doc.del) return;

    const tab = document.createElement('div');
    tab.className = 'tab' + (id === state.activeTab ? ' active' : '');
    tab.dataset.id = id;
    tab.tabIndex = 0;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', id === state.activeTab ? 'true' : 'false');
    tab.title = tabLabel(doc);

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tabLabel(doc);
    if (!doc.title) label.classList.add('tab-label-auto');
    label.addEventListener('dblclick', startTabRename.bind(null, id, label));

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.setAttribute('role', 'button');
    close.title = t('tab.close');
    close.innerHTML = ICONS.close;
    close.addEventListener('click', e => {
      e.stopPropagation();
      closeDoc(id);
    });

    tab.appendChild(label);
    tab.appendChild(close);
    tab.addEventListener('click', () => activateTab(id));
    tab.addEventListener('keydown', e => {
      if (e.target !== tab) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateTab(id); }
      if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); startTabRename(id, label); }
    });
    EL.tabBar.appendChild(tab);
  });

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'tab-new';
  newBtn.title = t('tab.new');
  newBtn.innerHTML = ICONS.plus;
  newBtn.addEventListener('click', () => createDoc());
  EL.tabBar.appendChild(newBtn);

  const act = EL.tabBar.querySelector('.tab.active');
  if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function startTabRename(id, labelEl) {
  const doc = getDoc(id);
  if (!doc) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-label-input';
  input.value = doc.title || '';
  input.maxLength = 120;
  if (!labelEl.isConnected) return;
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  // clicks/keys inside the field must not reach the tab (re-activation)
  ['click', 'mousedown', 'dblclick'].forEach(ev =>
    input.addEventListener(ev, e => e.stopPropagation()));
  let done = false;

  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== doc.title) {
      doc.title = v.slice(0, 120);
      markDoc(doc, 'm');
      renderTabs();
      showToast(t('doc.renamed'));
    } else {
      renderTabs();
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = doc.title || ''; input.blur(); }
  });
}

/* ===== SECTION 6: DOCS CRUD ===== */
function createDoc(opts) {
  opts = opts || {};
  if (!opts.keepEditor) flushSave();   // pending keystrokes belong to the OLD doc
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
    goal: null,
    mtime: Date.now(),
    del: false,
    fm: null
  };
  doc.fm = { c: doc.mtime, m: doc.mtime, p: doc.mtime, g: doc.mtime };   // WR-6
  state.docs.push(doc);
  state.tabOrder.push(doc.id);
  state.seen[doc.id] = 1;
  state.activeTab = doc.id;
  savePrefs();
  scheduleSave();
  renderTabs();
  if (!opts.keepEditor) {        // adoption path keeps live text + caret
    renderEditor();
    EL.editor.focus();
  }
  if (!opts.silent) showToast(t('doc.created'));
  return doc;
}

function activateTab(id) {
  const d = getDoc(id);
  if (!d || d.del) return;
  if (id === state.activeTab) return;          // already showing — keep DOM
  flushSave();
  const known = state.tabOrder.indexOf(id) !== -1;
  if (!known) state.tabOrder.push(id);
  state.activeTab = id;
  savePrefs();
  if (known) {
    // update in place: a re-built bar swallowed the 2nd click of a dblclick
    EL.tabBar.querySelectorAll('.tab').forEach(el => {
      const on = el.dataset.id === id;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  } else {
    renderTabs();
  }
  renderEditor();
  EL.editor.focus();
}

function closeDoc(id) {
  flushSave();
  const idx = state.tabOrder.indexOf(id);
  state.tabOrder = state.tabOrder.filter(x => x !== id);
  if (state.activeTab === id) {
    state.activeTab = state.tabOrder[Math.min(Math.max(idx - 1, 0), state.tabOrder.length - 1)] || null;
  }
  // The doc stays intact — reopen it any time from the Documents manager.
  savePrefs();
  renderTabs();
  renderEditor();
  showToast(t('doc.closed'));
}

/* ----- Delete (tombstone, R17) with Undo toast ----- */
function deleteDoc(id, onUndo) {
  const d = getDoc(id);
  if (!d || d.del) return;
  flushSave();
  const backup = JSON.parse(JSON.stringify(d));
  // Tombstone keeps only id/mtime/del — content leaves every device.
  Object.assign(d, {
    title: '', author: '', tags: [], category: '', html: '',
    footnotes: [], comments: [], versions: [], goal: null,
    header: '', footer: '', del: true, mtime: Date.now()
  });
  const wasActive = state.activeTab === id;
  state.tabOrder = state.tabOrder.filter(x => x !== id);
  if (wasActive) state.activeTab = state.tabOrder[state.tabOrder.length - 1] || null;
  savePrefs();
  scheduleSave();
  renderTabs();
  if (wasActive) renderEditor();
  undoToast(t('doc.deleted'), () => {
    const cur = getDoc(id);
    if (!cur) return;
    // WR-5: a sync since the delete may already have brought the doc
    // back (another device edited it, R17): keep that newer copy — the
    // old snapshot re-stamped over it lost the other device's edit.
    // fresh mtime beats the tombstone everywhere (resurrection contract)
    if (cur.del) Object.assign(cur, backup, { del: false, mtime: Date.now() });
    if (state.tabOrder.indexOf(id) === -1) state.tabOrder.push(id);
    state.activeTab = id;
    savePrefs();
    scheduleSave();
    renderTabs();
    renderEditor();
    showToast(t('doc.restored'));
    if (typeof onUndo === 'function') onUndo();
  });
}

/* ----- Documents manager (open / search / delete) ----- */
function docPlainText(html) {
  const box = ioInertDiv();
  box.innerHTML = html || '';
  box.querySelectorAll('sup.fn-ref').forEach(x => x.remove());
  return box.textContent || '';
}

function openDocsManager() {
  flushSave();
  const dlg = openDialog(t('docs.title'), '', [
    { class: 'fb-btn', label: '+ ' + t('tab.new'), onClick: () => { dlg.close(); createDoc(); } },
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => dlg.close() }
  ]);
  dlg.classList.add('w-dialog-docs');
  const body = dlg.querySelector('.w-dialog-body');

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'w-field docs-search';
  search.placeholder = t('docs.search');
  body.appendChild(search);

  const list = document.createElement('div');
  list.className = 'docs-list';
  body.appendChild(list);

  // plain text cache for this dialog session only
  const plain = {};
  const textOf = d => (plain[d.id] !== undefined) ? plain[d.id]
    : (plain[d.id] = docPlainText(d.html));

  function render() {
    list.innerHTML = '';
    const q = search.value.trim().toLocaleLowerCase();
    const alive = state.docs.filter(d => !d.del);
    const docs = alive
      .filter(d => !q || (d.title || '').toLocaleLowerCase().indexOf(q) !== -1 ||
                   textOf(d).toLocaleLowerCase().indexOf(q) !== -1)
      .sort((a, b) => (b.mtime - a.mtime) || (a.id < b.id ? -1 : 1));

    if (!docs.length) {
      const e = document.createElement('div');
      e.className = 'fn-empty';
      e.textContent = alive.length ? t('docs.none') : t('docs.empty');
      list.appendChild(e);
      return;
    }

    docs.forEach(d => {
      const row = document.createElement('div');
      row.className = 'docs-row' + (d.id === state.activeTab ? ' active' : '');

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'docs-main';
      const nm = document.createElement('span');
      nm.className = 'docs-name';
      // untitled docs show their opening words (three "Untitled" rows help nobody)
      const snip = textOf(d).trim().replace(/\s+/g, ' ').slice(0, 60);
      nm.textContent = d.title || snip || t('tab.untitled');
      if (!d.title) nm.classList.add('docs-untitled');
      const meta = document.createElement('span');
      meta.className = 'docs-meta';
      const words = textOf(d).trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
      meta.textContent = formatTs(d.mtime) + ' · ' + t('docs.words').replace('{n}', String(words));
      main.append(nm, meta);
      if (state.tabOrder.indexOf(d.id) !== -1) {
        const badge = document.createElement('span');
        badge.className = 'ac-badge';
        badge.textContent = t('docs.isOpen');
        main.appendChild(badge);
      }
      main.addEventListener('click', () => { dlg.close(); activateTab(d.id); });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ac-icon-btn danger';
      del.title = t('docs.delete');
      del.setAttribute('aria-label', t('docs.delete'));
      del.innerHTML = ICONS.trash;
      del.addEventListener('click', () => {
        wConfirm(t('docs.confirmDel').replace('{name}', d.title || t('tab.untitled')),
                 { danger: true, ok: t('wx.delete') })
          .then(ok => { if (ok) { deleteDoc(d.id, () => { if (dlg.open) render(); }); render(); } });
      });

      row.append(main, del);
      list.appendChild(row);
    });
  }

  search.addEventListener('input', render);
  render();
}

/* ===== SECTION 7: SLICE — LOAD / SAVE / MERGE ===== */
const SLICE_KEY = 'oros-writer-data';

// Retention guard: manual snapshots always survive; only the newest
// 8 auto versions travel in the slice (document feature, not backup).
const VER_AUTO_MAX = 8;
const VER_AUTO_BUDGET = 400000;   // chars of html across a doc's AUTO versions

function capVersions(vers) {
  const manual = vers.filter(v => v && v.manual);
  let auto = vers.filter(v => v && !v.manual).slice(-VER_AUTO_MAX);
  const size = list => list.reduce((n, v) => n + String(v.html || '').length, 0);
  while (auto.length > 1 && size(auto) > VER_AUTO_BUDGET) auto = auto.slice(1);
  return manual.concat(auto).sort((a, b) => a.ts - b.ts);
}

function cmpId(a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); }

function canonTombs(list) {
  const m = {};
  (Array.isArray(list) ? list : []).forEach(tb => {
    if (!tb || typeof tb.id !== 'string') return;
    const ts = Number(tb.ts) || 0;
    if (!(tb.id in m) || ts > m[tb.id]) m[tb.id] = ts;
  });
  return Object.keys(m).sort().map(k => ({ id: k, ts: m[k] }));
}

function serialize() {
  const tombs = canonTombs(state.tplTombs);
  const tombTs = {};
  tombs.forEach(tb => { tombTs[tb.id] = tb.ts; });
  const docs = state.docs.slice().sort(cmpId);
  const out = {
    ver: 1,
    docs: docs.map(d => {
      const o = {
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
      };
      // WR-6: the group clocks travel only when present, and LAST: a doc
      // without them serializes byte-for-byte as before, and on an equal
      // mtime the plain-LWW tie-break (larger JSON) prefers the copy
      // WITHOUT them ("}" > ","), so a device on the previous version
      // (which drops unknown fields) and this one agree instead of
      // re-uploading each other's copy.
      if (d.fm) o.fm = cleanFm(d.fm);
      // Wave 22: spelling language and Track changes, only when set
      // (same rule as fm: a doc without them is byte-for-byte as before)
      if (d.lang) o.lang = d.lang;
      if (d.track) o.track = true;
      return o;
    }),
    // Compatibility field for pre-prefs builds ONLY. Open tabs are a
    // device-local view (oros-writer-prefs); a device-varying value here
    // made every reconcile see a "difference" and push forever.
    tabOrder: docs.filter(d => !d.del).map(d => d.id),
    settings: state.settings,
    autocorrect: state.autocorrect,
    templates: (state.templates || [])
      .filter(tp => !(tombTs[tp.id] >= (tp.mtime || 0)))
      .slice().sort(cmpId),
    tplTombs: tombs,
    seeded: !!state.seeded
  };
  if (state.userDict && Object.keys(state.userDict).length) out.userDict = state.userDict;
  return out;
}

const DOC_LANGS = ['en', 'el', 'none'];
function cleanLang(v) { return DOC_LANGS.indexOf(v) !== -1 ? v : ''; }

// WR-1: imported .json backups are untrusted — margins and the goal are
// written into dialog markup, so only finite numbers / known types pass.
function cleanMargins(m) {
  const dm = (m && typeof m === 'object') ? m : {};
  const n = v => Number.isFinite(+v) ? +v : 25;   // same rule as openPageSettings
  return { top: n(dm.top), bottom: n(dm.bottom), left: n(dm.left), right: n(dm.right) };
}
const GOAL_TYPES = ['words', 'chars', 'paras', 'time', 'sessionWords'];
function cleanGoal(g) {
  if (!g || typeof g !== 'object') return null;
  const target = Number(g.target);
  if (!Number.isFinite(target) || target <= 0) return null;
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { type: GOAL_TYPES.indexOf(g.type) !== -1 ? g.type : 'words', target: target,
           lock: !!g.lock, startTs: num(g.startTs), startWords: num(g.startWords) };
}
// WR-6: per-group clocks of a doc — c content (html, footnotes,
// comments, versions), m meta (title, author, tags, category), p page
// (size, margins, header, footer), g goal. Optional: docs written by
// the previous version have none and merge whole-doc, as before.
const FM_GROUPS = ['c', 'm', 'p', 'g'];
function cleanFm(fm) {
  if (!fm || typeof fm !== 'object') return null;
  const out = {};
  FM_GROUPS.forEach(k => { const v = Number(fm[k]); out[k] = Number.isFinite(v) && v > 0 ? v : 0; });
  return out;
}

// WR-3: copy a freshly hydrated doc into the object already held (same
// identity), dropping keys the new copy does not carry.
function keepIdentity(prevDoc, nd) {
  if (!prevDoc) return nd;
  Object.keys(prevDoc).forEach(k => { if (!(k in nd)) delete prevDoc[k]; });
  return Object.assign(prevDoc, nd);
}

function hydrate(raw) {
  if (!raw || typeof raw !== 'object') return;
  if (!Array.isArray(raw.docs)) raw.docs = [];
  // WR-3: a pulled doc updates the object this device already holds IN
  // PLACE. Dialogs and panels (meta, page, goal, versions, footnotes,
  // comments) keep a reference to the doc they opened with; a fresh
  // object per pull turned every later edit in them into a write to a
  // detached copy — "saved", then silently gone.
  const prev = {};
  state.docs.forEach(d => { if (d && typeof d.id === 'string') prev[d.id] = d; });
  state.docs = raw.docs.filter(d => d && typeof d.id === 'string').map(d => keepIdentity(prev[d.id], {
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
    margins: cleanMargins(d.margins),
    header: typeof d.header === 'string' ? d.header : '',
    footer: typeof d.footer === 'string' ? d.footer : '',
    goal: cleanGoal(d.goal),
    mtime: Number(d.mtime) || 0,
    del: !!d.del,
    fm: cleanFm(d.fm),
    lang: cleanLang(d.lang),
    track: d.track === true
  }));
  state.seeded = !!raw.seeded;
  state.userDict = window.WriterSpell ? window.WriterSpell.mergeUserDict(raw.userDict, null) : {};
  spellUserSetDirty();
  state.settings = (raw.settings && typeof raw.settings === 'object')
    ? Object.assign({}, state.settings, raw.settings)
    : state.settings;
  if (typeof state.settings.smartTypography === 'undefined')
    state.settings.smartTypography = true;
  state.autocorrect = (raw.autocorrect && Array.isArray(raw.autocorrect.rules))
    ? raw.autocorrect : null;
  state.templates = Array.isArray(raw.templates) ? raw.templates
    .filter(x => x && typeof x.id === 'string' && typeof x.name === 'string') : [];
  state.tplTombs = canonTombs(raw.tplTombs);
  reconcileTabs();
}

/* ----- Device-local tab state (never synced) -----
   Open tabs are a per-device VIEW (like activeTab). Closing a tab on the
   phone must not close it on the desktop, and a union-merged synced list
   resurrected closed tabs. Docs never shown on this device auto-open
   once (a doc written on the phone appears on the desktop). */
const PREFS_KEY = 'oros-writer-prefs';

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      open: state.tabOrder, active: state.activeTab, seen: state.seen,
      view: { focus: view.focus, unit: view.unit, tw: view.tw, wc: view.wc },
      who: view.who        // author name of tracked changes (this device)
    }));
  } catch (e) { /* quota — tabs are only a view */ }
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    return (p && typeof p === 'object' && Array.isArray(p.open)) ? p : null;
  } catch (e) { return null; }
}

function reconcileTabs() {
  const alive = id => { const d = getDoc(id); return !!(d && !d.del); };
  state.tabOrder = state.tabOrder.filter((id, i, a) => alive(id) && a.indexOf(id) === i);
  state.docs.forEach(d => {
    if (d.del || state.seen[d.id]) return;
    state.seen[d.id] = 1;
    if (state.tabOrder.indexOf(d.id) === -1) state.tabOrder.push(d.id);
  });
  if (!alive(state.activeTab) || state.tabOrder.indexOf(state.activeTab) === -1) {
    state.activeTab = state.tabOrder[0] || null;
  }
  savePrefs();
}

// R5: symmetric pick — mtime first, then lexicographic JSON.
// merge(A,B) === merge(B,A); never "remote wins" on ties.
function wNewer(a, b, key) {
  const k = key || 'mtime';
  const ma = (a && Number(a[k])) || 0, mb = (b && Number(b[k])) || 0;
  if (ma !== mb) return ma > mb ? a : b;
  return String(JSON.stringify(a)) >= String(JSON.stringify(b)) ? a : b;
}

// WR-6: the fields of each clock group. A small change in one group (a
// rename, page margins, a goal) no longer replaces the text written on
// another device in the meantime — before, one mtime per doc made the
// whole doc of the later edit win.
const FM_FIELDS = {
  c: ['html', 'footnotes', 'comments', 'versions'],
  m: ['title', 'author', 'tags', 'category', 'lang', 'track'],
  p: ['pageSize', 'margins', 'header', 'footer'],
  g: ['goal']
};
function mergeDoc(L, R) {
  // Whole-doc LWW (as before) unless BOTH copies carry group clocks and
  // both are alive: a copy from a device on the previous version has
  // none, and a tombstone is decided by its single stamp (R17).
  if (!L.fm || !R.fm || L.del || R.del) return wNewer(L, R);
  const out = { id: L.id };
  const fm = {};
  FM_GROUPS.forEach(g => {
    const pick = (a, b) => {
      const sa = Number(a.fm[g]) || 0, sb = Number(b.fm[g]) || 0;
      if (sa !== sb) return sa > sb ? a : b;
      const ja = JSON.stringify(FM_FIELDS[g].map(k => a[k]));
      const jb = JSON.stringify(FM_FIELDS[g].map(k => b[k]));
      return ja >= jb ? a : b;
    };
    const w = pick(L, R);
    FM_FIELDS[g].forEach(k => { out[k] = w[k]; });
    fm[g] = Math.max(Number(L.fm[g]) || 0, Number(R.fm[g]) || 0);
  });
  // canonical key order = serialize()'s
  const res = {
    id: out.id, title: out.title, author: out.author, tags: out.tags,
    category: out.category, html: out.html,
    footnotes: out.footnotes, comments: out.comments, versions: out.versions,
    pageSize: out.pageSize, margins: out.margins,
    header: out.header, footer: out.footer, goal: out.goal,
    mtime: Math.max(Number(L.mtime) || 0, Number(R.mtime) || 0), del: false,
    fm: fm
  };
  if (cleanLang(out.lang)) res.lang = cleanLang(out.lang);
  if (out.track === true) res.track = true;
  return res;
}

// Entity LWW per doc + tombstones (R5/R17) — no Date.now() inside merge
function mergeSlices(local, remote) {
  if (!remote || typeof remote !== 'object') return local;
  const byId = {};
  const ids = new Set();
  [].concat(local.docs || [], remote.docs || []).forEach(d => {
    if (d && typeof d.id === 'string') ids.add(d.id);
  });

  ids.forEach(id => {
    const L = (local.docs || []).find(d => d.id === id);
    const R = (remote.docs || []).find(d => d.id === id);
    if (!R) { byId[id] = L; return; }               // local-only
    if (!L) { byId[id] = R; return; }               // remote-only
    byId[id] = mergeDoc(L, R);                      // LWW per entity / per group (R5)
  });

  const docIds = Object.keys(byId).sort();

  // Templates: LWW per entity, respecting tombstones (deleted wins over
  // stale-but-newer edit? No — mtime vs tombstone ts: newer wins.)
  const tombList = canonTombs([].concat(local.tplTombs || [], remote.tplTombs || []));
  const tombs = {};
  tombList.forEach(tb => { tombs[tb.id] = tb.ts; });
  const tplById = {};
  [].concat(local.templates || [], remote.templates || []).forEach(tp => {
    if (!tp || typeof tp.id !== 'string') return;
    if (tombs[tp.id] >= (tp.mtime || 0)) return;   // tombstoned
    tplById[tp.id] = tplById[tp.id] ? wNewer(tplById[tp.id], tp) : tp;
  });

  const merged = {
    ver: 1,
    docs: docIds.map(k => byId[k]),
    tabOrder: docIds.filter(k => !byId[k].del),
    settings: wNewer(local.settings, remote.settings, '_mtime'),
    autocorrect: wNewer(local.autocorrect, remote.autocorrect),
    templates: Object.keys(tplById).sort().map(k => tplById[k]),
    tplTombs: tombList,
    seeded: !!(local.seeded || remote.seeded)
  };
  // "my dictionary": per word, the newer add / remove (spell.js)
  const ud = window.WriterSpell ? window.WriterSpell.mergeUserDict(local.userDict, remote.userDict) : {};
  if (Object.keys(ud).length) merged.userDict = ud;
  return merged;
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
  // Keystrokes typed while the pull was in flight: fold them in
  // (local doc carries the newer mtime) instead of overwriting them.
  const pendingLocal = dirty;
  if (pendingLocal) {
    clearTimeout(saveTimer);
    const cur = activeDoc();
    if (cur) {
      const html = editorHTMLForSave();
      if (html !== cur.html) { cur.html = html; stampDoc(cur, 'c'); }
    }
    data = mergeSlices(serialize(), data);
  }
  const caret = editorCaret();   // WR-4: where the user's caret rests, if anywhere
  hydrate(data);             // sanitized hydrate + device-local tab reconcile
  localPersist();            // storage key mirrors live state — NO markDirty (R6)
  renderTabs();
  const doc = activeDoc();
  if (!doc || doc.html !== editorHTMLForSave()) {
    renderEditor();
    // WR-4: a re-render used to drop the caret at the top of the doc, so
    // the next keystroke on a phone landed in the first line.
    if (caret !== null && doc) restoreCaret(caret);
  }
  else { footnotesAfterRender(); commentsAfterRender(); tcSync(false); spellSchedule(0); }
  if (pendingLocal) scheduleSave();   // the user's own edits still need their push
  // No toast: sync feedback = taskbar dot (Part VI)
}

// WR-4: caret as a character offset into the editor text (null when the
// editor does not hold the focus), and back.
function editorCaret() {
  try {
    if (document.activeElement !== EL.editor) return null;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!EL.editor.contains(r.startContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(EL.editor);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  } catch (e) { return null; }
}
function restoreCaret(offset) {
  try {
    const walker = document.createTreeWalker(EL.editor, NodeFilter.SHOW_TEXT);
    let left = offset, node = null, last = null;
    while ((node = walker.nextNode())) {
      last = node;
      if (left <= node.data.length) break;
      left -= node.data.length;
    }
    const r = document.createRange();
    if (node) r.setStart(node, left);
    else if (last) r.setStart(last, last.data.length);
    else r.setStart(EL.editor, EL.editor.childNodes.length);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch (e) { /* caret is a convenience */ }
}

function registerSlice() {
  // LOCAL FIRST: live registration does NOT hydrate (sync.js only
  // replays the carry mailbox) — registering with an empty state
  // would let the first sliceGet()/flushSave() persist an empty slice.
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SLICE_KEY) || 'null'); } catch (e) { raw = null; }

  // Device-local tabs: prefs win; first boot after the upgrade migrates
  // the old synced tabOrder once and marks every existing doc as seen.
  const prefs = loadPrefs();
  if (prefs) {
    state.tabOrder = prefs.open.filter(x => typeof x === 'string');
    state.seen = (prefs.seen && typeof prefs.seen === 'object') ? prefs.seen : {};
    if (typeof prefs.active === 'string') state.activeTab = prefs.active;
  } else {
    state.tabOrder = (raw && Array.isArray(raw.tabOrder)) ? raw.tabOrder.slice() : null;
    state.seen = {};
    (raw && Array.isArray(raw.docs) ? raw.docs : []).forEach(d => {
      if (d && typeof d.id === 'string') state.seen[d.id] = 1;
    });
    if (!state.tabOrder) {
      state.tabOrder = (raw && Array.isArray(raw.docs) ? raw.docs : [])
        .filter(d => d && typeof d.id === 'string' && !d.del).map(d => d.id);
    }
  }
  if (raw) hydrate(raw); else reconcileTabs();
  if (!state.tabOrder.length) {
    const recent = state.docs.filter(d => !d.del)
      .sort((a, b) => (b.mtime - a.mtime) || (a.id < b.id ? -1 : 1))[0];
    if (recent) {
      state.tabOrder.push(recent.id);
      state.activeTab = recent.id;
      savePrefs();
    }
  }

  const api = syncApi();
  if (api && typeof api.registerSlice === 'function') {
    api.registerSlice(
      'writer',              // slice name in the cloud payload
      sliceGet,              // getter
      sliceSet,              // setter
      SLICE_KEY,             // localStorage key for closed-app proxy
      mergeSlices            // mergeFn — deterministic, no Date.now()
    );
  }
}

let quotaWarned = false;
function localPersist() {
  try {
    localStorage.setItem(SLICE_KEY, JSON.stringify(serialize()));
    quotaWarned = false;
  } catch (e) {
    // Never silent: a failed write means edits will NOT survive a reload
    console.error('[writer] local save failed:', e);
    if (!quotaWarned) { quotaWarned = true; localToast(t('save.quota')); }
  }
}

/* ===== SECTION 8: SAVE PIPELINE (dirty → 500ms debounce) ===== */
function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
}

function flushSave() {
  clearTimeout(saveTimer);
  // Text typed with NO open tab (first run / all tabs closed) was
  // silently discarded — adopt it into a fresh doc instead. Lazy
  // (only on real input) → no duplicate seeds across devices (R16).
  if (!activeDoc() && (EL.editor.textContent.trim() ||
      EL.editor.querySelector('img,table,hr'))) {
    createDoc({ silent: true, keepEditor: true });
  }
  if (!dirty) return;
  dirty = false;
  const doc = activeDoc();
  if (doc) {
    // mtime moves ONLY on a real content change. Stamping on every
    // flush let unrelated actions (settings, templates…) make a STALE
    // copy "newer" and overwrite another device's edit (LWW).
    // Doc-field edits stamp explicitly through markDoc().
    const html = editorHTMLForSave();   // strips transient find-hit marks
    if (html !== doc.html) {
      doc.html = html;
      stampDoc(doc, 'c');
      autoVersionTick(doc);
    }
  }
  localPersist();
  const api = syncApi();
  if (api && typeof api.markDirty === 'function') {
    api.markDirty();   // core engine: 5s debounce → reconcile
  }
}

// Doc-level field edit (meta, page setup, footnotes, comments, goal,
// versions): stamp THIS doc, then the normal save pipeline.
function markDoc(doc, group) {
  if (doc) stampDoc(doc, group);
  scheduleSave();
}

// WR-6: stamp the doc AND the clock of the group that changed (all groups
// when none is named). A doc written by the previous version gets its
// clocks here, on its first edit, all starting at its current mtime.
function stampDoc(doc, group) {
  const now = Date.now();
  if (!doc.fm) {
    const m0 = Number(doc.mtime) || 0;
    doc.fm = { c: m0, m: m0, p: m0, g: m0 };
  }
  (group ? [group] : FM_GROUPS).forEach(g => { doc.fm[g] = now; });
  doc.mtime = now;
}

/* ===== SECTION 9: RENDER EDITOR FROM ACTIVE DOC ===== */
function renderEditor() {
  const doc = activeDoc();
  findState.hits = [];               // old marks die with the old DOM
  findState.index = -1;
  if (findBar && !findBar.hidden) updateCount(0, 0);
  EL.editor.innerHTML = doc ? (doc.html || '') : '';
  EL.editor.setAttribute('data-page-size', doc ? doc.pageSize : 'a4');
  updateEmptyState();
  footnotesAfterRender();          // renumber + refresh panel (Wave 3)
  commentsAfterRender();           // refresh comment cards (Wave 3)
  goalAfterRender();               // goal bar + reading progress (Wave 4)
  if (tableBar) tableBar.hidden = true;
  viewAfterChange();
  tcSync(true);                    // Track changes of this doc (wave 22)
  spellAfterRender();              // fresh spelling marks for this doc
  // Adopt the browser's serialization WITHOUT touching mtime, so a later
  // unrelated flush never sees a "change" that is only formatting noise.
  if (doc) {
    const norm = editorHTMLForSave();
    if (norm !== doc.html) doc.html = norm;
  }
}

function updateEmptyState() {
  const doc = activeDoc();
  EL.editor.classList.toggle('editor-empty',
    !doc || !EL.editor.textContent.trim());
}

/* ===== SECTION 10: TOOLBAR COMMANDS (execCommand era for Wave 1;
   blocks deprecated — Wave 2+ may move to Selection API if needed) ===== */
let lockToastTs = 0;
function lockToast() {              // one reminder per 3s, not per keystroke
  const now = Date.now();
  if (now - lockToastTs < 3000) return;
  lockToastTs = now;
  showToast(t('goal.locked'));
}

function isLocked() {
  if (!EL.editor.dataset.goalLocked) return false;
  lockToast();
  return true;
}

function exec(cmd, val) {
  if (isLocked()) return;
  EL.editor.focus();
  document.execCommand(cmd, false, val || null);
  scheduleSave();
}

function bindToolbar() {
  const binds = {
    'btn-undo':    () => { if (!tcTryUndo(false) && !frTryUndo()) exec('undo'); },
    'btn-redo':    () => { if (!tcTryUndo(true) && !frTryRedo()) exec('redo'); },
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

  // Writer has its own Ask menu, so the shell's menu and button for
  // selected text (quickmenu.js) leave it alone.
  window.__orosNoSelAsk = true;

  // btn-ask — "Ask the Assistant" (Assistant phase 3): only when the
  // Assistant app is installed; placed before btn-settings.
  if (assistantInstalled() && !document.getElementById('btn-ask')) {
    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.id = 'btn-ask';
    askBtn.className = 'tb-btn';
    askBtn.title = t('tt.ask');
    askBtn.setAttribute('aria-label', t('tt.ask'));
    askBtn.setAttribute('aria-haspopup', 'menu');
    askBtn.innerHTML = ICONS.ask;
    if (setBtn.parentNode) setBtn.parentNode.insertBefore(askBtn, setBtn);
    else EL.toolbar.appendChild(askBtn);
    askBtn.addEventListener('mousedown', e => e.preventDefault());   // keep the selection
    binds['btn-ask'] = () => openAskMenu(askBtn);
  }

  // btn-send-app — "Send to an app" (shell send/, BR-SEND): only inside
  // an orOS that has it; placed before btn-settings.
  if (sendApi() && !document.getElementById('btn-send-app')) {
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.id = 'btn-send-app';
    sendBtn.className = 'tb-btn';
    sendBtn.title = t('tt.sendApp');
    sendBtn.setAttribute('aria-label', t('tt.sendApp'));
    sendBtn.innerHTML = ICONS.sendApp;
    if (setBtn.parentNode) setBtn.parentNode.insertBefore(sendBtn, setBtn);
    else EL.toolbar.appendChild(sendBtn);
    sendBtn.addEventListener('mousedown', e => e.preventDefault());   // keep the selection
    binds['btn-send-app'] = () => sendToApp();
  }

  Object.keys(binds).forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', binds[id]);
  });

  // Formatting buttons must not steal focus from the editor: on touch,
  // the blur collapsed the selection BEFORE execCommand ran.
  ['btn-undo','btn-redo','btn-bold','btn-italic','btn-underline','btn-strike',
   'btn-indent','btn-outdent','btn-bullets','btn-numbers','btn-align-left',
   'btn-align-center','btn-align-right','btn-align-justify','btn-hr',
   'btn-page-break','btn-lorem','btn-chars','btn-footnotes','btn-comments'
  ].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('mousedown', e => e.preventDefault());
  });

  EL.stylesSel.addEventListener('change', () => {
    if (isLocked()) { updateStylesSelect(); return; }
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
    if (isLocked()) return;
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

// Last caret INSIDE the editor. Typing in a dialog field moves the
// document selection into the dialog — inserts used to land there
// (and vanish with the dialog on close).
let lastEditorRange = null;
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (sel && sel.rangeCount &&
      EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    lastEditorRange = sel.getRangeAt(0).cloneRange();
  }
});

function insertNodeAtCursor(node) {
  if (isLocked()) return;
  const sel = window.getSelection();
  let range = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
  if (!range || !EL.editor.contains(range.commonAncestorContainer)) range = lastEditorRange;
  if (!range || !EL.editor.contains(range.commonAncestorContainer)) {
    EL.editor.appendChild(node);
    return;
  }
  if (!range.collapsed) range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);       // caret AFTER the node → sequential inserts keep order
  range.collapse(true);
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  lastEditorRange = range.cloneRange();
}

/* ===== SECTION 11: EVENT WIRING ===== */
function wireEvents() {
  // Input — track dirty state and empty-state placeholder
  EL.editor.addEventListener('input', () => {
    // No open tab (first run / all closed): adopt the text NOW, before
    // any tab action can re-render the editor over it.
    if (!activeDoc()) createDoc({ silent: true, keepEditor: true });
    dirty = true;
    updateEmptyState();
    scheduleSave();
  });

  // Goal bar + reading progress live refresh (Wave 4, rAF-coalesced)
  EL.editor.addEventListener('input', goalAfterInput);

  // Keyup — special handling for placeholder visibility (edge case: paste via menu)
  EL.editor.addEventListener('keyup', updateEmptyState);

  // Smart typography: ONLY after typed characters (never on delete,
  // paste or IME composition), and never inside code.
  EL.editor.addEventListener('input', (e) => {
    if (!state.settings.smartTypography || stBusy || frBusy) return;
    if (e.isComposing || e.inputType !== 'insertText') return;
    smartTransformLastInsert();
  });

  // Auto-correction: check the word just typed when Space is pressed
  EL.editor.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      autoCorrectLastWord();
    }
  });

  // Ctrl/Cmd + F — open find bar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      if (!findBar) toggleFindBar();
      findBar.hidden = false;
      const inp = findBar.querySelector('input[type="text"]');
      inp.focus(); inp.select();
    }
  });

  // Leaving the app (tab switch, iframe close, mobile background):
  // flush NOW — the 500ms debounce may never get to run.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flushSave(); return; }
    const bar = document.getElementById('goal-bar');
    if (bar && !bar.hidden) updateGoalBar();      // time goals catch up
  });
  window.addEventListener('pagehide', flushSave);

  // Pasted images (screenshots): downscale instead of a raw multi-MB data URL
  EL.editor.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd || !cd.files || !cd.files.length) return;
    const imgs = Array.from(cd.files).filter(f => /^image\//.test(f.type));
    if (!imgs.length) return;
    e.preventDefault();
    if (isLocked()) return;
    imgs.forEach(file => imageFileToDataUrl(file).then(url => {
      const img = document.createElement('img');
      img.src = url;
      img.style.maxWidth = '100%';
      insertNodeAtCursor(img);
      updateEmptyState();
      scheduleSave();
    }));
  });

  // Paragraph-style dropdown mirrors the block at the caret
  document.addEventListener('selectionchange', updateStylesSelect);
}

function updateStylesSelect() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount ||
      !EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
  let v = '';
  try { v = String(document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch (e) { v = ''; }
  v = v.replace(/[<>]/g, '');
  if (v === 'blockquote' || v === 'pre' || /^h[1-4]$/.test(v)) EL.stylesSel.value = v;
  else EL.stylesSel.value = 'p';
}

/* ===== SECTION 12: KEYBOARD SHORTCUTS (Bible: avoid browser-reserved combos) ===== */
function bindShortcuts() {
  // Contract B — forward Ctrl+Alt+Shift+letter to the shell (capture)
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    let p = null;
    try { p = window.parent; } catch (err) { return; }
    if (!(p && p !== window && p.orosShortcuts &&
          typeof p.orosShortcuts.handle === 'function')) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.altKey) return;   // Ctrl+Alt+Shift = shell territory
    // Ctrl/Cmd + S — manual save trigger (feedback only — autosave runs anyway)
    // e.code = physical key: e.key is a Greek letter (sigma) under the Greek layout (R12)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      flushSave();
      showToast(t('doc.saved'));
    }

    // Ctrl+Alt+W — close current tab (browser-reserved-safe combo:
    // plain Ctrl+W closes the browser tab and ignores preventDefault)
    if (e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyW') {
      if (state.activeTab) {
        e.preventDefault();
        flushSave();
        closeDoc(state.activeTab);
      }
    }

    // Ctrl+Alt+T — new tab (plain Ctrl/T opens a browser tab)
    if (e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyT') {
      e.preventDefault();
      createDoc();
    }

    // F2 — rename current tab (alt to dblclick)
    if (e.key === 'F2' && state.activeTab && !document.querySelector('.tab-label-input') &&
        !(e.target && e.target.closest && e.target.closest('dialog'))) {
      e.preventDefault();
      const doc = activeDoc();
      const tab = EL.tabBar.querySelector('.tab.active .tab-label');
      if (tab) startTabRename(state.activeTab, tab);
    }

  });
}

/* ===== SECTION 13: BOOT SEQUENCE ===== */
// Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
// target { doc }. Opens the document in a tab (activateTab skips
// missing and deleted ones). { openFile: { token } }: a file from the
// system's "Open with" (shell fileopen.js), taken once from the shell.
// { newDoc: { title?, text } }: Typewriter's "Send to Writer", a NEW
// document from plain text (paragraphs split on blank lines).
// { newDoc: { title?, text, md: true } }: the Assistant's document card
// (WR-FMT): the text is Markdown, read like an imported .md file
// (headings, bold, italic, lists, {.center} / {.right} / {.justify}).
// { newDoc: { title?, rows } }: "Send to an app" with a table
// (Spreadsheet, BR-SEND): a NEW document holding that table, row 1 as
// the heading row; every cell is plain text.
// { newBlank: true }: the single app's "New document" icon shortcut.
const NEWDOC_MAX = 500000;
const NEWDOC_ROWS = 500, NEWDOC_COLS = 64, NEWDOC_CELL = 2000;
function tableDocHtml(rows) {
  const cell = 'border:1px solid var(--border);padding:6px 10px';
  let out = '', n = 0;
  rows.slice(0, NEWDOC_ROWS).forEach((r, i) => {
    if (!Array.isArray(r)) return;
    const tag = i === 0 ? 'th' : 'td';
    out += '<tr>' + r.slice(0, NEWDOC_COLS).map(c => {
      const v = typeof c === 'number' && isFinite(c) ? String(c) : typeof c === 'string' ? c.slice(0, NEWDOC_CELL) : '';
      return '<' + tag + ' style="' + cell + '">' + (v.trim() ? esc(v).replace(/\n/g, '<br>') : '&nbsp;') + '</' + tag + '>';
    }).join('') + '</tr>';
    n++;
  });
  return n ? '<table style="border-collapse:collapse;width:100%;margin:1em 0">' + out + '</table><p><br></p>' : '';
}
function openSearchTarget(t) {
  if (t && t.newBlank === true) { createDoc({}); return; }
  if (t && t.newDoc && typeof t.newDoc === 'object' && Array.isArray(t.newDoc.rows)) {
    const html = tableDocHtml(t.newDoc.rows);
    if (!html) return;
    const title = typeof t.newDoc.title === 'string' ? t.newDoc.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    createDoc({ title: title, html: html });
    return;
  }
  if (t && t.newDoc && typeof t.newDoc === 'object' && typeof t.newDoc.text === 'string') {
    const text = t.newDoc.text.slice(0, NEWDOC_MAX);
    if (!text.trim()) return;
    const title = typeof t.newDoc.title === 'string' ? t.newDoc.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (t.newDoc.md === true) {
      const md = WriterIO.parseTextOf(text, 'md');
      ioApplyImport(Object.assign(md, { title: title || md.title }), 'new');
      return;
    }
    const p = ioParseTxt(text);
    createDoc({ title: title || p.title, html: p.html });
    return;
  }
  if (t && t.openFile) {
    const f = takeOpenFile(t.openFile);
    if (f) ioOpenFile(f);
    return;
  }
  if (t && typeof t.doc === 'string') activateTab(t.doc);
}
function takeOpenFile(o) {
  try {
    const p = window.parent;
    if (!o || typeof o.token !== 'string' || !p || p === window ||
        typeof p.__orosTakeFile !== 'function') return null;
    return p.__orosTakeFile(o.token);
  } catch (e) { return null; }
}
window.__orosOpenAt = openSearchTarget;

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
    wireViewTools();
    wireSpell();
    wireTrack();
    ioWireDragDrop();

    // 6. First render — set initial dirty flag based on content
    dirty = false;

    // 7. Universal search deep link staged while Writer was closed
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === 'function') {
        const t = window.parent.__orosTakeTarget('writer');
        if (t) openSearchTarget(t);
      }
    } catch (e) {}

  } catch (err) {
    console.error('[orOS] writer boot failed:', err);
  }
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

  // MUST be in the document before showModal() — detached <dialog>
  // throws InvalidStateError (Wave 5 regression: append was lost in patching)
  document.body.appendChild(dlg);

  // Close on outside click or Esc (native)
  dlg.showModal();
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => {
    // keep a live (Undo) toast alive when its host dialog goes away
    if (toastEl && dlg.contains(toastEl)) {
      const next = Array.from(document.querySelectorAll('dialog[open]')).filter(d => d !== dlg).pop();
      (next || document.body).appendChild(toastEl);
    }
    dlg.remove();
  });
  return dlg;
}

/* ----- Themed confirm / prompt (R14: no native dialogs) ----- */
function wConfirm(message, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let done = false;
    let dlg = null;
    const finish = v => { if (done) return; done = true; resolve(v); if (dlg) dlg.close(); };
    dlg = openDialog(opts.title || t('wx.confirm'), '', [
      { class: 'fb-btn', label: t('wx.cancel'), onClick: () => finish(false) },
      { class: 'fb-btn primary' + (opts.danger ? ' danger' : ''),
        label: opts.ok || t('wx.ok'), onClick: () => finish(true) }
    ]);
    const p = document.createElement('p');
    p.className = 'w-confirm-msg';
    p.textContent = message;
    dlg.querySelector('.w-dialog-body').appendChild(p);
    dlg.addEventListener('close', () => { if (!done) { done = true; resolve(false); } });
    const okBtn = dlg.querySelector('.w-dialog-foot .primary');
    if (okBtn) okBtn.focus();
  });
}

function wPrompt(title, value) {
  return new Promise(resolve => {
    let done = false;
    let dlg = null;
    const finish = v => { if (done) return; done = true; resolve(v); if (dlg) dlg.close(); };
    dlg = openDialog(title, '', [
      { class: 'fb-btn', label: t('wx.cancel'), onClick: () => finish(null) },
      { class: 'fb-btn primary', label: t('wx.ok'), onClick: () => finish(inp.value.trim() || null) }
    ]);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'w-field';
    inp.value = value || '';
    inp.style.width = '100%';
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(inp.value.trim() || null); }
    });
    dlg.querySelector('.w-dialog-body').appendChild(inp);
    dlg.addEventListener('close', () => { if (!done) { done = true; resolve(null); } });
    inp.focus();
    inp.select();
  });
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
    if (findBar.hidden) { clearHighlights(); updateCount(0, 0); }
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
    <input type="text" placeholder="${t('tt.find')}" aria-label="${escAttr(t('tt.find'))}">
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
      clearHighlights();             // marks never linger after closing
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

    // 'u' + Unicode lookarounds: \b is ASCII-only (Greek whole-word failed)
    const flags = findState.matchCase ? 'gu' : 'giu';
    const body = escapeRegex(findState.query);
    const pattern = findState.wholeWord
      ? '(?<![\\p{L}\\p{N}_])' + body + '(?![\\p{L}\\p{N}_])' : body;
    let re;
    try { re = new RegExp(pattern, flags); } catch (e) { return; }
    const matches = [...txt.matchAll(re)];
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
  // Split from the END: earlier offsets stay valid on the same node.
  // (The old forward loop detached textNode after the 1st hit →
  //  parentNode null → TypeError on the 2nd hit in one paragraph.)
  const marks = [];
  for (let k = matches.length - 1; k >= 0; k--) {
    const m = matches[k];
    if (!m[0].length || !textNode.parentNode) continue;
    const hit = textNode.splitText(m.index);
    hit.splitText(m[0].length);
    const mark = document.createElement('mark');
    mark.className = 'find-hit';
    hit.parentNode.replaceChild(mark, hit);
    mark.appendChild(hit);
    marks.unshift(mark);
  }
  marks.forEach(mk => findState.hits.push(mk));
}

function clearHighlights() {
  const parents = new Set();
  findState.hits.forEach(hit => {
    if (!hit.parentNode) return;
    parents.add(hit.parentNode);
    ioUnwrap(hit);
  });
  // re-join split text nodes (live ranges/caret are preserved by normalize)
  parents.forEach(p => { if (p.isConnected) p.normalize(); });
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
  // Scroll + highlight ONLY. Selecting the hit moved focus into the
  // editor while typing in the find box → next keystrokes replaced it.
  if (active) active.scrollIntoView({ block: 'center', inline: 'nearest' });
  updateCount(findState.hits.length, findState.index + 1);
}

function updateCount(total, curr) {
  if (!findBar) return;
  const countEl = findBar.querySelector('.find-count');
  if (total === 0) countEl.textContent = findState.query ? t('find.none') : '';
  else countEl.textContent = t('find.count').replace('{current}', curr).replace('{total}', total);
}

function replaceOne() {
  if (findState.index < 0 || findState.index >= findState.hits.length) return;
  if (isLocked()) return;
  const rep = findBar.querySelector('#rep-text').value;
  const span = frOffsets([findState.hits[findState.index]])[0];
  clearHighlights();
  if (span) frApply([span], rep);        // one native undo step
  frGroups.undo = frGroups.redo = null;
  scheduleSave();
  findAndMark();                         // fresh hits; go on after the replaced one
  if (!findState.hits.length || !span) return;
  const offs = frOffsets(findState.hits);
  let k = offs.findIndex(o => o.s >= span.s + rep.length);
  if (k < 0) k = 0;
  findState.index = k;
  highlightActive();
}

function replaceAll() {
  if (findState.query === '' || !findState.hits.length) return;
  if (isLocked()) return;
  const rep = findBar.querySelector('#rep-text').value;
  const spans = frOffsets(findState.hits);
  clearHighlights();
  const before = editorHTMLForSave();
  frApply(spans, rep);
  const after = editorHTMLForSave();
  frGroups.undo = (after !== before && !tracking()) ? { n: spans.length, before: before, after: after } : null;
  frGroups.redo = null;
  dirty = true;
  updateEmptyState();
  scheduleSave();
  goalAfterInput();
  updateCount(0, 0);
  showToast(t('find.replaced.all') + ' (' + spans.length + ')');
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
    Array.from(CHAR_SETS[setKey]).reduce((acc, ch) => {
      if (ch === ' ') return acc;
      if (ch === '\uFE0F' && acc.length) { acc[acc.length - 1] += ch; return acc; }
      acc.push(ch);
      return acc;
    }, []).forEach(ch => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'char-cell' + (setKey === 'emoji' ? ' is-emoji' : '');
      cell.textContent = ch;
      cell.title = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      cell.addEventListener('click', () => {
        insertTextAtCursor(ch);
        updateEmptyState();
        scheduleSave();
      });
      grid.appendChild(cell);
    });
    gridWrap.appendChild(grid);
  }
  renderCharGrid('greek');
}

function insertTextAtCursor(text) {
  insertNodeAtCursor(document.createTextNode(text));
}

/* ----- SMART TYPOGRAPHY (post-input transforms at caret) ----- */
const ST_PAIRS = {
  '"': ['\u201C', '\u201D'],   // curly double quotes, direction by context
  "'": ['\u2018', '\u2019'],   // curly apostrophes
  '--': null,                   // handled as triggers below
  '...': '\u2026'
};

let stBusy = false;   // our own insertText fires 'input' — ignore it

// Replace [start,end) of a text node through the editing pipeline:
// execCommand('insertText') lands in the native undo stack (Ctrl+Z
// reverts the curly quote, not the whole word).
function stReplace(node, start, end, rep) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  sel.removeAllRanges();
  sel.addRange(r);
  stBusy = true;
  let ok = false;
  try { ok = document.execCommand('insertText', false, rep); } catch (e) { ok = false; }
  stBusy = false;
  if (!ok) {                    // engine without insertText: direct edit
    node.nodeValue = node.nodeValue.slice(0, start) + rep + node.nodeValue.slice(end);
    const c = document.createRange();
    c.setStart(node, start + rep.length);
    c.collapse(true);
    sel.removeAllRanges();
    sel.addRange(c);
  }
  scheduleSave();
}

function inCode(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest && el.closest('pre, code'));
}

function smartTransformLastInsert() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r0 = sel.getRangeAt(0);
  if (!r0.collapsed) return;
  const node = r0.startContainer;
  if (node.nodeType !== 3 || inCode(node)) return;
  const caret = r0.startOffset;
  if (caret < 1) return;
  const before = node.nodeValue.slice(0, caret);

  // Dashes: "--" → en dash; one more "-" right after → em dash
  // (the old "---" rule was unreachable: "--" always converted first)
  if (/\u2013-$/.test(before)) { stReplace(node, caret - 2, caret, '\u2014'); return; }
  if (/--$/.test(before))      { stReplace(node, caret - 2, caret, '\u2013'); return; }

  // Ellipsis
  if (/\.\.\.$/.test(before))  { stReplace(node, caret - 3, caret, '\u2026'); return; }

  // Curly quotes (opening after start/space/open bracket/dash/opening quote)
  if (/["']$/.test(before)) {
    const q = before.slice(-1);
    const prev = before.slice(0, -1).slice(-1);
    const isOpen = prev === '' || /[\s\(\[\{>\u2013\u2014\u201C\u2018«]/.test(prev);
    const pair = ST_PAIRS[q];
    stReplace(node, caret - 1, caret, isOpen ? pair[0] : pair[1]);
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
  if (!sel || !sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
  const node = sel.getRangeAt(0).startContainer;
  if (node.nodeType !== 3 || inCode(node)) return;
  const caret = sel.getRangeAt(0).startOffset;
  const before = node.nodeValue.slice(0, caret);

  for (const rule of rules) {
    if (!rule || !rule.find || !before.endsWith(rule.find)) continue;
    // Word boundary: "11/2" must not become "1½", "a(c)" stays as typed
    const prev = before.slice(0, before.length - rule.find.length).slice(-1);
    if (prev && /[\p{L}\p{N}]/u.test(prev)) continue;
    stReplace(node, caret - rule.find.length, caret, rule.repl);
    return;
  }
}

let acDlgRef = null;

function openAcDialog() {
  if (!state.autocorrect || !Array.isArray(state.autocorrect.rules)) {
    state.autocorrect = {
      rules: JSON.parse(JSON.stringify(AC_DEFAULTS)),
      mtime: 0
    };
  }
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
    del.title = t('ac.del');
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
      <label class="full" style="text-align:left;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="set-spell" ${spellOn() ? 'checked' : ''}>
        ${esc(t('set.spell'))}
      </label>
      <p class="full set-note">${esc(t('set.spellNote'))}</p>
      <label class="full set-who" for="set-who">${esc(t('tc.who'))}</label>
      <input class="full w-field" id="set-who" type="text" maxlength="60" autocomplete="name">
      <p class="full set-note">${esc(t('tc.whoNote'))}</p>
    </div>
  `, [
    { class: 'fb-btn', label: t('tt.autoCorrect'), onClick: () => openAcDialog() },
    { class: 'fb-btn', label: t('ud.title'), onClick: () => openUserDict() },
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => dlg.close() }
  ]);
  const whoIn = dlg.querySelector('#set-who');
  whoIn.value = view.who || '';
  whoIn.placeholder = window.WriterTrack ? WriterTrack.deviceName(navigator.userAgent) : '';
  whoIn.addEventListener('input', () => {
    view.who = whoIn.value.replace(/\s+/g, ' ').slice(0, 60);
    savePrefs();
  });
  dlg.querySelector('#set-spell').addEventListener('change', (e) => setSpellOn(e.target.checked));

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
  if (qfMenu) {
    if (qfMenu._ac) qfMenu._ac.abort();
    qfMenu.remove();
    qfMenu = null;
  }
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

  // One AbortController per menu: closing it removes BOTH listeners
  const ac = new AbortController();
  qfMenu._ac = ac;
  setTimeout(() => {
    if (ac.signal.aborted) return;
    document.addEventListener('click', e => {
      if (qfMenu && qfMenu.contains(e.target)) return;   // item handlers close it
      closeQfMenu();
    }, { signal: ac.signal });
    document.addEventListener('contextmenu', closeQfMenu, { signal: ac.signal });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQfMenu(); },
      { signal: ac.signal });
    window.addEventListener('blur', closeQfMenu, { signal: ac.signal });
  }, 0);
}

/* ----- ASK THE ASSISTANT (Assistant phase 3) ----- */
// The selected text (else the whole document) goes into the
// Assistant's message box with the chosen request, through the shell's
// deep link __orosOpenAt("assistant", { ask }). Nothing is sent until
// the user presses Send there; the Assistant's answer has a Copy
// button, so the result comes back by pasting it.
const ASK_MAX = 12000;
function assistantInstalled() {
  try {
    const p = window.parent;
    if (!p || p === window || typeof p.orosAssistInstalled !== 'function' || typeof p.__orosOpenAt !== 'function') return false;
    return (p.orosAssistInstalled() || []).some(a => a && a.id === 'assistant');
  } catch (e) { return false; }
}
function askSourceText() {
  const sel = window.getSelection();
  let text = '';
  if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed &&
      EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    text = sel.toString();
  } else if (lastEditorRange && !lastEditorRange.collapsed) {
    text = lastEditorRange.toString();
  } else {
    text = EL.editor.innerText || '';
  }
  text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > ASK_MAX ? text.slice(0, ASK_MAX) + '…' : text;
}
function sendApi() {
  try { return window.parent !== window && window.parent.orosSend ? window.parent.orosSend : null; }
  catch (e) { return null; }
}
const SEND_MAX = 200000;
function sendToApp() {
  const api = sendApi();
  if (!api) return;
  const sel = window.getSelection();
  let text = '';
  if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed &&
      EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    text = sel.toString();
  } else if (lastEditorRange && !lastEditorRange.collapsed) {
    text = lastEditorRange.toString();
  } else {
    text = EL.editor.innerText || '';
  }
  text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, SEND_MAX);
  if (!text) { showToast(t('ask.empty')); return; }
  const doc = activeDoc();
  const title = doc && typeof doc.title === 'string' ? doc.title : '';
  api.open({ kind: 'text', data: { title: title, text: text } });
}
function askAssistant(kind) {
  const text = askSourceText();
  if (!text) { showToast(t('ask.empty')); return; }
  const ask = t('ask.' + kind) + '\n\n"""\n' + text + '\n"""' + (kind === 'other' ? '\n\n' : '');
  try { window.parent.__orosOpenAt('assistant', { ask: ask }); } catch (e) {}
}
function openAskMenu(anchor) {
  closeQfMenu();
  qfMenu = document.createElement('div');
  qfMenu.className = 'qf-menu';
  qfMenu.setAttribute('role', 'menu');
  ['sum', 'rephrase', 'fix', 'other'].forEach(kind => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qf-item';
    btn.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = t('ask.m.' + kind);
    btn.appendChild(label);
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => { closeQfMenu(); askAssistant(kind); });
    qfMenu.appendChild(btn);
  });
  document.body.appendChild(qfMenu);
  const r = anchor.getBoundingClientRect(), m = qfMenu.getBoundingClientRect();
  qfMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.width - 8)) + 'px';
  qfMenu.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - m.height - 8)) + 'px';
  const first = qfMenu.querySelector('button');
  const ac = new AbortController();
  qfMenu._ac = ac;
  setTimeout(() => {
    if (ac.signal.aborted) return;
    document.addEventListener('click', e => {
      if (qfMenu && (qfMenu.contains(e.target) || anchor.contains(e.target))) return;
      closeQfMenu();
    }, { signal: ac.signal });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeQfMenu(); anchor.focus(); } },
      { signal: ac.signal });
    window.addEventListener('blur', closeQfMenu, { signal: ac.signal });
  }, 0);
  if (first && (document.activeElement === anchor)) first.focus();
}

/* ----- LINK / IMAGE / TABLE DIALOGS ----- */
function openLinkDialog() {
  const selText = (() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      return sel.toString();
    }
    return lastEditorRange ? lastEditorRange.toString() : '';
  })();
  const dlg = openDialog(t('tt.qf.link'), `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <input type="text" class="w-field" id="lk-text" placeholder="${t('link.displayText')}">
      <input type="url" class="w-field" id="lk-url" placeholder="https://…">
    </div>
  `, [
    { class: 'fb-btn', label: t('wx.cancel'), onClick: () => dlg.close() },
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => { doInsertLink(dlg); } }
  ]);
  dlg.querySelector('#lk-text').value = selText;
}

function doInsertLink(dlg) {
  const text = dlg.querySelector('#lk-text').value.trim();
  const url = dlg.querySelector('#lk-url').value.trim();
  if (!url) return;
  // insertNodeAtCursor() replaces the remembered editor selection itself
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
      <input type="text" class="w-field" id="img-cap" placeholder="${escAttr(t('img.caption'))}">
    </div>
  `, [
    { class: 'fb-btn', label: t('wx.cancel'), onClick: () => dlg.close() },
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => { doInsertImage(dlg); } }
  ]);

  dlg.querySelector('#img-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    imageFileToDataUrl(file).then(url => { dlg.querySelector('#img-url').value = url; });
  });

  // Wave 2: shell present → native image picker via orosDialog.
  // Standalone keeps the built-in input above (change event, unchanged).
  dlg.querySelector('#img-file').addEventListener('click', function (e) {
    const host = dialogHost();
    if (!host) return;
    e.preventDefault();
    e.stopPropagation();
    host.openFile('image/*').then(function (file) {
      if (!file) return;   // cancel → silent exit
      imageFileToDataUrl(file).then(function (url) {
        dlg.querySelector('#img-url').value = url;
      });
    });
  }, true);
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

// ≤1600px, JPEG 0.85 (PNG kept when already small) → typically 150–400 KB
function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = reader.result;
      if (file.size <= 300 * 1024 || /svg/.test(file.type)) { resolve(src); return; }
      const img = new Image();
      img.onerror = () => resolve(src);
      img.onload = () => {
        const MAX = 1600;
        const k = Math.min(1, MAX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';            // JPEG has no alpha
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(c.toDataURL('image/jpeg', 0.85)); } catch (e) { resolve(src); }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
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
    { class: 'fb-btn', label: t('wx.cancel'), onClick: () => dlg.close() },
    { class: 'fb-btn primary', label: t('table.insert'), onClick: () => doInsertTable(dlg) }
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
      const cell = (withHeader && r === 0) ? tr.appendChild(document.createElement('th')) : tr.insertCell();
      cell.style.border = '1px solid var(--border)';
      cell.style.padding = '6px 10px';
      cell.textContent = '\u00A0';
    }
  }
  insertNodeAtCursor(tbl);
  insertNodeAtCursor(document.createElement('p'));
  scheduleSave();
  dlg.close();
}

// ===== SECTION 15b: INSERT MENU · TABLE TOOLS · VIEW (FOCUS, TYPEWRITER
// SCROLLING, WORD COUNT) · STATISTICS · UNDOABLE REPLACE =====
// Pure parts (sentences, statistics, centring) live
// in core.js (window.WriterCore, tested in tests/writer-core.test.js).
const WC = window.WriterCore;
function appLang() { return window.orosLang === 'el' ? 'el' : 'en'; }

// Put the remembered caret back into the editor (a toolbar tap or a
// dialog may have taken the selection away).
function restoreEditorSelection() {
  const sel = window.getSelection();
  const inEd = sel && sel.rangeCount && EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer);
  if (document.activeElement !== EL.editor) EL.editor.focus({ preventScroll: true });
  if (!inEd && lastEditorRange && EL.editor.contains(lastEditorRange.commonAncestorContainer)) {
    sel.removeAllRanges();
    sel.addRange(lastEditorRange.cloneRange());
  }
}

/* ----- Generic toolbar menu (Insert, View) ----- */
function openMenu(anchor, items) {
  closeQfMenu();
  qfMenu = document.createElement('div');
  qfMenu.className = 'qf-menu';
  qfMenu.setAttribute('role', 'menu');
  items.forEach(item => {
    if (!item) {
      const sep = document.createElement('div');
      sep.className = 'qf-sep';
      qfMenu.appendChild(sep);
      return;
    }
    if (item.heading) {
      const h = document.createElement('div');
      h.className = 'qf-head';
      h.textContent = item.label;
      qfMenu.appendChild(h);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qf-item';
    const checkable = typeof item.checked === 'boolean';
    btn.setAttribute('role', !checkable ? 'menuitem' : (item.radio ? 'menuitemradio' : 'menuitemcheckbox'));
    if (checkable) {
      btn.setAttribute('aria-checked', item.checked ? 'true' : 'false');
      if (item.checked) btn.classList.add('on');
    }
    const label = document.createElement('span');
    label.textContent = item.label;
    btn.appendChild(label);
    if (checkable) {
      const check = document.createElement('span');
      check.className = 'qf-check';
      check.innerHTML = ICONS.check;     // our own static SVG
      btn.appendChild(check);
    }
    if (item.strong) btn.classList.add('qf-strong');
    if (item.disabled) btn.disabled = true;
    btn.addEventListener('mousedown', e => e.preventDefault());   // keep the editor selection
    btn.addEventListener('click', () => { closeQfMenu(); if (item.action) item.action(); });
    qfMenu.appendChild(btn);
  });
  document.body.appendChild(qfMenu);
  const r = anchor.getBoundingClientRect(), m = qfMenu.getBoundingClientRect();
  qfMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.width - 8)) + 'px';
  qfMenu.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - m.height - 8)) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  const ac = new AbortController();
  qfMenu._ac = ac;
  ac.signal.addEventListener('abort', () => anchor.setAttribute('aria-expanded', 'false'));
  const menu = qfMenu;
  menu.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = Array.from(menu.querySelectorAll('.qf-item:not(:disabled)'));
    const i = list.indexOf(document.activeElement);
    const n = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
    if (n) n.focus();
  });
  setTimeout(() => {
    if (ac.signal.aborted) return;
    document.addEventListener('click', e => {
      if (qfMenu && (qfMenu.contains(e.target) || anchor.contains(e.target))) return;
      closeQfMenu();
    }, { signal: ac.signal });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeQfMenu(); anchor.focus(); } },
      { signal: ac.signal });
    window.addEventListener('blur', closeQfMenu, { signal: ac.signal });
  }, 0);
  const first = menu.querySelector('.qf-item');
  if (first && document.activeElement === anchor) first.focus();
}

function toggleMenu(anchor, build) {
  if (qfMenu && anchor.getAttribute('aria-expanded') === 'true') { closeQfMenu(); return; }
  build(anchor);
}

// The same menu at a point of the page (spelling suggestions).
function openMenuAt(x, y, items) {
  openMenu({
    getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }),
    setAttribute: () => {}, getAttribute: () => null, contains: () => false,
    focus: () => restoreEditorSelection()
  }, items);
}

/* ----- INSERT MENU (link, image, table… for touch screens too) ----- */
function openInsertMenu(anchor) {
  openMenu(anchor, [
    { label: t('tt.qf.link'), action: openLinkDialog },
    { label: t('tt.qf.image'), action: openImageDialog },
    { label: t('tt.qf.table'), action: openTableDialog },
    null,
    { label: t('tt.hr'), action: () => { restoreEditorSelection(); exec('insertHorizontalRule'); } },
    { label: t('tt.pageBreak'), action: () => { restoreEditorSelection(); document.getElementById('btn-page-break').click(); } },
    { label: t('fn.add'), action: () => { restoreEditorSelection(); addFootnote(); } },
    { label: t('tt.chars'), action: openCharsDialog }
  ]);
}

/* ----- TABLE TOOLS (a strip under the toolbar while the caret is in a table) ----- */
let tableBar = null;
const TBL_OPS = [
  ['rowAbove', 'rowUp', 'tbl.rowAbove'], ['rowBelow', 'rowDown', 'tbl.rowBelow'],
  ['colLeft', 'colLeft', 'tbl.colLeft'], ['colRight', 'colRight', 'tbl.colRight'],
  ['delRow', 'delRow', 'tbl.delRow'], ['delCol', 'delCol', 'tbl.delCol'],
  ['header', 'thead', 'table.headerRow'], ['delTable', 'delTable', 'tbl.delTable']
];

function selectionCell(useLast) {
  const sel = window.getSelection();
  let n = null;
  if (sel && sel.rangeCount && EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) n = sel.focusNode;
  else if (useLast && lastEditorRange && EL.editor.contains(lastEditorRange.commonAncestorContainer)) n = lastEditorRange.startContainer;
  if (!n) return null;
  const el = n.nodeType === 1 ? n : n.parentElement;
  const cell = el && el.closest ? el.closest('td, th') : null;
  return cell && EL.editor.contains(cell) ? cell : null;
}

function buildTableBar() {
  tableBar = document.createElement('div');
  tableBar.className = 'table-bar';
  tableBar.setAttribute('role', 'toolbar');
  tableBar.setAttribute('aria-label', t('tbl.bar'));
  tableBar.hidden = true;
  TBL_OPS.forEach(op => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fb-btn tbl-btn' + (op[0] === 'delTable' ? ' danger' : '');
    b.dataset.op = op[0];
    b.title = t(op[2]);
    b.innerHTML = ICONS[op[1]];          // our own static SVG
    const s = document.createElement('span');
    s.textContent = t(op[2]);
    b.appendChild(s);
    b.addEventListener('mousedown', e => e.preventDefault());   // the caret stays in the cell
    b.addEventListener('click', () => tableOp(op[0]));
    tableBar.appendChild(b);
  });
  EL.toolbar.parentNode.insertBefore(tableBar, EL.toolbar.nextSibling);
}

function updateTableBar() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    // the caret left the editor for good (another tab, nothing selected)
    if (tableBar && !selectionCell(true)) tableBar.hidden = true;
    return;
  }
  const cell = selectionCell(false);
  if (!cell && !tableBar) return;
  if (!tableBar) buildTableBar();
  tableBar.hidden = !cell;
  if (cell) {
    const first = cell.closest('table').rows[0];
    const isHead = !!first && Array.from(first.cells).every(c => c.nodeName === 'TH');
    const hb = tableBar.querySelector('[data-op="header"]');
    hb.setAttribute('aria-pressed', isHead ? 'true' : 'false');
    hb.classList.toggle('on', isHead);
  }
}

function caretInto(el) {
  if (!el) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(true);
  EL.editor.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  lastEditorRange = r.cloneRange();
}

function blankCell(like, tag) {
  const c = document.createElement(tag || like.nodeName.toLowerCase());
  const st = like.getAttribute('style');
  if (st) c.setAttribute('style', st);
  c.style.background = '';
  if (!c.getAttribute('style')) c.removeAttribute('style');
  c.appendChild(document.createElement('br'));
  return c;
}

function retagCell(c, tag) {
  const n = document.createElement(tag);
  Array.from(c.attributes).forEach(a => n.setAttribute(a.name, a.value));
  n.style.background = '';             // the old header look was an inline background
  if (!n.getAttribute('style')) n.removeAttribute('style');
  while (c.firstChild) n.appendChild(c.firstChild);
  c.replaceWith(n);
  return n;
}

function tableOp(op) {
  if (isLocked()) return;
  const cell = selectionCell(true);
  if (!cell) return;
  const table = cell.closest('table');
  const tr = cell.parentElement;
  const rows = Array.from(table.rows);
  const ri = rows.indexOf(tr), ci = cell.cellIndex;
  const cols = Math.max.apply(null, rows.map(r => r.cells.length));
  let focus = null;
  if ((op === 'delRow' && rows.length <= 1) || (op === 'delCol' && cols <= 1)) op = 'delTable';
  if (op === 'rowAbove' || op === 'rowBelow') {
    const nr = document.createElement('tr');
    Array.from(tr.cells).forEach(c => nr.appendChild(blankCell(c, 'td')));
    tr.parentNode.insertBefore(nr, op === 'rowAbove' ? tr : tr.nextSibling);
    focus = nr.cells[Math.min(ci, nr.cells.length - 1)];
  } else if (op === 'colLeft' || op === 'colRight') {
    rows.forEach(r => {
      const ref = r.cells[Math.min(ci, r.cells.length - 1)];
      if (!ref) { const nc0 = blankCell(cell, 'td'); r.appendChild(nc0); if (r === tr) focus = nc0; return; }
      const nc = blankCell(ref);
      const before = op === 'colLeft' && r.cells.length > ci;
      r.insertBefore(nc, before ? ref : ref.nextSibling);
      if (r === tr) focus = nc;
    });
  } else if (op === 'delRow') {
    const next = rows[ri + 1] || rows[ri - 1];
    tr.remove();
    focus = next.cells[Math.min(ci, next.cells.length - 1)];
  } else if (op === 'delCol') {
    rows.forEach(r => { const c = r.cells[ci]; if (c) c.remove(); });
    focus = tr.cells[Math.min(ci, tr.cells.length - 1)] || rows[0].cells[0];
  } else if (op === 'header') {
    const first = rows[0];
    const toTh = Array.from(first.cells).some(c => c.nodeName !== 'TH');
    Array.from(first.cells).forEach(c => {
      const n = retagCell(c, toTh ? 'th' : 'td');
      if (c === cell) focus = n;
    });
    if (!focus) focus = cell;
  } else if (op === 'delTable') {
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    table.replaceWith(p);
    focus = p;
  }
  caretInto(focus);
  updateEmptyState();
  scheduleSave();
  goalAfterInput();
  updateTableBar();
}

/* ----- VIEW: focus mode, typewriter scrolling, word count (per device,
   stored in oros-writer-prefs.view, never synced) ----- */
const view = { focus: false, unit: 'p', tw: false, wc: false, who: '' };

function loadView() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    const v = p && p.view;
    if (v && typeof v === 'object') {
      view.focus = v.focus === true;
      view.unit = v.unit === 's' ? 's' : 'p';
      view.tw = v.tw === true;
      view.wc = v.wc === true;
    }
    if (p && typeof p.who === 'string') view.who = p.who.slice(0, 60);
  } catch (e) { /* defaults */ }
}

loadView();   // before the first savePrefs() of the boot

function setView(key, val) {
  view[key] = val;
  savePrefs();
  applyView();
}

function openViewMenu(anchor) {
  openMenu(anchor, [
    { label: t('view.focus'), checked: view.focus, action: () => setView('focus', !view.focus) },
    { label: t('view.unitP'), checked: view.unit === 'p', radio: true, action: () => setView('unit', 'p') },
    { label: t('view.unitS'), checked: view.unit === 's', radio: true, action: () => setView('unit', 's') },
    null,
    { label: t('view.tw'), checked: view.tw, action: () => setView('tw', !view.tw) },
    { label: t('view.wc'), checked: view.wc, action: () => setView('wc', !view.wc) },
    null,
    { label: t('view.stats'), action: openStatsDialog }
  ]);
}

let focusExitBtn = null, focusStyle = null, wcChip = null;
function applyView() {
  EL.app.classList.toggle('focus-mode', view.focus);
  EL.app.classList.toggle('tw-scroll', view.tw);
  if (view.focus && !focusExitBtn) {
    focusExitBtn = document.createElement('button');
    focusExitBtn.type = 'button';
    focusExitBtn.className = 'focus-exit';
    focusExitBtn.innerHTML = ICONS.close;
    focusExitBtn.title = t('focus.exit');
    focusExitBtn.setAttribute('aria-label', t('focus.exit'));
    focusExitBtn.addEventListener('mousedown', e => e.preventDefault());
    focusExitBtn.addEventListener('click', () => setView('focus', false));
    EL.wrapper.appendChild(focusExitBtn);
  }
  if (focusExitBtn) focusExitBtn.hidden = !view.focus;
  if (view.focus) closeQfMenu();
  twPadding();
  updateFocus();
  twScroll();
  updateWcChip();
}

// The block that holds the caret: a list item, a table cell or a
// caption, else the editor's direct child (null for bare root text).
function caretBlock() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const n = sel.focusNode;
  if (!n || n === EL.editor || !EL.editor.contains(n)) return null;
  let el = n.nodeType === 1 ? n : n.parentElement;
  const inner = el.closest('li, td, th, figcaption');
  if (inner && EL.editor.contains(inner)) return inner;
  while (el && el.parentElement !== EL.editor) el = el.parentElement;
  return el || null;
}

function nthPath(el) {
  let sel = '';
  while (el && el !== EL.editor) {
    sel = ' > :nth-child(' + (Array.prototype.indexOf.call(el.parentElement.children, el) + 1) + ')' + sel;
    el = el.parentElement;
  }
  return '#rich-editor' + sel;
}

// Text offsets [s, e) inside rootEl → a Range over its text nodes.
function rangeFromOffsets(rootEl, s, e) {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, node, started = false, last = null;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    if (!started && s <= pos + len) { r.setStart(node, s - pos); started = true; }
    if (started && e <= pos + len) { r.setEnd(node, e - pos); return r; }
    pos += len; last = node;
  }
  if (!started) return null;
  r.setEnd(last, last.data.length);
  return r;
}

// Focus mode dims the text (CSS) and lights the current block through
// a generated :nth-child rule; sentence focus uses the CSS Custom
// Highlight API. Nothing is written into the document.
function updateFocus() {
  if (!focusStyle) {
    focusStyle = document.createElement('style');
    document.head.appendChild(focusStyle);
  }
  const hl = !!(window.CSS && CSS.highlights && typeof window.Highlight === 'function');
  if (hl) CSS.highlights.delete('w-focus');
  let css = '';
  if (view.focus) {
    const b = caretBlock();
    if (!b) css = '#rich-editor{color:var(--text)!important}';
    else {
      const path = nthPath(b);
      const sentence = view.unit === 's' && hl ? sentenceRange(b) : null;
      if (sentence) {
        CSS.highlights.set('w-focus', new window.Highlight(sentence));
        css = path + ' img{opacity:1}';
      } else {
        css = path + '{color:var(--text)!important}' + path + ' img{opacity:1}';
      }
    }
  }
  if (focusStyle.textContent !== css) focusStyle.textContent = css;
}

function sentenceRange(block) {
  try {
    const sel = window.getSelection();
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(sel.focusNode, sel.focusOffset);
    const off = pre.toString().length;
    const s = WC.sentenceAt(block.textContent, off, appLang());
    return s ? rangeFromOffsets(block, s.s, s.e) : null;
  } catch (e) { return null; }
}

// Typewriter scrolling: the caret line stays in the middle of the editor.
function twPadding() {
  if (view.tw) EL.editor.style.setProperty('--tw-pad', Math.round(EL.editor.clientHeight / 2) + 'px');
  else EL.editor.style.removeProperty('--tw-pad');
}

function twScroll() {
  if (!view.tw) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (!r.collapsed || !EL.editor.contains(r.startContainer)) return;
  let mid = null;
  const rects = r.getClientRects();
  if (rects.length && rects[0].height) mid = (rects[0].top + rects[0].bottom) / 2;
  else {
    const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    if (!el || el === EL.editor) return;
    const br = el.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
    mid = br.top + Math.min(br.height, lh) / 2;
  }
  const er = EL.editor.getBoundingClientRect();
  const d = WC.centerDelta(mid, er.top, EL.editor.clientHeight);
  if (d) EL.editor.scrollTop += d;
}

let viewRaf = 0;
function viewAfterChange() {
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => {
    viewRaf = 0;
    if (view.focus) updateFocus();
    twScroll();
    updateWcChip();
    updateTableBar();
  });
}

/* ----- Text of a subtree, one line per block (statistics) ----- */
const STAT_BLK = /^(P|DIV|LI|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|TD|TH|FIGCAPTION|TABLE|TR|UL|OL)$/;
function blockText(rootEl) {
  let text = '';
  const walker = document.createTreeWalker(rootEl,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => (n.nodeType === 1 && n.matches('sup.fn-ref'))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeType === 3) text += n.nodeValue;
    else if (n.nodeName === 'BR' || STAT_BLK.test(n.nodeName)) text += '\n';
  }
  return text;
}

function selectionFragmentText() {
  const sel = window.getSelection();
  let r = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
  if (!r || !EL.editor.contains(r.commonAncestorContainer)) r = lastEditorRange;
  if (!r || r.collapsed || !EL.editor.contains(r.commonAncestorContainer)) return '';
  const box = document.createElement('div');
  box.appendChild(r.cloneContents());
  return blockText(box);
}

function fmtMinutes(min) {
  const m = WC.roundMinutes(min);
  return m.lt1 ? t('stats.lt1') : t('stats.min').replace('{n}', m.n.toLocaleString(loc()));
}

function updateWcChip() {
  const show = view.wc && !!activeDoc();
  if (!show) { if (wcChip) wcChip.hidden = true; return; }
  if (!wcChip) {
    wcChip = document.createElement('button');
    wcChip.type = 'button';
    wcChip.className = 'wc-chip';
    wcChip.title = t('stats.title');
    wcChip.addEventListener('mousedown', e => e.preventDefault());
    wcChip.addEventListener('click', openStatsDialog);
    EL.wrapper.appendChild(wcChip);
  }
  wcChip.hidden = false;
  const n = editorStats().words;
  const sel = window.getSelection();
  const selTxt = (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed &&
    EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) ? selectionFragmentText() : '';
  const s = selTxt ? WC.countWords(selTxt) : 0;
  const L = loc();
  wcChip.textContent = s
    ? t('wc.sel').replace('{s}', s.toLocaleString(L)).replace('{n}', n.toLocaleString(L))
    : t('docs.words').replace('{n}', n.toLocaleString(L));
}

/* ----- STATISTICS ----- */
function openStatsDialog() {
  const L = appLang();   // sentence rules (core.js): "el" or "en"
  const doc = WC.textStats(blockText(EL.editor), L);
  const selTxt = selectionFragmentText();
  const sel = selTxt.trim() ? WC.textStats(selTxt, L) : null;
  const num = v => esc(v.toLocaleString(loc()));
  const rows = [
    ['stats.words', s => num(s.words)],
    ['stats.chars', s => num(s.chars)],
    ['stats.charsNs', s => num(s.charsNoSpaces)],
    ['stats.paras', s => num(s.paragraphs)],
    ['stats.sents', s => num(s.sentences)],
    ['stats.read', s => esc(fmtMinutes(s.readMin))],
    ['stats.speak', s => esc(fmtMinutes(s.speakMin))]
  ];
  const dlg = openDialog(t('stats.title'), `
    <table class="stats-table">
      <thead><tr><th></th><th scope="col">${esc(t('stats.doc'))}</th>${sel ? `<th scope="col">${esc(t('stats.sel'))}</th>` : ''}</tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row">${esc(t(r[0]))}</th><td>${r[1](doc)}</td>${sel ? `<td>${r[1](sel)}</td>` : ''}</tr>`).join('')}</tbody>
    </table>
    <p class="stats-note">${esc(t('stats.note'))}</p>
    <label class="stats-opt"><input type="checkbox" id="stats-wc" ${view.wc ? 'checked' : ''}> ${esc(t('view.wc'))}</label>
  `, [
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => dlg.close() }
  ]);
  dlg.querySelector('#stats-wc').addEventListener('change', e => setView('wc', e.target.checked));
}

/* ----- UNDOABLE FIND AND REPLACE ----- */
// Every replacement goes through execCommand (insertText / delete), so
// it lands in the browser's own undo stack. "Replace all" makes one
// step per hit; Undo/Redo right after it replays them all at once.
let frBusy = false;
let frUndoing = false;
const frGroups = { undo: null, redo: null };   // { n, before, after }

function frOffsets(marks) {
  return marks.filter(m => m.isConnected).map(m => {
    const pre = document.createRange();
    pre.selectNodeContents(EL.editor);
    pre.setEndBefore(m);
    const s = pre.toString().length;
    return { s: s, e: s + m.textContent.length };
  });
}

function frApply(spans, rep) {
  EL.editor.focus({ preventScroll: true });
  const sel = window.getSelection();
  const tracked = tracking();          // wave 22: replacements become tracked changes
  if (tracked) tcSnapshot('replace' + Date.now());
  spans.slice().sort((a, b) => b.s - a.s).forEach(sp => {
    const r = rangeFromOffsets(EL.editor, sp.s, sp.e);
    if (!r) return;
    sel.removeAllRanges();
    sel.addRange(r);
    if (tracked) { tcReplaceSelection(rep); return; }
    frBusy = true;
    let ok = false;
    try { ok = document.execCommand(rep ? 'insertText' : 'delete', false, rep || null); } catch (e) { ok = false; }
    frBusy = false;
    if (!ok) {                          // engine without execCommand: direct edit
      r.deleteContents();
      if (rep) r.insertNode(document.createTextNode(rep));
    }
  });
}

function frStep(cmd, target, n) {
  frUndoing = true;
  try {
    EL.editor.focus({ preventScroll: true });
    for (let i = 0; i < n && editorHTMLForSave() !== target; i++) document.execCommand(cmd);
  } finally { frUndoing = false; }
  dirty = true;
  updateEmptyState();
  scheduleSave();
  goalAfterInput();
}

function frTryUndo() {
  const g = frGroups.undo;
  if (frUndoing || !g) return false;
  clearHighlights();
  if (editorHTMLForSave() !== g.after) { frGroups.undo = null; return false; }
  frStep('undo', g.before, g.n);
  frGroups.undo = null;
  frGroups.redo = g;
  return true;
}

function frTryRedo() {
  const g = frGroups.redo;
  if (frUndoing || !g) return false;
  clearHighlights();
  if (editorHTMLForSave() !== g.before) { frGroups.redo = null; return false; }
  frStep('redo', g.after, g.n);
  frGroups.redo = null;
  frGroups.undo = g;
  return true;
}

function wireReplaceUndo() {
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const z = e.code === 'KeyZ', y = e.code === 'KeyY';
    if (!z && !y) return;
    if (e.target !== EL.editor) return;
    const redo = y || (z && e.shiftKey);
    if (redo ? frTryRedo() : frTryUndo()) e.preventDefault();
  }, true);
  EL.editor.addEventListener('beforeinput', e => {
    if (e.inputType === 'historyUndo' && frTryUndo()) e.preventDefault();
    else if (e.inputType === 'historyRedo' && frTryRedo()) e.preventDefault();
  });
}

/* ----- Wiring for this section (called from boot) ----- */
function wireViewTools() {
  const ins = document.getElementById('btn-insert');
  const vw = document.getElementById('btn-view');
  [ins, vw].forEach(b => { if (b) b.addEventListener('mousedown', e => e.preventDefault()); });
  if (ins) ins.addEventListener('click', () => toggleMenu(ins, openInsertMenu));
  if (vw) vw.addEventListener('click', () => toggleMenu(vw, openViewMenu));
  const rv = document.getElementById('btn-review');
  if (rv) {
    rv.addEventListener('mousedown', e => e.preventDefault());
    rv.addEventListener('click', () => toggleMenu(rv, openReviewMenu));
  }
  document.addEventListener('selectionchange', viewAfterChange);
  EL.editor.addEventListener('input', viewAfterChange);
  window.addEventListener('resize', () => { twPadding(); viewAfterChange(); });
  // Ctrl+Alt+F: focus mode on/off; Esc leaves it (when nothing else is open)
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyF') {
      e.preventDefault();
      setView('focus', !view.focus);
    } else if (e.key === 'Escape' && view.focus && !qfMenu &&
               !document.querySelector('dialog[open]') && (!findBar || findBar.hidden)) {
      setView('focus', false);
    }
  });
  wireReplaceUndo();
  applyView();
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
    markDoc(doc, 'c');
  }
  return changed;
}

/* ----- Add: sup at cursor + empty entry + renumber ----- */
function addFootnote() {
  if (isLocked()) return;
  ensureDoc();
  const doc = fnDoc();
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
  drainObserver();
  fnSuspendObserver = false;

  markDoc(doc, 'c');
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
    tcHidePanel();
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
      if (e) { e.text = ta.textContent; markDoc(fnDoc(), 'c'); }
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
      markDoc(fnDoc(), 'c');
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

// MutationObserver callbacks are ASYNC — toggling a flag around a sync
// change never paused anything. Drain the queued records instead.
function drainObserver() {
  if (fnObserver) fnObserver.takeRecords();
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
    if (!cmtEntry(mark.dataset.cmt)) { ioUnwrap(mark); changed = true; }   // keep the TEXT
  });

  const ids = new Set(cmtMarks().map(m => m.dataset.cmt));
  const before = doc.comments.length;
  doc.comments = doc.comments.filter(c => ids.has(c.id));
  if (doc.comments.length !== before) changed = true;

  if (changed) {
    if (cmtPanel && !cmtPanel.hidden) renderCommentsPanel();
    markDoc(doc, 'c');
  }
  return changed;
}

/* ----- Add: wrap the selection in a mark, create entry ----- */
function addComment() {
  const doc = cmtDoc();
  if (!doc) return;
  if (isLocked()) return;

  // Selection: live one if it is in the editor, else the remembered one
  // (clicking into the comments panel must not lose it).
  const sel = window.getSelection();
  let range = null;
  if (sel && sel.rangeCount && EL.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else if (lastEditorRange && EL.editor.contains(lastEditorRange.commonAncestorContainer)) {
    range = lastEditorRange;
  }
  if (!range || range.collapsed || !range.toString().trim()) {
    showToast(t('cmt.needSel'));
    return;
  }

  const BLK = 'p,div,li,h1,h2,h3,h4,blockquote,pre,td,th,figcaption';
  const blockOf = n => {
    let el = n.nodeType === 1 ? n : n.parentElement;
    while (el && el !== EL.editor && !el.matches(BLK)) el = el.parentElement;
    return el || EL.editor;
  };

  const id = 'cm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const quote = range.toString();
  const mark = document.createElement('mark');
  mark.className = 'cmt-mark';
  mark.dataset.cmt = id;

  cmtSuspendObserver = true;
  try {
    try {
      range.surroundContents(mark);          // clean case: one text run
    } catch (e) {
      // partial formatting (e.g. half-bold) → extract + wrap, but never
      // across paragraphs (a <mark> cannot hold blocks)
      if (blockOf(range.startContainer) !== blockOf(range.endContainer)) {
        showToast(t('cmt.oneBlock'));
        return;
      }
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
    }
  } finally {
    drainObserver();
    cmtSuspendObserver = false;
  }

  doc.comments.push({ id: id, quote: quote, text: '', ts: Date.now() });
  const after = document.createRange();
  after.setStartAfter(mark);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);

  markDoc(doc, 'c');
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
    tcHidePanel();
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
      if (e) { e.text = ta.textContent; markDoc(cmtDoc(), 'c'); }
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
      EL.editor.querySelectorAll('mark.cmt-mark[data-cmt="' + id + '"]').forEach(ioUnwrap);   // text stays
      cmtSuspendObserver = false;
      const d = cmtDoc();
      if (d) d.comments = d.comments.filter(c => c.id !== id);
      markDoc(cmtDoc(), 'c');
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
  const lang = loc();
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
  const doc = ensureDoc();

  metaDlg = openDialog(t('tt.meta'), '', [
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => metaDlg.close() }
  ]);
  const body = metaDlg.querySelector('.w-dialog-body');
  body.innerHTML = `
    <div class="form-grid">
      <label>${t('meta.title')}</label>
      <input type="text" class="w-field" id="meta-title" value="${escAttr(doc.title || '')}">
      
      <label>${t('meta.author')}</label>
      <input type="text" class="w-field" id="meta-author" value="${escAttr(doc.author || '')}">
      
      <label>${t('meta.category')}</label>
      <input type="text" class="w-field" id="meta-category" value="${escAttr(doc.category || '')}">
      
      <label>${t('meta.tags')}</label>
      <div class="full">
        <div class="meta-tag-add">
          <input type="text" class="w-field" id="meta-tags-new" placeholder="${escAttr(t('meta.tagsAdd'))}" enterkeyhint="done">
          <button type="button" class="fb-btn" id="meta-tags-btn" title="${escAttr(t('meta.tagAddBtn'))}" aria-label="${escAttr(t('meta.tagAddBtn'))}">+</button>
        </div>
        <div class="form-tags-row" id="meta-tags-list"></div>
      </div>
    </div>
  `;

  renderMetaTags(doc.tags || []);

  // Live sync to doc (no save button needed per design)
  document.getElementById('meta-title').addEventListener('input', (e) => {
    doc.title = e.target.value.trim().slice(0, 120);
    renderTabs();
    document.title = t('app.name') + ' — ' + (doc.title || t('tab.untitled'));
    markDoc(doc, 'm');
  });

  document.getElementById('meta-author').addEventListener('input', (e) => {
    doc.author = e.target.value;
    markDoc(doc, 'm');
  });

  document.getElementById('meta-category').addEventListener('input', (e) => {
    doc.category = e.target.value;
    markDoc(doc, 'm');
  });

  // keydown + explicit button: Android keyboards rarely fire 'keypress'
  const tagInput = document.getElementById('meta-tags-new');
  const addTag = () => {
    const val = tagInput.value.trim();
    if (val && !(doc.tags || []).includes(val)) {
      doc.tags = doc.tags || [];
      doc.tags.push(val);
      renderMetaTags(doc.tags);
      markDoc(doc, 'm');
    }
    tagInput.value = '';
  };
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTag(); }
  });
  document.getElementById('meta-tags-btn').addEventListener('click', addTag);
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
        markDoc(d, 'm');
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
  const doc = ensureDoc();
  if (!PAPER_SIZES[doc.pageSize]) doc.pageSize = 'a4';
  const dm = (doc.margins && typeof doc.margins === 'object') ? doc.margins : {};
  doc.margins = {
    top:    Number.isFinite(+dm.top)    ? +dm.top    : 25,
    bottom: Number.isFinite(+dm.bottom) ? +dm.bottom : 25,
    left:   Number.isFinite(+dm.left)   ? +dm.left   : 25,
    right:  Number.isFinite(+dm.right)  ? +dm.right  : 25
  };

  pageDlg = openDialog(t('page.settings'), '', [
    { class: 'fb-btn', label: t('page.mReset'), onClick: resetMargins },
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => pageDlg.close() }
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
        <input type="number" class="w-field" id="m-top" aria-label="${t('page.mTop')}" min="0" max="100" value="${doc.margins.top}">
        <input type="number" class="w-field" id="m-right" aria-label="${t('page.mRight')}" min="0" max="100" value="${doc.margins.right}">
        <input type="number" class="w-field" id="m-bottom" aria-label="${t('page.mBottom')}" min="0" max="100" value="${doc.margins.bottom}">
        <input type="number" class="w-field" id="m-left" aria-label="${t('page.mLeft')}" min="0" max="100" value="${doc.margins.left}">
      </div>
      <div class="margins-labels full">
        <span>↑</span><span>→</span><span>↓</span><span>←</span>
      </div>

      <label>${t('page.header')}</label>
      <input type="text" class="w-field full" id="page-header" placeholder="${t('page.headFootNote')}" value="${escAttr(doc.header || '')}">

      <label>${t('page.footer')}</label>
      <input type="text" class="w-field full" id="page-footer" placeholder="${t('page.headFootNote')}" value="${escAttr(doc.footer || '')}">

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
    markDoc(doc, 'p');
  });

  ['top','right','bottom','left'].forEach(side => {
    const inp = document.getElementById('m-' + side);
    inp.addEventListener('input', () => {
      doc.margins[side] = Math.max(0, Math.min(100, parseInt(inp.value) || 0));
      updatePreview();
      markDoc(doc, 'p');
    });
  });

  document.getElementById('page-header').addEventListener('input', (e) => {
    doc.header = e.target.value;
    markDoc(doc, 'p');
  });

  document.getElementById('page-footer').addEventListener('input', (e) => {
    doc.footer = e.target.value;
    markDoc(doc, 'p');
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
    if (cap) cap.textContent = size.w === 'auto' ? t(size.label) : `${size.w}×${size.h} mm`;
  }
  updatePreview();
}

function resetMargins() {
  const doc = activeDoc();
  if (!doc) return;
  if (!doc.margins || typeof doc.margins !== 'object') doc.margins = {};
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
  markDoc(doc, 'p');
}

/* ----- TABLE OF CONTENTS (inline) ----- */
function insertInlineToc() {
  const toc = generateTocHTML();
  if (!toc) { showToast(t('toc.empty')); return; }
  const box = document.createElement('div');
  box.innerHTML = toc;
  insertNodeAtCursor(box.firstChild);
  scheduleSave();
}

// Unique, stable heading ids (one counter, collision-checked, persisted)
function ensureHeadingIds() {
  const used = new Set();
  let changed = false;
  EL.editor.querySelectorAll('h1,h2,h3,h4').forEach(h => {
    if (!h.id || used.has(h.id) || document.getElementById(h.id) !== h) {
      let id;
      do { id = 'h-' + Math.random().toString(36).slice(2, 8); }
      while (document.getElementById(id) || used.has(id));
      h.id = id;
      changed = true;
    }
    used.add(h.id);
  });
  if (changed) scheduleSave();
  return Array.from(EL.editor.querySelectorAll('h1,h2,h3,h4'))
    .map(h => ({ id: h.id, level: h.tagName.toLowerCase(),
                 text: h.textContent.trim() || t('toc.unnamed') }));
}

function generateTocHTML() {
  const headings = ensureHeadingIds();
  if (headings.length === 0) return null;

  let html = '<div class="toc-inline">';
  html += '<ol>';
  headings.forEach(h => {
    html += `<li class="toc-h${h.level.replace('h','')}"><a href="#${escAttr(h.id)}">${esc(h.text)}</a></li>`;
  });
  html += '</ol></div>';
  return html;
}

function toggleTocPanel() {
  const headings = ensureHeadingIds();

  if (headings.length === 0) {
    showToast(t('toc.empty'));
    return;
  }

  const dlg = openDialog(t('toc.title'), '', [
    { class: 'fb-btn', label: t('toc.insert'), onClick: () => { insertInlineToc(); dlg.close(); } },
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => dlg.close() }
  ]);

  const body = dlg.querySelector('.w-dialog-body');
  const ul = document.createElement('ul');
  ul.className = 'toc-list';
  headings.forEach(h => {
    const li = document.createElement('li');
    li.className = 'toc-item toc-' + h.level;
    li.innerHTML = `<span class="toc-level">${h.level.toUpperCase()}</span><span class="toc-title">${esc(h.text)}</span>`;
    li.addEventListener('click', () => {
      const target = document.getElementById(h.id);   // no selector parsing of ids
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

// R15: a built-in's html is a table key (tpl.builtin.<id>.html); the
// active language's text is used at insert time.
const TPL_BUILTIN = [
  { id: 'essay', builtin: true, name: 'tpl.builtin.essay', desc: 'tpl.builtin.essay.d', html: 'tpl.builtin.essay.html' },
  { id: 'letter', builtin: true, name: 'tpl.builtin.letter', desc: 'tpl.builtin.letter.d', html: 'tpl.builtin.letter.html' },
  { id: 'novel', builtin: true, name: 'tpl.builtin.novel', desc: 'tpl.builtin.novel.d', html: 'tpl.builtin.novel.html' },
  { id: 'screenplay', builtin: true, name: 'tpl.builtin.screenplay', desc: 'tpl.builtin.screenplay.d', html: 'tpl.builtin.screenplay.html' },
  { id: 'poem', builtin: true, name: 'tpl.builtin.poem', desc: 'tpl.builtin.poem.d', html: 'tpl.builtin.poem.html' },
  { id: 'notes', builtin: true, name: 'tpl.builtin.notes', desc: 'tpl.builtin.notes.d', html: 'tpl.builtin.notes.html' },
  { id: 'blank', builtin: true, name: 'tpl.builtin.blank', desc: 'tpl.builtin.blank.d', html: '' }
];

function tplHtml(tpl) {
  if (tpl.builtin) return tpl.html ? t(tpl.html) : '';
  return typeof tpl.html === 'string' ? tpl.html : '';
}

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
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => tplDlg.close() }
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
      createDoc({ html: tplHtml(tpl), title: tpl.builtin ? t(tpl.name) : tpl.name, silent: true });
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
        wConfirm(t('tpl.confirmDel').replace('{name}', tpl.name), { danger: true, ok: t('wx.delete') })
          .then(ok => {
            if (!ok) return;
            state.templates = state.templates.filter(x => x.id !== tpl.id);
            state.tplTombs = state.tplTombs || [];
            state.tplTombs.push({ id: tpl.id, ts: Date.now() });   // tombstone (R17)
            scheduleSave();
            if (tplDlg && tplDlg.open) renderTemplates();
            undoToast(t('tpl.deleted'), () => {
              // fresh mtime beats the tombstone (resurrection contract)
              state.templates.push(Object.assign({}, tpl, { mtime: Date.now() }));
              scheduleSave();
              if (tplDlg && tplDlg.open) renderTemplates();
            });
          });
      });
      actions.appendChild(del);
    } else {
      const badge = document.createElement('span');
      badge.className = 'tpl-badge';
      badge.textContent = t('tpl.builtinBadge');
      card.appendChild(badge);
    }

    card.appendChild(actions);
    grid.appendChild(card);
  });

  body.appendChild(grid);
}

function saveCurrentAsTemplate() {
  const doc = ensureDoc();
  flushSave();
  wPrompt(t('tpl.name'), doc.title || '').then(name => {
    if (!name) return;
    const existing = (state.templates || []).find(x => x.name === name);
    const go = existing ? wConfirm(t('tpl.confirmOverwrite')) : Promise.resolve(true);
    go.then(ok => {
      if (!ok) return;
      const tpl = {
        id: existing ? existing.id : 'tp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        desc: existing ? (existing.desc || '') : '',
        html: editorHTMLForSave(),
        mtime: Date.now()
      };
      if (existing) Object.assign(existing, tpl);
      else {
        state.templates = state.templates || [];
        state.templates.push(tpl);
      }
      scheduleSave();
      if (tplDlg && tplDlg.open) renderTemplates();
      showToast(t('tpl.saved'));
    });
  });
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
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => {
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
  downloadBlob(data, 'oros-writer-templates.json', 'application/json')
    .then(ok => { if (ok) showToast(t('tpl.exported')); });   // cancel = silent
}

function importTemplateJson() {
  // Wave 2: unified picker when the shell hosts orosDialog;
  // localPickFile keeps the app usable standalone.
  const host = dialogHost();
  const picked = host
    ? host.openFile('.json,application/json')
    : localPickFile('.json,application/json');
  picked.then(file => {
    if (!file) return;   // user cancelled — silent exit
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const arr = Array.isArray(parsed) ? parsed : parsed.orOSTemplates;
        if (!Array.isArray(arr)) throw new Error('bad');
        state.templates = state.templates || [];
        arr.forEach(tpl => {
          if (!tpl || typeof tpl.name !== 'string' || typeof tpl.html !== 'string') return;
          tpl.html = ioSanitizeHtml(tpl.html);
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
}

/* ----- VERSION HISTORY -----
   Per-doc versions: 8 auto (every 30s IF content changed) + unlimited-enough
   manual snapshots. Manual: green badge + dedicated delete. Restore puts
   back text AND footnotes AND comments. Lives inside doc (LWW sync).
   Distinct from orOS core DB snapshots — this is a document feature. */


function openVersionsPanel() {
  const doc = ensureDoc();
  flushSave();
  const dlg = openDialog(t('ver.title'), '', [
    { class: 'fb-btn', label: t('ver.snapshot'), onClick: () => {
        takeManualSnapshot(doc);
        renderVersions(dlg, doc);
      } },
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => dlg.close() }
  ]);
  renderVersions(dlg, doc);
}

function renderVersions(dlg, doc) {
  const body = dlg.querySelector('.w-dialog-body');
  body.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'io-note ver-note';
  note.textContent = t('ver.autoNote');
  body.appendChild(note);
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
      wConfirm(t('ver.confirmRestore')).then(ok => {
        if (!ok) return;
        restoreVersion(doc, v);
        if (dlg.open) renderVersions(dlg, doc);
      });
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
        wConfirm(t('ver.confirmDel'), { danger: true, ok: t('wx.delete') }).then(ok => {
          if (!ok) return;
          doc.versions = doc.versions.filter(x => x !== v);
          markDoc(doc, 'c');
          if (dlg.open) renderVersions(dlg, doc);   // immediate UI removal
        });
      });
      acts.appendChild(del);
    }

    li.appendChild(acts);
    ul.appendChild(li);
  });

  body.appendChild(ul);
}

function countWordsInHtml(html) {
  const tmp = ioInertDiv();   // inert: a version's markup never loads or fires here
  tmp.innerHTML = html || '';
  // strip annotation chrome before counting
  tmp.querySelectorAll('sup.fn-ref').forEach(x => x.remove());
  const words = tmp.textContent.trim().split(/\s+/).filter(Boolean);
  // beta bug fix: punctuation between spaces ('word - word') is NOT a word
  return words.filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

// Auto versions ride the save pipeline (no idle timers — battery rule):
// flushSave() calls this only when the html really changed. At most one
// auto version per AUTO_VER_MS; capVersions() keeps the newest 8.
const AUTO_VER_MS = 5 * 60 * 1000;

function autoVersionTick(doc) {
  const vers = Array.isArray(doc.versions) ? doc.versions : (doc.versions = []);
  let lastAuto = null;
  for (let i = vers.length - 1; i >= 0; i--) { if (!vers[i].manual) { lastAuto = vers[i]; break; } }
  if (lastAuto && Date.now() - lastAuto.ts < AUTO_VER_MS) return;
  const last = vers.length ? vers[vers.length - 1] : null;
  if (!doc.html || (last && last.html === doc.html)) return;
  vers.push({ ts: Date.now(), html: doc.html, manual: false,
    footnotes: JSON.parse(JSON.stringify(doc.footnotes || [])),
    comments: JSON.parse(JSON.stringify(doc.comments || [])) });
  doc.versions = capVersions(vers);
}

function takeManualSnapshot(doc) {
  flushSave();
  doc.versions = doc.versions || [];
  doc.versions.push({ ts: Date.now(), html: doc.html || '', manual: true,
    footnotes: JSON.parse(JSON.stringify(doc.footnotes || [])),
    comments: JSON.parse(JSON.stringify(doc.comments || [])) });
  markDoc(doc, 'c');
  showToast(t('ver.snapshotted'));
}

function restoreVersion(doc, v) {
  // Full-fidelity restore: text + footnotes + comments
  // Snapshot the CURRENT state first (safety — restoring is undoable via its own entry)
  takeManualSnapshot(doc);
  // takeManualSnapshot() re-armed the debounce: the old flushSave()
  // here re-read the OLD editor into doc.html → restore was a no-op.
  clearTimeout(saveTimer);
  dirty = false;

  doc.html = v.html || '';
  // Versions taken after this fix carry their annotations; older ones
  // keep the current entries (comment marks unwrap, text survives).
  if (Array.isArray(v.footnotes)) doc.footnotes = JSON.parse(JSON.stringify(v.footnotes));
  if (Array.isArray(v.comments))  doc.comments  = JSON.parse(JSON.stringify(v.comments));
  stampDoc(doc, 'c');

  renderEditor();            // editor + footnote/comment panels + goal bar
  renderTabs();
  dirty = true;
  flushSave();               // persist + markDirty with the RESTORED html
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

// device-local runtime: per doc, the goal signature already celebrated
// (survives tab switches and sync re-renders — the toast fires once)
let goalRuntime = { firedFor: {} };
let goalRaf = 0;

/* ----- Stats (shared with the goal bar) ----- */
function editorStats() {
  // Walk the live DOM (no clone per keystroke). Words never merge across
  // blocks or <br>, and never split across inline formatting.
  const BLK = /^(P|DIV|LI|H1|H2|H3|H4|BLOCKQUOTE|PRE|TD|TH|FIGCAPTION|TABLE|UL|OL)$/;
  let text = '';
  const walker = document.createTreeWalker(EL.editor,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => (n.nodeType === 1 && n.matches('sup.fn-ref'))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeType === 3) text += n.nodeValue;
    else if (n.nodeName === 'BR' || BLK.test(n.nodeName)) text += '\n';
  }
  const words = text.trim().split(/\s+/).filter(Boolean)
    .filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  let paras = 0;
  Array.from(EL.editor.childNodes).forEach(n => {
    if (n.nodeType === 3) { if (n.nodeValue.trim()) paras++; return; }
    if (n.nodeType === 1 && /^(P|DIV)$/.test(n.nodeName) &&
        !n.classList.contains('page-break-marker') &&
        !n.classList.contains('toc-inline') && n.textContent.trim()) paras++;
  });
  return { words: words, chars: text.replace(/\s+/g, ' ').trim().length, paras: paras };
}

/* ----- Toggle / render the bar ----- */
function toggleGoalBar() {
  openGoalDialog();
}

function openGoalDialog() {
  const doc = ensureDoc();
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
      <input type="number" class="w-field" id="g-target" min="1" value="${Number(g.target) || 500}">
      <label class="full" style="text-align:left;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="g-lock" ${g.lock?'checked':''}> ${t('goal.lock')}
      </label>
    </div>
  `, [
    { class: 'fb-btn', label: t('goal.clear'), onClick: () => {
        doc.goal = null;
        delete goalRuntime.firedFor[doc.id];
        markDoc(doc, 'g');
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
        delete goalRuntime.firedFor[doc.id];
        markDoc(doc, 'g');
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
  if (!doc || !doc.goal) { bar.hidden = true; unlockEditor(); return; }

  const p = goalProgress(doc.goal);
  bar.classList.toggle('done', p.done);

  const label = document.getElementById('goal-label');
  label.textContent = p.done ? t('goal.done') : t('tt.goal');

  // stats INLINE next to the label (requirement — not a separate block)
  document.getElementById('goal-stats').textContent = p.statsLabel + ' · ' + p.pct + '%';
  document.getElementById('goal-fill').style.width = p.pct + '%';

  // Lock button shows the ARMED state (it can be armed before the goal)
  const lockBtn = document.getElementById('goal-lock');
  lockBtn.classList.toggle('on', !!doc.goal.lock);
  lockBtn.title = doc.goal.lock ? t('goal.lockArmed') : t('goal.lock');

  // Achieved: celebrate ONCE per goal (in-context → transient, not inbox)
  const sig = doc.goal.type + '|' + doc.goal.target + '|' + (doc.goal.startTs || 0);
  if (p.done && goalRuntime.firedFor[doc.id] !== sig) {
    goalRuntime.firedFor[doc.id] = sig;
    const typeStr = {
      words: t('goal.type.words'), chars: t('goal.type.chars'),
      paras: t('goal.type.paras'), time: t('goal.type.time'),
      sessionWords: t('goal.type.sessionWords')
    }[doc.goal.type];
    showToast(t('goal.done.msg')
      .replace('{type}', typeStr)
      .replace('{cur}', String(p.cur))
      .replace('{target}', String(doc.goal.target)));
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
  const clrBtn = document.getElementById('goal-clear');
  if (lockBtn) lockBtn.innerHTML = ICONS.lock;
  if (clrBtn) clrBtn.innerHTML = ICONS.close;

  lockBtn.addEventListener('click', () => {
    const doc = activeDoc();
    if (!doc || !doc.goal) return;
    const p = goalProgress(doc.goal);
    if (p.done && doc.goal.lock) {
      wConfirm(t('goal.unlockConfirm')).then(ok => {
        if (!ok) return;
        doc.goal.lock = false;
        markDoc(doc, 'g');
        updateGoalBar();
      });
      return;
    }
    doc.goal.lock = !doc.goal.lock;      // arming before the goal is allowed
    markDoc(doc, 'g');
    updateGoalBar();
    if (doc.goal.lock && !p.done) showToast(t('goal.lockArmed'));
  });

  clrBtn.addEventListener('click', () => {
    const doc = activeDoc();
    if (!doc) return;
    doc.goal = null;
    delete goalRuntime.firedFor[doc.id];
    markDoc(doc, 'g');
    document.getElementById('goal-bar').hidden = true;
    unlockEditor();
  });

  // Hard input block when locked (typing); toolbar paths use isLocked()
  EL.editor.addEventListener('beforeinput', (e) => {
    if (EL.editor.dataset.goalLocked) {
      e.preventDefault();
      lockToast();
    }
  });
  // Drops and pastes do not always raise a cancelable beforeinput
  ['paste', 'drop', 'cut'].forEach(ev => EL.editor.addEventListener(ev, (e) => {
    if (EL.editor.dataset.goalLocked) { e.preventDefault(); lockToast(); }
  }));
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
  if (goalRaf) return;                       // coalesce bursts into one frame
  goalRaf = requestAnimationFrame(() => {
    goalRaf = 0;
    const doc = activeDoc();
    const bar = document.getElementById('goal-bar');
    if (doc && doc.goal && !bar.hidden) updateGoalBar();
    updateReadingProgress();
  });
}

function goalAfterRender() {
  const doc = activeDoc();
  const bar = document.getElementById('goal-bar');
  if (doc && doc.goal) { bar.hidden = false; updateGoalBar(); }
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

// Chrome's contenteditable writes lines as <div> (or bare text at the
// root): normalise once → every exporter sees real <p> blocks.
// The pure import / .orosdoc code lives in io.js (window.WriterIO),
// shared with convert.js (the Converter); these are thin wrappers.
function ioNormalizeBlocks(container) { return WriterIO.normalizeBlocks(container); }

/* Shared list flattener for every exporter: [{depth, ordered, marker,
   body}] — body = the <li> WITHOUT its nested lists (no duplication). */
function ioListItems(listEl, depth, out) {
  out = out || [];
  let n = 1;
  Array.from(listEl.children).forEach(li => {
    if (li.nodeName !== 'LI') return;
    const ordered = listEl.nodeName === 'OL';
    const body = li.cloneNode(true);
    Array.from(body.children).forEach(c => { if (/^(UL|OL)$/.test(c.nodeName)) c.remove(); });
    out.push({ depth: depth, ordered: ordered, marker: ordered ? (n++) + '.' : '\u2022', body: body });
    Array.from(li.children).forEach(c => {
      if (/^(UL|OL)$/.test(c.nodeName)) ioListItems(c, depth + 1, out);
    });
  });
  return out;
}

// Tracked changes (wave 22): every format but DOCX (w:ins / w:del)
// exports the text as if all changes were accepted, with a notice.
function ioExportClone(opts) {
  let html = editorHTMLForSave();
  if (!(opts && opts.keepTracked) && window.WriterTrack && WriterTrack.hasChanges(html)) {
    html = WriterTrack.resolveHtml(html, 'accept');
    showToast(t('tc.exportNote'));
  }
  return ioCloneOf(html);
}
function ioCloneOf(html) {
  const c = document.createElement('div');
  c.innerHTML = html;
  return ioNormalizeBlocks(c);
}

function ioUnwrap(el) { WriterIO.unwrap(el); }

/* ----- PLAIN TEXT (TXT) ----- */
function ioWalkText(n) {
  let out = '';
  const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  (function walk(node) {
    Array.from(node.childNodes).forEach(ch => {
      if (ch.nodeType === 3) { out += ch.nodeValue; return; }
      if (ch.nodeName === 'BR') { out += '\n'; return; }
      if (ch.nodeName === 'HR') { nl(); out += '\n'; return; }
      if (ch.nodeType === 1 && ch.classList && ch.classList.contains('page-break-marker')) {
        nl(); out += '\n'; return;
      }
      if (ch.nodeName === 'LI') {
        // list items: one line each, indented by nesting depth
        let depth = 0, p = ch.parentElement;
        while (p && p !== n) { if (/^(UL|OL)$/.test(p.nodeName)) depth++; p = p.parentElement; }
        const par = ch.parentElement;
        const marker = (par && par.nodeName === 'OL')
          ? (Array.from(par.children).filter(x => x.nodeName === 'LI').indexOf(ch) + 1) + '. '
          : '- ';
        nl();
        out += '  '.repeat(Math.max(0, depth - 1)) + marker;
        walk(ch);
        nl();
        return;
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
  // 3-space indent per level: valid under both "- " and "1. " parents
  return ioListItems(listEl, depth).map(it =>
    '   '.repeat(it.depth) + (it.ordered ? it.marker + ' ' : '- ') +
    ioInlineMd(it.body).replace(/\s*\n\s*/g, ' ').trim()
  ).join('\n') + '\n';
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
  return WriterIO.standaloneHtml(doc, ioExportClone(), window.orosLang === 'el' ? 'el' : 'en', t('tab.untitled'));
}

/* ----- OROSDOC (round-trip archive) ----- */
function ioBuildOrosDoc(doc) {
  flushSave();
  return JSON.stringify(WriterIO.docContent(doc), null, 2);
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
/* ----- .orosdoc = an orOS bundle (bundle.js, docs/oros-bundle.md) -----
   content.json holds the document; pictures leave the HTML for
   media/<sha256>.<ext> (src="media/…" in content.json), and
   preview/document.html is the standalone page with ../media/
   pictures, so the unzipped folder reads in any browser. Older JSON
   .orosdoc files still open. */
const IO_BUNDLE_MIME = 'application/x-oros-doc';
// src="media/<key>" → data: URL again (raster pictures only, typed by their bytes)
function ioDropImages(html, media) { return WriterIO.dropImages(html, media); }
function ioExportOrosDoc(doc) {
  const obj = JSON.parse(ioBuildOrosDoc(doc));
  return WriterIO.writeBundle(obj, doc, ioToStandaloneHTML(doc), window.orosLang === 'el' ? 'el' : 'en')
    .then(bytes => downloadBlob(bytes, ioBaseName(doc) + '.orosdoc', IO_BUNDLE_MIME),
      () => showToast(t('io.exportfailed')));
}
function ioExportJSON() {
  flushSave();
  downloadBlob(JSON.stringify(serialize(), null, 2),
    'oros-writer-database.json', 'application/json');
}

/* ----- EXPORT DIALOG ----- */
function openExportDialog() {
  const doc = activeDoc();   // null on a blank page → only the DB export applies

  const dlg = openDialog(t('io.title.exp'), '', [
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => dlg.close() }
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

  if (!doc) {                            // say WHY most rows are disabled
    const why = document.createElement('div');
    why.className = 'io-note';
    why.style.marginTop = '0';
    why.textContent = t('io.needDoc');
    body.appendChild(why);
  }

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
    if (!doc && f.ext !== 'json') {
      row.disabled = true;
      row.classList.add('io-row-disabled');
      row.title = t('io.needDoc');
    } else {
      row.addEventListener('click', () => {
        try { f.fn(); }
        catch (err) {                       // never fail silently
          console.error('[writer] export ' + f.ext + ' failed:', err);
          showToast(t('io.exportfailed'));
        }
      });
    }
    list.appendChild(row);

    if (f.note) {
      const nt = document.createElement('div');
      nt.className = 'io-note';
      nt.textContent = '· ' + t(f.note);
      list.appendChild(nt);
    }
  });
  body.appendChild(list);

  // Metadata rides along (transparent to the user)
  const chips = [];
  if (doc && doc.author) chips.push(doc.author);
  if (doc && doc.category) chips.push(doc.category);
  ((doc && doc.tags) || []).forEach(tag => chips.push('#' + tag));
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

  // Wave 2 (B-lite): pre-warm the PDF vendors while the user chooses
  // a format, so the later saveFile() native-picker call happens well
  // inside the transient-activation window. Silent on failure — the
  // PDF export surfaces its own error if actually used.
  ioLoadScript(IO_VENDOR_JSPDF)
    .then(() => ioPdfFonts())
    .catch(function () { /* PDF export will report if needed */ });
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
        ioListItems(ch, 0).forEach(it => {
          const li = 567 * (it.depth + 1);
          out += '\\pard\\fi-284\\li' + li + '\\sa120 ' +
                 rtfEsc((it.ordered ? it.marker : '\u2022') + ' ') +
                 rtfInlineRe(it.body, {}) + '\\par\n';
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
      app.push('\\pard\\sb240\\b\\fs24 ' + rtfEsc(t('io.notes')) + '\\par\n');
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
      app.push('\\pard\\sb240\\b\\fs24 ' + rtfEsc(t('io.comments')) + '\\par\n');
      doc.comments.forEach(cm => {
        app.push('\\pard\\sa120 ' +
          rtfEsc('\u201C' + (cm.quote || '') + '\u201D \u2014 ' + (cm.text || '')) +
          '\\par\n');
      });
    }
    if (app.length) body += '\\page\n' + app.join('');
    // \pard resets paragraph props ONLY — character props (\b\fs40 of
    // a heading, \f0 of code) leaked into every following paragraph.
    body = body.replace(/\\pard/g, '\\pard\\plain\\f1\\fs22 ');

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
    const utf8 = /[^\x00-\x7f]/.test(f.name) ? 0x0800 : 0;   // bit 11: UTF-8 name (mail merge)
    lh.setUint16(6, utf8, true);         // flags
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
    cd.setUint16(8, utf8, true);         // flags
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
  const tag = pr.del ? 'w:delText' : 'w:t';     // text of a tracked deletion
  return '<w:r>' + (rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '') +
         '<' + tag + ' xml:space="preserve">' +
         esc(String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')) +
         '</' + tag + '></w:r>';
}

let dxTcN = 0;   // w:id of tracked changes, unique per file
function dxRuns(node, pr) {
  let out = '';
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) {
      out += dxRun(ch.nodeValue.replace(/[\r\n\t]+/g, ' '), pr);
      return;
    }
    // tracked change (wave 22) → <w:ins> / <w:del> around its runs
    if ((ch.nodeName === 'INS' || ch.nodeName === 'DEL') && ch.classList.contains('tc') &&
        window.WriterTrack && !pr.tc) {
      const kind = ch.nodeName === 'DEL' ? 'del' : 'ins';
      out += WriterTrack.docxOpen(kind, ++dxTcN, ch.getAttribute('data-au'), ch.getAttribute('data-ts')) +
             dxRuns(ch, Object.assign({}, pr, { tc: true, del: kind === 'del' })) +
             WriterTrack.docxClose(kind);
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
        ioListItems(ch, 0).forEach(it => {
          out += dxPara(dxRun(it.marker + ' ', {}) + dxRuns(it.body, {}),
                        { ind: 567 * (it.depth + 1) });
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
    const c = ioExportClone({ keepTracked: true });   // tracked changes → w:ins / w:del
    c.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);
    const pg = ioPageSizeMm(doc);

    dxTcN = 0;
    let body = dxBlocks(c);

    // Footnotes / comments appendix
    const app = [];
    if ((doc.footnotes || []).length) {
      app.push(dxPara(dxRun(t('io.notes'), { b: true }), { style: 'Heading2' }));
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
      app.push(dxPara(dxRun(t('io.comments'), { b: true }), { style: 'Heading2' }));
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
// jsPDF and the Noto fonts load ON DEMAND (PDF only) — boot stays clean.
// Fonts (all precached by sw.js, no network): the full NotoSans-Regular
// (Latin, Greek, Cyrillic…) and the Latin + Greek subsets of Noto Sans
// Bold / Italic / Bold Italic / Mono in vendor/noto/. A word that a
// subset can't draw falls back to Regular (bold then drawn as fill +
// stroke, a synthetic bold). Kept: headings, bold / italic / underline /
// strikethrough, links (clickable), superscript, alignment, lists with
// hanging indents, quotes, code, tables (grid, header row), images,
// page size and margins, header / footer, page numbers.

// Root-level vendor/ (sw.js precaches "vendor/…" at the SW scope).
// From writer/index.html that is "../vendor/…". NO query string: the SW
// matches precache entries by EXACT URL — a cache-buster made the PDF
// export fail offline.
const IO_VENDOR_JSPDF = '../vendor/jspdf.umd.min.js';
const IO_VENDOR_NOTO  = '../vendor/NotoSans-Regular.ttf';
const IO_PDF_FONTS = {
  normal:     IO_VENDOR_NOTO,
  bold:       '../vendor/noto/NotoSans-Bold.ttf',
  italic:     '../vendor/noto/NotoSans-Italic.ttf',
  bolditalic: '../vendor/noto/NotoSans-BoldItalic.ttf',
  mono:       '../vendor/noto/NotoSansMono-Regular.ttf'
};

let ioJspdfPromise = null;
function ioLoadScript(src) {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
  if (ioJspdfPromise) return ioJspdfPromise;
  ioJspdfPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.ioVendor = 'jspdf';
    s.onload = () => (window.jspdf && window.jspdf.jsPDF)
      ? res() : rej(new Error('jsPDF missing after load'));
    s.onerror = () => { s.remove(); rej(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  }).catch(err => { ioJspdfPromise = null; throw err; });   // retry possible
  return ioJspdfPromise;
}

const ioFontB64 = {};   // url → base64, in memory per session
function ioFetchFontB64(url) {
  if (ioFontB64[url]) return Promise.resolve(ioFontB64[url]);
  return fetch(url)
    .then(r => { if (!r.ok) throw new Error('font http ' + r.status); return r.arrayBuffer(); })
    .then(buf => {
      const u8 = new Uint8Array(buf);
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < u8.length; i += CHUNK)
        bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
      ioFontB64[url] = btoa(bin);
      return ioFontB64[url];
    });
}

// Regular is required; the other faces are optional (null → fallback).
function ioPdfFonts() {
  const keys = Object.keys(IO_PDF_FONTS);
  return Promise.all(keys.map(k => k === 'normal'
    ? ioFetchFontB64(IO_PDF_FONTS[k])
    : ioFetchFontB64(IO_PDF_FONTS[k]).catch(() => null)))
    .then(list => { const o = {}; keys.forEach((k, i) => { o[k] = list[i]; }); return o; });
}

function ioSafeHref(h) {
  const v = String(h || '').trim();
  return /^(https?:|mailto:)/i.test(v) ? v : '';
}

const IO_RUN_BLOCK = /^(P|DIV|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|LI)$/;

/* Collect inline runs [{text,b,i,u,strike,sup,sub,mono,link} | {br} | {img}] */
function ioCollectRuns(node, fmt, out) {
  Array.from(node.childNodes).forEach(ch => {
    if (ch.nodeType === 3) { out.push(Object.assign({ text: ch.nodeValue }, fmt)); return; }
    if (ch.nodeType !== 1) return;
    if (ch.nodeName === 'BR') { out.push({ text: '\n', br: true }); return; }
    if (ch.nodeName === 'IMG') { out.push({ img: ch }); return; }
    if (ch.classList && ch.classList.contains('page-break-marker')) return;
    // a block inside a list item or cell starts on its own line
    if (IO_RUN_BLOCK.test(ch.nodeName) && out.length && !out[out.length - 1].br) out.push({ text: '\n', br: true });
    const f = Object.assign({}, fmt);
    const map = { STRONG: 'b', B: 'b', EM: 'i', I: 'i', U: 'u', INS: 'u',
                  DEL: 'strike', S: 'strike', STRIKE: 'strike', SUP: 'sup', SUB: 'sub',
                  CODE: 'mono', KBD: 'mono', TT: 'mono' };
    if (map[ch.nodeName]) f[map[ch.nodeName]] = true;
    if (/^H[1-6]$/.test(ch.nodeName) || ch.nodeName === 'TH') f.b = true;
    if (ch.nodeName === 'A') { const h = ioSafeHref(ch.getAttribute('href')); if (h) f.link = h; }
    const st = ch.style;
    if (st) {
      const fw = st.fontWeight;
      if (fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600) f.b = true;
      else if (fw === 'normal' || (parseInt(fw, 10) > 0 && parseInt(fw, 10) < 600)) f.b = false;
      if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') f.i = true;
      const td = (st.textDecorationLine || st.textDecoration || '');
      if (/underline/.test(td)) f.u = true;
      if (/line-through/.test(td)) f.strike = true;
      if (st.verticalAlign === 'super') f.sup = true;
      if (st.verticalAlign === 'sub') f.sub = true;
    }
    ioCollectRuns(ch, f, out);
  });
}

function ioAlignOf(el) {
  let a = '';
  for (let n = el; n && n.nodeType === 1 && !a; n = n.parentElement) {
    a = (n.style && n.style.textAlign) || n.getAttribute('align') || '';
    if (n.nodeName === 'TD' || n.nodeName === 'TH' || n.classList.contains('io-root')) break;
  }
  a = String(a).toLowerCase();
  if (a === 'start') a = 'left';
  if (a === 'end') a = 'right';
  return /^(left|center|right|justify)$/.test(a) ? a : 'left';
}

// An image ready for jsPDF: { data, fmt, w, h } (px) or null. data: URLs
// of JPEG/PNG go in as they are; anything else is redrawn on a canvas
// (an image from another site that does not allow it stays a placeholder).
function ioPdfImage(src) {
  return new Promise(resolve => {
    src = String(src || '');
    if (!src || ioBadUrl(src)) { resolve(null); return; }
    const im = new Image();
    if (!/^data:/i.test(src)) im.crossOrigin = 'anonymous';
    let done = false;
    const fin = v => { if (!done) { done = true; clearTimeout(tm); resolve(v); } };
    const tm = setTimeout(() => fin(null), 10000);
    im.onload = () => {
      const w = im.naturalWidth, h = im.naturalHeight;
      if (!w || !h) { fin(null); return; }
      const m = /^data:image\/(jpeg|jpg|png);base64,/i.exec(src);
      if (m) { fin({ data: src, fmt: /png/i.test(m[1]) ? 'PNG' : 'JPEG', w: w, h: h }); return; }
      try {
        const k = Math.min(1, 2000 / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(im, 0, 0, c.width, c.height);
        fin({ data: c.toDataURL('image/jpeg', 0.9), fmt: 'JPEG', w: w, h: h });
      } catch (e) { fin(null); }    // tainted canvas
    };
    im.onerror = () => fin(null);
    im.src = src;
  });
}

function ioExportPdf(doc) {
  flushSave();
  showToast(t('io.busy'));
  ioBuildPdf(doc)
    .then(b => downloadBlob(b, ioBaseName(doc) + '.pdf', 'application/pdf'))
    .catch(err => {
      console.error('[orOS] writer PDF export failed:', err);
      showToast(t('io.exportfailed'));
    });
}

// The PDF of a document as a Blob. html: other content to lay out
// with the document's page settings (mail merge); default: the editor.
function ioBuildPdf(doc, html) {
  const c = html == null ? ioExportClone() : ioCloneOf(html);
  c.classList.add('io-root');
  c.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);
  const imgEls = Array.from(c.querySelectorAll('img'));
  const imgData = new Map();
  return ioLoadScript(IO_VENDOR_JSPDF)
    .then(() => Promise.all([
      ioPdfFonts(),
      Promise.all(imgEls.map(im => ioPdfImage(im.getAttribute('src')).then(v => imgData.set(im, v))))
    ]))
    .then(([fonts]) => {
      const JsPDF = window.jspdf.jsPDF;
      const pg = ioPageSizeMm(doc);
      const pdf = new JsPDF({ unit: 'mm', format: [pg.w, pg.h], compress: true });
      try {
        pdf.setProperties({ title: doc.title || '', author: doc.author || '',
          keywords: (doc.tags || []).join(', '), subject: doc.category || '', creator: 'orOS Writer' });
      } catch (e) { /* metadata is optional */ }

      // Fonts: family "noto" (4 styles) + "notomono"
      const have = { normal: true, bold: false, italic: false, bolditalic: false, mono: false };
      pdf.addFileToVFS('NotoSans-Regular.ttf', fonts.normal);
      pdf.addFont('NotoSans-Regular.ttf', 'noto', 'normal');
      ['bold', 'italic', 'bolditalic'].forEach(st => {
        const file = 'NotoSans-' + st + '.ttf';
        if (fonts[st]) {
          try { pdf.addFileToVFS(file, fonts[st]); pdf.addFont(file, 'noto', st); have[st] = true; } catch (e) { have[st] = false; }
        }
        if (!have[st]) pdf.addFont('NotoSans-Regular.ttf', 'noto', st);
      });
      if (fonts.mono) {
        try { pdf.addFileToVFS('NotoSansMono.ttf', fonts.mono); pdf.addFont('NotoSansMono.ttf', 'notomono', 'normal'); have.mono = true; } catch (e) { have.mono = false; }
      }
      pdf.setFont('noto', 'normal');

      const cmaps = {};
      function cmapOf(fam, st) {
        const key = fam + '/' + st;
        if (!(key in cmaps)) {
          let cm = null;
          try {
            const f = pdf.getFont(fam, st);
            cm = f && f.metadata && f.metadata.cmap && f.metadata.cmap.unicode && f.metadata.cmap.unicode.codeMap;
          } catch (e) { cm = null; }
          cmaps[key] = cm || null;
        }
        return cmaps[key];
      }
      function covers(fam, st, text) {
        const cm = cmapOf(fam, st);
        if (!cm) return true;
        for (const ch of text) {
          const cp = ch.codePointAt(0);
          if (cp > 32 && !cm[cp]) return false;
        }
        return true;
      }

      const PT = 25.4 / 72;                 // mm per point
      const ML = doc.margins.left, MR = doc.margins.right;
      const MT = doc.margins.top, MB = doc.margins.bottom;
      const CW = pg.w - ML - MR;            // content width
      const BOTTOM = pg.h - MB;
      let y = MT;                           // top of the next line

      const newPage = () => { pdf.addPage([pg.w, pg.h]); y = MT; };
      const need = h => { if (y + h > BOTTOM && y > MT + 0.01) newPage(); };

      const styleOf = r => (r.b && r.i) ? 'bolditalic' : r.b ? 'bold' : r.i ? 'italic' : 'normal';

      // Sets the font for one word; returns { size, synth }.
      function useFont(r, fs, text) {
        const size = (r.sup || r.sub) ? fs * 0.68 : fs;
        let fam = 'noto', st = styleOf(r), synth = false;
        if (r.mono && have.mono && covers('notomono', 'normal', text)) { fam = 'notomono'; st = 'normal'; }
        else if (st !== 'normal' && !(have[st] && covers('noto', st, text))) { synth = !!r.b; st = 'normal'; }
        pdf.setFont(fam, st);
        pdf.setFontSize(size);
        return { size: size, synth: synth };
      }

      // Words of a run list (images and breaks are handled by the caller)
      function tokenize(runs, fs, maxW) {
        const toks = [];
        let pend = false, first = true;
        runs.forEach(r => {
          if (r.br) { toks.push({ br: true }); pend = false; first = true; return; }
          String(r.text || '').split(/(\s+)/).forEach(piece => {
            if (!piece) return;
            if (/^\s+$/.test(piece)) { pend = true; return; }
            useFont(r, fs, piece);
            const w = pdf.getTextWidth(piece);
            if (w <= maxW) toks.push({ t: piece, r: r, w: w, sp: pend && !first });
            else {                          // a word wider than the line: cut it
              let cur = '', cw = 0, k = 0;
              for (const ch of piece) {
                const chw = pdf.getTextWidth(ch);
                if (cur && cw + chw > maxW) {
                  toks.push({ t: cur, r: r, w: cw, sp: k === 0 ? (pend && !first) : true, cut: k > 0 });
                  cur = ''; cw = 0; k++;
                }
                cur += ch; cw += chw;
              }
              if (cur) toks.push({ t: cur, r: r, w: cw, sp: k === 0 ? (pend && !first) : true, cut: k > 0 });
            }
            pend = false; first = false;
          });
        });
        return toks;
      }

      function drawLine(toks, line, x0, top, maxW, o) {
        const fs = o.fs, lh = o.lh;
        const al = WC.alignLine(line, maxW, o.align);
        const base = top + (lh - fs * PT) / 2 + fs * PT * 0.8;
        let x = x0 + al.x, prev = null;
        for (let k = line.from; k < line.to; k++) {
          const tk = toks[k];
          if (tk.br) continue;
          let gap = 0;
          if (k > line.from && tk.sp && !tk.cut) gap = o.spaceW + al.extra;
          x += gap;
          const f = useFont(tk.r, fs, tk.t);
          const col = tk.r.link ? '#1a4fb5' : (o.color || '#1a1a1a');
          pdf.setTextColor(col);
          const dy = tk.r.sup ? -fs * PT * 0.33 : (tk.r.sub ? fs * PT * 0.15 : 0);
          if (f.synth) {
            pdf.setDrawColor(col);
            pdf.setLineWidth(f.size * 0.018);
            pdf.text(tk.t, x, base + dy, { renderingMode: 'fillThenStroke' });
          } else pdf.text(tk.t, x, base + dy, { renderingMode: 'fill' });
          const under = tk.r.u || tk.r.link;
          if (under || tk.r.strike) {
            pdf.setDrawColor(col);
            pdf.setLineWidth(Math.max(0.15, fs * 0.006));
            const sx = (prev && gap && ((under && (prev.r.u || prev.r.link)))) ? x - gap : x;
            if (under) pdf.line(sx, base + dy + fs * PT * 0.12, x + tk.w, base + dy + fs * PT * 0.12);
            if (tk.r.strike) {
              const sx2 = (prev && gap && prev.r.strike) ? x - gap : x;
              pdf.line(sx2, base + dy - fs * PT * 0.28, x + tk.w, base + dy - fs * PT * 0.28);
            }
          }
          if (tk.r.link) {
            try { pdf.link(x, base - fs * PT * 0.8, tk.w, fs * PT, { url: tk.r.link }); } catch (e) {}
          }
          x += tk.w;
          prev = tk;
        }
        return base;
      }

      function drawImage(el, x, maxW, align) {
        const d = imgData.get(el);
        const alt = el.getAttribute('alt') || '';
        if (!d) {
          writeRuns([{ text: alt ? '[' + alt + ']' : '[▣]', i: true }], { x: x, w: maxW, fs: 9.5, color: '#777777', align: align, after: 0 });
          return;
        }
        const box = WC.fitBox(d.w, d.h, maxW, BOTTOM - MT);
        need(box.h);
        const ix = x + (align === 'center' ? (maxW - box.w) / 2 : align === 'right' ? maxW - box.w : 0);
        try { pdf.addImage(d.data, d.fmt, ix, y, box.w, box.h, undefined, 'FAST'); }
        catch (e) { writeRuns([{ text: '[▣]', i: true }], { x: x, w: maxW, fs: 9.5, color: '#777777', after: 0 }); return; }
        y += box.h + 1;
      }

      /* Paragraph writer: runs → lines (WriterCore.breakLines), page
         breaks between lines, optional hanging marker and quote bar. */
      function writeRuns(runs, o) {
        o = o || {};
        const fs = o.fs || 11;
        const lh = fs * PT * (o.lhK || 1.5);
        const x0 = o.x != null ? o.x : ML;
        const maxW = o.w != null ? o.w : (pg.w - MR - x0);
        const align = o.align || 'left';
        pdf.setFont('noto', 'normal'); pdf.setFontSize(fs);
        const spaceW = pdf.getTextWidth(' ');
        // split around images: text, image, text…
        const parts = [[]];
        runs.forEach(r => { if (r.img) parts.push(r, []); else parts[parts.length - 1].push(r); });
        let markerDone = !o.marker;
        parts.forEach((part, pi) => {
          if (!Array.isArray(part)) { drawImage(part.img, x0, maxW, align); return; }
          const hasText = part.some(r => r.br || /\S/.test(r.text || ''));
          if (!hasText && parts.length > 1) return;   // only the image(s)
          const toks = tokenize(part, fs, maxW);
          const lines = WC.breakLines(toks, maxW, spaceW);
          lines.forEach(line => {
            need(lh);
            if (o.bar) {
              pdf.setDrawColor('#bbbbbb'); pdf.setLineWidth(0.6);
              pdf.line(o.bar, y, o.bar, y + lh);
            }
            if (o.shade) {
              pdf.setFillColor(o.shade);
              pdf.rect(x0 - 1.5, y, maxW + 3, lh, 'F');
            }
            const base = drawLine(toks, line, x0, y, maxW,
              { fs: fs, lh: lh, align: align, spaceW: spaceW, color: o.color });
            if (!markerDone) {
              pdf.setFont('noto', o.markerBold ? (have.bold ? 'bold' : 'normal') : 'normal');
              pdf.setFontSize(fs);
              pdf.setTextColor(o.color || '#1a1a1a');
              pdf.text(o.marker, o.markerX, base, { renderingMode: 'fill' });
              markerDone = true;
            }
            y += lh;
          });
          if (pi < parts.length - 1) y += 0.5;
        });
        y += (o.after != null ? o.after : fs * PT * 0.45);
      }

      function writeTable(tbl, x0, maxW) {
        const rows = Array.from(tbl.rows);
        if (!rows.length) return;
        const ncol = Math.max.apply(null, rows.map(r => r.cells.length)) || 1;
        const lens = [];
        for (let ci = 0; ci < ncol; ci++) {
          lens.push(Math.max.apply(null, rows.map(r => r.cells[ci] ? r.cells[ci].textContent.trim().length : 0)));
        }
        const widths = WC.colWidths(lens, maxW, Math.min(15, maxW / ncol));
        const fs = 10, lh = fs * PT * 1.4, pad = 1.6;
        pdf.setFont('noto', 'normal'); pdf.setFontSize(fs);
        const spaceW = pdf.getTextWidth(' ');
        y += 1.5;
        rows.forEach((tr, ri) => {
          const cells = Array.from(tr.cells);
          const head = (cells.length && cells.every(cc => cc.nodeName === 'TH')) ||
            (tr.parentElement && tr.parentElement.nodeName === 'THEAD') ||
            (ri === 0 && cells.some(cc => /background/.test(cc.getAttribute('style') || '')));
          const laid = cells.map((td, ci) => {
            const runs = [];
            ioCollectRuns(td, head ? { b: true } : {}, runs);
            const clean = runs.map(r => r.img ? { text: '[▣] ' } : r);
            const w = (widths[ci] || widths[widths.length - 1]) - 2 * pad;
            const toks = tokenize(clean, fs, w);
            const lines = WC.breakLines(toks, w, spaceW);
            while (lines.length > 1 && lines[lines.length - 1].from === lines[lines.length - 1].to) lines.pop();
            return { toks: toks, lines: lines, w: w, align: ioAlignOf(td) };
          });
          const rowH = Math.max(lh, ...laid.map(l => l.lines.length * lh)) + 2 * pad;
          need(rowH);
          let x = x0;
          for (let ci = 0; ci < ncol; ci++) {
            const w = widths[ci];
            if (head) { pdf.setFillColor('#eeeeee'); pdf.rect(x, y, w, rowH, 'F'); }
            pdf.setDrawColor('#999999'); pdf.setLineWidth(0.2);
            pdf.rect(x, y, w, rowH, 'S');
            const l = laid[ci];
            if (l) l.lines.forEach((line, li) => drawLine(l.toks, line, x + pad, y + pad + li * lh, l.w,
              { fs: fs, lh: lh, align: l.align, spaceW: spaceW }));
            x += w;
          }
          y += rowH;
        });
        y += 3;
      }

      /* block walker; ctx = { x, w, bar } (quotes indent their blocks) */
      function writeBlocks(node, ctx) {
        Array.from(node.childNodes).forEach(ch => {
          if (ch.nodeType === 3) {
            if (ch.nodeValue.trim()) writeRuns([{ text: ch.nodeValue }], { x: ctx.x, w: ctx.w, bar: ctx.bar });
            return;
          }
          if (ch.nodeType !== 1) return;
          if (ch.classList && ch.classList.contains('page-break-marker')) { newPage(); return; }
          if (ch.classList && ch.classList.contains('toc-inline')) return;
          const align = ioAlignOf(ch);
          const runsOf = (el, fmt) => { const r = []; ioCollectRuns(el, fmt || {}, r); return r; };
          switch (ch.nodeName) {
            case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
              const fsz = { H1: 22, H2: 17, H3: 14, H4: 12.5, H5: 11.5, H6: 11 }[ch.nodeName];
              if (y > MT + 0.01) y += fsz * PT * 0.55;
              need(fsz * PT * 1.3 + 11 * PT * 1.5 * 2);   // keep with the next lines
              writeRuns(runsOf(ch, { b: true }), { x: ctx.x, w: ctx.w, fs: fsz, color: '#000000', align: align, lhK: 1.3, after: fsz * PT * 0.3 });
              break;
            }
            case 'BLOCKQUOTE': {
              const inner = { x: ctx.x + 7, w: ctx.w - 7, bar: ctx.x + 2.5, color: '#444444' };
              y += 1;
              if (Array.from(ch.children).some(k => IO_BLOCK_RE.test(k.nodeName))) writeBlocks(ch, inner);
              else writeRuns(runsOf(ch, { i: true }), { x: inner.x, w: inner.w, fs: 11, color: '#444444', align: align, bar: inner.bar });
              y += 1.5;
              break;
            }
            case 'PRE': {
              const fs = 9, lh = fs * PT * 1.45;
              const lines = ch.textContent.replace(/\n$/, '').split('\n');
              y += 1;
              lines.forEach(line => {
                const mono = have.mono && covers('notomono', 'normal', line);
                pdf.setFont(mono ? 'notomono' : 'noto', 'normal'); pdf.setFontSize(fs);
                const parts = line ? pdf.splitTextToSize(line, ctx.w - 6) : [''];
                parts.forEach(pt => {
                  need(lh);
                  pdf.setFillColor('#f2f2f2');
                  pdf.rect(ctx.x, y, ctx.w, lh, 'F');
                  pdf.setTextColor('#222222');
                  pdf.setFont(mono ? 'notomono' : 'noto', 'normal'); pdf.setFontSize(fs);
                  pdf.text(pt, ctx.x + 3, y + (lh - fs * PT) / 2 + fs * PT * 0.8, { renderingMode: 'fill' });
                  y += lh;
                });
              });
              y += 3;
              break;
            }
            case 'HR': {
              need(6); y += 3;
              pdf.setDrawColor('#888888'); pdf.setLineWidth(0.3);
              pdf.line(ctx.x, y, ctx.x + ctx.w, y);
              y += 3;
              break;
            }
            case 'UL': case 'OL': {
              ioListItems(ch, 0).forEach(it => {
                pdf.setFont('noto', 'normal'); pdf.setFontSize(11);
                const mx = ctx.x + 2 + it.depth * 6;
                const ind = Math.max(5, pdf.getTextWidth(it.marker) + 2);
                writeRuns(runsOf(it.body), { x: mx + ind, w: ctx.w - (mx + ind - ctx.x), fs: 11,
                  marker: it.marker, markerX: mx, align: ioAlignOf(it.body), bar: ctx.bar, color: ctx.color, after: 11 * PT * 0.2 });
              });
              y += 11 * PT * 0.3;
              break;
            }
            case 'TABLE': writeTable(ch, ctx.x, ctx.w); break;
            case 'FIGURE': {
              const cap = ch.querySelector('figcaption');
              Array.from(ch.querySelectorAll('img')).forEach(im => drawImage(im, ctx.x, ctx.w, 'center'));
              if (cap) writeRuns(runsOf(cap), { x: ctx.x, w: ctx.w, fs: 9.5, color: '#666666', align: 'center' });
              else y += 2;
              break;
            }
            case 'IMG': drawImage(ch, ctx.x, ctx.w, align); break;
            case 'P': case 'LI': case 'DT': case 'DD': case 'FIGCAPTION':
              writeRuns(runsOf(ch), { x: ctx.x, w: ctx.w, fs: 11, align: align, bar: ctx.bar, color: ctx.color });
              break;
            default:
              if (Array.from(ch.children).some(k => IO_BLOCK_RE.test(k.nodeName))) writeBlocks(ch, ctx);
              else {
                const r = runsOf(ch);
                if (r.length) writeRuns(r, { x: ctx.x, w: ctx.w, fs: 11, align: align, bar: ctx.bar, color: ctx.color });
              }
          }
        });
      }

      writeBlocks(c, { x: ML, w: CW });

      // Footnotes / comments appendix (localized headings)
      const notes = [];
      const seen = new Set();
      c.querySelectorAll('sup.fn-ref').forEach(ref => {
        const id = ref.getAttribute('data-fn');
        if (!id || seen.has(id)) return;
        seen.add(id);
        const e = (doc.footnotes || []).find(f => f.id === id);
        if (e) notes.push({ text: '[' + ref.textContent + '] ' + (e.text || '') });
      });
      const cmts = (doc.comments || []).map(cm =>
        ({ text: '“' + (cm.quote || '') + '” — ' + (cm.text || ''), i: true }));
      if (notes.length || cmts.length) {
        newPage();
        if (notes.length) {
          writeRuns([{ text: t('io.notes'), b: true }], { fs: 16 });
          notes.forEach(a => writeRuns([{ text: a.text }], { fs: 10 }));
          y += 4;
        }
        if (cmts.length) {
          writeRuns([{ text: t('io.comments'), b: true }], { fs: 16 });
          cmts.forEach(a => writeRuns([{ text: a.text, i: a.i }], { fs: 10 }));
        }
      }

      // Headers / footers / page numbers — every page, finalized pass
      const pages = pdf.internal.getNumberOfPages();
      const fitLine = (s, w) => { const l = pdf.splitTextToSize(String(s), w); return l.length ? l[0] : ''; };
      for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        pdf.setFont('noto', 'normal'); pdf.setFontSize(8.5);
        const num = p + ' / ' + pages;
        const numW = pdf.getTextWidth(num) + 4;
        const footY = pg.h - Math.max(MB / 2 - 1.5, 5);
        if (doc.header) {
          pdf.setTextColor('#777777');
          pdf.text(fitLine(doc.header, CW), ML, Math.max(MT / 2 + 1.5, 6), { renderingMode: 'fill' });
        }
        if (doc.footer) {
          pdf.setTextColor('#777777');
          pdf.text(fitLine(doc.footer, CW - numW), ML, footY, { renderingMode: 'fill' });
        }
        pdf.setTextColor('#999999');
        pdf.text(num, pg.w - MR, footY, { align: 'right', renderingMode: 'fill' });
      }

      // Wave 2: jsPDF's internal download path would BYPASS the
      // unified dialog — emit a Blob and ride the downloadBlob
      // funnel like every other format.
      return pdf.output('blob');
    });
}

/* ===== SECTION 24: WAVE 5 — IMPORT (parsers + dialog + apply) ===== */

/* ----- RTF parser (scanner, unicode-aware, lossy formatting) ----- */

/* ----- Sanitizer (all imports) — runs in an INERT document: no
   browsing context → no image loads, no handlers fire while parsing.
   (A live-document innerHTML fires <img onerror> even detached.) ----- */
function ioInertDiv() { return WriterIO.inertDiv(); }
function ioBadUrl(v) { return WriterIO.badUrl(v); }
function ioSanitizeHtml(html) { return WriterIO.sanitizeHtml(html); }

/* ----- TXT parser (also openSearchTarget; io.js has the same one) ----- */
function ioParseTxt(text) {
  const clean = String(text).replace(/\r\n?/g, '\n');
  const paras = clean.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const html = paras.map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
  const first = paras[0] || '';
  const title = first && first.length <= 80 ? first : '';
  return { title: title, html: html, footnotes: [], comments: [] };
}

/* ----- Markdown / HTML / RTF / OROSDOC parsers: io.js ----- */
function ioParseOrosObj(obj) { return WriterIO.parseOrosObj(obj); }

/* ----- Dispatch: file → parsed payload (async) ----- */
function ioParseFile(file) {
  const extTop = (file.name.split('.').pop() || '').toLowerCase();
  if (extTop === 'docx' || extTop === 'odt') return ioParseZipDoc(file, extTop);
  if (extTop === 'pdf') return ioParsePdf(file);
  if (extTop === 'orosdoc' && window.OrosBundle) {
    return file.slice(0, 4).arrayBuffer().then(head => {
      if (OrosBundle.sniff(new Uint8Array(head)) === null) return ioParseText(file);
      return file.arrayBuffer()
        .then(ab => OrosBundle.read(new Uint8Array(ab), { mime: IO_BUNDLE_MIME }))
        .then(ioFromBundle);
    });
  }
  return ioParseText(file);
}
// A bundle (zip or unzipped folder) → the same payload as a JSON .orosdoc
function ioFromBundle(r) {
  const obj = r && r.content;
  if (obj && obj.doc && typeof obj.doc.html === 'string') obj.doc.html = ioDropImages(obj.doc.html, r.media);
  return Object.assign({ kind: 'doc' }, ioParseOrosObj(obj));
}
function ioParseText(file) {
  return new Promise((resolve, reject) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read fail'));
    reader.onload = () => {
      const text = reader.result;
      try {
        resolve(WriterIO.parseTextOf(text, ext));
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsText(file);
  });
}

/* ----- Annotation remap (fresh ids — append/replace never clash) ----- */
function ioPrepareImport(parsed) { return WriterIO.prepareImport(parsed); }

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
  if (!doc) { ioApplyImport(parsed, 'new'); return; }
  const prep = ioPrepareImport(parsed);

  if (mode === 'append') {
    doc.html = (doc.html || '') + prep.html;
    doc.footnotes = (doc.footnotes || []).concat(prep.footnotes);
    doc.comments = (doc.comments || []).concat(prep.comments);
    stampDoc(doc, 'c');
  } else if (mode === 'replace') {
    takeManualSnapshot(doc);           // current state → Version History first
    doc.html = prep.html;
    doc.footnotes = prep.footnotes;
    doc.comments = prep.comments;
    stampDoc(doc, 'c');
    if (title && title !== doc.title) { doc.title = title; stampDoc(doc, 'm'); }
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

/* ----- Writer DB backup → MERGE (Bible: import merges by default).
   WR-2: a restore never replaces newer work. Before, every backup doc
   was restamped NOW, so an older backup overwrote the newer text of
   the same doc on every device (and its versions with it). Now:
   · a doc missing here, or deleted here, comes back (stamped now, so it
     beats the tombstone everywhere);
   · a doc that exists here keeps the newer of the two copies (original
     stamps); the other copy goes into the doc's Version History as a
     manual version — nothing is lost either way;
   · templates: missing / deleted ones come back, existing ones keep the
     newer copy; autocorrect: rules are unioned (this device's win on the
     same "find"); settings: plain LWW on their own stamp.
   Tombstones in the backup are ignored (a restore never deletes). ----- */
function ioMergeDbImport(data) {
  const now = Date.now();
  const cleanVers = vs => (Array.isArray(vs) ? vs : [])
    .filter(v => v && typeof v.html === 'string')
    .map(v => Object.assign({}, v, { html: ioSanitizeHtml(v.html),
      ts: Number(v.ts) || 0, manual: !!v.manual }));
  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (typeof v === 'string' ? v : '');
  flushSave();

  const restored = [];
  let kept = 0;
  arr(data.docs).filter(d => d && typeof d.id === 'string' && !d.del).forEach(d => {
    const b = {
      title: str(d.title).slice(0, 120), author: str(d.author),
      tags: arr(d.tags).filter(x => typeof x === 'string'), category: str(d.category),
      html: ioSanitizeHtml(str(d.html)),
      footnotes: arr(d.footnotes).filter(f => f && typeof f.id === 'string')
        .map(f => ({ id: f.id, text: str(f.text) })),
      comments: arr(d.comments).filter(c => c && typeof c.id === 'string')
        .map(c => ({ id: c.id, quote: str(c.quote), text: str(c.text), ts: Number(c.ts) || 0 })),
      versions: cleanVers(d.versions),
      pageSize: str(d.pageSize) || 'a4', margins: cleanMargins(d.margins),
      header: str(d.header), footer: str(d.footer), goal: cleanGoal(d.goal),
      mtime: Number(d.mtime) || 0,
      lang: cleanLang(d.lang), track: d.track === true
    };
    const cur = getDoc(d.id);
    if (!cur || cur.del) {
      const nd = cur || { id: d.id };
      Object.assign(nd, b, { del: false, mtime: now,
        fm: { c: now, m: now, p: now, g: now } });
      if (!cur) state.docs.push(nd);
      restored.push(nd.id);
      return;
    }
    const same = cur.html === b.html && cur.title === b.title &&
      JSON.stringify(cur.footnotes || []) === JSON.stringify(b.footnotes) &&
      JSON.stringify(cur.comments || []) === JSON.stringify(b.comments);
    if (same) return;
    const snap = (src, ts) => ({ ts: ts, html: src.html || '', manual: true,
      footnotes: JSON.parse(JSON.stringify(src.footnotes || [])),
      comments: JSON.parse(JSON.stringify(src.comments || [])) });
    cur.versions = Array.isArray(cur.versions) ? cur.versions : [];
    if (b.mtime > (Number(cur.mtime) || 0)) {
      // the backup copy is newer: it becomes the text, ours goes to history
      cur.versions.push(snap(cur, now));
      ['html', 'footnotes', 'comments'].forEach(k => { cur[k] = b[k]; });
      if (b.title) cur.title = b.title;
      stampDoc(cur, 'm');
    } else {
      cur.versions.push(snap(b, b.mtime || now));
    }
    cur.versions.sort((x, y) => x.ts - y.ts);
    stampDoc(cur, 'c');
    kept++;
  });

  const tombTs = {};
  canonTombs(state.tplTombs).forEach(tb => { tombTs[tb.id] = tb.ts; });
  arr(data.templates).filter(tp => tp && typeof tp.id === 'string' && typeof tp.name === 'string')
    .forEach(tp => {
      const inc = { id: tp.id, name: tp.name, desc: str(tp.desc),
        html: ioSanitizeHtml(str(tp.html)), mtime: Number(tp.mtime) || 0 };
      const cur = state.templates.find(x => x.id === tp.id);
      const dead = tombTs[tp.id] !== undefined && tombTs[tp.id] >= ((cur || inc).mtime || 0);
      if (!cur || dead) {
        inc.mtime = now;
        if (cur) Object.assign(cur, inc); else state.templates.push(inc);
      } else if (inc.mtime > (cur.mtime || 0)) {
        Object.assign(cur, inc);
      }
    });

  if (data.autocorrect && Array.isArray(data.autocorrect.rules)) {
    const mine = state.autocorrect ? state.autocorrect.rules.slice() : [];
    const have = {};
    mine.forEach(r => { if (r && typeof r.find === 'string') have[r.find] = 1; });
    let added = 0;
    data.autocorrect.rules.forEach(r => {
      if (!r || typeof r.find !== 'string' || typeof r.repl !== 'string' || have[r.find]) return;
      have[r.find] = 1; mine.push({ find: r.find, repl: r.repl, def: !!r.def }); added++;
    });
    if (added || !state.autocorrect) state.autocorrect = { rules: mine, mtime: now };
  }
  if (data.settings && typeof data.settings === 'object' &&
      (Number(data.settings._mtime) || 0) > (Number(state.settings._mtime) || 0)) {
    state.settings = Object.assign({}, state.settings, {
      smartTypography: data.settings.smartTypography !== false,
      typewriterSound: !!data.settings.typewriterSound,
      spell: data.settings.spell !== false,
      _mtime: Number(data.settings._mtime) });
  }
  if (data.seeded) state.seeded = true;
  if (data.userDict && window.WriterSpell) {
    state.userDict = WriterSpell.mergeUserDict(state.userDict, data.userDict);
    spellUserSetDirty();
  }

  restored.forEach(id => {
    state.seen[id] = 1;
    if (state.tabOrder.indexOf(id) === -1) state.tabOrder.push(id);
  });
  if (restored.length) state.activeTab = restored[0];
  reconcileTabs();
  renderTabs();
  renderEditor();
  dirty = true;
  flushSave();
  return { restored: restored.length, kept: kept };
}

/* ----- IMPORT DIALOG ----- */
function openImportDialog(prefile) {
  const dlg = openDialog(t('io.title.imp'), '', [
    { class: 'fb-btn primary', label: t('tt.import'), onClick: () => showToast(t('io.pickFirst')) }
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
    '<input type="file" accept=".orosdoc,.docx,.odt,.rtf,.html,.htm,.txt,.md,.markdown,.json,.pdf">';
  const inp = pick.querySelector('input');
  body.appendChild(pick);

  const folder = document.createElement('button');
  folder.type = 'button';
  folder.className = 'io-link-btn';
  folder.textContent = t('io.pickFolder');
  folder.addEventListener('click', ioPickFolder);
  if (window.OrosBundle) body.appendChild(folder);

  // One Google Doc (or a .docx / .odt in Drive) straight in
  // (../google-import.js + ../files/gmedia.js). Google's picker is a
  // layer of this page, so this dialog closes first and the picked
  // file comes back through the same dialog, like a dropped file.
  const GM = window.OrosGoogleMedia;
  if (GM && GM.docReady()) {
    const gd = document.createElement('button');
    gd.type = 'button';
    gd.className = 'io-link-btn';
    gd.textContent = t('io.gdocs');
    gd.addEventListener('click', () => {
      const lang = window.orosLang === 'el' ? 'el' : 'en';
      const job = GM.pickDoc('document', lang, { picking: () => { if (dlg.open) dlg.close(); } });
      showToast(t('io.gdocsWait'));
      job.then(file => {
        if (dlg.open) dlg.close();
        if (file) openImportDialog(file);
      }, e => {
        const msg = GM.docMessage(e, lang);
        if (msg) showToast(msg);
      });
    });
    body.appendChild(gd);
  }

  const busy = document.createElement('div');
  busy.className = 'io-busy';
  busy.style.display = 'none';
  busy.innerHTML = '<span class="io-spinner"></span>' + esc(t('io.busy'));
  body.appendChild(busy);

  let parsed = null, fileBase = '';

  // shared pipeline — used by the file picker AND drag & drop
  function ioPickDropped(file) {
    fileBase = file.name.replace(/\.[^.]+$/, '');
    ioParsing(ioParseFile(file));
  }
  // An unzipped .orosdoc folder (maybe changed by hand: a picture swapped)
  function ioPickFolder() {
    OrosBundle.pickFolder().then(files => {
      if (!files) return;
      fileBase = '';
      ioParsing(OrosBundle.readFolder(files, { mime: IO_BUNDLE_MIME }).then(ioFromBundle));
    });
  }
  function ioParsing(job) {
    busy.style.display = 'flex';
    pick.style.display = 'none';
    folder.style.display = 'none';

    job
      .then(res => {
        busy.style.display = 'none';
        if (res.kind === 'db') {
          wConfirm(t('io.dbConfirm')).then(ok => {
            if (ok) {
              const r = ioMergeDbImport(res.data);
              showToast(r && r.kept ? t('io.dbKept').replace('{n}', String(r.kept)) : t('io.imported'));
              dlg.close();
            } else {
              busy.style.display = 'none';
              pick.style.display = '';
              folder.style.display = '';
              inp.value = '';
            }
          });
          return;
        }
        parsed = res;
        renderOptions();
      })
      .catch(err => {
        console.error('[orOS] writer import failed:', err);
        busy.style.display = 'none';
        pick.style.display = '';
        folder.style.display = '';
        inp.value = '';
        showToast(err && err.code === 'newer' ? t('io.newer') : err && err.code === 'notext' ? t('io.pdfNoText') : t('io.importfailed'));
      });
  }

  inp.addEventListener('change', () => {
    const file = inp.files[0];
    if (file) ioPickDropped(file);
  });

  // Wave 2: when the shell is present, capture the picker click and
  // route through orosDialog (native picker). Standalone: the built-in
  // browser picker stays — the change event above keeps working.
  inp.addEventListener('click', function (e) {
    const host = dialogHost();
    if (!host) return;
    e.preventDefault();
    e.stopPropagation();
    host.openFile('.orosdoc,.docx,.odt,.rtf,.html,.htm,.txt,.md,.markdown,.json,.pdf')
      .then(function (file) {
        if (file) ioPickDropped(file);   // cancel → silent exit
      });
  }, true);

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
// ('deflate-raw'). DOCX → word/document.xml (+ styles.xml,
// numbering.xml), ODT → content.xml (+ styles.xml). Kept: headings
// (style or outline level), bold/italic/underline/strike/superscript,
// alignment, numbered and bulleted lists with their start, tables,
// line breaks (WR-FMT, io.js).

/* ----- Entry point for DOCX / ODT (ZIP reader + parsers: io.js) ----- */
function ioParseZipDoc(file, ext) {
  const readAb = (file.arrayBuffer
    ? file.arrayBuffer()
    : new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('read fail'));
        fr.readAsArrayBuffer(file);
      }));
  return readAb.then(buf => WriterIO.parseZipBuf(buf, ext));
}

/* ----- Entry point for PDF (text layer → paragraphs: pdfin.js) ----- */
function ioParsePdf(file) {
  if (!window.WriterPdfIn) return Promise.reject(new Error('pdfin.js is not loaded'));
  return file.arrayBuffer().then(buf => WriterPdfIn.open(buf));
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
    if (!ioDndHasFiles(e)) return;   // internal text drag → native move/copy
    e.preventDefault();
    ddCounter = 0;
    ioShowDd(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    ioOpenFile(f);
  });
}

// A dropped file, or one from the system's "Open with" (shell
// fileopen.js): known types go through the full import dialog.
function ioOpenFile(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (['orosdoc','json','docx','odt','rtf','html','htm','txt','md','markdown','pdf']
      .indexOf(ext) === -1) {
    showToast(t('io.importfailed'));
    return;
  }
  openImportDialog(f);   // reuses the full mode-selection flow
}

/* ===== SECTION 26: SPELL CHECK (wave 22) =====
   Hunspell dictionaries (vendor/hunspell: en_US, el_GR) are loaded by
   spell-worker.js only when a document has words of that alphabet, and
   kept in IndexedDB (never in the SW precache). Misspelt words are
   underlined through the CSS Custom Highlight API (::highlight(w-spell))
   or, where it is missing, a layer of lines over the editor: nothing is
   written into the document. Until a dictionary is ready (or if it
   fails) the browser's own spellcheck stays on. Pure parts: spell.js. */
const WS = window.WriterSpell;
const HL_OK = !!(window.CSS && CSS.highlights && typeof window.Highlight === 'function');
const spell = {
  worker: null, noWorker: false,
  ready: {}, failed: {}, asked: {}, warned: false,
  known: { en: new Map(), el: new Map() },     // word → true (right) / false (wrong)
  pending: { en: new Set(), el: new Set() },   // sent to the worker, no answer yet
  waits: {}, seq: 0,
  data: null,          // { segs, toks, docId, langs } of the last scan
  bad: [],             // [{ r: Range, w, lang }] shown now
  ignore: {},          // docId → Set of words ignored (this session)
  timer: null, typedAt: 0, skipped: false, users: null, layer: null, raf: 0
};

function spellOn() { return !!(state.settings && state.settings.spell !== false); }
function setSpellOn(on) {
  state.settings.spell = !!on;
  state.settings._mtime = Date.now();
  scheduleSave();
  spellSchedule(0);
}
function docLangMode(doc) { return doc ? cleanLang(doc.lang) : ''; }
function spellLangsFor(doc) {
  const m = docLangMode(doc);
  if (m === 'none') return [];
  return m ? [m] : ['en', 'el'];
}
function spellUserSetDirty() { spell.users = null; }
function spellUserSet() {
  if (!spell.users) spell.users = new Set(WS.userDictWords(state.userDict));
  return spell.users;
}

function spellWorker() {
  if (spell.worker || spell.noWorker) return spell.worker;
  const fail = () => {
    spell.noWorker = true;
    spell.worker = null;
    ['en', 'el'].forEach(l => { spell.failed[l] = true; });
    spellWarn();
    spellApplyNative();
  };
  try {
    spell.worker = new Worker('spell-worker.js');
    spell.worker.onmessage = spellOnMessage;
    spell.worker.onerror = fail;
  } catch (e) { fail(); }
  return spell.worker;
}
function spellWarn() {
  if (spell.warned) return;
  spell.warned = true;
  showToast(t('sp.failed'));
}

function spellOnMessage(ev) {
  const m = ev.data || {};
  if (m.op === 'loaded') {
    if (m.ok) spell.ready[m.lang] = true;
    else { spell.failed[m.lang] = true; spellWarn(); }
    spellApplyNative();
    spellRender();
  } else if (m.op === 'checked') {
    const words = spell.waits[m.id] || [];
    delete spell.waits[m.id];
    const k = spell.known[m.lang], p = spell.pending[m.lang];
    if (!k) return;
    if (k.size > 80000) k.clear();
    const bad = new Set(m.bad || []);
    words.forEach(w => { p.delete(w); if (!m.failed) k.set(w, !bad.has(w)); });
    spellRender();
  } else if (m.op === 'suggested') {
    const fn = spell.waits[m.id];
    delete spell.waits[m.id];
    if (typeof fn === 'function') fn(m.list || []);
  }
}

function spellEnsure(lang) {
  if (spell.ready[lang] || spell.failed[lang] || spell.asked[lang]) return;
  const w = spellWorker();
  if (!w) return;
  spell.asked[lang] = true;
  w.postMessage({ op: 'load', lang: lang });
}

// The editor's text as one string (a line break at every block, nothing
// for deleted tracked text, a space for code) + where each text node starts.
const SPELL_SKIP = 'pre, code, kbd, samp, sup.fn-ref, .toc-inline, .page-break-marker';
const SPELL_BREAK = /^(P|DIV|H[1-6]|LI|TD|TH|TR|TABLE|THEAD|TBODY|TFOOT|BLOCKQUOTE|FIGURE|FIGCAPTION|UL|OL|HR|BR|IMG)$/;
function spellCollect() {
  const segs = [];
  let text = '';
  (function walk(node) {
    for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
      if (ch.nodeType === 3) { segs.push({ n: ch, s: text.length }); text += ch.data; continue; }
      if (ch.nodeType !== 1) continue;
      if (ch.nodeName === 'DEL' && ch.classList.contains('tc')) continue;
      if (ch.matches(SPELL_SKIP)) { text += ' '; continue; }
      const br = SPELL_BREAK.test(ch.nodeName);
      if (br) text += '\n';
      walk(ch);
      if (br) text += '\n';
    }
  })(EL.editor);
  return { text: text, segs: segs };
}

function spellPos(segs, off, isEnd) {
  let lo = 0, hi = segs.length - 1;
  const key = isEnd ? off - 1 : off;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].s <= key) lo = mid; else hi = mid - 1;
  }
  const sg = segs[lo];
  if (!sg) return null;
  return { n: sg.n, o: Math.max(0, Math.min(off - sg.s, sg.n.data.length)) };
}
function spellRange(tk) {
  const d = spell.data;
  const a = spellPos(d.segs, tk.s, false), b = spellPos(d.segs, tk.e, true);
  if (!a || !b || !EL.editor.contains(a.n) || !EL.editor.contains(b.n)) return null;
  try {
    const r = document.createRange();
    r.setStart(a.n, a.o);
    r.setEnd(b.n, b.o);
    return r.collapsed ? null : r;
  } catch (e) { return null; }
}
function spellCaretOffset() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !spell.data) return -1;
  const n = sel.focusNode;
  if (!n || n.nodeType !== 3) return -1;
  const sg = spell.data.segs.find(s => s.n === n);
  return sg ? sg.s + sel.focusOffset : -1;
}

function spellSchedule(ms) {
  clearTimeout(spell.timer);
  spell.timer = setTimeout(spellScan, ms == null ? 450 : ms);
}
function spellAfterRender() {
  spell.bad = [];
  spell.data = null;
  spellPaint();
  spellSchedule(0);
}

function spellScan() {
  spell.timer = null;
  const doc = activeDoc();
  const langs = (spellOn() && doc) ? spellLangsFor(doc) : [];
  if (!langs.length) {
    spell.data = null;
    spell.bad = [];
    spellPaint();
    spellApplyNative();
    return;
  }
  const col = spellCollect();
  const toks = [], used = {};
  WS.tokens(col.text).forEach(tk => {
    if (!WS.shouldCheck(tk.w)) return;
    const lang = WS.scriptOf(tk.w);
    if (langs.indexOf(lang) === -1) return;
    tk.lang = lang;
    used[lang] = 1;
    toks.push(tk);
  });
  spell.data = { segs: col.segs, toks: toks, docId: doc.id, langs: Object.keys(used) };
  const need = {};
  toks.forEach(tk => {
    if (spell.known[tk.lang].has(tk.w) || spell.pending[tk.lang].has(tk.w)) return;
    (need[tk.lang] = need[tk.lang] || new Set()).add(tk.w);
  });
  Object.keys(used).forEach(spellEnsure);
  Object.keys(need).forEach(lang => {
    if (spell.failed[lang]) return;
    const w = spellWorker();
    if (!w) return;
    const words = Array.from(need[lang]);
    for (let i = 0; i < words.length; i += 2000) {
      const part = words.slice(i, i + 2000);
      const id = ++spell.seq;
      spell.waits[id] = part;
      part.forEach(x => spell.pending[lang].add(x));
      w.postMessage({ op: 'check', id: id, lang: lang, words: part });
    }
  });
  spellApplyNative();
  spellRender();
}

// The browser's own check: on while a needed dictionary is missing, off
// once ours works (no double underlines), off for "don't check".
function spellApplyNative() {
  const doc = activeDoc();
  let native = true;
  const mode = docLangMode(doc);
  if (mode === 'none') native = false;
  else if (spellOn() && doc) {
    const used = spell.data && spell.data.docId === doc.id ? spell.data.langs : [];
    native = used.some(l => !spell.ready[l]);
  }
  if (EL.editor.spellcheck !== native) EL.editor.spellcheck = native;
  if (mode === 'en' || mode === 'el') EL.editor.setAttribute('lang', mode);
  else EL.editor.removeAttribute('lang');
}

function spellRender() {
  const d = spell.data, doc = activeDoc();
  spell.skipped = false;
  if (!d || !doc || d.docId !== doc.id || !spellOn()) { spell.bad = []; spellPaint(); return; }
  const users = spellUserSet(), ign = spell.ignore[doc.id];
  const caret = Date.now() - spell.typedAt < 4000 ? spellCaretOffset() : -1;
  const bad = [];
  d.toks.forEach(tk => {
    if (spell.known[tk.lang].get(tk.w) !== false) return;
    if (WS.userHas(users, tk.w) || (ign && ign.has(tk.w))) return;
    if (caret === tk.e) { spell.skipped = true; return; }   // the word being typed
    const r = spellRange(tk);
    if (r) bad.push({ r: r, w: tk.w, lang: tk.lang });
  });
  spell.bad = bad;
  spellPaint();
}

function spellPaint() {
  if (HL_OK) {
    if (!spell.bad.length) { CSS.highlights.delete('w-spell'); return; }
    const h = new window.Highlight();
    spell.bad.forEach(b => h.add(b.r));
    CSS.highlights.set('w-spell', h);
    return;
  }
  spellPaintLayer();
}
// Fallback without the Highlight API: lines drawn over the editor.
function spellPaintLayer() {
  if (!spell.layer) {
    if (!spell.bad.length) return;
    spell.layer = document.createElement('div');
    spell.layer.className = 'spell-layer';
    spell.layer.setAttribute('aria-hidden', 'true');
    EL.wrapper.appendChild(spell.layer);
    EL.editor.addEventListener('scroll', () => {
      if (!spell.raf) spell.raf = requestAnimationFrame(() => { spell.raf = 0; spellPaintLayer(); });
    }, { passive: true });
  }
  const L = spell.layer;
  L.textContent = '';
  if (!spell.bad.length) return;
  const wr = EL.wrapper.getBoundingClientRect(), er = EL.editor.getBoundingClientRect();
  const frag = document.createDocumentFragment();
  spell.bad.forEach(b => {
    Array.from(b.r.getClientRects()).forEach(rc => {
      if (!rc.width || rc.bottom < er.top || rc.top > er.bottom) return;
      const ln = document.createElement('div');
      ln.className = 'spell-line';
      ln.style.left = (rc.left - wr.left) + 'px';
      ln.style.top = (rc.bottom - wr.top - 2) + 'px';
      ln.style.width = rc.width + 'px';
      frag.appendChild(ln);
    });
  });
  L.appendChild(frag);
}

function spellHitAt(x, y) {
  for (const b of spell.bad) {
    if (b.r.collapsed) continue;
    const rects = b.r.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const rc = rects[i];
      if (x >= rc.left - 2 && x <= rc.right + 2 && y >= rc.top - 2 && y <= rc.bottom + 3) return b;
    }
  }
  return null;
}

function spellSuggest(word, lang) {
  return new Promise(resolve => {
    const w = spellWorker();
    if (!w || !spell.ready[lang]) { resolve([]); return; }
    const id = ++spell.seq;
    const timer = setTimeout(() => { delete spell.waits[id]; resolve([]); }, 4000);
    spell.waits[id] = list => { clearTimeout(timer); resolve(list); };
    w.postMessage({ op: 'suggest', id: id, lang: lang, word: word });
  });
}

function spellMenu(hit, x, y) {
  spellSuggest(hit.w, hit.lang).then(list => {
    const items = list.length
      ? list.map(s => ({ label: s, strong: true, action: () => spellReplace(hit, s) }))
      : [{ label: t('sp.noSugg'), disabled: true }];
    items.push(null,
      { label: t('sp.add'), action: () => userDictAdd(hit.w) },
      { label: t('sp.ignore'), action: () => spellIgnore(hit.w) });
    openMenuAt(x, y, items);
  });
}

function spellReplace(hit, s) {
  if (isLocked()) return;
  const r = hit.r;
  if (!r || r.collapsed || r.toString() !== hit.w) { spellSchedule(0); return; }
  replaceRangeText(r, s);
}

// Replace a range of the editor with plain text: one undo step, or a
// tracked deletion + insertion while Track changes is on.
function replaceRangeText(range, text) {
  EL.editor.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  if (tracking()) { tcSnapshot('replace' + Date.now()); tcReplaceSelection(text); }
  else document.execCommand('insertText', false, text);
  dirty = true;
  scheduleSave();
  spellSchedule(30);
}

function spellIgnore(w) {
  const doc = activeDoc();
  if (!doc) return;
  (spell.ignore[doc.id] = spell.ignore[doc.id] || new Set()).add(w);
  spellRender();
}

function userDictSet(word, stamp) {
  const k = WS.cleanWord(word);
  if (!k) return '';
  const ch = {};
  ch[k] = stamp;
  state.userDict = WS.mergeUserDict(state.userDict, ch);
  spellUserSetDirty();
  dirty = true;
  scheduleSave();
  spellRender();
  return k;
}
function userDictAdd(w) {
  const k = userDictSet(w, Date.now());
  if (k) showToast(t('sp.added').replace('{w}', k));
}

function openUserDict() {
  const dlg = openDialog(t('ud.title'), '', [
    { class: 'fb-btn primary', label: t('wx.done'), onClick: () => dlg.close() }
  ]);
  const body = dlg.querySelector('.w-dialog-body');
  const note = document.createElement('p');
  note.className = 'set-note';
  note.textContent = t('ud.note');
  const row = document.createElement('div');
  row.className = 'ud-add';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'w-field';
  inp.maxLength = 60;
  inp.placeholder = t('ud.ph');
  inp.setAttribute('aria-label', t('ud.ph'));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'fb-btn';
  add.textContent = t('ud.add');
  row.append(inp, add);
  const list = document.createElement('ul');
  list.className = 'ud-list';
  body.append(note, row, list);
  function render() {
    list.textContent = '';
    const words = WS.userDictWords(state.userDict);
    if (!words.length) {
      const li = document.createElement('li');
      li.className = 'ud-empty';
      li.textContent = t('ud.empty');
      list.appendChild(li);
      return;
    }
    words.forEach(w => {
      const li = document.createElement('li');
      const s = document.createElement('span');
      s.textContent = w;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cmt-del';
      del.innerHTML = ICONS.trash;            // our own static SVG
      del.title = t('ud.remove').replace('{w}', w);
      del.setAttribute('aria-label', del.title);
      del.addEventListener('click', () => { userDictSet(w, -Date.now()); render(); });
      li.append(s, del);
      list.appendChild(li);
    });
  }
  const doAdd = () => {
    if (userDictSet(inp.value, Date.now())) { inp.value = ''; render(); }
    inp.focus();
  };
  add.addEventListener('click', doAdd);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doAdd(); } });
  render();
}

function openReviewMenu(anchor) {
  const doc = activeDoc();
  const mode = docLangMode(doc);
  const setLang = v => {
    const d = activeDoc();
    if (!d || cleanLang(d.lang) === v) return;
    d.lang = v;
    markDoc(d, 'm');
    spellSchedule(0);
  };
  openMenu(anchor, [
    { label: t('rv.spell'), checked: spellOn(), action: () => setSpellOn(!spellOn()) },
    { label: t('rv.lang'), heading: true },
    { label: t('rv.langAuto'), checked: mode === '', radio: true, disabled: !doc, action: () => setLang('') },
    { label: t('rv.langEn'), checked: mode === 'en', radio: true, disabled: !doc, action: () => setLang('en') },
    { label: t('rv.langEl'), checked: mode === 'el', radio: true, disabled: !doc, action: () => setLang('el') },
    { label: t('rv.langNone'), checked: mode === 'none', radio: true, disabled: !doc, action: () => setLang('none') },
    { label: t('rv.dict'), action: openUserDict },
    null,
    { label: t('rv.track'), checked: !!(doc && doc.track), disabled: !doc, action: tcToggle },
    { label: t('rv.changes'), disabled: !doc, action: () => tcTogglePanel(true) },
    null,
    { label: t('rv.merge'), disabled: !doc, action: openMailMerge }
  ]);
}

function wireSpell() {
  EL.editor.addEventListener('input', e => {
    if (e.inputType && /^insert/.test(e.inputType)) spell.typedAt = Date.now();
    spellSchedule();
  });
  document.addEventListener('selectionchange', () => {
    if (spell.skipped && !spell.timer) spellRender();
  });
  // Right-click on a marked word: suggestions (Alt+right-click stays
  // the quick format menu).
  EL.editor.addEventListener('contextmenu', e => {
    if (e.altKey) return;
    const hit = spellHitAt(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    spellMenu(hit, e.clientX, e.clientY);
  });
  // Touch: a tap on a marked word shows the same menu under it.
  let touch = false;
  EL.editor.addEventListener('pointerdown', e => { touch = e.pointerType === 'touch' || e.pointerType === 'pen'; }, { passive: true });
  EL.editor.addEventListener('click', e => {
    if (!touch || e.altKey) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const hit = spellHitAt(e.clientX, e.clientY);
    if (!hit) return;
    const rc = hit.r.getBoundingClientRect();
    spellMenu(hit, rc.left, rc.bottom + 6);
  });
  window.addEventListener('resize', () => { if (!HL_OK && spell.layer) spellPaintLayer(); });
}

/* ===== SECTION 27: TRACK CHANGES (wave 22) =====
   A per-document switch (doc.track, synced, clock group m). While it is
   on:
   · deletions (Backspace, Delete, cut, typing over a selection, drag)
     are cancelled in beforeinput and the text is wrapped in
     <del class="tc" data-tc data-au data-ts> instead; text that was
     itself a tracked insertion really goes;
   · typed text (keyboard, IME / Android composition, the browser's
     own corrections) is let through and wrapped afterwards in
     <ins class="tc" …>, from a MutationObserver diff of each changed
     text node (track.js diffEdit); text removed by a composition comes
     back as a deletion;
   · paste and drop insert plain text as one insertion;
   · Undo / Redo use snapshots of the editor (the browser's own undo
     stack cannot follow these edits).
   Joining / splitting paragraphs and formatting are not tracked. The
   marks are ordinary sanitised html, so they save, sync, export to
   DOCX as w:ins / w:del and come back from DOCX. */
const WT = window.WriterTrack;
const TC_COLORS = ['#2f7fd8', '#d9480f', '#2b8a3e', '#ae3ec9', '#c2255c', '#0c8599', '#b7791f', '#5c6ac4'];
const tc = {
  obs: null, type: null, composing: false, queue: [], busy: false,
  undo: [], redo: [], lastSnap: 0, lastKind: '',
  panel: null, panelTimer: null, styleEl: null
};

function tracking() { const d = activeDoc(); return !!(d && d.track); }
function tcAuthor() {
  return WT.cleanAttrs((view.who || '').trim() || WT.deviceName(navigator.userAgent)).au || 'orOS';
}
function tcNewMark(kind) {
  const el = document.createElement(kind);
  el.className = 'tc';
  el.setAttribute('data-tc', 'tc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  el.setAttribute('data-au', tcAuthor());
  el.setAttribute('data-ts', String(Date.now()));
  return el;
}
function isTcMark(el, kind) {
  return !!(el && el.nodeType === 1 && (el.nodeName === 'INS' || el.nodeName === 'DEL') &&
    el.classList.contains('tc') && (!kind || el.nodeName === kind.toUpperCase()));
}
function tcMarkOf(node, kind) {
  let el = node && (node.nodeType === 1 ? node : node.parentNode);
  while (el && el !== EL.editor) {
    if (isTcMark(el, kind)) return el;
    el = el.parentNode;
  }
  return null;
}

/* ----- on / off ----- */
function tcToggle() {
  const doc = activeDoc();
  if (!doc) return;
  flushSave();
  doc.track = !doc.track;
  markDoc(doc, 'm');
  tcSync(true);
  showToast(doc.track ? t('tc.on') : t('tc.offT'));
}
function tcSync(reset) {
  if (tracking()) tcStartObserver(); else tcStopObserver();
  if (reset) { tc.undo = []; tc.redo = []; tc.lastKind = ''; }
  const b = document.getElementById('btn-review');
  if (b) {
    b.classList.toggle('active', tracking());
    b.title = t('tt.review') + (tracking() ? ' · ' + t('tc.on') : '');
  }
  tcPanelSoon();
}

/* ----- typed text → insertions (MutationObserver) ----- */
function tcStartObserver() {
  if (tc.obs) return;
  tc.obs = new MutationObserver(tcOnMutations);
  tc.obs.observe(EL.editor, { subtree: true, characterData: true, characterDataOldValue: true, childList: true });
}
function tcStopObserver() {
  if (tc.obs) { tc.obs.disconnect(); tc.obs = null; }
  tc.queue = [];
  tc.type = null;
  tc.composing = false;
}
function tcOnMutations(recs) {
  if (tc.busy || (!tc.type && !tc.composing)) return;   // formatting, find marks, our own edits…
  for (let i = 0; i < recs.length; i++) tc.queue.push(recs[i]);
  if (tc.composing) return;                            // wait for the end of the composition
  tcFlush();
}
function tcTexts(n) {
  if (n.nodeType === 3) return [n];
  if (n.nodeType !== 1) return [];
  const out = [], w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  let x;
  while ((x = w.nextNode())) out.push(x);
  return out;
}
function tcFlush() {
  const recs = tc.queue;
  tc.queue = [];
  tc.type = null;
  if (!recs.length || !tracking()) return;
  const base = new Map(), added = new Set(), removed = new Set();
  recs.forEach(r => {
    if (r.type === 'characterData') {
      if (!base.has(r.target) && !added.has(r.target)) base.set(r.target, r.oldValue || '');
    } else if (r.type === 'childList') {
      r.addedNodes.forEach(n => tcTexts(n).forEach(x => { if (!base.has(x)) added.add(x); }));
      r.removedNodes.forEach(n => tcTexts(n).forEach(x => removed.add(x)));
    }
  });
  const sel = window.getSelection();
  const fNode = sel && sel.rangeCount ? sel.focusNode : null;
  const fOff = sel && sel.rangeCount ? sel.focusOffset : -1;
  let caret = null;
  tc.busy = true;
  try {
    const handle = (tn, oldT) => {
      if (!tn.isConnected || !EL.editor.contains(tn)) return;
      if (tcMarkOf(tn, 'ins')) return;            // typing inside an insertion stays in it
      if (tn.parentNode && tn.parentNode.closest && tn.parentNode.closest('sup.fn-ref, [contenteditable="false"]')) return;
      const at = tn === fNode ? fOff : -1;
      const d = WT.diffEdit(oldT, tn.data, at);
      if (!d.inserted && !d.removed) return;
      const c = tcWrapEdit(tn, d, at);
      if (c) caret = c;
    };
    base.forEach((oldT, tn) => handle(tn, oldT));
    added.forEach(tn => { if (!removed.has(tn)) handle(tn, ''); });   // in both: moved, not typed
    if (caret && sel) {
      const r = document.createRange();
      r.setStart(caret.n, caret.o);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } catch (e) {
    console.error('[writer] track changes:', e);
  } finally {
    if (tc.obs) tc.obs.takeRecords();
    tc.busy = false;
  }
  tcPanelSoon();
}

// One edited text node: [before][deleted again][inserted][rest].
function tcWrapEdit(tn, d, at) {
  const p = d.p, insLen = d.inserted.length;
  let mid = null, rest = null;
  if (p < tn.data.length) rest = tn.splitText(p);
  if (insLen) {
    mid = rest;
    rest = insLen < mid.data.length ? mid.splitText(insLen) : null;
  }
  const inDel = tcMarkOf(tn, 'del');
  let anchor = tn;
  if (d.removed) {
    if (inDel) {                                       // already deleted: put it back as it was
      const back = document.createTextNode(d.removed);
      anchor.parentNode.insertBefore(back, anchor.nextSibling);
      anchor = back;
    } else {
      const del = tcNewMark('del');
      del.textContent = d.removed;
      anchor.parentNode.insertBefore(del, anchor.nextSibling);
      anchor = del;
    }
  }
  let ins = null;
  if (mid) {
    ins = tcNewMark('ins');
    mid.parentNode.insertBefore(ins, mid);
    ins.appendChild(mid);
    if (anchor !== tn && ins.previousSibling !== anchor) anchor.parentNode.insertBefore(ins, anchor.nextSibling);
    if (inDel) tcLift(ins, inDel);
    ins = tcMergeAdjacent(ins);
  }
  if (anchor !== tn && isTcMark(anchor, 'del')) tcMergeAdjacent(anchor);
  // where the caret goes (at = caret in the new text, -1 unknown)
  let c = null;
  if (at >= 0) {
    if (at <= p) c = tn.isConnected ? { n: tn, o: Math.min(at, tn.data.length) } : null;
    else if (mid && at <= p + insLen) c = { n: mid, o: at - p };
    else if (rest) c = { n: rest, o: Math.max(0, Math.min(at - p - insLen, rest.data.length)) };
    else if (mid) c = { n: mid, o: mid.data.length };
  }
  if (!tn.data.length && tn.isConnected && !(c && c.n === tn)) tn.remove();
  return c;
}

// el (inside a deletion) moves out of it: [del…] el […del]
function tcLift(el, del) {
  const r = document.createRange();
  r.setStart(del, 0);
  r.setEndBefore(el);
  const left = r.extractContents();
  if (left.textContent) {
    const dl = del.cloneNode(false);
    dl.appendChild(left);
    del.parentNode.insertBefore(dl, del);
  }
  del.parentNode.insertBefore(el, del);
  if (!del.textContent && !del.querySelector('img')) del.remove();
}

// Joins a mark to a neighbour of the same kind and author.
function tcMergeAdjacent(el) {
  const au = el.getAttribute('data-au');
  const same = x => isTcMark(x, el.nodeName) && x.getAttribute('data-au') === au;
  const skipEmpty = (x, dir) => {
    while (x && x.nodeType === 3 && !x.data.length) { const n = x[dir]; x.remove(); x = n; }
    return x;
  };
  const prev = skipEmpty(el.previousSibling, 'previousSibling');
  if (same(prev)) {
    while (el.firstChild) prev.appendChild(el.firstChild);
    el.remove();
    el = prev;
  }
  const next = skipEmpty(el.nextSibling, 'nextSibling');
  if (same(next)) {
    while (next.firstChild) el.appendChild(next.firstChild);
    next.remove();
  }
  return el;
}

/* ----- deletions ----- */
function tcSkipNode(n) {
  const el = n.nodeType === 1 ? n : n.parentElement;
  return !!(el && el.closest && el.closest('sup.fn-ref, .page-break-marker, [contenteditable="false"]'));
}
function tcContains(range, node) {
  const r2 = document.createRange();
  r2.selectNode(node);
  return range.compareBoundaryPoints(Range.START_TO_START, r2) <= 0 &&
         range.compareBoundaryPoints(Range.END_TO_END, r2) >= 0;
}
// Text pieces (and images) inside a range: [{ node, s, e }]
function tcParts(range) {
  const out = [];
  const root = range.commonAncestorContainer;
  if (root.nodeType === 3) {
    if (range.endOffset > range.startOffset && !tcSkipNode(root)) out.push({ node: root, s: range.startOffset, e: range.endOffset });
    return out;
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = w.nextNode())) {
    if (!range.intersectsNode(n) || tcSkipNode(n)) continue;
    if (n.nodeType === 3) {
      const s = n === range.startContainer ? range.startOffset : 0;
      const e = n === range.endContainer ? range.endOffset : n.data.length;
      if (e > s) out.push({ node: n, s: s, e: e });
    } else if (n.nodeName === 'IMG' && tcContains(range, n)) out.push({ node: n, s: 0, e: 0 });
  }
  return out;
}

// Marks a range as deleted; returns the first / last mark involved.
function tcMarkDeleted(range) {
  const parts = tcParts(range);
  let first = null, last = null;
  parts.forEach(pt => {
    let n = pt.node;
    if (n.nodeType === 3) {
      if (pt.e < n.data.length) n.splitText(pt.e);
      if (pt.s > 0) n = n.splitText(pt.s);
    }
    const inDel = tcMarkOf(n, 'del');
    if (inDel) { first = first || inDel; last = inDel; return; }
    const inIns = tcMarkOf(n, 'ins');
    if (inIns) {                                       // never was there: it simply goes
      n.remove();
      if (!inIns.textContent && !inIns.querySelector('img')) inIns.remove();
      return;
    }
    const del = tcNewMark('del');
    n.parentNode.insertBefore(del, n);
    del.appendChild(n);
    const m = tcMergeAdjacent(del);
    first = first || m;
    last = m;
  });
  return { first: first, last: last };
}

// Backspace on text that is already deleted: step over it.
function tcStepOver(range, back, type) {
  const gran = /Word/.test(type) ? 'word' : /Line/.test(type) ? 'lineboundary' : 'character';
  const sel = window.getSelection();
  for (let i = 0; i < 40; i++) {
    if (!range) {
      if (!sel.rangeCount || typeof sel.modify !== 'function') return null;
      const save = sel.getRangeAt(0).cloneRange();
      sel.modify('extend', back ? 'backward' : 'forward', gran);
      range = sel.getRangeAt(0).cloneRange();
      sel.removeAllRanges();
      sel.addRange(save);
    }
    if (range.collapsed) return range;
    const parts = tcParts(range);
    if (!parts.length || !parts.every(p => tcMarkOf(p.node, 'del'))) return range;
    const del = tcMarkOf(back ? parts[0].node : parts[parts.length - 1].node, 'del');
    const c = document.createRange();
    if (back) c.setStartBefore(del); else c.setStartAfter(del);
    c.collapse(true);
    sel.removeAllRanges();
    sel.addRange(c);
    range = null;
  }
  return null;
}

function tcDelete(type, e) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const back = !/Forward/.test(type);
  let range = null;
  if (!sel.isCollapsed) range = sel.getRangeAt(0).cloneRange();
  else {
    const tr = (e && typeof e.getTargetRanges === 'function') ? e.getTargetRanges() : [];
    if (tr && tr.length) {
      range = document.createRange();
      try { range.setStart(tr[0].startContainer, tr[0].startOffset); range.setEnd(tr[0].endContainer, tr[0].endOffset); }
      catch (x) { range = null; }
    }
    range = tcStepOver(range, back, type);
  }
  if (!range || range.collapsed) return;
  if (!tcParts(range).length) {
    // no text: joining two paragraphs, an empty line, a rule — done as
    // usual and not tracked
    tc.type = null;
    sel.removeAllRanges();
    sel.addRange(range);
    tc.busy = true;
    try { document.execCommand('delete'); } finally { if (tc.obs) tc.obs.takeRecords(); tc.busy = false; }
    tcAfterEdit();
    return;
  }
  tc.busy = true;
  try {
    const res = tcMarkDeleted(range);
    const c = document.createRange();
    if (back) { if (res.first && res.first.isConnected) c.setStartBefore(res.first); else c.setStart(range.startContainer, range.startOffset); }
    else { if (res.last && res.last.isConnected) c.setStartAfter(res.last); else c.setStart(range.endContainer, range.endOffset); }
    c.collapse(true);
    sel.removeAllRanges();
    sel.addRange(c);
  } finally { if (tc.obs) tc.obs.takeRecords(); tc.busy = false; }
  tcAfterEdit();
}

// Insert plain text at a collapsed range as a tracked insertion.
function tcInsertAt(r, text) {
  const del = tcMarkOf(r.startContainer, 'del');
  if (del) { r = document.createRange(); r.setStartAfter(del); r.collapse(true); }
  const frag = document.createDocumentFragment();
  String(text).split(/\r\n|\r|\n/).forEach((line, i) => {
    if (i) frag.appendChild(document.createElement('br'));
    if (line) frag.appendChild(document.createTextNode(line));
  });
  const last = frag.lastChild;
  if (!last) return;
  if (tcMarkOf(r.startContainer, 'ins')) r.insertNode(frag);
  else {
    const ins = tcNewMark('ins');
    ins.appendChild(frag);
    r.insertNode(ins);
    tcMergeAdjacent(ins);
  }
  const c = document.createRange();
  if (last.nodeType === 3) c.setStart(last, last.data.length); else c.setStartAfter(last);
  c.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(c);
}

// The selection becomes a deletion, then text goes in after it.
function tcReplaceSelection(text) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  tc.busy = true;
  try {
    const r = sel.getRangeAt(0).cloneRange();
    let at = r;
    if (!r.collapsed) {
      const res = tcMarkDeleted(r);
      at = document.createRange();
      if (res.last && res.last.isConnected) at.setStartAfter(res.last);
      else at.setStart(r.endContainer, r.endOffset);
      at.collapse(true);
    }
    if (text) tcInsertAt(at, text);
    else { sel.removeAllRanges(); sel.addRange(at); }
  } finally { if (tc.obs) tc.obs.takeRecords(); tc.busy = false; }
  tcAfterEdit();
}

function tcAfterEdit() {
  dirty = true;
  updateEmptyState();
  scheduleSave();
  spellSchedule();
  tcPanelSoon();
}

/* ----- Undo / Redo while tracking (snapshots) ----- */
function tcCaretOffset() {
  try {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    if (!EL.editor.contains(r.startContainer)) return 0;
    const pre = document.createRange();
    pre.selectNodeContents(EL.editor);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  } catch (e) { return 0; }
}
function tcSnapshot(kind) {
  const now = Date.now();
  if (kind === tc.lastKind && now - tc.lastSnap < 1500) { tc.lastSnap = now; return; }
  tc.lastKind = kind;
  tc.lastSnap = now;
  tc.undo.push({ html: EL.editor.innerHTML, caret: tcCaretOffset() });
  if (tc.undo.length > 100) tc.undo.shift();
  tc.redo = [];
}
function tcRestore(s) {
  tc.busy = true;
  try {
    EL.editor.innerHTML = s.html;
    restoreCaret(s.caret);
  } finally { if (tc.obs) tc.obs.takeRecords(); tc.busy = false; }
  tc.lastKind = '';
  tcAfterEdit();
  goalAfterInput();
}
// redo: false = Undo. True when tracking handled it (even with nothing
// left to undo: the browser's own stack no longer matches the text).
function tcTryUndo(redo) {
  if (!tracking()) return false;
  const from = redo ? tc.redo : tc.undo, to = redo ? tc.undo : tc.redo;
  if (from.length) {
    to.push({ html: EL.editor.innerHTML, caret: tcCaretOffset() });
    tcRestore(from.pop());
  }
  return true;
}

/* ----- the browser's input events while tracking ----- */
function tcBeforeInput(e) {
  if (e.defaultPrevented || !tracking() || tc.busy) return;
  const type = e.inputType || '';
  if (type === 'historyUndo' || type === 'historyRedo') {
    e.preventDefault();
    tcTryUndo(type === 'historyRedo');
    return;
  }
  if (/^insertFrom(Paste|Drop|PasteAsQuotation)$/.test(type)) {
    const dt = e.dataTransfer;
    const text = dt ? dt.getData('text/plain') : '';
    if (e.cancelable && text) {
      e.preventDefault();
      tcSnapshot('paste' + Date.now());
      if (type === 'insertFromDrop') {
        const tr = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
        if (tr && tr.length) {
          const r = document.createRange();
          try {
            r.setStart(tr[0].startContainer, tr[0].startOffset);
            r.setEnd(tr[0].endContainer, tr[0].endOffset);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
          } catch (x) { /* keep the selection */ }
        }
      }
      tcReplaceSelection(text);
      return;
    }
    tc.type = type;
    return;
  }
  if (/^delete/.test(type)) {
    tcSnapshot('del');
    if (!e.cancelable || e.isComposing) { tc.type = type; return; }   // a composition: through the diff
    e.preventDefault();
    tcDelete(type, e);
    return;
  }
  if (/^insert(Text|ReplacementText|CompositionText|FromYank|Transpose)$/.test(type)) {
    tcSnapshot('type');
    const sel = window.getSelection();
    if (e.cancelable && !e.isComposing && sel && sel.rangeCount && !sel.isCollapsed) {
      // typing over a selection: it becomes a deletion first
      const text = e.data != null ? e.data : (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
      e.preventDefault();
      tcReplaceSelection(text);
      return;
    }
    tc.type = type;
    return;
  }
  tc.type = null;   // new paragraph, line break, formatting: not tracked
}

function wireTrack() {
  EL.editor.addEventListener('beforeinput', tcBeforeInput);
  EL.editor.addEventListener('input', () => {
    if (!tracking()) return;
    if (tc.obs && !tc.composing) {
      const recs = tc.obs.takeRecords();
      if (recs.length) tcOnMutations(recs);
    }
    setTimeout(() => { if (!tc.composing) { tc.type = null; tc.queue = []; } }, 0);
    tcPanelSoon();
  });
  EL.editor.addEventListener('compositionstart', () => {
    if (!tracking()) return;
    tc.composing = true;
    tcSnapshot('type');
  });
  EL.editor.addEventListener('compositionend', () => {
    if (!tc.composing) return;
    setTimeout(() => {
      tc.composing = false;
      if (tc.obs) { const recs = tc.obs.takeRecords(); for (let i = 0; i < recs.length; i++) tc.queue.push(recs[i]); }
      if (tc.queue.length) tcFlush();
      tc.type = null;
      dirty = true;
      scheduleSave();
    }, 0);
  });
  // Ctrl/Cmd+Z / Y: the snapshots, before the browser's own undo
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.target !== EL.editor || !tracking()) return;
    const z = e.code === 'KeyZ', y = e.code === 'KeyY';
    if (!z && !y) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    tcTryUndo(y || (z && e.shiftKey));
  }, true);
}

/* ----- accept / reject ----- */
function tcMarks(id) {
  const q = id ? '[data-tc="' + CSS.escape(id) + '"]' : '';
  return Array.from(EL.editor.querySelectorAll('ins.tc' + q + ', del.tc' + q));
}
function tcResolve(id, mode) {
  const marks = tcMarks(id);
  if (!marks.length) return 0;
  if (tracking()) tcSnapshot('resolve' + Date.now());
  tc.busy = true;
  try {
    marks.forEach(m => {
      if (!m.isConnected) return;
      const drop = mode === 'accept' ? 'DEL' : 'INS';
      if (m.nodeName === drop) m.remove(); else ioUnwrap(m);
    });
    EL.editor.normalize();
  } finally { if (tc.obs) tc.obs.takeRecords(); tc.busy = false; }
  tcAfterEdit();
  goalAfterInput();
  return marks.length;
}
function tcResolveAll(mode) {
  const doc = activeDoc();
  if (!doc) return;
  const before = EL.editor.innerHTML;
  if (!tcResolve(null, mode)) return;
  const id = doc.id;
  undoToast(t(mode === 'accept' ? 'tc.allAccepted' : 'tc.allRejected'), () => {
    if (state.activeTab !== id) return;
    tcRestore({ html: before, caret: tcCaretOffset() });
  });
}

/* ----- the Changes panel ----- */
function tcHidePanel() {
  if (tc.panel && !tc.panel.hidden) tc.panel.hidden = true;
}
function tcTogglePanel(forceOpen) {
  if (!tc.panel) tcBuildPanel();
  const open = forceOpen === true ? true : tc.panel.hidden;
  tc.panel.hidden = !open;
  if (open) {
    ['fn-panel', 'cmt-panel'].forEach(pid => { const p = document.getElementById(pid); if (p) p.hidden = true; });
    EL.wrapper.classList.add('has-side-panel');
    tcRenderPanel();
  } else {
    EL.wrapper.classList.remove('has-side-panel');
  }
}
function tcBuildPanel() {
  const p = document.createElement('div');
  p.className = 'side-panel';
  p.id = 'tc-panel';
  p.hidden = true;
  const head = document.createElement('div');
  head.className = 'side-panel-head';
  const h = document.createElement('h3');
  h.className = 'side-panel-title';
  h.textContent = t('tc.title') + ' ';
  const cnt = document.createElement('span');
  cnt.className = 'side-panel-count';
  cnt.setAttribute('data-tc-count', '');
  h.appendChild(cnt);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'sp-close';
  close.innerHTML = ICONS.close;
  close.title = t('tab.close');
  close.setAttribute('aria-label', t('tab.close'));
  close.addEventListener('click', () => tcTogglePanel());
  head.append(h, close);

  const sw = document.createElement('label');
  sw.className = 'tc-switch';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.setAttribute('data-tc-on', '');
  cb.addEventListener('change', () => { if (!!cb.checked !== tracking()) tcToggle(); });
  const sl = document.createElement('span');
  sl.textContent = t('rv.track');
  sw.append(cb, sl);

  const body = document.createElement('div');
  body.className = 'side-panel-body';
  body.setAttribute('data-tc-body', '');

  const foot = document.createElement('div');
  foot.className = 'side-panel-foot';
  const acc = document.createElement('button');
  acc.type = 'button';
  acc.className = 'fb-btn primary';
  acc.textContent = t('tc.acceptAll');
  acc.setAttribute('data-tc-all', 'accept');
  acc.addEventListener('click', () => tcResolveAll('accept'));
  const rej = document.createElement('button');
  rej.type = 'button';
  rej.className = 'fb-btn';
  rej.textContent = t('tc.rejectAll');
  rej.setAttribute('data-tc-all', 'reject');
  rej.addEventListener('click', () => tcResolveAll('reject'));
  foot.append(acc, rej);

  p.append(head, sw, body, foot);
  EL.wrapper.appendChild(p);
  tc.panel = p;
}

function tcGroups() {
  const out = [], byId = {};
  tcMarks(null).forEach(m => {
    const id = m.getAttribute('data-tc') || '';
    let g = byId[id];
    if (!g) {
      g = byId[id] = { id: id, kind: m.nodeName === 'DEL' ? 'del' : 'ins', au: m.getAttribute('data-au') || '',
        ts: Number(m.getAttribute('data-ts')) || 0, text: '', el: m };
      out.push(g);
    }
    g.text += m.textContent;
  });
  return out;
}

function tcRenderPanel() {
  const p = tc.panel;
  if (!p || p.hidden) return;
  const groups = tcGroups();
  p.querySelector('[data-tc-count]').textContent = String(groups.length);
  p.querySelector('[data-tc-on]').checked = tracking();
  p.querySelectorAll('[data-tc-all]').forEach(b => { b.disabled = !groups.length; });
  const body = p.querySelector('[data-tc-body]');
  body.textContent = '';
  if (!groups.length) {
    const e = document.createElement('div');
    e.className = 'fn-empty';
    e.textContent = t('tc.empty');
    body.appendChild(e);
    return;
  }
  groups.slice(0, 300).forEach(g => {
    const card = document.createElement('div');
    card.className = 'tc-card';
    card.style.setProperty('--tc-c', TC_COLORS[WT.colorIndex(g.au)]);
    const meta = document.createElement('div');
    meta.className = 'tc-meta';
    const kind = document.createElement('span');
    kind.className = 'tc-kind';
    kind.textContent = t(g.kind === 'del' ? 'tc.del' : 'tc.ins');
    const who = document.createElement('span');
    who.className = 'tc-au';
    who.textContent = g.au;
    const when = document.createElement('span');
    when.className = 'tc-ts';
    when.textContent = formatTs(g.ts);
    meta.append(kind, who, when);
    const txt = document.createElement('button');
    txt.type = 'button';
    txt.className = 'tc-text tc-text-' + g.kind;
    const s = g.text.replace(/\s+/g, ' ').trim();
    txt.textContent = s.length > 160 ? s.slice(0, 160) + '…' : (s || '¶');
    txt.addEventListener('click', () => {
      if (!g.el.isConnected) return;
      g.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const r = document.createRange();
      r.selectNodeContents(g.el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    const acts = document.createElement('div');
    acts.className = 'tc-acts';
    [['accept', 'tc.accept'], ['reject', 'tc.reject']].forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fb-btn';
      b.textContent = t(a[1]);
      b.addEventListener('click', () => { tcResolve(g.id, a[0]); tcRenderPanel(); });
      acts.appendChild(b);
    });
    card.append(meta, txt, acts);
    body.appendChild(card);
  });
  if (groups.length > 300) {
    const more = document.createElement('div');
    more.className = 'fn-empty';
    more.textContent = '+' + (groups.length - 300);
    body.appendChild(more);
  }
}

// Author colours (a generated rule per author name) + the panel, soon.
function tcPanelSoon() {
  clearTimeout(tc.panelTimer);
  tc.panelTimer = setTimeout(() => {
    tcPaintAuthors();
    tcRenderPanel();
  }, 250);
}
function tcPaintAuthors() {
  if (!tc.styleEl) {
    tc.styleEl = document.createElement('style');
    document.head.appendChild(tc.styleEl);
  }
  const seen = {};
  let css = '';
  tcMarks(null).forEach(m => {
    const a = m.getAttribute('data-au') || '';
    if (seen[a]) return;
    seen[a] = 1;
    css += '.rich-editor .tc[data-au="' + CSS.escape(a) + '"]{--tc-c:' + TC_COLORS[WT.colorIndex(a)] + '}';
  });
  if (tc.styleEl.textContent !== css) tc.styleEl.textContent = css;
}

/* ===== SECTION 28: MAIL MERGE (wave 22) =====
   {{Field}} placeholders + records from Contacts (read-only, the
   Contacts app's own oros-contacts-data) or a CSV file → one PDF, a
   ZIP of PDFs, or one new document. Values are HTML-escaped by
   merge.js; tracked changes count as accepted. */
const WM = window.WriterMerge;
const MM_MAX_PDF = 500;
const MM_PB = '<div class="page-break-marker" contenteditable="false"></div>';

function mmContactsRaw() {
  try { return JSON.parse(localStorage.getItem('oros-contacts-data') || 'null'); } catch (e) { return null; }
}

function openMailMerge() {
  flushSave();
  const doc = activeDoc();
  if (!doc) { showToast(t('io.needDoc')); return; }
  const src = WT.resolveHtml(doc.html || '', 'accept');
  const fields = WM.fieldsIn(src);
  if (!fields.length) {
    const d0 = openDialog(t('mm.title'), '', [
      { class: 'fb-btn primary', label: t('wx.ok'), onClick: () => d0.close() }
    ]);
    const p = document.createElement('p');
    p.className = 'w-confirm-msg';
    p.textContent = t('mm.noFields');
    d0.querySelector('.w-dialog-body').appendChild(p);
    return;
  }
  const st = { kind: 'contacts', label: '', data: { headers: [], rows: [] }, i: 0, out: 'pdf', csv: null, csvName: '' };
  const dlg = openDialog(t('mm.title'), '', [
    { class: 'fb-btn', label: t('wx.cancel'), onClick: () => dlg.close() },
    { class: 'fb-btn primary', label: t('mm.go'), onClick: () => mmRun(doc, src, st, dlg) }
  ]);
  dlg.classList.add('mm-dialog');
  const body = dlg.querySelector('.w-dialog-body');
  const goBtn = dlg.querySelector('.w-dialog-foot .primary');

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // Data: Contacts (with a label) or a CSV file
  const dataH = el('div', 'mm-h', t('mm.data'));
  const srcRow = el('div', 'mm-src');
  const bContacts = el('button', 'fb-btn', t('mm.contacts'));
  const bCsv = el('button', 'fb-btn', t('mm.csv'));
  [bContacts, bCsv].forEach(b => { b.type = 'button'; });
  const labelSel = el('select', 'w-field mm-label');
  labelSel.setAttribute('aria-label', t('mm.label'));
  const optAll = el('option', null, t('mm.allContacts'));
  optAll.value = '';
  labelSel.appendChild(optAll);
  WM.contactLabels(mmContactsRaw()).forEach(l => {
    const o = el('option', null, l.name);
    o.value = l.id;
    labelSel.appendChild(o);
  });
  const csvName = el('span', 'mm-csvname');
  srcRow.append(bContacts, bCsv, labelSel, csvName);

  // Fields
  const fieldsH = el('div', 'mm-h', t('mm.fields'));
  const chips = el('div', 'mm-fields');
  const colsNote = el('p', 'set-note');

  // Preview
  const nav = el('div', 'mm-nav');
  const prev = el('button', 'fb-btn mm-arrow');
  const next = el('button', 'fb-btn mm-arrow');
  prev.type = next.type = 'button';
  prev.innerHTML = ICONS.prev;
  next.innerHTML = ICONS.next;
  prev.title = t('mm.prev'); prev.setAttribute('aria-label', t('mm.prev'));
  next.title = t('mm.next'); next.setAttribute('aria-label', t('mm.next'));
  const pos = el('span', 'mm-pos');
  pos.setAttribute('aria-live', 'polite');
  nav.append(prev, pos, next);
  const preview = el('div', 'mm-preview');

  // Output
  const outH = el('div', 'mm-h', t('mm.out'));
  const outs = el('div', 'mm-outs');
  [['pdf', 'mm.outPdf'], ['zip', 'mm.outZip'], ['doc', 'mm.outDoc']].forEach(o => {
    const lab = el('label', 'fb-opt mm-out');
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = 'mm-out';
    r.value = o[0];
    r.checked = st.out === o[0];
    r.addEventListener('change', () => { st.out = o[0]; });
    lab.append(r, document.createTextNode(t(o[1])));
    outs.appendChild(lab);
  });

  body.append(dataH, srcRow, fieldsH, chips, colsNote, nav, preview, outH, outs);

  function load() {
    if (st.kind === 'contacts') st.data = WM.contactRecords(mmContactsRaw(), st.label);
    else st.data = st.csv || { headers: [], rows: [] };
    st.i = 0;
    refresh();
  }
  function refresh() {
    bContacts.classList.toggle('on', st.kind === 'contacts');
    bCsv.classList.toggle('on', st.kind === 'csv');
    bContacts.setAttribute('aria-pressed', String(st.kind === 'contacts'));
    bCsv.setAttribute('aria-pressed', String(st.kind === 'csv'));
    labelSel.hidden = st.kind !== 'contacts';
    csvName.hidden = st.kind !== 'csv';
    csvName.textContent = st.csvName;
    const headers = st.data.headers, rows = st.data.rows;
    chips.textContent = '';
    const missing = [];
    fields.forEach(f => {
      const ok = WM.findHeader(f, headers) !== null;
      if (!ok) missing.push(f);
      const c = el('span', 'mm-chip' + (ok ? ' ok' : ' miss'), '{{' + f + '}}');
      chips.appendChild(c);
    });
    colsNote.textContent = missing.length ? t('mm.missing').replace('{list}', missing.join(', ')) : '';
    if (st.kind === 'csv' && headers.length) {
      colsNote.textContent += (colsNote.textContent ? ' · ' : '') + t('mm.columns').replace('{list}', headers.join(', '));
    }
    const n = rows.length;
    if (st.i >= n) st.i = Math.max(0, n - 1);
    pos.textContent = n ? t('mm.record').replace('{i}', st.i + 1).replace('{n}', n) : t('mm.noRows');
    prev.disabled = st.i <= 0;
    next.disabled = st.i >= n - 1;
    goBtn.disabled = !n;
    preview.innerHTML = n ? ioSanitizeHtml(WM.mergeHtml(src, rows[st.i], headers).html) : '';
  }
  bContacts.addEventListener('click', () => { st.kind = 'contacts'; load(); });
  bCsv.addEventListener('click', () => {
    const host = dialogHost();
    const picked = host ? host.openFile('.csv,text/csv,.tsv,.txt') : localPickFile('.csv,text/csv,.tsv,.txt');
    picked.then(f => {
      if (!f) return;
      return f.text().then(txt => {
        const parsed = WM.parseCsv(txt);
        if (!parsed.headers.length) throw new Error('empty');
        st.csv = parsed;
        st.csvName = String(f.name || '').slice(0, 80);
        st.kind = 'csv';
        load();
      });
    }).catch(() => showToast(t('mm.csvBad')));
  });
  labelSel.addEventListener('change', () => { st.label = labelSel.value; load(); });
  prev.addEventListener('click', () => { if (st.i > 0) { st.i--; refresh(); } });
  next.addEventListener('click', () => { if (st.i < st.data.rows.length - 1) { st.i++; refresh(); } });
  load();
}

function mmFileName(row, headers, i, used) {
  const pick = (row.FullName || (headers[0] ? row[headers[0]] : '') || '').toString();
  const base = (String(i + 1).padStart(3, '0') + (pick ? ' ' + pick : ''))
    .replace(/[\\\/:*?"<>|\u0000-\u001F]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  let name = base + '.pdf', k = 2;
  while (used[name]) name = base + ' (' + (k++) + ').pdf';
  used[name] = 1;
  return name;
}

function mmRun(doc, src, st, dlg) {
  const rows = st.data.rows, headers = st.data.headers;
  if (!rows.length) { showToast(t('mm.noRows')); return; }
  let use = rows;
  if (st.out !== 'doc' && rows.length > MM_MAX_PDF) {
    use = rows.slice(0, MM_MAX_PDF);
    showToast(t('mm.capped').replace('{n}', MM_MAX_PDF));
  }
  const merged = use.map(r => WM.mergeHtml(src, r, headers).html);
  dlg.close();
  const done = () => showToast(t('mm.done').replace('{n}', use.length));
  const fail = err => { console.error('[orOS] writer mail merge failed:', err); showToast(t('io.exportfailed')); };

  if (st.out === 'doc') {
    const box = ioInertDiv();
    box.innerHTML = ioSanitizeHtml(merged.join(MM_PB));
    box.querySelectorAll('sup.fn-ref').forEach(s => s.remove());     // notes and comments stay in the original
    box.querySelectorAll('mark.cmt-mark').forEach(ioUnwrap);
    const nd = createDoc({ title: t('mm.docTitle').replace('{title}', doc.title || t('tab.untitled')).slice(0, 120),
                           html: box.innerHTML, silent: true });
    nd.pageSize = doc.pageSize;
    nd.margins = cleanMargins(doc.margins);
    nd.header = doc.header || '';
    nd.footer = doc.footer || '';
    nd.lang = cleanLang(doc.lang);
    stampDoc(nd);
    renderEditor();
    scheduleSave();
    done();
    return;
  }
  flushSave();
  const pdfDoc = Object.assign({}, doc, { comments: [] });
  if (st.out === 'pdf') {
    showToast(t('io.busy'));
    ioBuildPdf(pdfDoc, merged.join(MM_PB))
      .then(b => downloadBlob(b, ioBaseName(doc) + '.pdf', 'application/pdf'))
      .then(done, fail);
    return;
  }
  // a PDF per record, one after the other, then one ZIP
  const files = [], used = {};
  let chain = Promise.resolve();
  merged.forEach((html, i) => {
    chain = chain.then(() => {
      if (i % 10 === 0) showToast(t('mm.busy').replace('{i}', i + 1).replace('{n}', merged.length));
      return ioBuildPdf(pdfDoc, html);
    }).then(b => b.arrayBuffer()).then(ab => {
      files.push({ name: mmFileName(use[i], headers, i, used), data: new Uint8Array(ab) });
    });
  });
  chain.then(() => downloadBlob(ioZipStore(files), ioBaseName(doc) + '.zip', 'application/zip'))
    .then(done, fail);
}

// Boot LAST: every let/const above is initialized by now (no TDZ even
// if the script is ever injected after DOMContentLoaded).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
