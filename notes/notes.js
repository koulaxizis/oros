// ============================================================
// orOS Notes v0.14.0 — Plain-text wiki notebook
//
// Architecture (unchanged core, v0.13.1 contract):
//   - Flat pages[] {id, parent, title, text, mtime, pos}
//   - tombs {} (delete-wins, prune 30d)
//   - Device-local prefs (never synced): open/current/width
//   - orosSync lives in window.parent when embedded — resolved
//     via syncApi() (ARCHITECTURE REFERENCE, v0.13.1)
//   - Merge: per-page LWW (mtime, tie → lexicographic JSON),
//     tombs union max-ts, orphan → re-parent ROOT, cycle guard
//
// v0.14.0 (Wave 2.1): PAGE LABELS — Todo/Kanban parity.
//   - state.labels = [{id, name, color, mtime, pos}]  (synced registry)
//   - page.labels  = [labelId, ...]                  (attach/detach)
//   - Merge engine extends: labels union LWW + tomb
//     guard, detaches of dead labels pruned at normalize
//   - DATA_VER 1 → 2 (additive migration)
// ============================================================
(function () {
  "use strict";

  var APP_VERSION   = "0.14.0";
  var STORAGE_KEY   = "oros-notes-data";
  var PREFS_KEY     = "oros-notes-prefs";
  var DATA_VER      = 2;
  var SAVE_DEBOUNCE_MS = 500;
  var TOMB_PRUNE_DAYS  = 30;
  var DAY_MS           = 24 * 60 * 60 * 1000;

  var LABEL_COLORS = [
    "#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf",
    "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"
  ];

  // ---------- 1. State ----------
  var state = {
    ver:    DATA_VER,
    pages:  [],   // {id, parent, title, text, mtime, pos, labels:[]}
    labels: [],   // {id, name, color, mtime, pos}
    tombs:  {}    // pageId -> ts
  };

  var prefs = { open: {}, current: null, width: 270 };
  var pendingId      = null;    // page awaiting debounced save
  var pendingTimer   = null;

  // ---------- 2. Load / migrate / normalize ----------

  function defaultData() {
    return {
      ver: DATA_VER,
      pages: [{
        id: uid(), parent: null, title: t("page.untitled"),
        text: "", mtime: Date.now(), pos: 0, labels: []
      }],
      labels: [],
      tombs: {}
    };
  }

  function loadData() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
    if (!raw || typeof raw !== "object") {
      state = defaultData();
      saveNow();
      return;
    }

    // v1 → v2: additive — labels registry arrives empty, pages get
    // an empty labels array. Nothing renamed, nothing dropped.
    if (typeof raw.ver === "number" && raw.ver < 2) {
      raw.labels = [];
    }

    state.ver    = DATA_VER;
    state.pages  = Array.isArray(raw.pages)  ? raw.pages  : [];
    state.labels = Array.isArray(raw.labels) ? raw.labels : [];
    state.tombs  = (raw.tombs && typeof raw.tombs === "object") ? raw.tombs : {};

    normalizeState();
    if (JSON.stringify(raw) !== JSON.stringify(state)) saveNow();
  }

  // Normalization is IDEMPOTENT and runs on every load AND on every
  // incoming merge result — both devices converge to identical shape.
  function normalizeState() {
    var labelIds = {};
    state.labels.forEach(function (l) {
      if (l && typeof l.id === "string" &&
          typeof l.name === "string" && l.name.trim() !== "") {
        l.color = (LABEL_COLORS.indexOf(l.color) !== -1) ? l.color : LABEL_COLORS[0];
        l.pos   = (typeof l.pos === "number" && isFinite(l.pos)) ? l.pos : 0;
        l.mtime = l.mtime || Date.now();
        labelIds[l.id] = true;
      }
    });
    state.labels = state.labels.filter(function (l) { return !!l && labelIds[l.id]; });

    // De-dupe labels by id (merge can theoretically produce twins
    // on pathological clocks): keep the LWW one.
    state.labels.sort(function (a, b) { return a.mtime - b.mtime; });
    var seenL = {};
    state.labels = state.labels.filter(function (l) {
      if (seenL[l.id]) return false;
      seenL[l.id] = true; return true;
    });

    var alive = {};
    state.pages.forEach(function (p) {
      if (!p || typeof p.id !== "string") return;
      alive[p.id] = true;
    });

    state.pages = state.pages.filter(function (p, i) {
      return p && typeof p.id === "string" &&
             state.pages.findIndex(function (q) { return q && q.id === p.id; }) === i;
    });

    state.pages.forEach(function (p) {
      p.parent = (p.parent === null || alive[p.parent]) ? p.parent : null;
      p.pos    = (typeof p.pos === "number" && isFinite(p.pos)) ? p.pos : 0;
      p.mtime  = p.mtime || Date.now();
      // labels: array of known, alive label ids, de-duplicated
      var ll = Array.isArray(p.labels) ? p.labels : [];
      var seen = {};
      p.labels = [];
      ll.forEach(function (lid) {
        if (typeof lid === "string" && labelIds[lid] && !seen[lid]) {
          seen[lid] = true;
          p.labels.push(lid);
        }
      });
      // Sort for deterministic comparison in merge/serialize paths
      p.labels.sort();
    });

    // Orphans → ROOT; iterate-until-stable (cycle guard)
    var changedO = true, guard = 0;
    while (changedO && guard++ < 100) {
      changedO = false;
      state.pages.forEach(function (p) {
        if (p.parent !== null && !alive[p.parent]) { p.parent = null; changedO = true; }
        // Cycle break: walk up; if we reach ourselves, re-parent to ROOT
        var anc = p.parent, hops = 0;
        while (anc !== null && hops++ < 200) {
          var node = state.pages.find(function (q) { return q.id === anc; });
          if (!node) break;
          if (node.id === p.id) { p.parent = null; changedO = true; break; }
          anc = node.parent;
        }
      });
    }

    // Tomb pruning (30d) + never keep a tomb for a resurrected page
    var now = Date.now();
    Object.keys(state.tombs).forEach(function (id) {
      if (alive[id] || (now - state.tombs[id]) > TOMB_PRUNE_DAYS * DAY_MS) {
        delete state.tombs[id];
      }
    });
  }

  function saveNow() {
    normalizeState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // Debounced save — burst edits coalesce; the dirty flag reaches
  // the sync engine only ONCE the page settles.
  function flushSave() {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    if (!pendingId) return;
    saveNow();
    if (state.pages.some(function (p) { return p.id === pendingId; })) {
      markSyncDirty();
    }
    pendingId = null;
    setSaveIndicator("saved");
  }

  function queueSave(pageId) {
    pendingId = pageId;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    setSaveIndicator("dirty");
  }

  // ---------- 3. i18n ----------

  var STRINGS = {
    en: {
      "app.title":          "Notes",
      "tree.title":         "Pages",
      "tree.empty":         "No pages yet",
      "tree.empty.hint":    "Tap + to create your first page",
      "page.untitled":      "Untitled",
      "page.new":           "New page",
      "page.newchild":      "New sub-page",
      "page.delete":        "Delete",
      "page.rename":        "Rename",
      "page.move.up":       "Move up",
      "page.move.down":     "Move down",
      "page.placeholder":   "Start writing…",
      "page.count":         "{n}",
      "toast.created":      "Page created",
      "toast.deleted":      "Page deleted",
      "toast.moved":        "Page moved",
      "toast.merged":       "Merged from sync",
      "labels.title":       "Labels",        // v0.14.0
      "labels.none":        "No labels yet",  // v0.14.0
      "labels.new":         "New label…",    // v0.14.0
      "labels.add":         "Add",           // v0.14.0
      "labels.detach":      "Remove",        // v0.14.0
      "labels.confirm":     "Delete this label?",      // v0.14.0
      "labels.detached":    "Label removed", // v0.14.0
      "labels.empty.new":   "Label name",     // v0.14.0
	        "notes.app":         "Notes",
      "notes.new.page":    "New page",
      "notes.title.ph":    "Title",
      "notes.text.ph":     "Start typing…",
	  "menu.exportPage": "Export page (.txt)",
"menu.exportNotebook": "Export notebook (.zip)",
"search.placeholder": "Search pages…",
"search.hint": "Type at least 2 characters",
"search.none": "No results",
"search.count": "{n} results",
"tags.all": "All labels",
"tags.pages": "{n} pages",
"tags.back": "Back",
"links.out": "Links",
"links.back": "Backlinks",
"links.none": "None"
    },
    el: {
      "app.title":          "Σημειώσεις",
      "tree.title":         "Σελίδες",
      "tree.empty":         "Καμία σελίδα ακόμη",
      "tree.empty.hint":    "Πάτησε + για τη πρώτη σελίδα",
      "page.untitled":      "Χωρίς τίτλο",
      "page.new":           "Νέα σελίδα",
      "page.newchild":      "Νέα υποσελίδα",
      "page.delete":        "Διαγραφή",
      "page.rename":        "Μετονομασία",
      "page.move.up":       "Μετακίνηση πάνω",
      "page.move.down":     "Μετακίνηση κάτω",
      "page.placeholder":   "Ξεκίνα να γράφεις…",
      "page.count":         "{n}",
      "toast.created":      "Η σελίδα δημιουργήθηκε",
      "toast.deleted":      "Η σελίδα διαγράφηκε",
      "toast.moved":        "Η σελίδα μετακινήθηκε",
      "toast.merged":       "Συγχωνεύτηκε από sync",
      "labels.title":       "Ετικέτες",        // v0.14.0
      "labels.none":        "Καμία ετικέτα ακόμη",  // v0.14.0
      "labels.new":         "Νέα ετικέτα…",    // v0.14.0
      "labels.add":         "Προσθήκη",        // v0.14.0
      "labels.detach":      "Αφαίρεση",        // v0.14.0
      "labels.confirm":     "Διαγραφή αυτής της ετικέτας;",  // v0.14.0
      "labels.detached":    "Η ετικέτα αφαιρέθηκε", // v0.14.0
      "labels.empty.new":   "Όνομα ετικέτας",   // v0.14.0
	        "notes.app":         "Σημειώσεις",
      "notes.new.page":    "Νέα σελίδα",
      "notes.title.ph":    "Τίτλος",
      "notes.text.ph":     "Ξεκίνα να γράφεις…",
	  "menu.exportPage": "Εξαγωγή σελίδας (.txt)",
"menu.exportNotebook": "Εξαγωγή σημειωματαρίου (.zip)",
"search.placeholder": "Αναζήτηση σε σελίδες…",
"search.hint": "Πληκτρολόγησε τουλάχιστον 2 χαρακτήρες",
"search.none": "Κανένα αποτέλεσμα",
"search.count": "{n} αποτελέσματα",
"tags.all": "Όλες οι ετικέτες",
"tags.pages": "{n} σελίδες",
"tags.back": "Πίσω",
"links.out": "Σύνδεσμοι",
"links.back": "Αναφορές",
"links.none": "Κανένα"
    }
  };

  function detectLang() {
    try {
      var p = (window.parent && window.parent.orosLang) || window.orosLang;
      return (p === "el") ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = detectLang();

  function t(key) {
    var d = STRINGS[LANG] || STRINGS.en;
    return (d[key] !== undefined) ? d[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  function applyI18n() {
    document.documentElement.setAttribute("lang", LANG);
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    var titled = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < titled.length; j++) {
      titled[j].setAttribute("placeholder", t(titled[j].getAttribute("data-i18n-ph")));
    }
  }

  // ---------- 4. Palette inheritance (shell contract) ----------
  // PAL_VARS: the 11-variable shells' palette vocabulary — identical
  // list to todo.css/kanban.css (ARCHITECTURE REFERENCE, v0.13.1).

  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--panel-bg",
                  "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      // Mirror the theme attribute first (light/dark color-scheme
      // rules in notes.css depend on it — todo.js parity).
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var parentStyle = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {

        var val = parentStyle.getPropertyValue(v);
        if (val && val.trim() !== "") {
          document.documentElement.style.setProperty(v, val.trim());
        }
      });
    } catch (e) { /* standalone (non-embedded) — fallback :root stands */ }
  }

  // Watch data-skin/data-theme mutations on the parent <html> and
  // re-inherit instantly — the app never lags behind a shell
  // skin/theme switch.
  function watchPalette() {
    try {
      var target = window.parent.document.documentElement;
      if (!target || typeof MutationObserver === "undefined") return;
      var mo = new MutationObserver(function () { inheritPalette(); });
      mo.observe(target, { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* not embedded */ }
  }

    // ---------- 5. Render tree (label dots) ----------

  var CARET_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  var PAGE_SVG  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var X_SVG     = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var PLUS_SVG  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  var BURGER_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

  // v0.14.1: HTML ships the buttons EMPTY (icons are injected here —
  // restoring the v0.13.1 contract my v0.14.0 rewrite dropped).
  function paintStaticIcons() {
    var nb = document.getElementById("btn-new-page");
    if (nb && !nb.innerHTML.trim()) nb.innerHTML = PLUS_SVG;
    var st = document.getElementById("btn-show-tree");
    if (st && !st.innerHTML.trim()) st.innerHTML = BURGER_SVG;
  }

  function uid(prefix) {
    return (prefix || "p") + Date.now().toString(36) +
           Math.random().toString(36).slice(2, 7);
  }

  function syncApi() {
    // ARCHITECTURE REFERENCE (v0.13.1): orosSync lives on the PARENT
    // window when the app runs inside the shell iframe.
    return (window.parent && window.parent.orosSync) || window.orosSync || null;
  }

  function markSyncDirty() {
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
  }

  function setSaveIndicator(kind) {
    var el = document.getElementById("save-indicator");
    if (el) el.setAttribute("data-state", kind === "dirty" ? "dirty" : "saved");
  }

  function toast(text) {
    var d = document.createElement("div");
    d.setAttribute("role", "status");
    d.textContent = text;
    d.style.cssText =
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(8px);" +
      "background:var(--panel-bg);color:var(--text);border:1px solid var(--border);" +
      "border-radius:999px;padding:8px 18px;font-size:13px;font-weight:700;" +
      "box-shadow:0 8px 24px var(--shadow);opacity:0;transition:opacity .25s,transform .25s;" +
      "z-index:999;pointer-events:none;max-width:88vw;text-align:center;";
    document.body.appendChild(d);
    requestAnimationFrame(function () {
      d.style.opacity = "1";
      d.style.transform = "translateX(-50%) translateY(0)";
    });
    setTimeout(function () {
      d.style.opacity = "0";
      d.style.transform = "translateX(-50%) translateY(8px)";
      setTimeout(function () { d.remove(); }, 300);
    }, 2200);
  }

  function pageById(id) {
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i].id === id) return state.pages[i];
    }
    return null;
  }

  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    return null;
  }

  function kidsOf(parentId) {
    return state.pages
      .filter(function (p) { return p.parent === parentId; })
      .sort(function (a, b) {
        return (a.pos - b.pos) ||
               (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
      });
  }

  function siblingList(page) {
    return state.pages
      .filter(function (p) { return p.id !== page.id && p.parent === page.parent; })
      .sort(function (a, b) { return a.pos - b.pos; });
  }

  function renderTree() {
    var root = document.getElementById("tree-root");
    if (!root) return;
    root.innerHTML = "";

    if (state.pages.length === 0) {
      var empty = document.createElement("li");
      empty.className = "tree-empty";
      empty.textContent = t("tree.empty");
      root.appendChild(empty);
      return;
    }

    buildNodes(root, null, 0);
  }

  function buildNodes(host, parentId, depth) {
    if (depth > 32) return;                    // pathological-tree guard
    var kids = kidsOf(parentId);
    if (!kids.length) return;

    kids.forEach(function (p) {
      var node = document.createElement("li");
      node.className = "node" + (prefs.open[p.id] ? " open" : "");
      node.dataset.id = p.id;

      var row = document.createElement("div");
      row.className = "node-row" + (prefs.current === p.id ? " active" : "");

      // Caret (only when the page has children)
      var grandKids = kidsOf(p.id);
      var caret = document.createElement("span");
      caret.className = "node-caret" + (grandKids.length ? "" : " hidden");
      caret.innerHTML = CARET_SVG;
      if (grandKids.length) {
        caret.addEventListener("click", function (e) {
          e.stopPropagation();
          prefs.open[p.id] = !prefs.open[p.id];
          savePrefs();
          renderTree();
        });
      }
      row.appendChild(caret);

      var ico = document.createElement("span");
      ico.className = "node-ico";
      ico.innerHTML = PAGE_SVG;
      row.appendChild(ico);

      var lab = document.createElement("span");
      lab.className = "node-label";
      lab.textContent = p.title !== "" ? p.title : t("page.untitled");
      row.appendChild(lab);

      // ---- Label dots (Wave 2.1) ----
      var dots = document.createElement("span");
      dots.className = "node-dots";
      (p.labels || []).forEach(function (lid) {
        var lb = labelById(lid);
        if (!lb) return;
        var dot = document.createElement("span");
        dot.className = "node-dot";
        dot.style.background = lb.color;
        dot.title = lb.name;
        dots.appendChild(dot);
      });
      if (dots.childNodes.length) row.appendChild(dots);

      if (grandKids.length) {
        var cnt = document.createElement("span");
        cnt.className = "node-count";
        cnt.textContent = String(grandKids.length);
        row.appendChild(cnt);
      }

      row.addEventListener("click", function () { selectPage(p.id); });

      // Long-press (touch) + right-click → context menu
      var lpTimer = null;
      row.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        openNodeMenu(p, e.clientX, e.clientY);
      });
      row.addEventListener("touchstart", function (e) {
        var tx = e.touches[0].clientX, ty = e.touches[0].clientY;
        lpTimer = setTimeout(function () {
          openNodeMenu(p, tx, ty);
        }, 550);
      }, { passive: true });
      ["touchend", "touchmove", "touchcancel"].forEach(function (ev) {
        row.addEventListener(ev, function () {
          if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        }, { passive: true });
      });

      node.appendChild(row);

      var ul = document.createElement("ul");
      ul.className = "node-kids";
      buildNodes(ul, p.id, depth + 1);
      node.appendChild(ul);

      host.appendChild(node);
    });
  }

  function renderAll() {
    renderTree();
    renderEditor();
  }

  // ---------- 5b. Selection + page ops ----------

  function selectPage(id) {
    flushSave();
    prefs.current = id;
    savePrefs();
    renderAll();
  }

  function renderEditor() {
    var title = document.getElementById("page-title");
    var text  = document.getElementById("page-text");
    var page  = pageById(prefs.current);
    if (!title || !text) return;
	
	    var oldStrip = document.getElementById("links-strip");
    if (oldStrip && !page) oldStrip.remove();

    title.disabled = !page;
    text.disabled  = !page;
    title.value = page ? page.title : "";
    text.value  = page ? page.text : "";
    setSaveIndicator("saved");
	    renderChips(page);
    renderLinksStrip(page);   // v0.17.0: outgoing [[links]] + backlinks
  }
  
    // v0.14.1: visible label chips in the editor header — tags were
  // previously dots-in-the-tree only. Click → picker for this page.
  function renderChips(page) {
    var old = document.getElementById("page-chips");
    if (old) old.remove();
    var header = document.getElementById("editor-header");
    if (!header || !page) return;
    var ids = page.labels || [];
    if (!ids.length) return;

    var wrap = document.createElement("span");
    wrap.id = "page-chips";
    ids.forEach(function (lid) {
      var lb = labelById(lid);
      if (!lb) return;
      var chip = document.createElement("button");
      chip.className = "page-chip";
      chip.type = "button";
      var dot = document.createElement("span");
      dot.className = "page-chip-dot";
      dot.style.background = lb.color;
      chip.appendChild(dot);
      var nm = document.createElement("span");
      nm.textContent = lb.name;
      chip.appendChild(nm);
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        var r = chip.getBoundingClientRect();
        openLabelPicker(page, r.left, r.bottom + 4);
      });
      wrap.appendChild(chip);
    });
    var si = document.getElementById("save-indicator");
    if (si) header.insertBefore(wrap, si);
    else header.appendChild(wrap);
  }

  function newPage(parentId) {
    var maxPos = 0;
    siblingListByParent(parentId).forEach(function (p) {
      if (p.pos > maxPos) maxPos = p.pos;
    });
    var p = {
      id: uid(), parent: parentId || null,
      title: t("page.untitled"), text: "",
      mtime: Date.now(), pos: maxPos + 1, labels: []
    };
    state.pages.push(p);
    if (parentId) prefs.open[parentId] = true;
    saveNow();
    markSyncDirty();
    prefs.current = p.id;
    savePrefs();
    renderAll();
    toast(t("toast.created"));
    var titleEl = document.getElementById("page-title");
    if (titleEl) { titleEl.focus(); titleEl.select(); }
  }

  function siblingListByParent(parentId) {
    return state.pages
      .filter(function (p) { return p.parent === (parentId || null); })
      .sort(function (a, b) { return a.pos - b.pos; });
  }

  function deletePage(id) {
    var page = pageById(id);
    if (!page) return;
    if (!window.confirm('"' + (page.title || t("page.untitled")) + '" — ' + t("page.delete") + "?")) return;

    // Tombstone — delete wins on merge, resurrected pages revive
    state.tombs[id] = Date.now();
    state.pages = state.pages.filter(function (p) { return p.id !== id; });

    if (prefs.current === id) prefs.current = (state.pages[0] && state.pages[0].id) || null;
    delete prefs.open[id];
    savePrefs();
    saveNow();
    markSyncDirty();
    renderAll();
    toast(t("toast.deleted"));
  }

  function renamePage(id) {
    var page = pageById(id);
    if (!page) return;
    var name = window.prompt(t("page.rename"), page.title);
    if (name === null) return;
    page.title = name;
    page.mtime = Date.now();
    saveNow();
    markSyncDirty();
    renderAll();
    if (prefs.current === id) {
      var titleEl = document.getElementById("page-title");
      if (titleEl) titleEl.value = name;
    }
  }

  function movePage(id, dir) {
    var page = pageById(id);
    if (!page) return;
    var sibs = siblingListByParent(page.parent);
    var idx = -1;
    for (var i = 0; i < sibs.length; i++) if (sibs[i].id === id) { idx = i; break; }
    var swapWith = sibs[idx + dir];
    if (!swapWith) return;

    var tmp = page.pos; page.pos = swapWith.pos; swapWith.pos = tmp;
    if (page.pos === swapWith.pos) swapWith.pos = page.pos + dir; // equal-pos tie breaker
    page.mtime    = Date.now();
    swapWith.mtime = Date.now();
    saveNow();
    markSyncDirty();
    renderAll();
    toast(t("toast.moved"));
  }

  // ---------- 6. Context menu + label picker (Wave 2.1) ----------

  function closeMenus() {
    var m = document.getElementById("node-menu");
    if (m) m.remove();
    var lp = document.getElementById("label-picker");
    if (lp) lp.remove();
  }

  function clampToViewport(el, x, y) {
    var r = el.getBoundingClientRect();
    el.style.left = Math.max(6, Math.min(x, innerWidth  - r.width  - 6)) + "px";
    el.style.top  = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + "px";
  }
  
    // ---------- 6b. Export plumbing: download + ZIP writer ----------
  // Store-method ZIP, vanilla JS, ZERO dependencies (mantra).
  // writeZip(entries) → Blob; entries = [{ path, data }] with
  // UNIX "/" paths. Names/data are UTF-8 (flag bit 11 set).

  var utf8 = (typeof TextEncoder === "function")
    ? function (s) { return new TextEncoder().encode(s); }
    : function (s) {                      // legacy fallback
        var out = [];
        for (var i = 0; i < s.length; i++) {
          var cp = s.codePointAt(i);
          if (cp > 0xFFFF) i++;           // consume the pair
          if (cp < 0x80) out.push(cp);
          else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
          else if (cp < 0x10000) out.push(0xE0 | (cp >> 12),
                                         0x80 | ((cp >> 6) & 63),
                                         0x80 | (cp & 63));
          else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                        0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        }
        return new Uint8Array(out);
      };

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ZIP timestamps are DOS date/time (2s granularity, 1980-2107)
  function dosDateTime(d) {
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
      date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
    };
  }

  function writeZip(entries) {
    var chunks = [];
    var central = [];
    var offset = 0;

    entries.forEach(function (e) {
      var nameB = utf8(e.path);
      var dataB = utf8(e.data);
      var crc = crc32(dataB);
      var dt = dosDateTime(new Date());

      // Local file header (30 bytes fixed)
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);   // signature
      lh.setUint16(4, 20, true);           // version needed
      lh.setUint16(6, 0x0800, true);       // flags: UTF-8 names
      lh.setUint16(8, 0, true);            // method: STORE
      lh.setUint16(10, dt.time, true);
      lh.setUint16(12, dt.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, dataB.length, true); // compressed size
      lh.setUint32(22, dataB.length, true); // uncompressed size
      lh.setUint16(26, nameB.length, true);
      lh.setUint16(28, 0, true);            // extra field len
      chunks.push(new Uint8Array(lh.buffer), nameB, dataB);

      central.push({ nameB: nameB, crc: crc, size: dataB.length, dt: dt, offset: offset });
      offset += 30 + nameB.length + dataB.length;
    });

    var cdStart = offset;
    central.forEach(function (c) {
      // Central directory header (46 bytes fixed)
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);   // signature
      ch.setUint16(4, 20, true);            // version made by
      ch.setUint16(6, 20, true);            // version needed
      ch.setUint16(8, 0x0800, true);        // flags: UTF-8
      ch.setUint16(10, 0, true);            // method: STORE
      ch.setUint16(12, c.dt.time, true);
      ch.setUint16(14, c.dt.date, true);
      ch.setUint32(16, c.crc, true);
      ch.setUint32(20, c.size, true);
      ch.setUint32(24, c.size, true);
      ch.setUint16(28, c.nameB.length, true);
      // 30/32 extra+comment len, 34/36 attrs — all zero
      ch.setUint32(42, c.offset, true);     // local header offset
      chunks.push(new Uint8Array(ch.buffer), c.nameB);
      offset += 46 + c.nameB.length;
    });

    // End of central directory (22 bytes fixed)
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, central.length, true);
    eocd.setUint16(10, central.length, true);
    eocd.setUint32(12, offset - cdStart, true);
    eocd.setUint32(16, cdStart, true);
    chunks.push(new Uint8Array(eocd.buffer));

    return new Blob(chunks, { type: "application/zip" });
  }

  // Filename sanitizer — strips filesystem-hostile chars
  function sanitizeFilename(name) {
    var s = (name || "").trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 80);
       return s || "Untitled";
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  
    // ---------- 6c. Export functions (page .txt / notebook .zip) ----------

  function childrenSorted(parentId) {
    return state.pages
      .filter(function (p) { return parentId ? (p.parent === parentId) : (!p.parent); })
      .sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
  }

  function sanitizeFolder(name) {
    var s = sanitizeFilename(name).replace(/[. ]+$/, ""); // no trailing dots/spaces
    return s || "_";
  }

  function pageText(page) {
    return page.title + "\n\n" + (page.text || "");
  }

  function exportPageTxt(page) {
    downloadBlob(
      new Blob([pageText(page)], { type: "text/plain;charset=utf-8" }),
      sanitizeFilename(page.title) + ".txt"
    );
  }

  function exportNotebookZip() {
    if (!state.pages.length) { return; }
    var entries = [];
    var used = {};   // "dir|name" (lowercase) -> duplicate count
    var visited = {}; // cycle guard for malformed merged trees

    function unique(dir, name) {
      var key = dir + "|" + name.toLowerCase();
      var n = used[key] || 0;
      used[key] = n + 1;
      return n ? (name + " (" + (n + 1) + ")") : name;
    }

    function addPage(page, dir, depth) {
      if (depth > 50 || visited[page.id]) { return; } // cycle guard
      visited[page.id] = true;

      var kids = childrenSorted(page.id);
      if (kids.length) {
        // Folder-carrying page: its own .txt lives INSIDE its folder
        var sub = dir + sanitizeFolder(page.title) + "/";
        entries.push({
          path: sub + unique(sub, sanitizeFilename(page.title)) + ".txt",
          data: pageText(page)
        });
        for (var i = 0; i < kids.length; i++) { addPage(kids[i], sub, depth + 1); }
      } else {
        entries.push({
          path: dir + unique(dir, sanitizeFilename(page.title)) + ".txt",
          data: pageText(page)
        });
      }
    }

    childrenSorted(null).forEach(function (r) { addPage(r, "", 0); });

    var d = new Date();
    var stamp = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
    downloadBlob(writeZip(entries), "notes-" + stamp + ".zip");
  }
  
    // ---------- 6d. Search (Ctrl+K) + Tags aggregation panel ----------
  // SESSION-ONLY by construction: neither view persists ANY state —
  // no prefs write, no localStorage key. Sync pulls / renderAll can
  // never resurrect them.

  function closeFloating() {
    var so = document.getElementById("search-overlay");
    if (so) so.remove();
    var tp = document.getElementById("tag-panel");
    if (tp) tp.remove();
  }

  function snippetAround(text, needle) {
    if (!text) return "";
    var lower = text.toLowerCase();
    var i = needle ? lower.indexOf(needle) : -1;
    if (i === -1) i = 0;
    var start = Math.max(0, i - 30);
    var end = Math.min(text.length, start + 90);
    var s = text.slice(start, end).replace(/\s+/g, " ");
    if (start > 0) s = "…" + s;
    if (end < text.length) s += "…";
    return s;
  }

  function runSearch(q) {
    var out = document.getElementById("search-results");
    if (!out) return;
    out.innerHTML = "";
    var needle = q.trim().toLowerCase();

    if (needle.length < 2) {
      var h = document.createElement("div");
      h.className = "sr-msg";
      h.textContent = t("search.hint");
      out.appendChild(h);
      return;
    }

    var hits = [];
    state.pages.forEach(function (p) {
      var inTitle = ((p.title || "")).toLowerCase().indexOf(needle) !== -1;
      var inText  = ((p.text  || "")).toLowerCase().indexOf(needle) !== -1;
      if (inTitle || inText) hits.push({ p: p, w: inTitle ? 0 : 1 });
    });
    // Title hits first, then freshest
    hits.sort(function (a, b) { return a.w - b.w || (b.p.mtime || 0) - (a.p.mtime || 0); });

    if (!hits.length) {
      var n = document.createElement("div");
      n.className = "sr-msg";
      n.textContent = t("search.none");
      out.appendChild(n);
      return;
    }

    var cap = Math.min(hits.length, 50);
    var cnt = document.createElement("div");
    cnt.className = "sr-msg";
    cnt.textContent = t("search.count").replace("{n}", String(hits.length));
    out.appendChild(cnt);

    for (var i = 0; i < cap; i++) {
      (function (hit) {
        var row = document.createElement("button");
        row.className = "sr-item";
        row.type = "button";
        var ti = document.createElement("span");
        ti.className = "sr-title";
        ti.textContent = hit.p.title !== "" ? hit.p.title : t("page.untitled");
        row.appendChild(ti);
        var sn = document.createElement("span");
        sn.className = "sr-snippet";
        sn.textContent = snippetAround(hit.p.text, needle);
        row.appendChild(sn);
        row.addEventListener("click", function () {
          closeFloating();
          selectPage(hit.p.id);
        });
        out.appendChild(row);
      })(hits[i]);
    }
  }

  function openSearch() {
    closeMenus();
    closeFloating();
    var ov = document.createElement("div");
    ov.id = "search-overlay";
    var box = document.createElement("div");
    box.id = "search-box";
    var inp = document.createElement("input");
    inp.id = "search-input";
    inp.type = "text";
    inp.spellcheck = false;
    inp.placeholder = t("search.placeholder");
    var res = document.createElement("div");
    res.id = "search-results";
    box.appendChild(inp);
    box.appendChild(res);
    ov.appendChild(box);
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) ov.remove(); });
    inp.addEventListener("input", function () { runSearch(inp.value); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { ov.remove(); return; }
      if (e.key === "Enter") {
        var first = res.querySelector(".sr-item");
        if (first) first.click();
      }
      e.stopPropagation();
    });
    document.body.appendChild(ov);
    inp.focus();
    runSearch("");
  }

  function toggleTagPanel() {
    var p = document.getElementById("tag-panel");
    if (p) { p.remove(); return; }
    closeMenus();
    renderTagPanel(null);
  }

  function renderTagPanel(filterId) {
    var old = document.getElementById("tag-panel");
    if (old) old.remove();

    var panel = document.createElement("div");
    panel.id = "tag-panel";

    var head = document.createElement("div");
    head.className = "tp-head";
    if (filterId) {
      var back = document.createElement("button");
      back.className = "tp-back";
      back.type = "button";
      back.textContent = t("tags.back");
      back.addEventListener("click", function () { renderTagPanel(null); });
      head.appendChild(back);
    }
    var ht = document.createElement("span");
    ht.className = "tp-title";
    if (filterId) {
      var lb = labelById(filterId);
      ht.textContent = lb ? lb.name : "";
    } else {
      ht.textContent = t("tags.all");
    }
    head.appendChild(ht);
    var x = document.createElement("button");
    x.className = "tp-close";
    x.type = "button";
    x.innerHTML = X_SVG;
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", function () { panel.remove(); });
    head.appendChild(x);
    panel.appendChild(head);

    var list = document.createElement("div");
    list.className = "tp-list";

    if (!filterId) {
      if (!state.labels.length) {
        var none = document.createElement("div");
        none.className = "tp-none";
        none.textContent = t("labels.none");
        list.appendChild(none);
      } else {
        state.labels
          .slice()
          .sort(function (a, b) { return (a.pos - b.pos) || a.name.localeCompare(b.name); })
          .forEach(function (lb) {
            var cnt = state.pages.filter(function (p) {
              return (p.labels || []).indexOf(lb.id) !== -1;
            }).length;
            var row = document.createElement("button");
            row.className = "tp-item";
            row.type = "button";
            var dot = document.createElement("span");
            dot.className = "tp-dot";
            dot.style.background = lb.color;
            row.appendChild(dot);
            var nm = document.createElement("span");
            nm.className = "tp-name";
            nm.textContent = lb.name;
            row.appendChild(nm);
            var c = document.createElement("span");
            c.className = "tp-count";
            c.textContent = String(cnt);
            row.appendChild(c);
            row.addEventListener("click", function () { renderTagPanel(lb.id); });
            list.appendChild(row);
          });
      }
    } else {
      var pages = state.pages
        .filter(function (p) { return (p.labels || []).indexOf(filterId) !== -1; })
        .sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
      if (!pages.length) {
        var pn = document.createElement("div");
        pn.className = "tp-none";
        pn.textContent = t("search.none");
        list.appendChild(pn);
      } else {
        pages.forEach(function (p) {
          var pr = document.createElement("button");
          pr.className = "tp-page";
          pr.type = "button";
          pr.textContent = p.title !== "" ? p.title : t("page.untitled");
          pr.addEventListener("click", function () {
            panel.remove();
            selectPage(p.id);
          });
          list.appendChild(pr);
        });
      }
    }

    panel.appendChild(list);
    document.body.appendChild(panel);
  }
  
    // ---------- 6e. Wiki-links + backlinks (live, zero storage) ----------
  // Outgoing links: [[Title]] parsed from the page text on the fly.
  // Backlinks: other pages whose text contains [[current title]].
  // Resolved chip → open; unresolved chip → CREATE (creation-on-click,
  // new page becomes a CHILD of the current page — wiki-tree semantics).

  function wikiTitles(text) {
    var out = [], seen = {};
    var re = /\[\[([^\[\]]+)\]\]/g, m;
    while ((m = re.exec(text || "")) !== null) {
      var title = m[1].trim();
      if (title && !seen[title.toLowerCase()]) {
        seen[title.toLowerCase()] = true;
        out.push(title);
      }
    }
    return out;
  }

  function pageByTitle(title) {
    var low = (title || "").toLowerCase();
    for (var i = 0; i < state.pages.length; i++) {
      var p = state.pages[i];
      if ((p.title || "").trim().toLowerCase() === low) return p;
    }
    return null;
  }

  function openOrCreateFromLink(title) {
    var target = pageByTitle(title);
    if (target) { selectPage(target.id); return; }
    // Creation-on-click: new page as CHILD of current, at end.
    newPage(prefs.current || null);
    var fresh = pageById(prefs.current);
    if (fresh) {
      fresh.title = title;
      fresh.mtime = Date.now();
      saveNow();
      markSyncDirty();
      renderAll();
    }
  }

  function backlinkPages(current) {
    var title = ((current && current.title) || "").trim();
    if (!title) return [];
    var needle = "[[" + title + "]]";
    return state.pages.filter(function (p) {
      return p.id !== current.id && ((p.text || "").indexOf(needle) !== -1);
    });
  }

  function chip(label, cls, onclick) {
    var c = document.createElement("button");
    c.type = "button";
    c.className = "lk-chip " + (cls || "");
    c.textContent = label;
    c.addEventListener("click", function (e) { e.stopPropagation(); onclick(); });
    return c;
  }

  function renderLinksStrip(page) {
    var old = document.getElementById("links-strip");
    if (old) old.remove();

    var pane = document.getElementById("editor-pane");
    if (!pane || !page) return;

    var outTitles = wikiTitles(page.text);
    var backs = backlinkPages(page);
    if (!outTitles.length && !backs.length) return;

    var strip = document.createElement("div");
    strip.id = "links-strip";

    if (outTitles.length) {
      var so = document.createElement("div");
      so.className = "lk-section";
      so.textContent = t("links.out");
      strip.appendChild(so);
      outTitles.forEach(function (title) {
        var resolved = !!pageByTitle(title);
        strip.appendChild(chip(title, resolved ? "ok" : "new", function () {
          openOrCreateFromLink(title);
        }));
      });
    }

    if (backs.length) {
      var sb = document.createElement("div");
      sb.className = "lk-section";
      sb.textContent = t("links.back");
      strip.appendChild(sb);
      backs.forEach(function (src) {
        strip.appendChild(chip(
          src.title !== "" ? src.title : t("page.untitled"),
          "back",
          function () { selectPage(src.id); }
        ));
      });
    }

    pane.appendChild(strip);
  }

  function openNodeMenu(page, x, y) {
    closeMenus();
    var menu = document.createElement("div");
    menu.id = "node-menu";

        var actions = [
      [t("page.newchild"), function () { newPage(page.id); }],
      [t("page.rename"),   function () { renamePage(page.id); }],
      [t("page.move.up"),  function () { movePage(page.id, -1); }],
      [t("page.move.down"),function () { movePage(page.id, +1); }],
      [t("labels.title"),  function () { openLabelPicker(page, x, y); }],
      [t("menu.exportPage"),       function () { exportPageTxt(page); }],
      [t("menu.exportNotebook"),   function () { exportNotebookZip(); }],
      [t("page.delete"),   function () { deletePage(page.id); }]
    ];
    actions.forEach(function (pair) {
      var b = document.createElement("button");
      b.className = "node-menu-item";
      b.textContent = pair[0];
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        closeMenus();
        pair[1]();
      });
      menu.appendChild(b);
    });

    document.body.appendChild(menu);
    clampToViewport(menu, x, y);
  }

  // -------- Label picker popover --------

  function openLabelPicker(page, x, y) {
    closeMenus();
    var box = document.createElement("div");
    box.id = "label-picker";

    var title = document.createElement("div");
    title.className = "lp-title";
    title.textContent = t("labels.title") + " · " +
      (page.title !== "" ? page.title : t("page.untitled"));
    box.appendChild(title);

    if (!state.labels.length) {
      var none = document.createElement("div");
      none.className = "lp-none";
      none.textContent = t("labels.none");
      box.appendChild(none);
    } else {
      state.labels
        .slice()
        .sort(function (a, b) { return a.pos - b.pos || a.name.localeCompare(b.name); })
        .forEach(function (lb) {
          box.appendChild(buildLabelRow(page, lb));
        });
    }

    // ---- New label area: input + swatches + Add ----
    var newArea = document.createElement("div");
    newArea.className = "lp-new";

    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = t("labels.new");
    input.maxLength = 40;
    newArea.appendChild(input);

    var swatches = document.createElement("div");
    swatches.className = "lp-swatches";
    var selColor = LABEL_COLORS[0];
    LABEL_COLORS.forEach(function (c, i) {
      var sw = document.createElement("button");
      sw.className = "lp-swatch" + (i === 0 ? " sel" : "");
      sw.style.background = c;
      sw.setAttribute("aria-label", c);
      sw.addEventListener("click", function () {
        selColor = c;
        Array.prototype.forEach.call(swatches.children, function (s) {
          s.classList.remove("sel");
        });
        sw.classList.add("sel");
      });
      swatches.appendChild(sw);
    });
    newArea.appendChild(swatches);

    var addBtn = document.createElement("button");
    addBtn.className = "lp-add";
    addBtn.textContent = t("labels.add");
    addBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      var lb = createLabel(name, selColor);
      toggleAttach(page, lb.id);           // create → attach immediately
      input.value = "";
      refreshPicker(page, lb.id);
    });
    newArea.appendChild(addBtn);

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addBtn.click(); }
      e.stopPropagation();
    });

    box.appendChild(newArea);
    document.body.appendChild(box);
    clampToViewport(box, x, y);
    if (!state.labels.length) input.focus();
  }

  // Rebuilds the picker in place after create/attach/detach/delete —
  // keeps position and context, no flicker dance.
  function refreshPicker(page, focusLabelId) {
    var old = document.getElementById("label-picker");
    if (!old) return;
    var x = parseFloat(old.style.left) || 60;
    var y = parseFloat(old.style.top)  || 60;
    openLabelPicker(page, x, y);
    if (focusLabelId) {
      var el = document.querySelector('#label-picker .lp-item[data-lid="' + focusLabelId + '"]');
      if (el) el.focus();
    }
  }

  function buildLabelRow(page, lb) {
    var row = document.createElement("button");
    row.className = "lp-item" + ((page.labels || []).indexOf(lb.id) !== -1 ? " attached" : "");
    row.dataset.lid = lb.id;

    var dot = document.createElement("span");
    dot.className = "lp-dot";
    dot.style.background = lb.color;
    row.appendChild(dot);

    var name = document.createElement("span");
    name.className = "lp-name";
    name.textContent = lb.name;
    row.appendChild(name);

    var x = document.createElement("span");
    x.className = "lp-x";
    x.title = t("labels.confirm");
    x.innerHTML = X_SVG;
    x.addEventListener("click", function (e) {
      e.stopPropagation();
      if (window.confirm(t("labels.confirm") + "\n\"" + lb.name + "\"")) {
        deleteLabel(lb.id);
        refreshPicker(page, null);
      }
    });
    row.appendChild(x);

    row.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".lp-x")) return;
      toggleAttach(page, lb.id);
      refreshPicker(page, lb.id);
    });
    return row;
  }

  function createLabel(name, color) {
    var maxPos = 0;
    state.labels.forEach(function (l) { if (l.pos > maxPos) maxPos = l.pos; });
    var lb = { id: uid("l"), name: name, color: color, mtime: Date.now(), pos: maxPos + 1 };
    state.labels.push(lb);
    saveNow();
    markSyncDirty();
    return lb;
  }

  // Delete = label tombstone ("lbl:" prefix rides in the SAME
  // state.tombs map — Part 1 normalize keeps unknown-prefix entries
  // for 30 days). Merge drops any label whose tomb outweighs its
  // mtime; refs on pages get pruned by normalizeState. Deterministic
  // on both devices, no new top-level field.
  function deleteLabel(id) {
    state.tombs["lbl:" + id] = Date.now();
    state.labels = state.labels.filter(function (l) { return l.id !== id; });
    state.pages.forEach(function (p) {
      var idx = (p.labels || []).indexOf(id);
      if (idx !== -1) { p.labels.splice(idx, 1); p.mtime = Date.now(); }
    });
    saveNow();
    markSyncDirty();
    renderAll();
    toast(t("labels.detached"));
  }

  function toggleAttach(page, labelId) {
    if (!page.labels) page.labels = [];
    var idx = page.labels.indexOf(labelId);
    if (idx === -1) page.labels.push(labelId);
    else page.labels.splice(idx, 1);
    page.labels.sort();                     // deterministic serialization
    page.mtime = Date.now();
    saveNow();
    markSyncDirty();
        renderAll();     // v0.14.1: chips must refresh too, not just tree dots
  }

  // ---------- 7. Merge engine (pages + labels, deterministic) ----------

  function pickByLWW(l, r, keyFn) {
    var ls = JSON.stringify(l), rs = JSON.stringify(r);
    if (ls === rs) return l;
    return keyFn(r) > keyFn(l) ? r : (keyFn(l) > keyFn(r) ? l :
           (ls < rs ? l : r));             // tie → lexicographic JSON
  }

  function mergeNotesStates(a, b) {
    if (!a && !b) return null;

    a = a || { ver: 2, pages: [], labels: [], tombs: {} };
    b = b || { ver: 2, pages: [], labels: [], tombs: {} };

    // -- Tombs: union, max ts (page tombs AND "lbl:" label tombs) --
    var tombs = {};
    var keys = {};
    Object.keys(a.tombs || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(b.tombs || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      var ta = (a.tombs || {})[k] || 0;
      var tb = (b.tombs || {})[k] || 0;
      tombs[k] = Math.max(ta, tb);
    });

    // -- Labels: per-id LWW, then tomb-drop --
    var labelMap = {};
    [].concat(a.labels || [], b.labels || []).forEach(function (l) {
      if (!l || typeof l.id !== "string") return;
      labelMap[l.id] = labelMap[l.id]
        ? pickByLWW(labelMap[l.id], l, function (x) { return x.mtime || 0; })
        : l;
    });
    var labels = Object.keys(labelMap).map(function (k) { return labelMap[k]; })
      .filter(function (l) {
        var tomb = tombs["lbl:" + l.id] || 0;   // delete wins ties (>=)
        return !(tomb >= (l.mtime || 0));
      })
      .sort(function (x, y) { return x.pos - y.pos || x.name.localeCompare(y.name); });

    var labelAlive = {};
    labels.forEach(function (l) { labelAlive[l.id] = true; });

    // -- Pages: per-id LWW, tomb-filtered (delete wins ties: >=) --
    var pageMap = {};
    [].concat(a.pages || [], b.pages || []).forEach(function (p) {
      if (!p || typeof p.id !== "string") return;
      pageMap[p.id] = pageMap[p.id]
        ? pickByLWW(pageMap[p.id], p, function (x) { return x.mtime || 0; })
        : p;
    });
    var pages = Object.keys(pageMap).map(function (k) { return pageMap[k]; })
      .filter(function (p) {
        var tomb = tombs[p.id] || 0;
        return !(tomb >= (p.mtime || 0));
      })
      .map(function (p) {
        // Dead label refs never survive the merge output
        p.labels = (p.labels || []).filter(function (lid) { return labelAlive[lid]; });
        p.labels.sort();
        return p;
      })
      .sort(function (x, y) { return (x.mtime || 0) - (y.mtime || 0); });

    return { ver: DATA_VER, pages: pages, labels: labels, tombs: tombs };
  }

  // ---------- 8. Sync slice registration ----------

  function sliceGet() {
    // Deep-copy: the engine JSON-stringifies for comparison — a
    // live reference would race the debounce timer mid-edit.
    return JSON.parse(JSON.stringify({
      ver: state.ver, pages: state.pages, labels: state.labels, tombs: state.tombs
    }));
  }

  function sliceSet(data, info) {
    if (!data || typeof data !== "object") return;
    var incoming = JSON.stringify({
      ver: data.ver, pages: data.pages || [], labels: data.labels || [], tombs: data.tombs || {}
    });
    var mine = JSON.stringify({
      ver: state.ver, pages: state.pages, labels: state.labels, tombs: state.tombs
    });
    if (incoming === mine) return;          // echo suppression — no re-render/toast

    state.ver    = DATA_VER;
    state.pages  = Array.isArray(data.pages)  ? data.pages  : [];
    state.labels = Array.isArray(data.labels) ? data.labels : [];
    state.tombs  = (data.tombs && typeof data.tombs === "object") ? data.tombs : {};

    normalizeState();
    saveNow();

    // Deleted current page? Re-anchor selection.
    if (!pageById(prefs.current)) {
      prefs.current = (state.pages[0] && state.pages[0].id) || null;
    }
    savePrefs();
    renderAll();
    if (info && info.merged) toast(t("toast.merged"));
  }

  function registerNotesSlice() {
    var api = syncApi();
    if (api && typeof api.registerSlice === "function") {
      // (name, get, set, storageKey, merge) — merge-capable slice:
      // closed-app proxies stay guarded, live opens merge.
      api.registerSlice("notes", sliceGet, sliceSet, STORAGE_KEY, mergeNotesStates);
    }
  }

  // ---------- 9. Wiring & boot ----------

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function loadPrefs() {
    try {
      var raw = JSON.parse(localStorage.getItem(PREFS_KEY));
      if (raw && typeof raw === "object") {
        prefs.open    = (raw.open && typeof raw.open === "object") ? raw.open : {};
        prefs.current = (typeof raw.current === "string") ? raw.current : null;
        prefs.width   = (typeof raw.width === "number" && raw.width >= 200 && raw.width <= 480)
                        ? raw.width : 270;
      }
    } catch (e) {}
    if (prefs.current && !pageByIdQuick(prefs.current)) prefs.current = null;
  }
  function pageByIdQuick(id) {
    try {
      var d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return !!(d && d.pages && d.pages.some(function (p) { return p.id === id; }));
    } catch (e) { return false; }
  }

  function initSplitter() {
    var sp = document.getElementById("pane-splitter");
    var tp = document.getElementById("tree-pane");
    if (!sp || !tp) return;

    function setWidth(w) {
      w = Math.max(200, Math.min(480, w));
      prefs.width = w;
      tp.style.flexBasis = w + "px";
    }
    setWidth(prefs.width);

    var dragging = false;
    sp.addEventListener("pointerdown", function (e) {
      dragging = true;
      sp.classList.add("dragging");
      document.body.classList.add("resizing");
      sp.setPointerCapture && sp.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    sp.addEventListener("pointermove", function (e) {
      if (dragging) setWidth(e.clientX);
    });
    sp.addEventListener("pointerup", function () {
      dragging = false;
      sp.classList.remove("dragging");
      document.body.classList.remove("resizing");
      savePrefs();
    });
  }

  function wireUI() {
	      paintStaticIcons();
    var showTree = document.getElementById("btn-show-tree");
    if (showTree) {
      showTree.addEventListener("click", function () {
        document.getElementById("notes-app").classList.toggle("tree-open");
      });
    }

    var newBtn = document.getElementById("btn-new-page");
    if (newBtn) newBtn.addEventListener("click", function () { newPage(null); });

    // ---- Runtime-injected tree-footer buttons ----
    // v0.15.0: export notebook (ZIP)
    // v0.16.0: search + tags panel
    if (newBtn && newBtn.parentNode) {
      var SEARCH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      var DL_SVG     = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      var TAG_SVG    = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';

      // Search ← before +
      var seBtn = document.createElement("button");
      seBtn.id = "btn-search";
      seBtn.type = "button";
      seBtn.className = "icon-btn";
      seBtn.title = t("search.placeholder");
      seBtn.setAttribute("aria-label", t("search.placeholder"));
      seBtn.innerHTML = SEARCH_SVG;
      seBtn.addEventListener("click", openSearch);
      newBtn.parentNode.insertBefore(seBtn, newBtn);

      // Export zip → right after +
      var exBtn = document.createElement("button");
      exBtn.id = "btn-export-notebook";
      exBtn.type = "button";
      exBtn.className = "icon-btn";
      exBtn.title = t("menu.exportNotebook");
      exBtn.setAttribute("aria-label", t("menu.exportNotebook"));
      exBtn.innerHTML = DL_SVG;
      exBtn.addEventListener("click", function () { exportNotebookZip(); });
      newBtn.parentNode.insertBefore(exBtn, newBtn.nextSibling);

      // Tags → last
      var tgBtn = document.createElement("button");
      tgBtn.id = "btn-tag-panel";
      tgBtn.type = "button";
      tgBtn.className = "icon-btn";
      tgBtn.title = t("tags.all");
      tgBtn.setAttribute("aria-label", t("tags.all"));
      tgBtn.innerHTML = TAG_SVG;
      tgBtn.addEventListener("click", toggleTagPanel);
      newBtn.parentNode.appendChild(tgBtn);
    }

    var title = document.getElementById("page-title");
    if (title) {
      title.addEventListener("input", function () {
        var p = pageById(prefs.current);
        if (!p) return;
        p.title = title.value;
        p.mtime = Date.now();
        queueSave(p.id);
        renderTree();
      });
    }

    var text = document.getElementById("page-text");
    if (text) {
      text.addEventListener("input", function () {
        var p = pageById(prefs.current);
        if (!p) return;
        p.text  = text.value;
        p.mtime = Date.now();
        queueSave(p.id);
        renderLinksStrip(p);   // live chips while typing
      });
    }

    // Outside-click closes menus (menus stopPropagation internally)
    document.addEventListener("click", function (e) {
      if (!e.target.closest || (!e.target.closest("#node-menu") && !e.target.closest("#label-picker"))) {
        closeMenus();
      }
      // v0.16.0: floating views close on outside click / backdrop
      var tp = document.getElementById("tag-panel");
      if (tp && (!e.target.closest || !e.target.closest("#tag-panel"))) {
        var pb = document.getElementById("btn-tag-panel");
        if (!(pb && pb.contains(e.target))) tp.remove();
      }
      var so = document.getElementById("search-overlay");
      if (so && e.target === so) so.remove();
    });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === "Escape") { closeMenus(); closeFloating(); }
    });

    // Last-chance flush before tab death
    window.addEventListener("beforeunload", flushSave);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushSave();
    });
  }

  // ---------- Boot ----------
  loadPrefs();
  loadData();
  applyI18n();
  inheritPalette();
  renderAll();
  registerNotesSlice();
  wireUI();
  initSplitter();
  watchPalette();

  // Console debugging handle (Lesson 4 culture)
  window.__notesDebug = {
    version: APP_VERSION,
    state: state,
    merge: mergeNotesStates,
    sliceGet: sliceGet
  };
})();