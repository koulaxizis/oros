// ============================================================
// orOS Notes v0.13.0 — Plain-text wiki notebook (Zim-style)
//
// MANTRA (design contract, every orOS app):
//   Offline first · Mobile first · No external dependencies
//   Full project manual export · Full project automatic export
//   Full project snapshots · Full project auto-merge sync
//
// Sections:
//   1. Constants & state
//   2. Storage (load / normalize / save)
//   3. i18n (EN/EL, self-contained)
//   4. Tree render
//   5. Tree interactions (create / rename / delete / move)
//   6. Editor + autosave (debounce)
//   7. Sync slice registration + merge engine
//   8. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var APP_VERSION = "0.13.0";

  // ---------- 1. Constants & state ----------
  var STORAGE_KEY   = "oros-notes-data";
  var DATA_VER      = 1;
  var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
  var SAVE_DEBOUNCE_MS = 500;                          // keystroke → disk
  var ROOT_ID      = "root";                          // virtual tree root

  // Device-local (NEVER synced): expanded tree nodes, current page,
  // pane width. Server-side (synced): the pages themselves.
  var PREFS_KEY     = "oros-notes-prefs";   // { open: {id:1}, current: id, width: 270 }

  // state.pages — flat array, tree derived on render (same pattern
  // as Kanban: flat truth, tree is a projection).
  // Page: { id, parent, title, text, mtime, pos }
  //   parent: id of parent page ("root" = top level)
  //   mtime:  per-page epoch ms (merge engine: last-writer wins per page)
  //   pos:    sibling order within parent
  var state = {
    pages: [],          // syncable truth
    tombs: {},          // { id: ts } deleted pages (pruned after 30d)
    openIds: {},        // device-local expanded tree nodes
    currentId: null,   // device-local selected page
    dirty: false        // unflushed keystrokes (autosave buffer)
  };

  // ---------- 2. Storage ----------
  function loadData() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!raw || typeof raw !== "object") return migrateEmpty();
      if (raw.ver !== DATA_VER) return migrate(raw);
      state.pages = Array.isArray(raw.pages) ? raw.pages : [];
      state.tombs = (raw.tombs && typeof raw.tombs === "object") ? raw.tombs : {};
      normalize();
    } catch (e) {
      return migrateEmpty();
    }
  }

  function migrateEmpty() {
    state.pages = [];
    state.tombs = {};
    // First-run welcome page — one page, so the app never boots empty.
    var welcome = {
      id: newId(),
      parent: ROOT_ID,
      title: "",
      text: "",
      mtime: Date.now(),
      pos: 0
    };
    welcome.title = window.t ? t("notes.welcome.title") : "Welcome";
    welcome.text  = window.t ? t("notes.welcome.text")  : "";
    state.pages.push(welcome);
    state.currentId = welcome.id;
  }

  // Version migrations live here later (ver 1 → 2 …). Today: pass-through.
  function migrate(raw) {
    state.pages = Array.isArray(raw.pages) ? raw.pages : [];
    state.tombs = (raw.tombs && typeof raw.tombs === "object") ? raw.tombs : {};
    normalize();
  }

  // Defensive sanitation of pulled/loaded data: ids, parents, positions.
  function normalize() {
    var seen = {};
    var i;
    for (i = state.pages.length - 1; i >= 0; i--) {
      var p = state.pages[i];
      if (!p || typeof p.id !== "string" || !p.id) { state.pages.splice(i, 1); continue; }
      if (seen[p.id]) { state.pages.splice(i, 1); continue; }   // dup → newest kept later by id? No: LAST wins → splice earlier
      seen[p.id] = true;
      p.parent = (typeof p.parent === "string" && p.parent) ? p.parent : ROOT_ID;
      p.title = String(p.title == null ? "" : p.title);
      p.text  = String(p.text == null ? "" : p.text);
      p.mtime = Number(p.mtime) || 0;
      p.pos   = Number(p.pos) || 0;
    }
    // Orphans: parent dead (deleted or never existed) → top level.
    // (Delete cascades on purpose: tombstoned parents take children
    // with them — see section 5. But corrupt/foreign parent ids land here.)
    for (i = 0; i < state.pages.length; i++) {
      var q = state.pages[i];
      if (q.parent !== ROOT_ID && !seen[q.parent]) q.parent = ROOT_ID;
    }
    pruneTombs();
  }

  function pruneTombs() {
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(state.tombs).forEach(function (id) {
      if (state.tombs[id] < cutoff) delete state.tombs[id];
    });
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ver: DATA_VER,
        pages: state.pages,
        tombs: state.tombs
      }));
      return true;
    } catch (e) {
      return false;   // quota — autosave indicator goes red, data
                      // stays in memory; next save attempt retries
    }
  }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null") || {};
      state.openIds = (p.open && typeof p.open === "object") ? p.open : {};
      state.currentId = typeof p.current === "string" ? p.current : null;
      state.width = Number(p.width) || 270;
    } catch (e) { /* defaults already set */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        open: state.openIds,
        current: state.currentId,
        width: state.width
      }));
    } catch (e) { /* prefs are expendable */ }
  }

  function newId() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // ---------- 3. i18n (EN/EL, self-contained — no loader, no 404s) ----------
  var I18N = {
    en: {
      "notes.app":            "Notes",
      "notes.new.page":        "New page",
      "notes.new.child":       "New subpage",
      "notes.title.ph":        "Title",
      "notes.text.ph":         "Start typing…",
      "notes.delete":          "Delete page",
      "notes.delete.confirm":  "Delete this page and all its subpages?",
      "notes.saved":           "Saved",
      "notes.unsaved":         "Unsaved changes",
      "notes.save.failed":    "Save failed — storage full?",
      "notes.empty.title":    "Untitled",
      "notes.welcome.title":  "Welcome",
      "notes.welcome.text":   "This is your notebook. Plain text, nothing else.\n\nOrganize pages in the tree — every page can hold subpages.",
      "notes.count":          "{n} pages",
      "notes.no.selection":   "Select a page to start writing.",
      "sync.merged":          "Merged changes from sync"
    },
    el: {
      "notes.app":            "Σημειώσεις",
      "notes.new.page":       "Νέα σελίδα",
      "notes.new.child":      "Νέα υποσελίδα",
      "notes.title.ph":       "Τίτλος",
      "notes.text.ph":        "Ξεκίνα να γράφεις…",
      "notes.delete":         "Διαγραφή σελίδας",
      "notes.delete.confirm": "Διαγραφή αυτής της σελίδας και όλων των υποσελίδων της;",
      "notes.saved":          "Αποθηκεύτηκε",
      "notes.unsaved":        "Μη αποθηκευμένες αλλαγές",
      "notes.save.failed":    "Αποτυχία αποθήκευσης — γεμάτος χώρος;",
      "notes.empty.title":    "Χωρίς τίτλο",
      "notes.welcome.title":  "Καλωσόρισες",
      "notes.welcome.text":   "Αυτό είναι το σημειωματάριό σου. Απλό κείμενο, τίποτα άλλο.\n\nΟργάνωσε τις σελίδες στο δέντρο — κάθε σελίδα μπορεί να έχει υποσελίδες.",
      "notes.count":          "{n} σελίδες",
      "notes.no.selection":   "Διάλεξε σελίδα για να γράψεις.",
      "sync.merged":          "Συγχωνεύτηκαν αλλαγές από το sync"
    }
  };

  // Window-global t(): inherits parent shell language when embedded,
  // falls back to own dictionary. URL override ?lang= for standalone use.
  function detectLang() {
    var p = new URLSearchParams(window.location.search).get("lang");
    if (p === "en" || p === "el") return p;
    if (window.parent !== window && window.parent.orosLang &&
        (window.parent.orosLang === "en" || window.parent.orosLang === "el")) {
      return window.parent.orosLang;
    }
    var st = localStorage.getItem("oros-lang");
    return (st === "en" || st === "el") ? st : "en";
  }

  var LANG = detectLang();

  function t(key) {
    var d = I18N[LANG] || I18N.en;
    return d[key] != null ? d[key] : key;
  }
  window.t = t;

  function applyI18n() {
    document.documentElement.setAttribute("lang", LANG);
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    var titled = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < titled.length; j++) {
      titled[j].setAttribute("title", t(titled[j].getAttribute("data-i18n-title")));
      titled[j].setAttribute("aria-label", titled[j].getAttribute("title"));
    }
    var phs = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < phs.length; k++) {
      phs[k].setAttribute("placeholder", t(phs[k].getAttribute("data-i18n-ph")));
    }
  }

    // ---------- 4. Tree render ----------
  // The tree is a PROJECTION of the flat pages array (Kanban
  // pattern): flat truth, derived view. Every render rebuilds from
  // state — cheap at notebook scale (hundreds of pages), immune to
  // DOM/state drift.

  var CARET_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="9 18 15 12 9 6"/></svg>';
  var DOC_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/></svg>';
  var PLUS_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  // id → page map + id → [children ids] built once per render.
  var idxPages = {};
  var idxKids  = {};

  function buildIndexes() {
    idxPages = {};
    idxKids  = {};
    for (var i = 0; i < state.pages.length; i++) {
      var p = state.pages[i];
      idxPages[p.id] = p;
    }
    for (var j = 0; j < state.pages.length; j++) {
      var q = state.pages[j];
      (idxKids[q.parent] = idxKids[q.parent] || []).push(q.id);
    }
    // Sibling order by pos (ties → title, deterministic across
    // devices regardless of insertion order).
    Object.keys(idxKids).forEach(function (pid) {
      idxKids[pid].sort(function (a, b) {
        var pa = idxPages[a], pb = idxPages[b];
        if (pa.pos !== pb.pos) return pa.pos - pb.pos;
        return pa.title < pb.title ? -1 : pa.title > pb.title ? 1 : 0;
      });
    });
  }

  function kidsOf(id) {
    return idxKids[id] || [];
  }

  function pageTitle(id) {
    var p = idxPages[id];
    return (p && p.title) ? p.title : t("notes.empty.title");
  }

  // Ancestors of the current page get auto-expanded so the selection
  // is never hidden in a collapsed branch after a re-render (sync
  // pull, language change, mobile return).
  function ensureVisible(id) {
    var walk = id;
    var guard = 0;
    while (walk && walk !== ROOT_ID && idxPages[walk] && guard++ < 200) {
      state.openIds[walk] = 1;
      walk = idxPages[walk].parent;
    }
  }

  function renderTree() {
    buildIndexes();

    // Sanitize selection: current page may have been deleted by a
    // sync merge. Fall back to first top-level page, then null.
    if (state.currentId && !idxPages[state.currentId]) {
      var tops = kidsOf(ROOT_ID);
      state.currentId = tops.length ? tops[0] : null;
    }

    var root = document.getElementById("tree-root");
    root.innerHTML = "";

    var tops2 = kidsOf(ROOT_ID);
    if (!tops2.length) {
      var empty = document.createElement("li");
      empty.className = "tree-empty";
      empty.textContent = t("notes.no.selection");
      root.appendChild(empty);
      // No pages at all → currentId must be null (verified above)
      savePrefs();
    } else {
      if (state.currentId) ensureVisible(state.currentId);
      tops2.forEach(function (id) {
        root.appendChild(buildNode(id));
      });
    }

    renderCount();
    renderEditor();   // keep title/text in sync with (possibly new)
                       // current page after every tree render
  }

  // Recursive node builder. Depth guard is a belt-and-braces measure
  // against cycles corrupting localStorage (normalize() kills orphan
  // parents, not cycles — a cycle would loop forever here otherwise).
  function buildNode(id, depth) {
    depth = depth || 0;
    var li = document.createElement("li");
    li.className = "node" + (state.openIds[id] ? " open" : "");

    var kids = kidsOf(id);

    var row = document.createElement("div");
    row.className = "node-row" + (state.currentId === id ? " active" : "");
    row.dataset.id = id;

    // Caret: only meaningful when children exist — otherwise hidden
    // (keeps tap targets aligned, no dead-zone taps).
    var caret = document.createElement("button");
    caret.className = "node-caret" + (kids.length ? "" : " hidden");
    caret.setAttribute("tabindex", "-1");
    caret.setAttribute("aria-label", "toggle");
    caret.innerHTML = CARET_SVG;
    if (kids.length) {
      caret.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleNode(id);
      });
    }
    row.appendChild(caret);

    var ico = document.createElement("span");
    ico.className = "node-ico";
    ico.innerHTML = DOC_SVG;
    row.appendChild(ico);

    var label = document.createElement("span");
    label.className = "node-label";
    label.textContent = pageTitle(id);
    row.appendChild(label);

    if (kids.length) {
      var cnt = document.createElement("span");
      cnt.className = "node-count";
      cnt.textContent = String(kids.length);
      row.appendChild(cnt);
    }

    // Select = one tap anywhere on the row (mobile-first: biggest
    // target wins; caret stops propagation for branch toggling).
    row.addEventListener("click", function () {
      selectPage(id);
    });

    li.appendChild(row);

    if (kids.length && depth < 100) {
      var ul = document.createElement("ul");
      ul.className = "node-kids";
      kids.forEach(function (kid) {
        ul.appendChild(buildNode(kid, depth + 1));
      });
      li.appendChild(ul);
    }

    return li;
  }

  function toggleNode(id) {
    if (state.openIds[id]) delete state.openIds[id];
    else state.openIds[id] = 1;
    savePrefs();
    renderTree();
  }

  function selectPage(id) {
    if (state.dirty) flushSave();     // leaving a page with pending
                                      // keystrokes — never lose them
    state.currentId = id;
    state.openIds[id] = 1;             // selecting implies expanding
    savePrefs();
    renderTree();
    // Mobile: tree overlay closes on selection (one screen at a time)
    document.getElementById("notes-app").classList.remove("tree-open");
  }

  // Status line under the tree header: total page count.
  function renderCount() {
    var el = document.getElementById("tree-title");
    el.textContent = t("notes.app") + " · " + state.pages.length;
  }

    // ---------- 5. Tree interactions ----------
  // All mutations follow the same discipline:
  //   mutate → touch mtime → save → markDirty (sync) → re-render.
  // One helper guarantees nothing forgets a step (the Kanban lesson:
  // stampAll exists BECAUSE someone once forgot an om stamp).

  function touch(p) {
    p.mtime = Date.now();
  }

  function commit() {
    if (!saveData()) {
      // Quota refused the write — scream once, never silently.
      // (Indicator dot goes red via editor state — see section 6.)
      setEditorState("dirty");
    }
    if (window.orosSync && typeof window.orosSync.markDirty === "function") {
      window.orosSync.markDirty();
    }
    renderTree();
  }

  // --- Create ---

  function createPage(parentId) {
    parentId = parentId || ROOT_ID;
    // Expanding the parent makes the newborn visible immediately —
    // creating a subpage inside a collapsed node would look like
    // "nothing happened".
    if (parentId !== ROOT_ID) state.openIds[parentId] = 1;

    var p = {
      id: newId(),
      parent: parentId,
      title: "",
      text: "",
      mtime: Date.now(),
      // pos: below ALL existing siblings (max + 1) — append, never
      // guess, never collide.
      pos: nextPos(parentId)
    };
    state.pages.push(p);
    state.currentId = p.id;
    savePrefs();
    commit();
    // Focus goes straight into the title: naming IS the first act.
    var title = document.getElementById("page-title");
    if (title) title.focus();
  }

  function nextPos(parentId) {
    var kids = kidsOf(parentId);   // sorted by buildIndexes — last is max pos
    if (!kids.length) return 0;
    var maxP = idxPages[kids[kids.length - 1]].pos;
    return (Number(maxP) || 0) + 1;
  }

  // --- Rename (inline, via the editor header input — section 6) ---
  // Title edits are just page edits: same mtime/touch/commit path.

  // --- Delete: tombstone + cascade ---
  // Same doctrine as Kanban: deleting a container kills the branch.
  // Children get their OWN tombstones (not just orphaning) — orphans
  // resurrecting on another device after a merge is the bug this
  // prevents. All stamps share one timestamp: the merge engine sees
  // one atomic deletion, not a trickle.

  function collectDescendants(id, out) {
    var kids = kidsOf(id);
    for (var i = 0; i < kids.length; i++) {
      out.push(kids[i]);
      collectDescendants(kids[i], out);
    }
  }

  function deletePage(id) {
    if (!idxPages[id]) return;
    var doomed = [id];
    collectDescendants(id, doomed);

    var msg = doomed.length > 1
      ? t("notes.delete.confirm")
      : t("notes.delete.confirm");   // single-string confirm: minimal core
    if (!window.confirm(msg)) return;

    var ts = Date.now();
    for (var i = 0; i < doomed.length; i++) {
      var pid = doomed[i];
      state.tombs[pid] = ts;
      for (var j = state.pages.length - 1; j >= 0; j--) {
        if (state.pages[j].id === pid) { state.pages.splice(j, 1); break; }
      }
      delete state.openIds[pid];
    }

    // Selection falls to the deleted node's parent — the natural
    // "where was I" answer (falls to first top-level in renderTree
    // when nothing remains).
    state.currentId = (id !== ROOT_ID && idxPages[id]) ? id : null;
    if (state.currentId === id || !idxPages[id]) {
      state.currentId = null;   // deleted → renderTree picks a sane fallback
    }
    savePrefs();
    commit();
  }

  // --- Reorder (move up/down within siblings) ---
  // Minimal-core move UI: no drag-and-drop yet (Wave 2 candidate #9).
  // Up/down swaps pos with the adjacent sibling and rewrites both
  // mtimes — the merge engine arbitrates honestly if two devices
  // reordered concurrently.

  function movePage(id, dir) {
    var p = idxPages[id];
    if (!p) return;
    var kids = kidsOf(p.parent);            // sorted array of ids
    var i = kids.indexOf(id);
    var j = i + dir;                         // dir: -1 up, +1 down
    if (j < 0 || j >= kids.length) return;   // already at the edge

    var other = idxPages[kids[j]];
    // Swap pos values. Ties (both equal) → nudge by half-step so the
    // swap is real even in degenerate data (title tiebreak keeps
    // devices deterministic meanwhile).
    var tmp = p.pos;
    p.pos = other.pos;
    other.pos = tmp;
    if (p.pos === other.pos) {
      p.pos = other.pos + (dir === -1 ? -0.5 : 0.5);
    }
    touch(p);
    touch(other);
    commit();
  }

  // Long-press context actions (mobile) / right-click (desktop):
  // one compact menu per node. Minimal: rename via select, so only
  // subpage-create / delete / move live here.
  function openNodeMenu(id, x, y) {
    closeNodeMenu();
    var menu = document.createElement("div");
    menu.id = "node-menu";

    var items = [
      { key: "notes.new.child", fn: function () { createPage(id); } },
      { key: "notes.delete",    fn: function () { deletePage(id); } }
    ];

    var kids = kidsOf(id);
    var siblings = (idxPages[id] ? kidsOf(idxPages[id].parent) : []);
    var si = siblings.indexOf(id);
    if (si > 0) {
      items.push({ key: "▲", fn: function () { movePage(id, -1); } });
    }
    if (si < siblings.length - 1) {
      items.push({ key: "▼", fn: function () { movePage(id, 1); } });
    }

    items.forEach(function (it) {
      var b = document.createElement("button");
      b.className = "node-menu-item";
      b.textContent = (it.key === "▲" || it.key === "▼") ? it.key : t(it.key);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        closeNodeMenu();
        it.fn();
      });
      menu.appendChild(b);
    });

    document.body.appendChild(menu);

    // Clamp inside the viewport (mobile edge-case: menus spawning
    // half-off-screen at the right edge).
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth  - r.width  - 4)) + "px";
    menu.top = 0;
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + "px";
  }

  function closeNodeMenu() {
    var m = document.querySelector("#node-menu");
    if (m) m.remove();
    var m2 = document.getElementById("node-menu");
    if (m2) m2.remove();
  }

  // ---------- 6. Editor + autosave ----------

  var SAVE_DEBOUNCE = SAVE_DEBOUNCE_MS;
  var saveTimer = null;

  function currentPage() {
    return state.currentId ? idxPages[state.currentId] : null;
  }

  // Indicator states: idle (grey) → dirty (red) → saved (purple).
  function setEditorState(s) {
    var ind = document.getElementById("save-indicator");
    if (ind) ind.setAttribute("data-state", s);
  }

  function renderEditor() {
    var p = currentPage();
    var title = document.getElementById("page-title");
    var text  = document.getElementById("page-text");

    if (!p) {
      title.value = "";
      text.value = "";
      title.disabled = true;
      text.disabled = true;
      text.placeholder = t("notes.no.selection");
      setEditorState("idle");
      return;
    }
    title.disabled = false;
    text.disabled = false;
    text.placeholder = t("notes.text.ph");
    // Fill only when the DOM differs — writing the same value into a
    // focused input would move the caret to the end mid-typing (the
    // classic re-render-eats-my-cursor bug).
    if (title.value !== p.title) title.value = p.title;
    if (text.value  !== p.text)  text.value  = p.text;
    setEditorState("idle");
  }

  function flushSave() {
    if (!state.dirty) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNow();
  }

  function scheduleSave() {
    state.dirty = true;
    setEditorState("dirty");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE);
  }

  function saveNow() {
    state.dirty = false;
    var p = currentPage();
    if (!p) { setEditorState("idle"); return; }

    var title = document.getElementById("page-title").value;
    var text  = document.getElementById("page-text").value;

    // Skip no-op writes: identical content → no mtime touch →
    // no phantom "changes" reaching the merge engine.
    if (p.title === title && p.text === text) {
      setEditorState("saved");
      return;
    }

    p.title = title;
    p.text  = text;
    touch(p);
    if (saveData()) {
      setEditorState("saved");
    } else {
      setEditorState("dirty");   // quota — retried on next keystroke
    }
    if (window.orosSync && typeof window.orosSync.markDirty === "function") {
      window.orosSync.markDirty();
    }
    // Title changed → the tree label must follow (targeted, not a
    // full renderTree: full rebuild here would fight the focused
    // input on every save).
    var label = document.querySelector('.node-row[data-id="' + p.id + '"] .node-label');
    if (label) label.textContent = title || t("notes.empty.title");
  }

    // ---------- 7. Sync slice + merge engine ----------
  // Architecture clone of the Kanban/Todo engines, adapted to a flat
  // page list (much simpler than Kanban: no per-entity substructures,
  // just LWW-per-page + placement arbitration).
  //
  // Merge rules (mirroring the Kanban doctrine):
  //   1. Per-page LWW: higher mtime wins, ties → pickRef tie-break
  //      (lexicographic JSON of the page — deterministic on all
  //      devices regardless of pull order).
  //   2. Tombstones: union of both sides, pruned after 30 days.
  //      A tomb wins over a live page whose mtime is older than
  //      (or tied with) the tomb's ts. A page EDITED after the
  //      deletion (mtime > ts) resurrects — legitimate "undo by
  //      retyping", same semantics as Todo/Kanban.
  //   3. Placement (parent/pos): dictated by the WINNING side of the
  //      page's content. No cross-side mixing.
  //   4. Orphan rule: winner page whose parent is dead (tombstoned
  //      or absent) dies with it — cascading tombstone, same ts as
  //      the merge resolution (atomic, one stamp).
  //   5. Cycle guard: a page whose ancestor chain contains itself
  //      is re-parented to ROOT (corrupt data can never freeze the
  //      renderer — defense in depth with buildNode's depth cap).

  function pageRef(p) {
    // Canonical serialization for tie-breaks: key order fixed by
    // explicit construction, never by insertion luck.
    return JSON.stringify([p.id, p.parent, p.title, p.text, p.pos]);
  }

  function pickPage(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.mtime !== b.mtime) return a.mtime > b.mtime ? a : b;
    var ra = pageRef(a), rb = pageRef(b);
    if (ra === rb) return a;
    return ra < rb ? a : b;   // lexicographic — deterministic
  }

  function mergeNotesStates(localStr, remoteStr) {
    var local  = JSON.parse(localStr  || '{"ver":1,"pages":[],"tombs":{}}');
    var remote = JSON.parse(remoteStr || '{"ver":1,"pages":[],"tombs":{}}');

    var lp = Array.isArray(local.pages)  ? local.pages  : [];
    var rp = Array.isArray(remote.pages) ? remote.pages : [];

    var lt = (local.tombs  && typeof local.tombs  === "object") ? local.tombs  : {};
    var rt = (remote.tombs && typeof remote.tombs === "object") ? remote.tombs : {};

    var localChanged  = false;
    var remoteApplied = false;

    // --- 1. Tombstone union ---
    var tombs = {};
    Object.keys(lt).forEach(function (id) { tombs[id] = lt[id]; });
    Object.keys(rt).forEach(function (id) {
      if (!tombs[id] || rt[id] > tombs[id]) {
        tombs[id] = rt[id];
        if (lt[id] !== undefined) localChanged = true;  // our tomb lost to a newer one (impossible, but honest)
      } else {
        remoteApplied = true;                             // their tomb lost to ours
      }
    });
    if (Object.keys(rt).some(function (id) { return lt[id] === undefined; })) {
      remoteApplied = true;                               // pure-remote tomb arrived
    }

    // --- 2. Page union with tomb arbitration ---
    var byId = {};
    lp.forEach(function (p) { byId[p.id] = p; });
    rp.forEach(function (p) {
      var mine = byId[p.id];
      var tombTs = tombs[p.id];
      var theirs = p;
      if (tombTs != null) {
        // Tomb newer than (or tied with) their edit → their page is dead.
        // Strictly newer only: a tie means same-instant delete+edit —
        // deletion wins (matches the Todo engine's stance).
        if (theirs.mtime <= tombTs) {
          remoteApplied = (mine === undefined);   // remote never landed locally before
          return;
        }
      }
      if (mine === undefined) {
        byId[p.id] = theirs;
        remoteApplied = true;
      } else {
        var winner = pickPage(mine, theirs);
        if (winner !== mine) {
          byId[p.id] = winner;
          remoteApplied = true;
        } else if (pageRef(mine) !== pageRef(theirs)) {
          localChanged = true;
        }
      }
    });
    // Local pages vs our own tombs (delete-then-sync round trip):
    Object.keys(byId).forEach(function (id) {
      var ts = tombs[id];
      if (ts != null && byId[id] && byId[id].mtime <= ts) delete byId[id];
    });

    // --- 3. Orphan rule: dead parent → child dies (cascade) ---
    // Iterate until stable: a dying parent can doom grandchildren.
    var ids = Object.keys(byId);
    var doomed = {};
    var stable = false;
    while (!stable) {
      stable = true;
      ids.forEach(function (id) {
        if (doomed[id]) return;
        var p = byId[id];
        if (!p || p.parent === ROOT_ID) return;
        var parentAlive = byId[p.parent] && !doomed[p.parent];
        if (!parentAlive) {
          doomed[id] = true;
          stable = false;                              // cascade another round
        }
      });
    }
    var cascadeTs = Date.now();   // one atomic stamp for the whole cascade
    Object.keys(doomed).forEach(function (id) { tombs[id] = cascadeTs; });

    // --- 4. Cycle guard: ancestor loop → re-parent to ROOT ---
    Object.keys(byId).forEach(function (id) {
      var p = byId[id];
      if (p.parent === ROOT_ID) return;
      var seen = {}; seen[id] = 1;
      var walk = p.parent;
      var guard = 0;
      while (walk && walk !== ROOT_ID && byId[walk] && guard++ < 500) {
        if (seen[walk]) { p.parent = ROOT_ID; return; }   // loop → top level
        seen[walk] = 1;
        walk = byId[walk].parent;
      }
    });

    var pages = Object.keys(byId).map(function (id) { return byId[id]; });

    return {
      ver: DATA_VER,
      pages: pages,
      tombs: tombs,
      changed: localChanged || remoteApplied   // caller decides whether to save/render
    };
  }

  // Slice getters/setters — the sync engine's whole interface to us.
  function sliceGet() {
    return JSON.stringify({
      ver: DATA_VER,
      pages: state.pages,
      tombs: state.tombs
    });
  }

  function sliceSet(mergedStr) {
    // Fed ONLY by pulls (post-merge) and imports — NEVER by user
    // actions. No markDirty here (pull → set → push loop is the
    // cardinal sin; the shell taught us this in blood).
    try {
      var raw = JSON.parse(mergedStr);
      state.pages = Array.isArray(raw.pages) ? raw.pages : [];
      state.tombs = (raw.tombs && typeof raw.tombs === "object") ? raw.tombs : {};
      normalize();
      saveData();
      flushSaveCancelled();          // pending keystrokes of a DEAD page must not overwrite the merge
      renderTree();
    } catch (e) {
      // Corrupt payload must never take the notebook down with it.
      console.warn("[notes] sliceSet: corrupt payload ignored", e);
    }
  }

  function flushSaveCancelled() {
    // If a debounced save was armed against a page that no longer
    // exists post-merge, disarm it — resurfacing it would resurrect
    // deleted content (the resurrect-the-deleted bug, preempted).
    var pend = state.currentId;
    if (saveTimer && pend && !state.pages.some(function (p) { return p.id === pend; })) {
      clearTimeout(saveTimer);
      saveTimer = null;
      state.dirty = false;
    }
  }

  function registerNotesSlice() {
    if (window.orosSync && typeof window.orosSync.registerSlice === "function") {
      window.orosSync.registerSlice(
        "notes",
        sliceGet,
        sliceSet,
        function (localStr, remoteStr) {     // mergeFn
          var m = mergeNotesStates(localStr, remoteStr);
          return JSON.stringify({
            ver: m.ver, pages: m.pages, tombs: m.tombs
          });
        }
      );
    }
  }

  // ---------- 8. Splitter, wiring & boot ----------

  // Desktop pane resize — width persisted in prefs (device-local).
  function initSplitter() {
    var sp = document.getElementById("pane-splitter");
    var app = document.getElementById("notes-app");
    var tree = document.getElementById("tree-pane");
    var startX = 0, startW = 0, dragging = false;

    function onMove(e) {
      if (!dragging) return;
      var x = (e.touches && e.touches.length) ? e.touches[0].clientX : e.clientX;
      var w = startW + (x - startX);
      w = Math.max(180, Math.min(Math.min(480, window.innerWidth * 0.6), w));
      tree.style.flex = "0 0 " + w + "px";
      tree.style.width = w + "px";
      state.width = w;
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("resizing");
      savePrefs();
    }
    sp.addEventListener("mousedown", function (e) { start(e.clientX); });
    sp.addEventListener("touchstart", function (e) {
      if (e.touches.length) start(e.touches[0].clientX);
    }, { passive: true });
    function start(x) {
      dragging = true;
      startX = x;
      startW = tree.getBoundingClientRect().width || state.width;
      document.body.classList.add("resizing");
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);

    if (state.width && state.width >= 180) {
      tree.style.flex = "0 0 " + state.width + "px";
      tree.style.width = state.width + "px";
    }
  }

  function wireUI() {
    // Mobile: tree overlay toggle
    document.getElementById("btn-show-tree").innerHTML = DOC_SVG;
    document.getElementById("btn-show-tree").addEventListener("click", function () {
      document.getElementById("notes-app").classList.toggle("tree-open");
    });

    // New top-level page (footer button)
    var nb = document.getElementById("btn-new-page");
    nb.innerHTML = PLUS_SVG;
    nb.addEventListener("click", function () {
      createPage(ROOT_ID);
      document.getElementById("notes-app").classList.add("tree-open");
      // Mobile: after creating, tree closes on select — but the new
      // page IS selected with an empty title, so jump straight to
      // the editor instead. (tree-open above is for desktop-wide view.)
      document.getElementById("notes-app").classList.remove("tree-open");
    });

    // New-page button inside node menu → createPage handles focusing.
    // Editor bindings — the ONLY writers of page content.
    document.getElementById("page-title").addEventListener("input", scheduleSave);
    document.getElementById("page-text").addEventListener("input", scheduleSave);

    // Node context menu: right-click desktop / long-press mobile.
    var longPressTimer = null;
    var root = document.getElementById("tree-root");
    root.addEventListener("contextmenu", function (e) {
      var row = e.target.closest ? e.target.closest(".node-row") : null;
      if (!row) return;
      e.preventDefault();
      openNodeMenu(row.dataset.id, e.clientX, e.clientY);
    });
    root.addEventListener("touchstart", function (e) {
      var row = e.target.closest ? e.target.closest(".node-row") : null;
      if (!row) return;
      var tx = e.touches[0].clientX, ty = e.touches[0].clientY;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        openNodeMenu(row.dataset.id, tx, ty);
      }, 550);
    }, { passive: true });
    root.addEventListener("touchend", function () {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });
    root.addEventListener("touchmove", function () {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });
    root.addEventListener("scroll", function () { closeNodeMenu(); }, true);

    // Any tap outside the menu closes it.
    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("#node-menu")) return;
      closeNodeMenu();
    });

    // Leaving the app with pending keystrokes: flush NOW, not "later".
    window.addEventListener("beforeunload", function () { flushSave(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushSave();
    });

    // Esc = mobile tree close / menu close (desktop Esc is owned by
    // the shell when embedded — keydown bubbles only inside iframe).
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeNodeMenu();
        document.getElementById("notes-app").classList.remove("tree-open");
      }
    });
  }

  // ---------- Boot ----------
  loadPrefs();
  loadData();
  applyI18n();
  renderTree();
  registerNotesSlice();
  wireUI();
  initSplitter();

})();
  
  