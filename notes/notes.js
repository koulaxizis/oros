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
      "labels.empty.new":   "Label name"      // v0.14.0
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
      "labels.empty.new":   "Όνομα ετικέτας"   // v0.14.0
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
      var parentStyle = window.parent.getComputedStyle(document.documentElement);
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

    title.disabled = !page;
    text.disabled  = !page;
    title.value = page ? page.title : "";
    text.value  = page ? page.text : "";
    setSaveIndicator("saved");
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

  function openNodeMenu(page, x, y) {
    closeMenus();
    var menu = document.createElement("div");
    menu.id = "node-menu";

    var actions = [
      [t("page.newchild"), function () { newPage(page.id); }],
      [t("page.rename"),   function () { renamePage(page.id); }],
      [t("page.move.up"),  function () { movePage(page.id, -1); }],
      [t("page.move.down"),function () { movePage(page.id, +1); }],
      [t("labels.title"),  function () { openLabelPicker(page, x, y); }],   // ← Wave 2.1
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
    renderTree();
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
    var showTree = document.getElementById("btn-show-tree");
    if (showTree) {
      showTree.addEventListener("click", function () {
        document.getElementById("notes-app").classList.toggle("tree-open");
      });
    }

    var newBtn = document.getElementById("btn-new-page");
    if (newBtn) newBtn.addEventListener("click", function () { newPage(null); });

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
      });
    }

    // Outside-click closes menus (menus stopPropagation internally)
    document.addEventListener("click", function (e) {
      if (!e.target.closest || (!e.target.closest("#node-menu") && !e.target.closest("#label-picker"))) {
        closeMenus();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenus();
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