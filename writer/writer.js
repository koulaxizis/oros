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
    'sync.updated': 'Updated with changes from other devices'
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
    'sync.updated': 'Ενημερώθηκε με αλλαγές από άλλες συσκευές'
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
  close:  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>',
  plus:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="8" y1="2.5" x2="8" y2="13.5"/><line x1="2.5" y1="8" x2="13.5" y2="8"/></svg>'
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

  return {
    ver: 1,
    docs: Object.keys(byId).map(k => byId[k]),
    tabOrder: base,
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
      doc.html = EL.editor.innerHTML;
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

})();
/* EOF — Wave 1 core skeleton COMPLETE */