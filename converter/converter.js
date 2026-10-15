// ============================================================
// orOS Converter — App logic (v1.0.0)
// Bulk conversion of other formats into the open orOS bundles
// (OBF, bundle.js): documents → .orosdoc (Writer), spreadsheets →
// .orossheet (Spreadsheet). Later waves add more apps through
// converter/registry.js; nothing here names an app.
//   - Drop or pick many files, or a whole folder. Each row shows
//     the file, its target (or "not supported"), size and status.
//   - Convert runs the files one at a time. Each app's convert.js
//     (the converter contract, window.OrosConvert.<app>) and its
//     deps are loaded once by script tag, on first need.
//   - Output: one .zip download, a folder in Files
//     (/internal/Converted/<date>/), or each file saved on its own
//     (orosDialog.saveFile, R33).
//   - Open: a finished file opens in its app through the shell's
//     file-open path (orosFileOpen.open).
// Data: nothing synced. Device-local (R10): oros-converter-prefs
// { out } (the last output choice). Sync exemption: the Converter
// keeps no user data of its own; its results live in Files (synced
// by Vault Drive when on) or wherever the user saves them.
// Notifications: none (exemption, Checklist B item 9): the work is
// done while the app is open and every row shows its own status.
// Deep link: __orosOpenAt("converter", { paths: [orOS disk paths] })
// (Files › Convert to orOS); { openFile: { token } } (a File held by
// the shell); { files: [File] } when called on this window directly.
// Sections:
//   1. Constants, i18n, helpers
//   2. Prefs
//   3. Rows: adding files, folders, disk paths
//   4. Rendering
//   5. Loading converters
//   6. Converting
//   7. Output: zip, Files folder, save each, open
//   8. Toast
//   9. Keyboard (Contract Β)
//  10. Palette + deep link
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.ConverterCore;
  var R = window.OrosConvertRegistry;

  // ---------- 1. Constants, i18n, helpers ----------
  var SCRIPT_V = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  })();

  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "orOS Converter",
      "app.sub": "Documents and spreadsheets into orOS files",
      "btn.clear": "Clear the list", "btn.files": "Add files", "btn.folder": "Add a folder",
      "btn.stop": "Stop", "btn.open": "Open", "btn.save": "Save", "btn.remove": "Remove",
      "btn.retry": "Try again",
      "drop.title": "Drop files or a folder here",
      "drop.hint": "Documents ({doc}) and spreadsheets ({sheet}) become orOS files that open in their app with nothing lost. Your files are never changed.",
      "drop.veil": "Drop to add",
      "out.title": "Where the orOS files go",
      "out.zip": "Download all as .zip", "out.folder": "Save to a folder in Files", "out.each": "Save each file",
      "out.zip.hint": "One .zip with every converted file, downloaded when the list is done.",
      "out.folder.hint": "Into Files › {dir}. Folders you added keep their sub-folders.",
      "out.folder.off": "Files is not available here.",
      "out.each.hint": "Save each file yourself when it is done, or all at the end.",
      "list.title": "Files",
      "skipped": "{n} other files in the folder left out",
      "skipped.one": "1 other file in the folder left out",
      "to.none": "Not supported",
      "st.waiting": "Waiting", "st.converting": "Converting… {p}%", "st.loading": "Getting ready…",
      "st.saving": "Saving…", "st.done": "Done", "st.saved": "Saved in Files", "st.savedOut": "Saved",
      "st.error": "Not converted",
      "st.warn": "{n} notes", "st.warn.one": "1 note",
      "err.unsupported": "This kind of file can't be converted.",
      "err.bad": "The file could not be read: it is damaged, or not really a {ext} file.",
      "err.toobig": "This file is too big to convert.",
      "err.failed": "Something went wrong while converting.",
      "err.load": "The converter for this kind of file could not be loaded. Are you offline?",
      "err.oros": "This is already an orOS file.",
      "err.read": "The file could not be read from Files.",
      "err.write": "Could not save it in Files.",
      "err.stopped": "Stopped before converting.",
      "foot.count": "{n} files", "foot.count.one": "1 file",
      "foot.ready": "{n} to convert", "foot.done": "{n} done", "foot.err": "{n} not converted",
      "foot.na": "{n} not supported",
      "go.convert": "Convert {n}", "go.convert.one": "Convert 1 file",
      "go.zip": "Download .zip", "go.folder": "Save to Files", "go.each": "Save all",
      "go.show": "Show in Files", "go.nothing": "Convert",
      "toast.added": "{n} files added", "toast.added.one": "1 file added",
      "toast.full": "The list is full ({n} files).",
      "toast.zipFail": "The .zip could not be made.",
      "toast.saved": "Saved in Files › {dir}",
      "toast.openFail": "Could not open it.",
      "toast.done": "Converted {n} of {m}",
      "toast.nothing": "No file here can be converted.",
      "aria.row": "{name}, {size}, {status}",
      "aria.progress": "Converting {name}"
    },
    el: {
      "app.name": "Μετατροπέας orOS",
      "app.sub": "Έγγραφα και υπολογιστικά φύλλα σε αρχεία orOS",
      "btn.clear": "Καθαρισμός της λίστας", "btn.files": "Προσθήκη αρχείων", "btn.folder": "Προσθήκη φακέλου",
      "btn.stop": "Διακοπή", "btn.open": "Άνοιγμα", "btn.save": "Αποθήκευση", "btn.remove": "Αφαίρεση",
      "btn.retry": "Ξανά",
      "drop.title": "Άφησε εδώ αρχεία ή έναν φάκελο",
      "drop.hint": "Τα έγγραφα ({doc}) και τα υπολογιστικά φύλλα ({sheet}) γίνονται αρχεία orOS που ανοίγουν στην εφαρμογή τους χωρίς απώλειες. Τα αρχεία σου δεν αλλάζουν ποτέ.",
      "drop.veil": "Άφησέ τα για προσθήκη",
      "out.title": "Πού πάνε τα αρχεία orOS",
      "out.zip": "Λήψη όλων ως .zip", "out.folder": "Αποθήκευση σε φάκελο στα Αρχεία", "out.each": "Αποθήκευση ενός ενός",
      "out.zip.hint": "Ένα .zip με όλα τα αρχεία που μετατράπηκαν, κατεβαίνει όταν τελειώσει η λίστα.",
      "out.folder.hint": "Στα Αρχεία › {dir}. Οι φάκελοι που πρόσθεσες κρατούν τους υποφακέλους τους.",
      "out.folder.off": "Τα Αρχεία δεν είναι διαθέσιμα εδώ.",
      "out.each.hint": "Αποθήκευσε κάθε αρχείο μόλις είναι έτοιμο, ή όλα στο τέλος.",
      "list.title": "Αρχεία",
      "skipped": "{n} ακόμα αρχεία του φακέλου έμειναν έξω",
      "skipped.one": "1 ακόμα αρχείο του φακέλου έμεινε έξω",
      "to.none": "Δεν υποστηρίζεται",
      "st.waiting": "Σε αναμονή", "st.converting": "Μετατροπή… {p}%", "st.loading": "Προετοιμασία…",
      "st.saving": "Αποθήκευση…", "st.done": "Έτοιμο", "st.saved": "Αποθηκεύτηκε στα Αρχεία", "st.savedOut": "Αποθηκεύτηκε",
      "st.error": "Δεν μετατράπηκε",
      "st.warn": "{n} σημειώσεις", "st.warn.one": "1 σημείωση",
      "err.unsupported": "Αυτό το είδος αρχείου δεν μετατρέπεται.",
      "err.bad": "Το αρχείο δεν διαβάστηκε: είναι κατεστραμμένο ή δεν είναι πραγματικά αρχείο {ext}.",
      "err.toobig": "Το αρχείο είναι πολύ μεγάλο για μετατροπή.",
      "err.failed": "Κάτι πήγε στραβά στη μετατροπή.",
      "err.load": "Ο μετατροπέας για αυτό το είδος αρχείου δεν φορτώθηκε. Μήπως είσαι χωρίς σύνδεση;",
      "err.oros": "Αυτό είναι ήδη αρχείο orOS.",
      "err.read": "Το αρχείο δεν διαβάστηκε από τα Αρχεία.",
      "err.write": "Δεν αποθηκεύτηκε στα Αρχεία.",
      "err.stopped": "Σταμάτησε πριν τη μετατροπή.",
      "foot.count": "{n} αρχεία", "foot.count.one": "1 αρχείο",
      "foot.ready": "{n} για μετατροπή", "foot.done": "{n} έτοιμα", "foot.err": "{n} δεν μετατράπηκαν",
      "foot.na": "{n} δεν υποστηρίζονται",
      "go.convert": "Μετατροπή {n}", "go.convert.one": "Μετατροπή 1 αρχείου",
      "go.zip": "Λήψη .zip", "go.folder": "Αποθήκευση στα Αρχεία", "go.each": "Αποθήκευση όλων",
      "go.show": "Εμφάνιση στα Αρχεία", "go.nothing": "Μετατροπή",
      "toast.added": "Προστέθηκαν {n} αρχεία", "toast.added.one": "Προστέθηκε 1 αρχείο",
      "toast.full": "Η λίστα γέμισε ({n} αρχεία).",
      "toast.zipFail": "Το .zip δεν φτιάχτηκε.",
      "toast.saved": "Αποθηκεύτηκαν στα Αρχεία › {dir}",
      "toast.openFail": "Δεν άνοιξε.",
      "toast.done": "Μετατράπηκαν {n} από {m}",
      "toast.nothing": "Κανένα αρχείο εδώ δεν μετατρέπεται.",
      "aria.row": "{name}, {size}, {status}",
      "aria.progress": "Μετατροπή του {name}"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }
  // Singular / plural pair: "<key>.one" for 1, "<key>" otherwise.
  function tn(key, n, params) {
    var p = params || {};
    p.n = n;
    return t(n === 1 && (STRINGS.en[key + ".one"] !== undefined) ? key + ".one" : key, p);
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }

  function parentWin() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  function dialogHost() {
    try { if (window.orosDialog) return window.orosDialog; } catch (e) {}
    try { var p = parentWin(); return p && p.orosDialog ? p.orosDialog : null; } catch (e) { return null; }
  }
  function fsApi() {
    try {
      var p = parentWin(), fs = p ? p.orosFS : null;
      return fs && typeof fs.writeBlob === "function" && typeof fs.readBlob === "function" &&
             typeof fs.stat === "function" ? fs : null;
    } catch (e) { return null; }
  }
  function fileOpenApi() {
    try {
      var p = parentWin(), fo = p ? p.orosFileOpen : null;
      return fo && typeof fo.open === "function" ? fo : null;
    } catch (e) { return null; }
  }

  // BOOT MARKER
  (function () {
    document.documentElement.lang = LANG;
    console.log("converter.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Prefs ----------
  var prefs = C.readPrefs(null);
  function loadPrefs() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(C.PREFS_KEY) || "null"); } catch (e) {}
    prefs = C.readPrefs(raw);
  }
  function savePrefs() {
    try { localStorage.setItem(C.PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  // The choice in effect: "folder" needs Files.
  function outMode() { return prefs.out === "folder" && !fsApi() ? "zip" : prefs.out; }

  // ---------- 3. Rows: adding files, folders, disk paths ----------
  // row: { id, name, size, mtime, dir (sub-folder), target (registry
  //   entry|null), file (File|null), path (orOS disk path|null),
  //   status waiting|converting|saving|done|error, p (0..1),
  //   err (string key), warnings [], out: { name, blob|null,
  //   disk (path)|null, saved (bool) } }
  var rows = [];
  var keys = {};
  var nextId = 1;
  var skipped = 0;
  var running = false, stopAsked = false, writeFailed = false;

  function addRow(o) {
    if (rows.length >= C.MAX_FILES) return "full";
    var k = C.fileKey(o.name, o.size, o.mtime, o.path || o.dir);
    if (keys[k]) return "dup";
    keys[k] = true;
    var r = {
      id: nextId++, key: k, name: o.name, size: o.size || 0, mtime: o.mtime || 0, dir: o.dir || "",
      target: C.targetFor(o.name), file: o.file || null, path: o.path || null,
      status: "waiting", p: 0, err: "", warnings: [], out: null
    };
    if (r.target && r.size > C.MAX_FILE) { r.status = "error"; r.err = "toobig"; }
    rows.push(r);
    if (r.file && r.target && r.status === "waiting") headCheck(r);
    return r;
  }

  // First bytes of a picked file: a .docx that is not a ZIP is
  // marked at once, before anything is loaded.
  function headCheck(r) {
    var f = r.file;
    if (!f || typeof f.slice !== "function") return;
    Promise.resolve().then(function () { return f.slice(0, 128).arrayBuffer(); }).then(function (ab) {
      var verdict = C.checkHead(R.extOf(r.name), new Uint8Array(ab));
      if (verdict && r.status === "waiting") {
        r.status = "error";
        r.err = verdict === "oros" ? "oros" : "bad";
        renderRow(r);
        renderFoot();
      }
    }, function () {});
  }

  function addFiles(list, fromFolder) {
    var added = 0, full = false, before = skipped;
    (list || []).forEach(function (it) {
      var f = it.file || it, rel = it.rel !== undefined ? it.rel : (f.webkitRelativePath || "");
      var name = String(f.name || "");
      if (!name) return;
      if (fromFolder || rel) {
        if (C.skipInFolder(name) || !C.targetFor(name)) { skipped++; return; }
      }
      var res = addRow({ name: name, size: f.size, mtime: f.lastModified, dir: C.relDir(rel), file: f });
      if (res === "full") full = true;
      else if (res !== "dup") added++;
    });
    afterAdd(added, full, skipped > before);
  }

  function afterAdd(added, full, newSkips) {
    renderAll();
    if (full) showToast(t("toast.full", { n: C.MAX_FILES }));
    else if (added) showToast(tn("toast.added", added));
    else if (newSkips) showToast(t("toast.nothing"));
  }

  // Disk paths from Files (deep link). Read lazily: only the size now.
  function addPaths(paths) {
    var fs = fsApi();
    if (!fs || !paths.length) return Promise.resolve();
    var added = 0, full = false;
    return paths.reduce(function (chain, p) {
      return chain.then(function () {
        return fs.stat(p).then(function (st) {
          if (!st || st.dir) return;
          var res = addRow({ name: p.slice(p.lastIndexOf("/") + 1), size: st.size, mtime: st.mtime, path: p });
          if (res === "full") full = true;
          else if (res !== "dup") added++;
        }, function () {});
      });
    }, Promise.resolve()).then(function () { afterAdd(added, full, false); });
  }

  // A dropped folder: walk it (FileSystemEntry API), keep relative paths.
  function walkEntry(entry, out) {
    if (!entry) return Promise.resolve();
    if (entry.isFile) {
      return new Promise(function (res) {
        entry.file(function (f) {
          out.push({ file: f, rel: String(entry.fullPath || f.name).replace(/^\//, "") });
          res();
        }, function () { res(); });
      });
    }
    if (!entry.isDirectory || C.skipInFolder(entry.name)) return Promise.resolve();
    var reader = entry.createReader();
    function more() {
      return new Promise(function (res) { reader.readEntries(res, function () { res([]); }); }).then(function (batch) {
        if (!batch.length || out.length > C.MAX_FILES * 4) return;
        return batch.reduce(function (c, e) { return c.then(function () { return walkEntry(e, out); }); }, Promise.resolve()).then(more);
      });
    }
    return more();
  }

  function onDrop(e) {
    e.preventDefault();
    hideVeil();
    var dt = e.dataTransfer;
    if (!dt) return;
    var items = dt.items ? [].slice.call(dt.items) : [];
    var entries = items.map(function (it) {
      return it.kind === "file" && typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null;
    });
    var hasDir = entries.some(function (en) { return en && en.isDirectory; });
    if (!hasDir) { addFiles([].slice.call(dt.files || []), false); return; }
    var out = [];
    entries.reduce(function (c, en) { return c.then(function () { return walkEntry(en, out); }); }, Promise.resolve())
      .then(function () {
        // Loose files dropped next to a folder are taken as they are.
        var loose = out.filter(function (o) { return o.rel.indexOf("/") === -1; });
        var inDirs = out.filter(function (o) { return o.rel.indexOf("/") !== -1; });
        addFiles(loose.map(function (o) { return { file: o.file, rel: "" }; }), false);
        addFiles(inDirs, true);
      });
  }

  function pickFiles() {
    var dlg = dialogHost(), acc = R.extensions().join(",");
    if (dlg && typeof dlg.openFiles === "function") {
      dlg.openFiles(acc).then(function (files) { if (files && files.length) addFiles(files, false); });
      return;
    }
    localPick(acc, false);
  }
  // A folder: orosDialog has no folder picker, so the browser's own
  // (<input webkitdirectory>, as OrosBundle.pickFolder does).
  function pickFolder() {
    if (window.OrosBundle && typeof window.OrosBundle.pickFolder === "function") {
      window.OrosBundle.pickFolder().then(function (list) { if (list) addFiles([].slice.call(list), true); });
      return;
    }
    localPick("", true);
  }
  function localPick(accept, folder) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    if (accept) inp.accept = accept;
    if (folder) inp.setAttribute("webkitdirectory", "");
    inp.addEventListener("change", function () {
      if (inp.files && inp.files.length) addFiles([].slice.call(inp.files), folder);
      inp.value = "";
    });
    inp.click();
  }

  function removeRow(r) {
    if (r.status === "converting" || r.status === "saving") return;
    rows = rows.filter(function (x) { return x !== r; });
    delete keys[r.key];
    r.out = null;
    renderAll();
  }
  function clearList() {
    if (running) return;
    rows = [];
    keys = {};
    skipped = 0;
    renderAll();
  }

  // ---------- 4. Rendering ----------
  var ICON = {
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };

  function statusText(r) {
    if (!r.target) return t("to.none");
    if (r.status === "converting") return r.p < 0 ? t("st.loading") : t("st.converting", { p: Math.round(r.p * 100) });
    if (r.status === "saving") return t("st.saving");
    if (r.status === "error") return t("st.error");
    if (r.status === "done") {
      if (r.out && r.out.disk) return t("st.saved");
      if (r.out && r.out.saved) return t("st.savedOut");
      return t("st.done");
    }
    return t("st.waiting");
  }
  function errText(r) {
    if (r.err === "bad") return t("err.bad", { ext: R.extOf(r.name) });
    return t("err." + r.err);
  }

  function renderRow(r) {
    var li = document.querySelector('#list li[data-id="' + r.id + '"]');
    if (!li) return;
    li.className = "row st-" + (r.target ? r.status : "na");
    li.innerHTML = "";
    var top = el("div", "row-top");
    var ic = el("span", "row-ic");
    ic.innerHTML = ICON.file;
    top.appendChild(ic);
    var nm = el("div", "row-name");
    nm.appendChild(el("span", "row-file", r.name));
    if (r.dir) nm.appendChild(el("span", "row-dir", r.dir));
    top.appendChild(nm);
    var rm = el("button", "icon-btn row-rm");
    rm.type = "button";
    rm.innerHTML = ICON.x;
    setLabel(rm, t("btn.remove") + ": " + r.name);
    rm.disabled = r.status === "converting" || r.status === "saving";
    rm.addEventListener("click", function () { removeRow(r); });
    top.appendChild(rm);
    li.appendChild(top);

    var meta = el("div", "row-meta");
    meta.appendChild(el("span", "row-size", C.fmtSize(r.size, LANG)));
    var to = el("span", "badge" + (r.target ? "" : " off"));
    if (r.target) {
      to.innerHTML = ICON.arrow;
      to.appendChild(document.createTextNode(r.target.to));
    } else to.textContent = t("to.none");
    meta.appendChild(to);
    if (r.target) meta.appendChild(el("span", "row-st", statusText(r)));
    li.appendChild(meta);

    if (r.status === "converting") {
      var bar = el("div", "bar" + (r.p < 0 ? " busy" : ""));
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", t("aria.progress", { name: r.name }));
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      if (r.p >= 0) bar.setAttribute("aria-valuenow", String(Math.round(r.p * 100)));
      var fill = el("span", "fill");
      fill.style.width = (r.p < 0 ? 30 : Math.round(r.p * 100)) + "%";
      bar.appendChild(fill);
      li.appendChild(bar);
    }
    if (r.status === "error" && r.err) {
      li.appendChild(el("p", "row-err", errText(r)));
    }
    if (r.status === "done" && r.warnings.length) {
      var d = el("details", "row-warn");
      d.appendChild(el("summary", "", tn("st.warn", r.warnings.length)));
      var ul = el("ul");
      r.warnings.slice(0, 20).forEach(function (w) { ul.appendChild(el("li", "", String(w))); });
      d.appendChild(ul);
      li.appendChild(d);
    }
    var acts = el("div", "row-acts");
    if (r.status === "done" && r.out) {
      if (fileOpenApi()) acts.appendChild(button(t("btn.open"), "btn small", function () { openResult(r); }));
      if (outMode() === "each" && !r.out.disk) acts.appendChild(button(t("btn.save"), "btn small", function () { saveOne(r); }));
    }
    if (r.status === "error" && r.target && (r.err === "failed" || r.err === "load" || r.err === "write" || r.err === "read" || r.err === "stopped")) {
      acts.appendChild(button(t("btn.retry"), "btn small", function () {
        if (running) return;
        r.status = "waiting"; r.err = ""; r.p = 0;
        renderRow(r); renderFoot();
      }));
    }
    if (acts.childNodes.length) li.appendChild(acts);
    li.setAttribute("aria-label", t("aria.row", { name: r.name, size: C.fmtSize(r.size, LANG), status: r.target ? statusText(r) : t("to.none") }));
  }
  function button(label, cls, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function renderList() {
    var ul = $("list");
    ul.innerHTML = "";
    rows.forEach(function (r) {
      var li = el("li");
      li.setAttribute("data-id", String(r.id));
      ul.appendChild(li);
      renderRow(r);
    });
    $("list-sec").hidden = rows.length === 0 && skipped === 0;
    $("skipped").hidden = skipped === 0;
    $("skipped").textContent = tn("skipped", skipped);
    $("clear-btn").hidden = rows.length === 0 && skipped === 0;
    $("clear-btn").disabled = running;
  }

  function renderOut() {
    var fs = fsApi(), mode = outMode();
    [].forEach.call(document.querySelectorAll('input[name="out"]'), function (inp) {
      inp.checked = inp.value === mode;
      inp.disabled = (inp.value === "folder" && !fs);
    });
    var hint = mode === "folder" ? t("out.folder.hint", { dir: C.diskDir().slice(C.ROOT.length + 1) }) : t("out." + mode + ".hint");
    if (!fs) hint += " " + t("out.folder.off");
    $("out-hint").textContent = hint;
  }

  function renderFoot() {
    var s = C.summary(rows), mode = outMode();
    $("foot").hidden = rows.length === 0;
    var bits = [tn("foot.count", s.total)];
    if (s.waiting) bits.push(t("foot.ready", { n: s.waiting }));
    if (s.done) bits.push(t("foot.done", { n: s.done }));
    if (s.error) bits.push(t("foot.err", { n: s.error }));
    if (s.unsupported) bits.push(t("foot.na", { n: s.unsupported }));
    $("foot-info").textContent = bits.join(" · ");
    var go = $("go-btn"), alt = $("alt-btn");
    $("stop-btn").hidden = !running;
    alt.hidden = true;
    go.disabled = running;
    go.onclick = null;
    if (running) { go.textContent = t("go.nothing"); return; }
    if (s.waiting) {
      go.textContent = s.waiting === 1 ? t("go.convert.one") : t("go.convert", { n: s.waiting });
      go.onclick = convertAll;
      return;
    }
    if (!s.done) { go.textContent = t("go.nothing"); go.disabled = true; return; }
    if (mode === "zip") { go.textContent = t("go.zip"); go.onclick = downloadZip; }
    else if (mode === "each") { go.textContent = t("go.each"); go.onclick = saveAll; }
    else {
      var unsaved = rows.some(function (r) { return r.status === "done" && r.out && !r.out.disk; });
      if (unsaved) { go.textContent = t("go.folder"); go.onclick = saveAllToDisk; }
      else { go.textContent = t("go.show"); go.onclick = showInFiles; }
      if (unsaved && lastDiskDir) { alt.hidden = false; alt.textContent = t("go.show"); alt.onclick = showInFiles; }
    }
  }

  function renderAll() {
    document.body.classList.toggle("has-rows", rows.length > 0);
    renderList(); renderOut(); renderFoot();
  }

  // ---------- 5. Loading converters ----------
  // Each script once, in order. Paths in the registry and in a
  // module's deps are root-relative; this page lives one level down.
  var loaded = {};      // root-relative path → Promise
  (function () {
    [].forEach.call(document.querySelectorAll("script[src]"), function (s) {
      var src = (s.getAttribute("src") || "").split(/[?#]/)[0];
      if (!src) return;
      loaded[src.indexOf("../") === 0 ? src.slice(3) : "converter/" + src] = Promise.resolve();
    });
  })();
  function loadScript(path) {
    path = String(path || "").replace(/^\.?\//, "");
    if (!/^[a-z0-9_\-\/\.]+\.js$/i.test(path) || path.indexOf("..") !== -1) return Promise.reject(new Error("path"));
    if (loaded[path]) return loaded[path];
    loaded[path] = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "../" + path + (SCRIPT_V ? "?v=" + encodeURIComponent(SCRIPT_V) : "");
      s.onload = function () { res(); };
      s.onerror = function () { delete loaded[path]; rej(new Error("load")); };
      document.head.appendChild(s);
    });
    return loaded[path];
  }
  var modules = {};     // app → Promise<module>
  function loadConverter(entry) {
    if (modules[entry.app]) return modules[entry.app];
    modules[entry.app] = loadScript(entry.script).then(function () {
      var mod = window.OrosConvert && window.OrosConvert[entry.app];
      if (!mod || typeof mod.convert !== "function") throw new Error("load");
      var deps = Array.isArray(mod.deps) ? mod.deps : [];
      return deps.reduce(function (c, d) { return c.then(function () { return loadScript(d); }); }, Promise.resolve())
        .then(function () { return mod; });
    }).then(null, function (e) {
      delete modules[entry.app];
      var err = new Error("load");
      err.code = "load";
      err.cause = e;
      throw err;
    });
    return modules[entry.app];
  }

  // ---------- 6. Converting ----------
  function sourceFile(r) {
    if (r.file) return Promise.resolve(r.file);
    var fs = fsApi();
    if (!fs || !r.path) return Promise.reject(codeErr("read"));
    return fs.readBlob(r.path).then(function (b) {
      if (b && typeof b.name === "string" && b.name === r.name) return b;
      try { return new File([b], r.name, { type: (b && b.type) || "", lastModified: r.mtime || Date.now() }); }
      catch (e) { b.name = r.name; return b; }
    }, function () { throw codeErr("read"); });
  }
  function codeErr(code) { var e = new Error(code); e.code = code; return e; }

  function convertOne(r) {
    var mod = null, file = null;
    r.status = "converting"; r.p = -1; r.err = ""; r.warnings = [];
    renderRow(r); renderFoot();
    return loadConverter(r.target).then(function (m) {
      mod = m;
      var ext = R.extOf(r.name);
      if (Array.isArray(mod.from) && mod.from.indexOf(ext) === -1) throw codeErr("unsupported");
      return sourceFile(r);
    }).then(function (f) {
      file = f;
      if (file.size > C.MAX_FILE) throw codeErr("toobig");
      return file.slice(0, 128).arrayBuffer();
    }).then(function (ab) {
      var verdict = C.checkHead(R.extOf(r.name), new Uint8Array(ab));
      if (verdict) throw codeErr(verdict === "oros" ? "oros" : "bad");
      r.p = 0; renderRow(r);
      var lastPaint = 0;
      return mod.convert(file, {
        lang: LANG,
        onProgress: function (x) {
          var v = Math.max(0, Math.min(1, Number(x) || 0)), now = Date.now();
          r.p = v;
          if (now - lastPaint > 120 || v === 1) { lastPaint = now; renderRow(r); }
        }
      });
    }).then(function (res) {
      file = null;
      if (!res || !res.blob || typeof res.blob.size !== "number") throw codeErr("failed");
      r.warnings = Array.isArray(res.warnings) ? res.warnings.filter(function (w) { return typeof w === "string"; }) : [];
      r.out = { name: C.outName(res.name, r.name, r.target.to), blob: res.blob, disk: null, saved: false };
      if (outMode() === "folder") return writeToDisk(r);
    }).then(function () {
      r.status = "done"; r.p = 1;
    }, function (e) {
      file = null;
      var code = e && (e.code === "load" || e.code === "oros" || e.code === "read" || e.code === "write") ? e.code : C.errorCode(e);
      if (r.out && code === "write") {          // converted; kept here, "Save to Files" tries again
        r.status = "done"; r.p = 1; r.err = ""; writeFailed = true; return;
      }
      r.status = "error"; r.err = code; r.out = null;
      try { if (code === "failed") console.error("[orOS] converter:", r.name, e); } catch (x) {}
    }).then(function () { renderRow(r); renderFoot(); });
  }

  function convertAll() {
    if (running) return;
    var todo = rows.filter(function (r) { return r.target && r.status === "waiting"; });
    if (!todo.length) return;
    running = true; stopAsked = false; writeFailed = false;
    $("stop-btn").disabled = false;
    diskTaken = {};
    renderAll();
    var ok = 0;
    todo.reduce(function (chain, r) {
      return chain.then(function () {
        if (stopAsked) { if (r.status === "waiting") { r.status = "error"; r.err = "stopped"; renderRow(r); } return; }
        if (r.status !== "waiting" || rows.indexOf(r) === -1) return;
        return convertOne(r).then(function () { if (r.status === "done") ok++; });
      });
    }, Promise.resolve()).then(function () {
      running = false;
      renderAll();
      say(t("toast.done", { n: ok, m: todo.length }));
      if (!ok) return;
      var mode = outMode();
      if (writeFailed) showToast(t("err.write"));
      else if (mode === "zip") downloadZip();
      else if (mode === "folder" && lastDiskDir) showToast(t("toast.saved", { dir: lastDiskDir.slice(C.ROOT.length + 1) }));
      else showToast(t("toast.done", { n: ok, m: todo.length }));
    });
  }

  // ---------- 7. Output: zip, Files folder, save each, open ----------
  function resultBlob(r) {
    if (r.out && r.out.blob) return Promise.resolve(r.out.blob);
    var fs = fsApi();
    if (r.out && r.out.disk && fs) return fs.readBlob(r.out.disk);
    return Promise.reject(codeErr("read"));
  }

  // One .zip of every done row (sub-folders kept). Results are Blobs:
  // each one's CRC is read on its own, then the bundle's ZIP writer
  // stores them as they are (they are ZIPs already).
  var zipping = false;
  function downloadZip() {
    var B = window.OrosBundle, done = rows.filter(function (r) { return r.status === "done" && r.out; });
    if (zipping || !done.length) return;
    if (!B || typeof B.digest !== "function" || (typeof B.zipBlob !== "function" && typeof B._zip !== "function")) {
      showToast(t("toast.zipFail"));
      return;
    }
    zipping = true;
    var taken = {}, entries = [], when = new Date();
    done.reduce(function (c, r) {
      return c.then(function () {
        return resultBlob(r).then(function (b) {
          return B.digest(b).then(function (d) {
            var name = (r.dir ? r.dir + "/" : "") + r.out.name;
            entries.push({ name: C.uniqueName(name, taken), data: b, crc: d.crc });
          });
        });
      });
    }, Promise.resolve()).then(function () {
      if (typeof B.zipBlob === "function") return B.zipBlob(entries, when);
      return B._zip(entries, when).then(function (bytes) { return new Blob([bytes], { type: "application/zip" }); });
    }).then(function (zipBlob) {
      return saveBlob(zipBlob, C.zipName(when, LANG), "application/zip", ".zip");
    }).then(function () { zipping = false; }, function (e) {
      zipping = false;
      try { console.error("[orOS] converter zip:", e); } catch (x) {}
      showToast(t("toast.zipFail"));
    });
  }

  function saveBlob(blob, name, mime, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var accept = {};
      accept[mime] = [ext];
      return dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: name, accept: accept }] });
    }
    // Standalone: a plain download.
    var a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
    return Promise.resolve({ ok: true, mode: "download" });
  }

  function mimeOf(r) {
    try {
      var mod = window.OrosConvert && window.OrosConvert[r.target.app];
      if (mod && typeof mod.mime === "string") return mod.mime;
    } catch (e) {}
    return "application/zip";
  }

  function saveOne(r) {
    if (!r.out) return Promise.resolve();
    return resultBlob(r).then(function (b) {
      return saveBlob(b, r.out.name, mimeOf(r), r.target.to);
    }).then(function (res) {
      if (res && res.ok) { r.out.saved = true; renderRow(r); }
    }, function () { showToast(t("err.read")); });
  }
  function saveAll() {
    var list = rows.filter(function (r) { return r.status === "done" && r.out; });
    list.reduce(function (c, r) { return c.then(function () { return saveOne(r); }); }, Promise.resolve());
  }

  // Files: /internal/Converted/<date>/<sub-folders>/<name>, a free
  // name when the same one is there already.
  var diskTaken = {}, lastDiskDir = "";
  function freeDiskPath(fs, dir, name) {
    var m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(name), base = m[1], ext = m[2] || "";
    function tryN(n) {
      var nm = base + (n > 1 ? " (" + n + ")" : "") + ext, p = dir + "/" + nm;
      if (diskTaken[p.toLowerCase()]) return tryN(n + 1);
      return fs.stat(p).then(function () { return n < 999 ? tryN(n + 1) : p; }, function () { return p; });
    }
    return tryN(1).then(function (p) { diskTaken[p.toLowerCase()] = true; return p; });
  }
  function writeToDisk(r) {
    var fs = fsApi();
    if (!fs || !r.out || !r.out.blob) return Promise.reject(codeErr("write"));
    var top = C.diskDir(), dir = top + (r.dir ? "/" + r.dir : "");
    r.status = "saving"; renderRow(r);
    return freeDiskPath(fs, dir, r.out.name).then(function (p) {
      return fs.writeBlob(p, r.out.blob).then(function () {
        r.out.disk = p;
        r.out.name = p.slice(p.lastIndexOf("/") + 1);
        r.out.blob = null;          // on the disk now: let it go
        lastDiskDir = top;
      });
    }).then(null, function () { throw codeErr("write"); });
  }
  function saveAllToDisk() {
    var list = rows.filter(function (r) { return r.status === "done" && r.out && !r.out.disk; });
    if (!list.length || running) return;
    running = true;
    renderFoot();
    var failed = 0;
    list.reduce(function (c, r) {
      return c.then(function () {
        return writeToDisk(r).then(null, function () { failed++; }).then(function () { r.status = "done"; renderRow(r); });
      });
    }, Promise.resolve()).then(function () {
      running = false;
      renderAll();
      if (failed) showToast(t("err.write"));
      else if (lastDiskDir) showToast(t("toast.saved", { dir: lastDiskDir.slice(C.ROOT.length + 1) }));
    });
  }
  function showInFiles() {
    var p = parentWin();
    var dir = lastDiskDir || C.diskDir();
    try { if (p && typeof p.__orosOpenAt === "function") p.__orosOpenAt("files", { path: dir, dir: true }); } catch (e) {}
  }

  // Open in its app: the shell's file-open path picks the app for
  // the extension (.orosdoc → Writer, .orossheet → Spreadsheet).
  // The File is made in the shell's realm: this page unloads when the
  // app opens, and a Blob object of an unloaded page can no longer be
  // read by the app that takes it.
  function openResult(r) {
    var fo = fileOpenApi(), p = parentWin();
    if (!fo || !r.out) return;
    resultBlob(r).then(function (b) {
      var F = (p && p.File) || File;
      fo.open([new F([b], r.out.name, { type: b.type || mimeOf(r) })]);
    }).then(null, function () { showToast(t("toast.openFail")); });
  }

  // ---------- 8. Toast ----------
  var toastTimer = null;
  function showToast(msg) {
    var tEl = $("toast");
    tEl.textContent = msg;
    tEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { tEl.classList.remove("show"); }, 3200);
  }
  function say(msg) { $("live").textContent = msg; }

  // ---------- 9. Keyboard (Contract Β) ----------
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.code === "KeyO") { e.preventDefault(); pickFiles(); }
      else if (e.code === "Enter") {
        var go = $("go-btn");
        if (!go.disabled && !$("foot").hidden) { e.preventDefault(); go.click(); }
      }
    });
  }

  // ---------- 10. Palette + deep link ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // { paths } from Files, { openFile: { token } } from the shell,
  // { files: [File] } from a direct call on this window.
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (Array.isArray(target.files)) {
      var files = target.files.filter(function (f) { return f && typeof f.name === "string" && typeof f.size === "number"; });
      if (files.length) addFiles(files, false);
    }
    var tg = C.parseTarget(target);
    if (tg.token) {
      try {
        var p = parentWin(), f = p && typeof p.__orosTakeFile === "function" ? p.__orosTakeFile(tg.token) : null;
        if (f) addFiles([f], false);
      } catch (e) {}
    }
    if (tg.paths.length) addPaths(tg.paths);
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("clear-btn").innerHTML = ICON.clear;
    setLabel($("clear-btn"), t("btn.clear"));
    var doc = C.registry.byApp("writer"), sheet = C.registry.byApp("spreadsheet");
    $("drop-hint").textContent = t("drop.hint", {
      doc: doc ? doc.from.join(" ") : "",
      sheet: sheet ? sheet.from.join(" ") : ""
    });
  }

  var dragDepth = 0;
  function hideVeil() { dragDepth = 0; $("drag-veil").hidden = true; }
  function hasFiles(e) {
    var ty = e.dataTransfer && e.dataTransfer.types;
    return !!ty && [].indexOf.call(ty, "Files") !== -1;
  }

  function wire() {
    $("add-files").addEventListener("click", pickFiles);
    $("add-folder").addEventListener("click", pickFolder);
    $("clear-btn").addEventListener("click", clearList);
    $("stop-btn").addEventListener("click", function () { stopAsked = true; $("stop-btn").disabled = true; });
    [].forEach.call(document.querySelectorAll('input[name="out"]'), function (inp) {
      inp.addEventListener("change", function () {
        if (!inp.checked) return;
        prefs.out = inp.value;
        savePrefs();
        renderAll();
      });
    });
    document.addEventListener("dragenter", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      $("drag-veil").hidden = false;
    });
    document.addEventListener("dragover", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    document.addEventListener("dragleave", function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $("drag-veil").hidden = true;
    });
    document.addEventListener("drop", onDrop);
    window.addEventListener("beforeunload", function (e) {
      if (running) { e.preventDefault(); e.returnValue = ""; }
    });
    wireKeyboard();
  }

  function boot() {
    loadPrefs();
    applyI18n();
    inheritPalette();
    wire();
    watchPalette();
    renderAll();
    try {
      var p = parentWin();
      if (p && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget("converter");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
