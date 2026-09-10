// ============================================================
// orOS Notes v0.13.1 — Plain-text wiki notebook (Zim-style)
//
// MANTRA (design contract, every orOS app):
//   Offline first · Mobile first · No external dependencies
//   Full project manual export · Full project automatic export
//   Full project snapshots · Full project auto-merge sync
//
// ARCHITECTURE CONTRACTS (v0.13.1, canonical: todo.js):
//   - Palette inheritance: shell CSS variables injected from the
//     parent <html> computed styles (same-origin iframe) at boot,
//     re-injected via MutationObserver on data-skin/data-theme.
//   - orosSync lives on window.parent when embedded — always
//     resolved through syncApi(), never window.orosSync directly.
//
// Sections:
//   1. Constants & state
//   2. Storage (load / normalize / save) + syncApi resolver
//   3. i18n (EN/EL, self-contained)
//   3b. Palette inheritance (shell contract)
//   4. Tree render
//   5. Tree interactions (create / rename / delete / move / menu)
//   6. Editor + autosave (debounce)
//   7. Sync slice registration + merge engine
//   8. Splitter, wiring & boot
// ============================================================
(function () {
  "use strict";

  var APP_VERSION = "0.13.1";

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
    currentId: null,    // device-local selected page
    width: 270,         // device-local tree pane width
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
    welcome.title = t("notes.welcome.title");
    welcome.text  = t("notes.welcome.text");
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
      // Missing/duplicate ids: the LAST occurrence in array order
      // survives (append-newest convention, same as Todo).
      if (!p || typeof p.id !== "string" || !p.id || seen[p.id]) {
        state.pages.splice(i, 1);
        continue;
      }
      seen[p.id] = true;
      p.parent = (typeof p.parent === "string" && p.parent) ? p.parent : ROOT_ID;
      p.title = String(p.title == null ? "" : p.title);
      p.text  = String(p.text == null ? "" : p.text);
      p.mtime = Number(p.mtime) || 0;
      p.pos   = Number(p.pos) || 0;
    }
    // Orphans: parent dead (deleted or never existed) → top level.
    // (Deliberate deletes cascade their OWN tombstones in section 5;
    // corrupt/foreign parent ids land HERE instead.)
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
      return false;   // quota — data stays in memory; the next save
                      // attempt retries, indicator stays red meanwhile
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

  // orosSync lives on the PARENT window when we're embedded in the
  // shell iframe — same-origin, so it's reachable. Standalone open
  // (dev / direct URL) falls back to a same-window instance if any.
  // Asking window.orosSync directly SILENTLY disables slice
  // registration inside the shell — v0.13.1 fix, never again.
  function syncApi() {
    return (window.parent && window.parent.orosSync) || window.orosSync || null;
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
      "notes.save.failed":     "Save failed — storage full?",
      "notes.empty.title":     "Untitled",
      "notes.welcome.title":   "Welcome",
      "notes.welcome.text":    "This is your notebook. Plain text, nothing else.\n\nOrganize pages in the tree — every page can hold subpages.",
      "notes.count":            "{n} pages",
      "notes.no.selection":    "Select a page to start writing.",
      "notes.move.up":         "Move up",
      "notes.move.down":       "Move down",
      "notes.menu.rename":     "Rename",
      "sync.merged":           "Merged changes from sync"
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
      "notes.move.up":        "Πάνω",
      "notes.move.down":      "Κάτω",
      "notes.menu.rename":    "Μετονομασία",
      "sync.merged":          "Συγχωνεύτηκαν αλλαγές από το sync"
    }
  };

  // Language: URL override (?lang=) > parent shell (same-origin
  // iframe) > shared localStorage > English default.
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

  // ---------- 3b. Palette inheritance (shell contract) ----------
  // Same-origin iframe: read the parent <html> computed styles and
  // inject them as our own — the app follows the active skin and
  // dark/light theme. Standalone open (catch path) keeps the
  // oros-skin fallback values from notes.css.
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone (direct) open — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
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
    // sync merge. Fall back to first top-level page, then none.
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
      state.currentId = null;   // verified empty above — selection cleared
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
  // parents, the merge kills loops — a cycle would hang the render
  // otherwise; defense in depth on all three layers).
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

    // ===== 5. TREE INTERACTIONS =====

  var $ = function (id) { return document.getElementById(id); };

  // i18n addendum (menu/toast keys used only by this section)
  I18N.en["notes.toast.deleted"] = "Deleted";
  I18N.el["notes.toast.deleted"] = "Διαγράφηκε";

  function currentPage() {
    return state.currentId ? idxPages[state.currentId] : null;
  }

  // THE single mutation exit point (Kanban/Todo parity):
  // save → mark dirty (sync) → re-render. Everything funnels here.
  function commit() {
    saveData();
    markSyncDirty();
    renderTree();
  }

  // ---- Page creation ----
  function createPage(parentId) {
    flushSave();                                  // never strand pending edits
    parentId = (parentId && idxPages[parentId]) ? parentId : ROOT_ID;
    var page = {
      id: newId(),
      parent: parentId,
      title: "",
      text: "",
      mtime: Date.now(),
      pos: kidsOf(parentId).length                // append at end of siblings
    };
    state.pages.push(page);
    state.currentId = page.id;
    state.openIds[parentId] = 1;                   // parent expands to reveal it
    savePrefs();
    commit();
    var tEl = $("page-title");
    tEl.focus();
    tEl.select();                                  // straight into naming
  }

  // ---- Delete (cascade tombstones — merge-safe, Todo parity) ----
  function deletePage(id) {
    var page = idxPages[id];
    if (!page) return;

    // Collect the whole subtree (idxKids is current post-render).
    var doomed = [id];
    for (var i = 0; i < doomed.length; i++) {
      kidsOf(doomed[i]).forEach(function (kid) { doomed.push(kid); });
    }

    // Disarm a pending debounce pointing at a doomed page — the
    // page is about to vanish; flushing into it would resurrect a
    // dead id ("flushSaveCancelled" contract, v0.13.0).
    if (pendingId && doomed.indexOf(pendingId) !== -1) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
      pendingId = null;
      state.dirty = false;
      setIndicator("idle");
    }

    var parentId = page.parent;
    var parentAlive = (parentId !== ROOT_ID) &&
      doomed.indexOf(parentId) === -1 && state.pages.indexOf(idxPages[parentId]) !== -1;

    var ts = Date.now();
    doomed.forEach(function (did) { state.tombs[did] = ts; });
    state.pages = state.pages.filter(function (p) {
      return doomed.indexOf(p.id) === -1;
    });

    // Selection fallback: prefer the surviving parent, then the
    // first top-level page, then nothing (empty notebook is legal
    // — the next New page rebuilds; sync never ships an empty
    // payload over this, sliceSet ignores empties).
    if (doomed.indexOf(state.currentId) !== -1) {
      if (parentAlive) state.currentId = parentId;
      else {
        var tops = kidsOf(ROOT_ID);
        state.currentId = tops.length ? tops[0] : null;
      }
      savePrefs();
    }

    commit();
    toast(t("notes.toast.deleted"));
  }

  // ---- Move up / down (within siblings) ----
  function movePage(id, dir) {
    var page = idxPages[id];
    if (!page) return;
    var sibs = kidsOf(page.parent);
    var at = sibs.indexOf(id);
    var to = at + dir;
    if (at === -1 || to < 0 || to >= sibs.length) return;

    var other = idxPages[sibs[to]];
    var tmp = page.pos;
    page.pos = other.pos;
    other.pos = tmp;
    // Parent+pos are page CONTENT — both movers must win the next
    // merge, so both get fresh mtimes.
    page.mtime = Date.now();
    other.mtime = Date.now();

    commit();
  }

  // ---- Context menu (long-press / right-click) ----
  var toastTimer = null;
  var suppressNextClick = false;

  function closeNodeMenu() {
    var m = document.getElementById("node-menu");
    if (m) m.remove();
  }

  function openNodeMenu(id, x, y) {
    closeNodeMenu();
    var page = idxPages[id];
    if (!page) return;

    var sibs = kidsOf(page.parent);
    var at = sibs.indexOf(id);

    var menu = document.createElement("div");
    menu.id = "node-menu";

    function addItem(label, fn, danger) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "node-menu-item";
      b.textContent = label;
      if (danger) b.style.color = "var(--danger)";
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        closeNodeMenu();
        fn();
      });
      menu.appendChild(b);
    }

    addItem(t("notes.new.child"), function () { createPage(id); });
    addItem(t("notes.menu.rename"), function () {
      selectPage(id);
      setTimeout(function () {
        var el = $("page-title");
        el.focus();
        el.select();
      }, 60);
    });
    if (at > 0)                  addItem(t("notes.move.up"),   function () { movePage(id, -1); });
    if (at < sibs.length - 1)    addItem(t("notes.move.down"), function () { movePage(id, 1); });
    addItem(t("notes.delete"), function () {
      if (window.confirm(t("notes.delete.confirm"))) deletePage(id);
    }, true);

    document.body.appendChild(menu);

    // Clamp inside the viewport (fixed in v0.13.1 — the old code
    // could push the menu off-screen on the bottom-right corner).
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth  - mw - 8)) + "px";
    menu.style.top  = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + "px";
  }

  // ===== 6. EDITOR + AUTOSAVE =====

  function setIndicator(st) {
    var el = $("save-indicator");
    if (el) el.dataset.state = st;
  }

  // Guarded setters: assigning .value resets the caret even when
  // the string is identical in some engines — skip no-op writes so
  // mid-typing re-renders never disturb the cursor.
  function renderEditor() {
    var page = currentPage();
    var tEl = $("page-title"), xEl = $("page-text");

    if (!page) {
      tEl.disabled = true;
      xEl.disabled = true;
      if (tEl.value !== "") tEl.value = "";
      if (xEl.value !== "") xEl.value = "";
      setIndicator("idle");
      return;
    }

    tEl.disabled = false;
    xEl.disabled = false;
    if (tEl.value !== page.title) tEl.value = page.title;
    if (xEl.value !== page.text)  xEl.value = page.text;
    setIndicator(state.dirty ? "dirty" : "saved");
  }

  var pendingTimer = null;
  var pendingId = null;

  // Keystroke → dirty → debounced flush. Every input on EITHER
  // field restarts the timer and re-targets the CURRENT page.
  function markPending() {
    var page = currentPage();
    if (!page) return;
    state.dirty = true;
    pendingId = page.id;
    setIndicator("dirty");
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  function flushSave() {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    if (!pendingId) return;

    var pid = pendingId;
    pendingId = null;

    // Dead-page disarm: the debounce's target vanished (deleted by
    // the user or replaced by a sync pull mid-typing). Drop it.
    var page = idxPages[pid];
    if (!page) {
      state.dirty = false;
      setIndicator("idle");
      return;
    }

    page.title = $("page-title").value;
    page.text  = $("page-text").value;
    page.mtime = Date.now();
    state.dirty = false;

    if (saveData()) {
      setIndicator("saved");
      markSyncDirty();
      updateActiveLabel(page);
    } else {
      // Quota — keep the buffer armed so the next keystroke retries.
      pendingId = pid;
      state.dirty = true;
      setIndicator("dirty");
    }
  }

  // In-place label update after a debounced commit: a FULL re-render
  // while typing would steal focus / reset the caret. Only the
  // active row's label text changes on title edits — patch just it.
  function updateActiveLabel(page) {
    var row = document.querySelector('.node-row[data-id="' + page.id + '"]');
    if (!row) { renderTree(); return; }      // row not on screen — full render
    var label = row.querySelector(".node-label");
    if (label) label.textContent = page.title || t("notes.empty.title");
  }

  // Tiny toast (JS-injected, CSS-variable-styled — no extra markup
  // in index.html, no separate stylesheet section).
  function toast(msg) {
    var el = document.getElementById("notes-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "notes-toast";
      el.style.cssText =
        "position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(8px);" +
        "z-index:1200;background:var(--panel-bg);color:var(--text);" +
        "border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px var(--shadow);" +
        "padding:9px 14px;font-size:13px;opacity:0;" +
        "transition:opacity .3s,transform .3s;pointer-events:none;max-width:calc(100vw - 32px);";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    void el.offsetWidth;                        // restart the transition
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(8px)";
    }, 3000);
  }

  // ===== 7. SYNC SLICE + MERGE ENGINE =====
  // Contract (consumed by sync.js via registerSlice's 5th arg):
  //   mergeNotesStates(local, remote) → merged or null (empty guard).
  //   · tombstones: union, max ts — prune expired inside (symmetric)
  //   · pages: union by id, PER-PAGE LWW by mtime;
  //     tie → lexicographic JSON pick (deterministic both ways)
  //   · alive iff mtime > tomb (delete wins ties, edit-after-delete
  //     resurrects — same semantics as Todo/Kanban)
  //   · orphan cascade: iterate-until-stable — a page whose parent
  //     is not alive is re-parented to ROOT (data preservation)
  //   · cycle guard: any ancestor loop → ROOT
  // Session-local view state (openIds/currentId/width) NEVER syncs.

  function pickPage(x, y) {
    if ((x.mtime || 0) !== (y.mtime || 0)) {
      return (x.mtime || 0) > (y.mtime || 0) ? x : y;
    }
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  }

  function mergeNotesStates(A, B) {
    var a = A || {}, b = B || {};

    // 1. Tombstones: union with max ts, prune expired.
    var tombs = {};
    Object.keys(a.tombs || {}).forEach(function (id) { tombs[id] = a.tombs[id]; });
    Object.keys(b.tombs || {}).forEach(function (id) {
      tombs[id] = Math.max(tombs[id] || 0, b.tombs[id]);
    });
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(tombs).forEach(function (id) {
      if (tombs[id] < cutoff) delete tombs[id];
    });

    // 2. Pages: union by id, per-page LWW.
    var map = {};
    function absorb(arr) {
      (arr || []).forEach(function (p) {
        if (!p || typeof p.id !== "string") return;
        map[p.id] = map[p.id] ? pickPage(map[p.id], p) : p;
      });
    }
    absorb(a.pages); absorb(b.pages);

    // 3. Aliveness: tomb kills unless content is strictly newer.
    var alive = {};
    Object.keys(map).forEach(function (id) {
      var ts = tombs[id];
      if (ts === undefined || (map[id].mtime || 0) > ts) alive[id] = map[id];
    });

    var pages = Object.keys(alive).map(function (id) { return alive[id]; });

    // 4. Orphan cascade — iterate until stable. Mutations inside the
    //    loop can invalidate earlier resolutions (pruning a parent
    //    orphans ITS children one level down), so we loop to the
    //    fixpoint instead of a single pass.
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        if (p.parent !== ROOT_ID && !alive[p.parent]) {
          p.parent = ROOT_ID;
          changed = true;
        }
      }
    }

    // 5. Cycle guard: an ancestor chain that revisits itself → ROOT.
    pages.forEach(function (q) {
      var seen = {};
      var walk = q.parent;
      var guard = 0;
      while (walk && walk !== ROOT_ID && alive[walk] && guard++ < 1000) {
        if (seen[walk]) { q.parent = ROOT_ID; return; }
        seen[walk] = 1;
        walk = alive[walk].parent;
      }
    });

    // Post-condition: never ship an empty state over local data.
    if (pages.length === 0) return null;
    return { ver: DATA_VER, pages: pages, tombs: tombs };
  }

  function sliceGet() {
    return {
      ver: DATA_VER,
      pages: JSON.parse(JSON.stringify(state.pages)),
      tombs: JSON.parse(JSON.stringify(state.tombs))
    };
  }

  // data — merged result (or plain remote on legacy LWW paths)
  // info — { merged: true } when the value came through the merge
  function sliceSet(data, info) {
    data = JSON.parse(JSON.stringify(data || null));
    if (!data || typeof data !== "object") return;
    if (!Array.isArray(data.pages) || data.pages.length === 0) return;

    // Land any unflushed keystrokes first — the fields still hold
    // them; the merged payload was snapshotted earlier.
    flushSave();

    window.__notesSyncApi._suppress = true;
    try {
      state.pages = data.pages;
      state.tombs = (data.tombs && typeof data.tombs === "object") ? data.tombs : {};
      normalize();
      saveData();
    } finally {
      window.__notesSyncApi._suppress = false;
    }

    renderTree();     // sanitizes a dead currentId, re-derives the tree

    if (info && info.merged) toast(t("sync.merged"));
  }

  function registerNotesSlice() {
    var api = syncApi();

    window.__notesSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("notes", sliceGet, sliceSet, STORAGE_KEY, mergeNotesStates);
  }

  function markSyncDirty() {
    var me = window.__notesSyncApi;
    if (me && me._suppress) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
  }

  // ===== 8. SPLITTER, WIRING & BOOT =====

  function initSplitter() {
    var sp = $("pane-splitter");
    var pane = $("tree-pane");
    if (!sp || !pane) return;

    // Restore the persisted width (device-local, never synced).
    pane.style.width = state.width + "px";

    sp.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var baseLeft = pane.getBoundingClientRect().left;
      document.body.classList.add("resizing");

      function onMove(ev) {
        var w = Math.max(180, Math.min(480, ev.clientX - baseLeft));
        pane.style.width = w + "px";
        state.width = w;
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("resizing");
        savePrefs();
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

  function wireUI() {
    var app = $("notes-app");
    var treeRoot = $("tree-root");

    // --- New page (footer) ---
    $("btn-new-page").addEventListener("click", function () {
      createPage(currentPage() ? currentPage().parent : ROOT_ID);
    });

    // --- Mobile tree overlay toggle ---
    var showTree = $("btn-show-tree");
    if (showTree) {
      showTree.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="14" y2="12"/>' +
        '<line x1="4" y1="17" x2="17" y2="17"/></svg>';
      showTree.addEventListener("click", function () {
        app.classList.toggle("tree-open");
      });
    }

    // --- Editor fields: debounced autosave ---
    $("page-title").addEventListener("input", markPending);
    $("page-text").addEventListener("input", markPending);
    $("page-title").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {                 // title done → body
        e.preventDefault();
        $("page-text").focus();
      }
    });

    // --- Tree: long-press + right-click → node menu ---
    var lpTimer = null, lpId = null, lpX = 0, lpY = 0;

    treeRoot.addEventListener("pointerdown", function (e) {
      var row = e.target.closest ? e.target.closest(".node-row") : null;
      if (!row) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      lpId = row.dataset.id;
      lpX = e.clientX;
      lpY = e.clientY;
      lpTimer = setTimeout(function () {
        if (!lpId) return;
        if (navigator.vibrate) navigator.vibrate(10);
        suppressNextClick = true;    // the release click must not select
        openNodeMenu(lpId, lpX, lpY);
        lpId = null;
      }, 550);
    });
    treeRoot.addEventListener("pointermove", function (e) {
      if (!lpTimer) return;
      if (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10) {
        clearTimeout(lpTimer);
        lpTimer = null;
        lpId = null;
      }
    });
    ["pointerup", "pointercancel"].forEach(function (evName) {
      treeRoot.addEventListener(evName, function () {
        clearTimeout(lpTimer);
        lpTimer = null;
        lpId = null;
      });
    });
    treeRoot.addEventListener("contextmenu", function (e) {
      var row = e.target.closest ? e.target.closest(".node-row") : null;
      if (!row) return;
      e.preventDefault();
      openNodeMenu(row.dataset.id, e.clientX, e.clientY);
    });

    // The synthetic click right after a long-press menu opens must
    // not also SELECT the row beneath it — swallow it in capture.
    treeRoot.addEventListener("click", function (e) {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    // Any outside tap dismisses the menu.
    document.addEventListener("click", function () { closeNodeMenu(); });
    document.addEventListener("scroll", function () { closeNodeMenu(); }, true);

    // --- Keyboard: Ctrl/Cmd+S = flush now ---
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        flushSave();
      }
    });

    // --- Flush on tab hide/close (nothing is ever stranded) ---
    window.addEventListener("pagehide", flushSave);
    window.addEventListener("beforeunload", flushSave);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushSave();
    });
  }

  // ---------- Boot ----------
  loadPrefs();          // device-local view first…
  loadData();           // …then the truth (may set first-run welcome)
  applyI18n();
  inheritPalette();     // colors in place BEFORE the first paint settles
  renderTree();
  registerNotesSlice();
  wireUI();
  initSplitter();
  watchPalette();       // live skin/theme switches from here on
})();