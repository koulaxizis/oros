// ============================================================
// orOS Files — App logic (v0.1, Wave 1: browse/create/rename/delete)
// ------------------------------------------------------------
// First orOS application on the OrosFS virtual disk. ALL file
// operations go through window.parent.orosFS (fs.js) — this app
// owns NO file data of its own. Only view preferences (expanded
// tree nodes, last visited folder) live in localStorage.
//
// Zero-contact rules honored:
//   • Storage key: "oros-files-data" (new, oros- prefixed →
//     factory-reset sweep catches it)
//   • No other app's keys are read or written
//   • View prefs are deliberately NOT sync-registered: they are
//     device-local by nature (Wave 3 brings Dropbox-mount sync
//     for file CONTENT, not view state)
//
// Async model: unlike todo.js, every render is promise-driven
// (OPFS answers through promises). A render token guards against
// stale listings arriving out of order during fast navigation.
// Sections:
//   1. Constants, i18n, helpers
//   2. View state + persistence
//   3. FS bridge (orosFS access + availability guard)
//   4. Navigation + render orchestration
//   5. Folder tree render (lazy, expanded set)
//   6. Entry list render (+ selection)
//   7. Breadcrumbs + status bar
//   8. Dialogs (create / rename / delete)
//   9. Mobile tree drawer
//  10. Toast
//  11. Palette + shell shortcut forwarding
//  12. Wiring & boot
// Coding style: ES5 + promises, matching shell.js/fs.js/todo.js.
// ============================================================
(function () {
  "use strict";

  var APP_VER = "0.1";
  var STORAGE_KEY = "oros-files-data";
  var DATA_VER = 1;
  var ROOT = "/internal";

  // ---------- 1. Constants, i18n, helpers ----------

  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "tree.root":    "Files",
      "tree.toggle":  "Show folders",
      "nav.up":       "Go to parent folder",
      "act.newFolder":"New folder",
      "act.newFile":  "New file",
      "act.rename":   "Rename",
      "act.delete":   "Delete",
      "empty.title":  "This folder is empty",
      "empty.hint":   "Create a file or folder with the buttons above.",
      "dlg.createFolder": "New folder",
      "dlg.createFile":   "New file",
      "dlg.rename":       "Rename",
      "dlg.nameLabel":    "Name",
      "dlg.cancel":   "Cancel",
      "dlg.ok":       "Create",
      "dlg.save":     "Save",
      "dlg.deleteTitle":    "Delete",
      "dlg.deleteConfirm":  "Delete",
      "dlg.deleteFileMsg":   "Delete “{name}”?",
      "dlg.deleteFolderMsg": "Delete “{name}” and everything inside it?",
      "dlg.reserved": "Reserved name",
      "err.required": "Please enter a name.",
      "err.chars":    "The name can’t contain: / \\ : * ? \" < > |",
      "err.exists":   "Something with this name already exists here.",
      "toast.createdFolder": "Folder created",
      "toast.createdFile":   "File created",
      "toast.renamed":       "Renamed",
      "toast.deleted":       "Deleted",
      "toast.opFail":        "Operation failed",
      "toast.fsMissing":     "The orOS file system is not available.",
      "status.loading": "Loading…",
      "status.items":   "{n} items",
      "status.oneItem": "1 item",
      "name.newFolder": "New folder",
      "name.newFile":   "New file.txt"
    },
    el: {
      "tree.root":    "Αρχεία",
      "tree.toggle":  "Εμφάνιση φακέλων",
      "nav.up":       "Μετάβαση στον γονικό φάκελο",
      "act.newFolder":"Νέος φάκελος",
      "act.newFile":  "Νέο αρχείο",
      "act.rename":   "Μετονομασία",
      "act.delete":   "Διαγραφή",
      "empty.title":  "Αυτός ο φάκελος είναι κενός",
      "empty.hint":   "Δημιούργησε αρχείο ή φάκελο με τα κουμπιά παραπάνω.",
      "dlg.createFolder": "Νέος φάκελος",
      "dlg.createFile":   "Νέο αρχείο",
      "dlg.rename":       "Μετονομασία",
      "dlg.nameLabel":    "Όνομα",
      "dlg.cancel":   "Άκυρο",
      "dlg.ok":       "Δημιουργία",
      "dlg.save":     "Αποθήκευση",
      "dlg.deleteTitle":    "Διαγραφή",
      "dlg.deleteConfirm":  "Διαγραφή",
      "dlg.deleteFileMsg":   "Διαγραφή «{name}»;",
      "dlg.deleteFolderMsg": "Διαγραφή «{name}» και όλων των περιεχομένων;",
      "dlg.reserved": "Δεσμευμένο όνομα",
      "err.required": "Δώσε ένα όνομα.",
      "err.chars":    "Το όνομα δεν μπορεί να περιέχει: / \\ : * ? \" < > |",
      "err.exists":   "Υπάρχει ήδη κάτι με αυτό το όνομα εδώ.",
      "toast.createdFolder": "Ο φάκελος δημιουργήθηκε",
      "toast.createdFile":   "Το αρχείο δημιουργήθηκε",
      "toast.renamed":       "Έγινε μετονομασία",
      "toast.deleted":       "Διαγράφηκε",
      "toast.opFail":        "Η ενέργεια απέτυχε",
      "toast.fsMissing":     "Το σύστημα αρχείων του orOS δεν είναι διαθέσιμο.",
      "status.loading": "Φόρτωση…",
      "status.items":   "{n} στοιχεία",
      "status.oneItem": "1 στοιχείο",
      "name.newFolder": "Νέος φάκελος",
      "name.newFile":   "Νέο αρχείο.txt"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }
  function tfmt(key, vars) {
    var s = t(key);
    Object.keys(vars || {}).forEach(function (k) {
      s = s.split("{" + k + "}").join(String(vars[k]));
    });
    return s;
  }

  function $(id) { return document.getElementById(id); }

  var BAD_CHARS = /[\\/:*?"<>|]/;

  var FOLDER_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  var FILE_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var CARET_SVG =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  var MENU_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';

  // ---------- 2. View state + persistence ----------
  // prefs = { ver: 1, expanded: {"/internal/a": true, …}, last: "/internal" }
  // Expanded set persists only FOLDER paths that the user opened.

  var prefs = null;
  var cwd = ROOT;
  var selection = null;         // { name, dir, path } — the picked row
  var renderToken = 0;          // stale-listing guard

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.ver === DATA_VER && p.expanded && typeof p.last === "string") {
          prefs = p;
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
    prefs = { ver: DATA_VER, expanded: {}, last: ROOT };
    // First run: root expanded so the tree shows something
    prefs.expanded[ROOT] = true;
    savePrefs();
  }

  function savePrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); }
    catch (e) { /* quota — view prefs are expendable */ }
  }

  // ---------- 3. FS bridge ----------

  function FS() {
    return (window.parent && window.parent.orosFS) || window.orosFS;
  }

  function join(parent, name) {
    return parent === "/" ? "/" + name : parent + "/" + name;
  }

  function isAvailable() {
    var fs = FS();
    return !!(fs && typeof fs.ls === "function");
  }

  function fsList(path) {
    return FS().ls(path).then(function (list) {
      // dirs first (A→Z), then files (A→Z) — stable, predictable
      var dirs = [], files = [];
      (list || []).forEach(function (e) {
        (e.dir ? dirs : files).push(e);
      });
      var byName = function (a, b) { return a.name < b.name ? -1 : 1; };
      dirs.sort(byName);
      files.sort(byName);
      return dirs.concat(files);
    });
  }

  // ---------- 4. Navigation + render orchestration ----------

  function refresh() {
    var token = ++renderToken;
    setStatusLoading();
    fsList(cwd).then(function (entries) {
      if (token !== renderToken) return;      // superseded mid-flight
      renderEntries(entries);
      renderStatus(entries.length);
    }).catch(function (e) {
      if (token !== renderToken) return;
      renderEntries([]);
      renderStatus(0);
      if (e && e.code === "ENOENT") {
        // Folder vanished (deleted elsewhere / stale last-open):
        // fall back to the root, never strand the user on a ghost.
        prefs.last = ROOT;
        cwd = ROOT;
        selection = null;
        refresh();
      }
    });
    renderTree();
    renderCrumbs();
    updateActionButtons();
  }

  function navigate(path) {
    cwd = path;
    selection = null;
    prefs.last = path;
    savePrefs();
    refresh();
  }

  function updateActionButtons() {
    $("up").disabled = (cwd === ROOT);
    $("rename").disabled = !selection;
    $("delete").disabled = !selection;
    $("delete").classList.toggle("danger-arm", !!selection);
  }

  // ---------- 5. Folder tree render (lazy, expanded set) ----------

  function renderTree() {
    var host = $("tree-root");
    var token = renderToken;
    host.innerHTML = "";
    host.appendChild(makeTreeNode(ROOT, t("tree.root"), 0, token));
  }

  // One node per FOLDER. Children are listed only when expanded —
  // deep trees never pay for what the user hasn't opened.
  function makeTreeNode(path, label, depth, token) {
    var wrap = document.createElement("div");

    var node = document.createElement("div");
    node.className = "tnode" + (path === cwd ? " selected" : "");
    node.style.paddingLeft = (6 + depth * 14) + "px";
    node.dataset.path = path;

    var caret = document.createElement("span");
    caret.className = "caret";
    caret.innerHTML = CARET_SVG;
    node.appendChild(caret);

    var glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.innerHTML = FOLDER_SVG;
    node.appendChild(glyph);

    var name = document.createElement("span");
    name.className = "tname";
    name.textContent = label;
    node.appendChild(name);

    // Expansion + navigation: caret toggles, anywhere navigates.
    // Lazy-load reveals children on FIRST expand, then re-renders
    // from a fresh ls (updates stay cheap and honest).
    caret.addEventListener("click", function (e) {
      e.stopPropagation();
      if (caret.classList.contains("empty")) return;
      toggleExpanded(path);
    });
    node.addEventListener("click", function () {
      closeTreeDrawer();
      navigate(path);
    });

    wrap.appendChild(node);

    var kids = document.createElement("div");
    kids.className = "tchildren";
    wrap.appendChild(kids);

    if (isExpanded(path)) {
      node.classList.add("open");
      fsList(path).then(function (entries) {
        if (token !== renderToken) return;
        var dirs = entries.filter(function (e) { return e.dir; });
        if (dirs.length === 0) {
          caret.classList.add("empty");     // expanded but childless
          return;
        }
        dirs.forEach(function (d) {
          kids.appendChild(makeTreeNode(join(path, d.name), d.name, depth + 1, token));
        });
      }).catch(function () {
        /* stale branch (folder deleted elsewhere): node stays leaf */
      });
    } else {
      // Collapsed: unknown whether it has children — probe gently
      // so the caret can hide itself for true leaf folders.
      fsList(path).then(function (entries) {
        if (token !== renderToken) return;
        var hasDirs = entries.some(function (e) { return e.dir; });
        if (!hasDirs) caret.classList.add("empty");
      }).catch(function () { /* leave the caret — harmless */ });
    }

    return wrap;
  }

  function isExpanded(path) {
    return !!prefs.expanded[path];
  }
  function toggleExpanded(path) {
    if (prefs.expanded[path]) delete prefs.expanded[path];
    else prefs.expanded[path] = true;
    savePrefs();
    renderTree();                            // tree-only redraw
  }

  // ---------- 6. Entry list render + selection ----------

  function renderEntries(entries) {
    var ul = $("entries");
    ul.innerHTML = "";
    $("empty").hidden = entries.length > 0;
    if (entries.length === 0) return;

    entries.forEach(function (e) {
      var path = join(cwd, e.name);
      var li = document.createElement("li");
      li.className = "entry" + (selection && selection.path === path ? " selected" : "");
      li.dataset.path = path;

      var glyph = document.createElement("span");
      glyph.className = "glyph " + (e.dir ? "folder" : "file");
      glyph.innerHTML = e.dir ? FOLDER_SVG : FILE_SVG;
      li.appendChild(glyph);

      var name = document.createElement("span");
      name.className = "ename";
      name.textContent = e.name;
      li.appendChild(name);

      var ext = document.createElement("span");
      ext.className = "ext" + (e.dir ? " folder" : "");
      ext.textContent = e.dir ? t("tree.root").toLowerCase() !== "files" ? "" : "folder" : extOf(e.name);
      if (e.dir && ext.textContent === "") { ext.textContent = "\u00A0"; }
      li.appendChild(ext);

      // Single click = select (arms rename/delete). Double click on a
      // folder = navigate. Files do nothing on double-click in Wave 1
      // (preview arrives in Wave 3).
      li.addEventListener("click", function () {
        selection = { name: e.name, dir: e.dir, path: path };
        // cheap re-selection without a full listing
        var rows = ul.querySelectorAll(".entry");
        for (var i = 0; i < rows.length; i++) {
          rows[i].classList.toggle("selected", rows[i].dataset.path === path);
        }
        updateActionButtons();
      });
      if (e.dir) {
        li.addEventListener("dblclick", function () {
          selection = null;
          navigate(path);
        });
      }

      ul.appendChild(li);
    });
  }

  function extOf(name) {
    var dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) return "file";
    return name.slice(dot + 1).toLowerCase();
  }

  // ---------- 7. Breadcrumbs + status bar ----------

  function renderCrumbs() {
    var host = $("crumbs");
    host.innerHTML = "";

    var home = document.createElement("button");
    home.type = "button";
    home.className = "crumb" + (cwd === ROOT ? " current" : "");
    home.textContent = t("tree.root");
    home.addEventListener("click", function () { navigate(ROOT); });
    host.appendChild(home);

    if (cwd === ROOT) return;

    var rest = cwd.slice(ROOT.length + 1).split("/");
    var acc = ROOT;
    rest.forEach(function (seg, i) {
      acc = join(acc, seg);

      var sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "/";
      host.appendChild(sep);

      var crumb = document.createElement("button");
      crumb.type = "button";
      var last = (i === rest.length - 1);
      crumb.className = "crumb" + (last ? " current" : "");
      crumb.textContent = seg;
      if (!last) {
        crumb.addEventListener("click", function () { navigate(acc); });
      }
      host.appendChild(crumb);
    });
  }

  function setStatusLoading() {
    $("st-count").textContent = t("status.loading");
    $("st-path").textContent = cwd === ROOT ? ROOT : cwd;
  }

  function renderStatus(count) {
    $("st-count").textContent =
      count === 1 ? t("status.oneItem") : tfmt("status.items", { n: count });
    $("st-path").textContent = cwd === ROOT ? ROOT : cwd;
  }

  // ---------- 8. Dialogs (create / rename / delete) ----------

  var DIALOG_MODE = null;       // "folder" | "file" | "rename"
  var dialogSubmitted = false;

  function validateName(raw, existingNames) {
    var name = raw.trim();
    if (!name) return { ok: false, err: t("err.required") };
    if (BAD_CHARS.test(name)) return { ok: false, err: t("err.chars") };
    if (name === "." || name === "..") return { ok: false, err: t("err.required") };
    for (var i = 0; i < existingNames.length; i++) {
      if (existingNames[i] === name) return { ok: false, err: t("err.exists") };
    }
    return { ok: true, name: name };
  }

  // existing() resolves the CURRENT listing — used by validation.
  // We hold a micro-cache of the last fetched listing so both the
  // dialog validation and the submit path see the same truth.
  var lastEntries = [];
  var origListChain = null;
  function currentEntries() {
    if (origListChain) return origListChain;
    return fsList(cwd).catch(function () { return []; });
  }

  function openNameDialog(mode) {
    DIALOG_MODE = mode;
    dialogSubmitted = false;

    var title = $("name-title");
    var submitBtn = $("name-form").querySelector('button[type="submit"]');
    if (mode === "folder") {
      title.textContent = t("dlg.createFolder");
      submitBtn.textContent = t("dlg.ok");
      $("name-input").value = t("name.newFolder");
    } else if (mode === "file") {
      title.textContent = t("dlg.createFile");
      submitBtn.textContent = t("dlg.ok");
      $("name-input").value = t("name.newFile");
    } else {
      title.textContent = t("dlg.rename");
      submitBtn.textContent = t("dlg.save");
      $("name-input").value = selection ? selection.name : "";
    }
    // Pre-select the base name (without extension) for renames —
    // desktop nicety; harmless everywhere else.
    var v = $("name-input").value;
    var dot = v.lastIndexOf(".");
    try {
      $("name-input").setSelectionRange(0, (dot > 0 && DIALOG_MODE === "rename") ? dot : v.length);
    } catch (e) { /* some engines with RTL inputs — ignore */ }

    $("name-error").hidden = true;
    origListChain = currentEntries();
    $("dlg-name").showModal();
    setTimeout(function () { $("name-input").focus(); }, 50);
  }

  function submitNameDialog() {
    var raw = $("name-input").value;
    origListChain.then(function (entries) {
      var names = entries.map(function (e) { return e.name; });
      var check = validateName(raw, names);

      if (!check.ok) {
        var err = $("name-error");
        err.textContent = check.err;
        err.hidden = false;
        $("name-input").focus();
        // Keep the dialog OPEN on validation failure — the <form
        // method="dialog"> already tried to close it; reassert.
        $("dlg-name").showModal();
        return;
      }

      var name = check.name;
      var op = null;
      if (DIALOG_MODE === "folder") {
        op = FS().mkdir(join(cwd, name)).then(function () { showToast(t("toast.createdFolder")); });
      } else if (DIALOG_MODE === "file") {
        op = FS().writeText(join(cwd, name), "").then(function () { showToast(t("toast.createdFile")); });
      } else if (DIALOG_MODE === "rename" && selection) {
        op = FS().mv(selection.path, join(cwd, name))
          .then(function () {
            // Fold renamed-folder subtrees into the new path so the
            // expanded-set stays honest (stale keys are inert anyway).
            if (selection.dir) renameExpandedPrefix(selection.path, join(cwd, name));
            showToast(t("toast.renamed"));
          });
      }

      if (!op) { $("dlg-name").close(); return; }

      op.then(function () {
        dialogSubmitted = true;
        selection = null;
        $("dlg-name").close();
        refresh();
      }).catch(function () {
        showToast(t("toast.opFail"));
        dialogSubmitted = true;
        $("dlg-name").close();
        refresh();
      });
    });
    // Suppress the form's default close — we manage it ourselves.
    return false;
  }

  function renameExpandedPrefix(oldPath, newPath) {
    var updated = false;
    Object.keys(prefs.expanded).forEach(function (k) {
      if (k === oldPath || k.indexOf(oldPath + "/") === 0) {
        delete prefs.expanded[k];
        prefs.expanded[newPath + k.slice(oldPath.length)] = true;
        updated = true;
      }
    });
    if (updated) savePrefs();
  }

  function openDeleteDialog() {
    if (!selection) return;
    var msg = selection.dir ? t("dlg.deleteFolderMsg") : t("dlg.deleteFileMsg");
    $("delete-msg").textContent = tfmt4(msg, selection.name);
    $("dlg-delete").showModal();
  }
  // tiny shim — keep tfmt for templating "{name}"
  function tfmt4(template, name) {
    return template.split("{name}").join(name);
  }

  function performDelete() {
    if (!selection) return;
    FS().rm(selection.path).then(function () {
      if (selection && selection.dir) dropExpandedPrefix(selection.path);
      showToast(t("toast.deleted"));
      selection = null;
      refresh();
    }).catch(function () {
      showToast(t("toast.opFail"));
    });
  }

  function dropExpandedPrefix(path) {
    var changed = false;
    Object.keys(prefs.expanded).forEach(function (k) {
      if (k === path || k.indexOf(path + "/") === 0) {
        delete prefs.expanded[k];
        changed = true;
      }
    });
    if (changed) savePrefs();
  }

  // ---------- 9. Mobile tree drawer ----------

  var drawerBackdrop = null;

  function ensureTreeToggle() {
    // Created by JS (not in the static HTML): it only exists below
    // 640px, where the tree becomes a drawer.
    if ($("tree-toggle")) return;
    var bar = $("bar");
    var tog = document.createElement("button");
    tog.type = "button";
    tog.id = "tree-toggle";
    tog.setAttribute("aria-label", t("tree.toggle"));
    tog.title = t("tree.toggle");
    tog.innerHTML = MENU_SVG;
    tog.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleTreeDrawer();
    });
    bar.insertBefore(tog, bar.firstChild);
  }

  function toggleTreeDrawer() {
    var wrap = $("tree-wrap");
    var open = !wrap.classList.contains("open");
    wrap.classList.toggle("open", open);
    $("tree-toggle").classList.toggle("open", open);
    if (open && !drawerBackdrop) {
      drawerBackdrop = document.createElement("div");
      drawerBackdrop.id = "tree-backdrop";
      drawerBackdrop.addEventListener("click", closeTreeDrawer);
      $("split").appendChild(drawerBackdrop);
    } else if (!open) {
      closeTreeDrawer();
    }
  }

  function closeTreeDrawer() {
    var wrap = $("tree-wrap");
    if (!wrap.classList.contains("open")) return;
    wrap.classList.remove("open");
    var tog = $("tree-toggle");
    if (tog) tog.classList.remove("open");
    if (drawerBackdrop && drawerBackdrop.parentNode) {
      drawerBackdrop.parentNode.removeChild(drawerBackdrop);
    }
    drawerBackdrop = null;
  }

  // ---------- 10. Toast ----------

  var toastTimer = null;

  function showToast(text) {
    var el = $("toast");
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth;                    // restart transition
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 4000);
  }

  // ---------- 11. Palette + shell shortcut forwarding ----------

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

  // Contract Β: shell-owned combos (Ctrl+Alt+Shift+*) forward FIRST.
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  // ---------- 12. Wiring & boot ----------

  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var ti = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < ti.length; j++) {
      ti[j].setAttribute("title", t(ti[j].getAttribute("data-i18n-title")));
      ti[j].setAttribute("aria-label", ti[j].getAttribute("title"));
    }
  }

  function wire() {
    $("up").addEventListener("click", function () {
      if (cwd === ROOT) return;
      navigate(cwd.slice(0, cwd.lastIndexOf("/")) || ROOT);
    });

    $("new-folder").addEventListener("click", function () { openNameDialog("folder"); });
    $("new-file").addEventListener("click", function () { openNameDialog("file"); });
    $("rename").addEventListener("click", function () { openNameDialog("rename"); });
    $("delete").addEventListener("click", openDeleteDialog);

    // Name dialog — submit is intercepted; validation failures keep
    // the dialog open (showModal reassert overrides the implicit close).
    $("name-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitNameDialog();
    });
    $("name-cancel").addEventListener("click", function () {
      dialogSubmitted = true;
      $("dlg-name").close();
    });

    // Delete dialog
    $("delete-form").addEventListener("submit", function (e) {
      e.preventDefault();
      $("dlg-delete").close();
      performDelete();
    });
    $("delete-cancel").addEventListener("click", function () {
      $("dlg-delete").close();
    });

    // Clicking empty space deselects (matches desktop file managers)
    $("list-wrap").addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".entry")) return;
      selection = null;
      var rows = $("entries").querySelectorAll(".entry");
      for (var i = 0; i < rows.length; i++) rows[i].classList.remove("selected");
      updateActionButtons();
    });
  }

  function boot() {
    loadPrefs();
    applyI18n();
    ensureTreeToggle();
    wire();
    inheritPalette();
    watchPalette();

    if (!isAvailable()) {
      // Graceful degradation: no fs.js (direct open of a stale
      // cached copy, or an ancient offline bundle). Visible state,
      // nothing hidden, nothing throws.
      $("empty").hidden = false;
      $("empty").querySelector("span").textContent = t("toast.fsMissing");
      $("empty").querySelector("small").textContent = "";
      $("new-folder").disabled = true;
      $("new-file").disabled = true;
      $("up").disabled = true;
      console.warn("[orOS] files.js v" + APP_VER + " booted (NO orosFS — read-only state)");
      return;
    }

    // Resume the last visited folder (view pref — device-local).
    cwd = prefs.last && prefs.last.indexOf(ROOT) === 0 ? prefs.last : ROOT;
    selection = null;
    refresh();
    console.log("[orOS] files.js v" + APP_VER + " booted (backend: " +
      (FS().mode ? FS().mode() : "unknown") + ")");
  }

  boot();
})();