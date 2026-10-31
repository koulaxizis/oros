// ============================================================
// orOS Files — computer.js ("This computer", orOS USB only)
// ------------------------------------------------------------
// A "This computer" place in the Files tree, next to the orOS disk:
// the computer's own folders (Documents, Downloads, Pictures…) and its
// disks (USB sticks, other disks; Windows disks read-only). It shows
// only where the orOS launcher serves its computer files API (orOS USB,
// live stick or installed); see computer-core.js for the contract.
//
// What a person can do here: browse, preview pictures, video, sound and
// text, make folders, rename, move to the computer's Trash (and put
// back, or empty it), open and close (eject) disks, copy files and
// folders to the orOS disk, and (from the orOS disk, "Send to This
// computer…") copy them here. Nothing here is synced: only what is
// copied to the orOS disk joins sync.
//
// Device-local: oros-files-computer-view { on, path } the last place.
// Files is the only caller: OrosFilesComputer.init(ctx) at boot,
// treeNode() from renderTree(), leave() from navigate(),
// exportFrom(paths) from the selection bar and context menu,
// openAt(path) from the shell's "oros-files-open" event.
// ============================================================
(function () {
  "use strict";

  var C = window.OrosComputerCore;
  var VIEW_LS = "oros-files-computer-view";
  var PREFIX = C.PREFIX;
  var BIG_COPY = 500 * 1048576;          // asks before copying more to the orOS disk
  var TEXT_PREVIEW = 256 * 1024;

  var LANG = (function () {
    if (window.orosI18n) return window.orosI18n.lang();
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");

  var STRINGS = {
    en: {
      "c.tree":        "This computer",
      "c.home":        "Home folder",
      "c.folders":     "Folders",
      "c.disks":       "Disks",
      "c.noDisks":     "No other disks. A USB stick appears here when you plug it in.",
      "c.usb":         "USB",
      "c.internal":    "Inside this computer",
      "c.readonly":    "read-only",
      "c.free":        "{n} free",
      "c.open":        "Open",
      "c.eject":       "Eject",
      "c.ejected":     "{name} can be removed now",
      "c.opening":     "Opening {name}…",
      "c.up":          "Go to parent folder",
      "c.refresh":     "Refresh",
      "c.newFolder":   "New folder",
      "c.newFolderName": "New folder",
      "c.trash":       "Trash of this computer",
      "c.loading":     "Loading…",
      "c.empty":       "This folder is empty",
      "c.items":       "{n} items",
      "c.oneItem":     "1 item",
      "c.actions":     "Actions for {name}",
      "c.rename":      "Rename",
      "c.renameTitle": "New name",
      "c.delete":      "Move to the Trash",
      "c.deleted":     "Moved to the Trash of this computer",
      "c.deleteMsg":   "Move “{name}” to the Trash of this computer?",
      "c.toDisk":      "Copy to the orOS disk…",
      "c.toDiskTitle": "Copy to the orOS disk",
      "c.toDiskOk":    "Copy here",
      "c.copying":     "Copying {i} of {n}…",
      "c.copiedToDisk": "Copied to the orOS disk: {n}",
      "c.copiedHere":  "Copied to this computer: {n}",
      "c.bigCopy":     "{size} will be copied to the orOS disk and, with sync on, uploaded to your cloud. Continue?",
      "c.continue":    "Continue",
      "c.cancel":      "Cancel",
      "c.ok":          "OK",
      "c.send":        "Send to This computer…",
      "c.sendTitle":   "Copy to This computer",
      "c.sendOk":      "Copy here",
      "c.pick":        "Choose a folder",
      "c.failedSome":  "{n} could not be copied",
      "c.preview":     "Preview",
      "c.noPreview":   "No preview for this kind of file. Copy it to the orOS disk to open it in an app.",
      "c.close":       "Close",
      "c.trashEmpty":  "The Trash is empty",
      "c.restore":     "Put back",
      "c.restored":    "Put back in {dst}",
      "c.purge":       "Delete for good",
      "c.purgeMsg":    "Delete “{name}” for good? It cannot be brought back.",
      "c.emptyTrash":  "Empty the Trash",
      "c.emptyMsg":    "Delete everything in the Trash of this computer for good? {n} items.",
      "c.from":        "From {dst}",
      "c.e.exists":    "Something with this name is already there",
      "c.e.readonly":  "This disk is read-only",
      "c.e.full":      "The disk is full",
      "c.e.denied":    "No permission for this place",
      "c.e.notfound":  "It is no longer there",
      "c.e.changed":   "It was changed elsewhere in the meantime",
      "c.e.busy":      "The disk is in use. Wait for the copy to finish, then try again.",
      "c.e.inside":    "A folder cannot go into itself",
      "c.e.verify":    "The copy did not match the original; the original was kept",
      "c.e.notempty":  "The folder is not empty",
      "c.e.offline":   "orOS cannot reach the computer's files right now",
      "c.e.io":        "That did not work: {m}",
      "c.e.name":      "Use a name without “/” that does not start with a dot",
      "c.f.Documents": "Documents",
      "c.f.Downloads": "Downloads",
      "c.f.Pictures":  "Pictures",
      "c.f.Music":     "Music",
      "c.f.Videos":    "Videos",
      "c.f.Desktop":   "Desktop"
    },
    el: {
      "c.tree":        "Αυτός ο υπολογιστής",
      "c.home":        "Προσωπικός φάκελος",
      "c.folders":     "Φάκελοι",
      "c.disks":       "Δίσκοι",
      "c.noDisks":     "Δεν υπάρχουν άλλοι δίσκοι. Ένα USB stick εμφανίζεται εδώ μόλις το συνδέσεις.",
      "c.usb":         "USB",
      "c.internal":    "Μέσα στον υπολογιστή",
      "c.readonly":    "μόνο ανάγνωση",
      "c.free":        "{n} ελεύθερα",
      "c.open":        "Άνοιγμα",
      "c.eject":       "Αφαίρεση",
      "c.ejected":     "Μπορείς τώρα να βγάλεις το {name}",
      "c.opening":     "Άνοιγμα του {name}…",
      "c.up":          "Στον γονικό φάκελο",
      "c.refresh":     "Ανανέωση",
      "c.newFolder":   "Νέος φάκελος",
      "c.newFolderName": "Νέος φάκελος",
      "c.trash":       "Κάδος αυτού του υπολογιστή",
      "c.loading":     "Φόρτωση…",
      "c.empty":       "Ο φάκελος είναι άδειος",
      "c.items":       "{n} στοιχεία",
      "c.oneItem":     "1 στοιχείο",
      "c.actions":     "Ενέργειες για το {name}",
      "c.rename":      "Μετονομασία",
      "c.renameTitle": "Νέο όνομα",
      "c.delete":      "Μεταφορά στον Κάδο",
      "c.deleted":     "Μεταφέρθηκε στον Κάδο του υπολογιστή",
      "c.deleteMsg":   "Να μεταφερθεί το «{name}» στον Κάδο του υπολογιστή;",
      "c.toDisk":      "Αντιγραφή στον δίσκο του orOS…",
      "c.toDiskTitle": "Αντιγραφή στον δίσκο του orOS",
      "c.toDiskOk":    "Αντιγραφή εδώ",
      "c.copying":     "Αντιγραφή {i} από {n}…",
      "c.copiedToDisk": "Αντιγράφηκαν στον δίσκο του orOS: {n}",
      "c.copiedHere":  "Αντιγράφηκαν σε αυτόν τον υπολογιστή: {n}",
      "c.bigCopy":     "Θα αντιγραφούν {size} στον δίσκο του orOS και, με ενεργό συγχρονισμό, θα ανέβουν στο cloud σου. Να συνεχίσω;",
      "c.continue":    "Συνέχεια",
      "c.cancel":      "Άκυρο",
      "c.ok":          "OK",
      "c.send":        "Αποστολή σε αυτόν τον υπολογιστή…",
      "c.sendTitle":   "Αντιγραφή σε αυτόν τον υπολογιστή",
      "c.sendOk":      "Αντιγραφή εδώ",
      "c.pick":        "Διάλεξε φάκελο",
      "c.failedSome":  "{n} δεν αντιγράφηκαν",
      "c.preview":     "Προεπισκόπηση",
      "c.noPreview":   "Δεν υπάρχει προεπισκόπηση για αυτό το είδος αρχείου. Αντίγραψέ το στον δίσκο του orOS για να το ανοίξεις σε εφαρμογή.",
      "c.close":       "Κλείσιμο",
      "c.trashEmpty":  "Ο Κάδος είναι άδειος",
      "c.restore":     "Επαναφορά",
      "c.restored":    "Επανήλθε στο {dst}",
      "c.purge":       "Οριστική διαγραφή",
      "c.purgeMsg":    "Οριστική διαγραφή του «{name}»; Δεν θα μπορεί να επανέλθει.",
      "c.emptyTrash":  "Άδειασμα Κάδου",
      "c.emptyMsg":    "Οριστική διαγραφή όλων όσων είναι στον Κάδο του υπολογιστή; {n} στοιχεία.",
      "c.from":        "Από {dst}",
      "c.e.exists":    "Υπάρχει ήδη κάτι με αυτό το όνομα",
      "c.e.readonly":  "Αυτός ο δίσκος είναι μόνο για ανάγνωση",
      "c.e.full":      "Ο δίσκος είναι γεμάτος",
      "c.e.denied":    "Δεν υπάρχει άδεια για αυτό το σημείο",
      "c.e.notfound":  "Δεν υπάρχει πια εκεί",
      "c.e.changed":   "Άλλαξε από αλλού στο μεταξύ",
      "c.e.busy":      "Ο δίσκος χρησιμοποιείται. Περίμενε να τελειώσει η αντιγραφή και ξαναδοκίμασε.",
      "c.e.inside":    "Ένας φάκελος δεν μπορεί να μπει μέσα στον εαυτό του",
      "c.e.verify":    "Το αντίγραφο δεν ταίριαξε με το πρωτότυπο· το πρωτότυπο κρατήθηκε",
      "c.e.notempty":  "Ο φάκελος δεν είναι άδειος",
      "c.e.offline":   "Το orOS δεν φτάνει αυτή τη στιγμή στα αρχεία του υπολογιστή",
      "c.e.io":        "Δεν έγινε: {m}",
      "c.e.name":      "Γράψε όνομα χωρίς «/» που δεν αρχίζει με τελεία",
      "c.f.Documents": "Έγγραφα",
      "c.f.Downloads": "Λήψεις",
      "c.f.Pictures":  "Εικόνες",
      "c.f.Music":     "Μουσική",
      "c.f.Videos":    "Βίντεο",
      "c.f.Desktop":   "Επιφάνεια εργασίας"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "files", LANG);

  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  // The computer's own folders keep their English names on disk; Files
  // shows them translated.
  function folderLabel(name) {
    var k = C.folderKey(name);
    return k ? t(k) : name;
  }

  var SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICON = {
    pc:     SVG + '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    folder: SVG + '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    file:   SVG + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    home:   SVG + '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    drive:  SVG + '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 12h.01M10 12h8"/></svg>',
    usb:    SVG + '<path d="M9 2h6v6H9zM7 8h10v9a5 5 0 0 1-10 0z"/></svg>',
    up:     SVG.replace('stroke-width="2"', 'stroke-width="2.2"') + '<path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    refresh: SVG + '<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>',
    add:    SVG + '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 11v6M9 14h6"/></svg>',
    trash:  SVG + '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    more:   SVG + '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    eject:  SVG + '<path d="M5 16h14L12 6z"/><path d="M5 20h14"/></svg>'
  };

  // ---------- state ----------
  var ctx = null;
  var api = null;
  var available = false;
  var probed = false;
  var pendingAt = null;     // a shell "open here" that came before the probe answered
  var active = false;
  var cwd = PREFIX;
  var trashMode = false;
  var renderToken = 0;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(cls, html, title, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = html;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", fn);
    return b;
  }
  function textBtn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function toast(s) { if (ctx && ctx.toast) ctx.toast(s); }
  function fail(e) {
    var code = e && e.code;
    toast(t(C.errKey(code), { m: (e && e.message) || "" }));
  }
  function disk() { return ctx && ctx.fs ? ctx.fs() : null; }
  // Files' sizes stop at MB; disks are counted in GB.
  function fmtKB(n) {
    n = n || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
    return ctx && ctx.fmtKB ? ctx.fmtKB(n) : String(n);
  }
  function fmtDate(ms) {
    if (!ms) return "-";
    try { return new Date(ms).toLocaleDateString(LOC, { day: "2-digit", month: "2-digit", year: "2-digit" }); }
    catch (e) { return "-"; }
  }
  function saveView() { try { localStorage.setItem(VIEW_LS, JSON.stringify({ on: active, path: cwd })); } catch (e) {} }
  function readView() { try { return JSON.parse(localStorage.getItem(VIEW_LS) || "null"); } catch (e) { return null; } }
  function nameOf(p) {
    var a = C.toApi(p) || "";
    var segs = a.split("/");
    if (a === "/home") return t("c.home");
    if (segs.length === 3 && segs[1] === "home") return folderLabel(segs[2]);
    return C.baseName(p);
  }

  // ---------- small dialogs (centered, R32; no native dialogs, R14) ----------
  function dialog(title, body, buttons, cls) {
    return new Promise(function (resolve) {
      var d = el("dialog", "cmp-dlg" + (cls ? " " + cls : ""));
      d.appendChild(el("h3", "", title));
      if (body) d.appendChild(typeof body === "string" ? el("p", "", body) : body);
      var row = el("menu", "dlg-row");
      buttons.forEach(function (b) {
        row.appendChild(textBtn(b.cls || "", b.label, function () { d.close(); resolve(b.value); }));
      });
      d.appendChild(row);
      d.addEventListener("cancel", function () { resolve(null); });
      d.addEventListener("close", function () { d.remove(); });
      document.body.appendChild(d);
      d.showModal();
    });
  }
  function confirmBox(title, text, okLabel, danger) {
    return dialog(title, text, [
      { label: t("c.cancel"), value: false },
      { label: okLabel, value: true, cls: danger ? "danger" : "primary" }
    ]).then(function (v) { return v === true; });
  }
  function askName(title, value) {
    return new Promise(function (resolve) {
      var d = el("dialog", "cmp-dlg");
      var f = el("form");
      f.appendChild(el("h3", "", title));
      var inp = el("input");
      inp.type = "text";
      inp.value = value || "";
      inp.setAttribute("aria-label", title);
      inp.spellcheck = false;
      f.appendChild(inp);
      var hint = el("p", "cmp-hint");
      f.appendChild(hint);
      var row = el("menu", "dlg-row");
      row.appendChild(textBtn("", t("c.cancel"), function () { d.close(); resolve(null); }));
      var ok = el("button", "primary", t("c.ok"));
      ok.type = "submit";
      row.appendChild(ok);
      f.appendChild(row);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = inp.value;
        if (!C.validName(v)) { hint.textContent = t("c.e.name"); inp.focus(); return; }
        d.close();
        resolve(v);
      });
      d.appendChild(f);
      d.addEventListener("cancel", function () { resolve(null); });
      d.addEventListener("close", function () { d.remove(); });
      document.body.appendChild(d);
      d.showModal();
      inp.focus();
      var dot = inp.value.lastIndexOf(".");
      inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length);
    });
  }

  // ---------- panel ----------
  function ensurePanel() {
    if ($("cmp-panel")) return;
    var bar = el("div", "dbx-bar cmp-bar");
    bar.id = "cmp-bar";
    var up = btn("tool", ICON.up, t("c.up"), function () { if (trashMode) { trashMode = false; load(); } else if (cwd !== PREFIX) go(upOf(cwd)); });
    up.id = "cmp-up";
    bar.appendChild(up);
    var nav = el("nav", "dbx-crumbs");
    nav.id = "cmp-crumbs";
    bar.appendChild(nav);
    var nf = btn("tool", ICON.add, t("c.newFolder"), newFolder);
    nf.id = "cmp-new";
    bar.appendChild(nf);
    var tr = btn("tool", ICON.trash, t("c.trash"), function () { trashMode = !trashMode; load(); });
    tr.id = "cmp-trash";
    bar.appendChild(tr);
    bar.appendChild(btn("tool", ICON.refresh, t("c.refresh"), function () { load(); }));
    var host = $("bar");
    if (host) host.appendChild(bar);

    var panel = el("section", "dbx-panel cmp-panel");
    panel.id = "cmp-panel";
    var hdr = el("div", "entry-list-header");
    hdr.id = "cmp-head";
    hdr.appendChild(el("span"));
    [["col.name", "name"], ["col.size", "size"], ["col.date", "date"]].forEach(function (c) {
      var th = el("span", "col-th");
      th.dataset.field = c[1];
      th.appendChild(el("span", "col-th-label", ctx && ctx.t ? ctx.t(c[0]) : c[1]));
      hdr.appendChild(th);
    });
    panel.appendChild(hdr);
    var ul = el("ul", "dbx-list cmp-list");
    ul.id = "cmp-entries";
    panel.appendChild(ul);
    var msg = el("div", "dbx-msg");
    msg.id = "cmp-msg";
    msg.hidden = true;
    panel.appendChild(msg);
    var st = el("div", "dbx-status");
    st.id = "cmp-status";
    panel.appendChild(st);
    var split = $("split");
    if (split) split.appendChild(panel);
  }

  // "/computer/disks/X" goes up to "/computer" ("/computer/disks" is not a place).
  function upOf(p) {
    var parent = C.parentOf(p);
    return parent === PREFIX + "/disks" ? PREFIX : parent;
  }

  function showMsg(text) {
    var m = $("cmp-msg");
    m.innerHTML = "";
    m.appendChild(el("p", "", text));
    m.hidden = false;
  }
  function hideMsg() { $("cmp-msg").hidden = true; }
  function status(s) { var n = $("cmp-status"); if (n) n.textContent = s || ""; }

  function paintBar() {
    var nav = $("cmp-crumbs");
    nav.innerHTML = "";
    var parts = trashMode
      ? [{ name: t("c.tree"), path: PREFIX }, { name: t("c.trash"), path: null }]
      : C.crumbs(cwd, folderLabel, t("c.tree"), t("c.home"));
    parts.forEach(function (c, i) {
      if (i) nav.appendChild(el("span", "crumb-sep", "/"));
      var last = i === parts.length - 1;
      var b = el("button", "crumb" + (last ? " current" : ""), c.name);
      b.type = "button";
      if (!last && c.path) b.addEventListener("click", function () { trashMode = false; go(c.path); });
      nav.appendChild(b);
    });
    $("cmp-up").disabled = !trashMode && cwd === PREFIX;
    $("cmp-new").hidden = trashMode || cwd === PREFIX;
    $("cmp-trash").classList.toggle("on", trashMode);
    $("cmp-trash").setAttribute("aria-pressed", trashMode ? "true" : "false");
    $("cmp-head").hidden = cwd === PREFIX || trashMode;
  }

  function load() {
    if (!active) return;
    ensurePanel();
    paintBar();
    hideMsg();
    var my = ++renderToken;
    var ul = $("cmp-entries");
    status(t("c.loading"));
    var job = trashMode ? loadTrash() : (cwd === PREFIX ? loadTop() : loadFolder());
    job.then(function (rows) {
      if (my !== renderToken || !active) return;
      ul.innerHTML = "";
      rows.forEach(function (r) { ul.appendChild(r); });
    }, function (e) {
      if (my !== renderToken || !active) return;
      ul.innerHTML = "";
      status("");
      showMsg(t(C.errKey(e && e.code), { m: (e && e.message) || "" }));
    });
  }

  // ---------- top: folders and disks ----------
  function section(title) {
    var li = el("li", "cmp-sec");
    li.appendChild(el("span", "sec-title", title));
    return li;
  }
  function placeRow(icon, title, sub, onOpen, extra) {
    var li = el("li", "entry cmp-place");
    li.tabIndex = 0;
    var g = el("span", "glyph folder");
    g.innerHTML = icon;
    li.appendChild(g);
    var nm = el("span", "ename col-name");
    nm.appendChild(el("span", "", title));
    if (sub) nm.appendChild(el("span", "cmp-sub", sub));
    li.appendChild(nm);
    var tools = el("span", "cmp-tools");
    (extra || []).forEach(function (b) { tools.appendChild(b); });
    li.appendChild(tools);
    li.addEventListener("click", onOpen);
    li.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target === li) { e.preventDefault(); onOpen(); } });
    return li;
  }

  function loadTop() {
    return Promise.all([
      api.roots(),
      api.list(PREFIX + "/home").catch(function () { return []; }),
      api.disks().catch(function () { return []; })
    ]).then(function (res) {
      var roots = res[0] || {}, home = res[1], vols = res[2];
      var rows = [section(t("c.folders"))];
      var homeSub = roots.home && roots.home.total ? t("c.free", { n: fmtKB(roots.home.free) }) : "";
      rows.push(placeRow(ICON.home, t("c.home"), homeSub, function () { go(PREFIX + "/home"); }));
      var have = {};
      home.forEach(function (e) { if (e.dir) have[e.name] = true; });
      C.HOME_FOLDERS.forEach(function (n) {
        if (!have[n]) return;
        rows.push(placeRow(ICON.folder, folderLabel(n), "", function () { go(PREFIX + "/home/" + n); }));
      });
      rows.push(section(t("c.disks")));
      var disks = C.diskRows(vols, roots.disks);
      if (!disks.length) {
        var none = el("li", "cmp-none", t("c.noDisks"));
        rows.push(none);
      }
      disks.forEach(function (d) {
        var sub = [d.usb ? t("c.usb") : t("c.internal"), fmtKB(d.size), d.fstype.toUpperCase(),
                   d.path && d.free ? t("c.free", { n: fmtKB(d.free) }) : "", d.readonly ? t("c.readonly") : ""]
          .filter(Boolean).join(" · ");
        var extra = [];
        if (d.path) {
          extra.push(btn("tool cmp-eject", ICON.eject, t("c.eject") + " " + d.name, function (e) { e.stopPropagation(); eject(d); }));
        }
        rows.push(placeRow(d.usb ? ICON.usb : ICON.drive, d.name, sub, function () { openDisk(d); }, extra));
      });
      status("");
      return rows;
    });
  }

  function openDisk(d) {
    if (d.path) { go(d.path); return; }
    if (busy) return;
    busy = true;
    status(t("c.opening", { name: d.name }));
    api.op({ op: "mount", dev: d.dev }).then(function (r) {
      busy = false;
      if (r && r.path) go(C.fromApi(r.path));
      else load();
    }, function (e) { busy = false; status(""); fail(e); });
  }

  function eject(d) {
    if (busy) return;
    busy = true;
    api.op({ op: "unmount", dev: d.dev }).then(function () {
      busy = false;
      toast(t("c.ejected", { name: d.name }));
      if (C.placeOf(cwd) === d.path) cwd = PREFIX;
      load();
    }, function (e) { busy = false; fail(e); load(); });
  }

  // ---------- a folder ----------
  function loadFolder() {
    return api.list(cwd).then(function (list) {
      var rows = C.sortEntries(list, LOC).map(entryRow);
      if (!rows.length) showMsg(t("c.empty"));
      status(rows.length === 1 ? t("c.oneItem") : t("c.items", { n: rows.length }));
      return rows;
    });
  }

  function entryRow(r) {
    var li = el("li", "entry");
    li.tabIndex = 0;
    li.dataset.path = r.path;
    var g = el("span", "glyph " + (r.dir ? "folder" : "file"));
    g.innerHTML = r.dir ? ICON.folder : ICON.file;
    li.appendChild(g);
    li.appendChild(el("span", "ename col-name", cwd === PREFIX + "/home" && r.dir ? folderLabel(r.name) : r.name));
    li.appendChild(el("span", "col-size", r.dir ? "-" : fmtKB(r.size)));
    li.appendChild(el("span", "col-date", fmtDate(r.mtime)));
    var more = btn("tool cmp-more", ICON.more, t("c.actions", { name: r.name }), function (e) {
      e.stopPropagation();
      actions(r);
    });
    li.appendChild(more);
    li.addEventListener("click", function () { activate(r); });
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); actions(r); });
    li.addEventListener("keydown", function (e) {
      if (e.target !== li) return;
      if (e.key === "Enter") { e.preventDefault(); activate(r); }
      else if (e.key === "Delete") { e.preventDefault(); remove(r); }
      else if (e.key === "F2") { e.preventDefault(); rename(r); }
    });
    return li;
  }

  function activate(r) {
    if (r.dir) { go(r.path); return; }
    preview(r);
  }

  function actions(r) {
    var list = [
      { label: t("c.toDisk"), value: "disk" },
      { label: t("c.rename"), value: "rename" },
      { label: t("c.delete"), value: "trash", cls: "danger" },
      { label: t("c.cancel"), value: null }
    ];
    if (!r.dir) list.unshift({ label: t("c.preview"), value: "preview" });
    dialog(r.name, null, list, "cmp-acts").then(function (v) {
      if (v === "preview") preview(r);
      else if (v === "disk") copyToDisk([r]);
      else if (v === "rename") rename(r);
      else if (v === "trash") remove(r);
    });
  }

  // ---------- preview ----------
  var IMG = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
  var VID = /\.(mp4|webm|m4v|mov|ogv|mkv)$/i;
  var AUD = /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus)$/i;
  var TXT = /\.(txt|md|csv|tsv|json|log|ini|conf|cfg|xml|html?|css|js|srt|vtt|yml|yaml)$/i;

  function preview(r) {
    var d = el("dialog", "cmp-dlg cmp-pv");
    var head = el("div", "cmp-pv-head");
    head.appendChild(el("strong", "", r.name));
    head.appendChild(el("span", "cmp-sub", fmtKB(r.size) + " · " + fmtDate(r.mtime)));
    d.appendChild(head);
    var body = el("div", "cmp-pv-body");
    var url = api.rawUrl(r.path);
    if (IMG.test(r.name)) {
      var img = el("img");
      img.alt = r.name;
      img.src = url;
      body.appendChild(img);
    } else if (VID.test(r.name)) {
      var v = el("video");
      v.controls = true;
      v.src = url;
      body.appendChild(v);
    } else if (AUD.test(r.name)) {
      var a = el("audio");
      a.controls = true;
      a.src = url;
      body.appendChild(a);
    } else if (TXT.test(r.name)) {
      var pre = el("pre", "cmp-pv-text", t("c.loading"));
      body.appendChild(pre);
      fetch(url, { credentials: "same-origin", headers: { Range: "bytes=0-" + (TEXT_PREVIEW - 1) } })
        .then(function (res) { return res.ok ? res.text() : ""; })
        .then(function (s) { pre.textContent = s; }, function () { pre.textContent = ""; });
    } else {
      body.appendChild(el("p", "", t("c.noPreview")));
    }
    d.appendChild(body);
    var row = el("menu", "dlg-row");
    row.appendChild(textBtn("", t("c.toDisk"), function () { d.close(); copyToDisk([r]); }));
    row.appendChild(el("span", "spacer"));
    row.appendChild(textBtn("primary", t("c.close"), function () { d.close(); }));
    d.appendChild(row);
    d.addEventListener("close", function () {
      d.querySelectorAll("video,audio").forEach(function (m) { try { m.pause(); m.removeAttribute("src"); m.load(); } catch (e) {} });
      d.remove();
    });
    document.body.appendChild(d);
    d.showModal();
  }

  // ---------- change ----------
  function newFolder() {
    if (trashMode || cwd === PREFIX) return;
    api.list(cwd).then(function (list) {
      var name = C.uniqueName(t("c.newFolderName"), list.map(function (e) { return e.name; }));
      return askName(t("c.newFolder"), name).then(function (n) {
        if (!n) return null;
        return api.op({ op: "mkdir", path: C.join(cwd, n) }).then(load);
      });
    }).catch(fail);
  }

  function rename(r) {
    askName(t("c.renameTitle"), r.name).then(function (n) {
      if (!n || n === r.name) return null;
      return api.op({ op: "rename", path: r.path, to: C.join(C.parentOf(r.path), n) }).then(load);
    }).catch(fail);
  }

  function remove(r) {
    confirmBox(t("c.delete"), t("c.deleteMsg", { name: r.name }), t("c.delete"), true).then(function (ok) {
      if (!ok) return null;
      return api.op({ op: "trash", path: r.path }).then(function () {
        toast(t("c.deleted"));
        load();
      });
    }).catch(fail);
  }

  // ---------- Trash of this computer ----------
  function loadTrash() {
    return api.trash().then(function (items) {
      var rows = [];
      if (items.length) {
        var li = el("li", "cmp-trash-head");
        li.appendChild(textBtn("danger", t("c.emptyTrash"), function () { emptyTrash(items); }));
        rows.push(li);
      } else {
        showMsg(t("c.trashEmpty"));
      }
      items.forEach(function (it) {
        var r = el("li", "entry cmp-trash-item");
        var g = el("span", "glyph " + (it.dir ? "folder" : "file"));
        g.innerHTML = it.dir ? ICON.folder : ICON.file;
        r.appendChild(g);
        var nm = el("span", "ename col-name");
        nm.appendChild(el("span", "", it.name));
        if (it.from) nm.appendChild(el("span", "cmp-sub", t("c.from", { dst: nameOf(C.parentOf(it.from)) })));
        r.appendChild(nm);
        r.appendChild(el("span", "col-size", it.dir ? "-" : fmtKB(it.size)));
        var tools = el("span", "cmp-tools");
        if (it.from) tools.appendChild(textBtn("", t("c.restore"), function () { restore(it); }));
        tools.appendChild(textBtn("danger", t("c.purge"), function () { purge(it); }));
        r.appendChild(tools);
        rows.push(r);
      });
      status(items.length === 1 ? t("c.oneItem") : t("c.items", { n: items.length }));
      return rows;
    });
  }

  function restore(it) {
    api.op({ op: "restore", root: it.root, id: it.id }).then(function () {
      toast(t("c.restored", { dst: nameOf(C.parentOf(it.from)) }));
      load();
    }, fail);
  }

  function purge(it) {
    confirmBox(t("c.purge"), t("c.purgeMsg", { name: it.name }), t("c.purge"), true).then(function (ok) {
      if (!ok) return null;
      return api.op({ op: "purge", root: it.root, id: it.id }).then(load);
    }).catch(fail);
  }

  function emptyTrash(items) {
    confirmBox(t("c.emptyTrash"), t("c.emptyMsg", { n: items.length }), t("c.emptyTrash"), true).then(function (ok) {
      if (!ok) return null;
      var chain = Promise.resolve();
      items.forEach(function (it) {
        chain = chain.then(function () { return api.op({ op: "purge", root: it.root, id: it.id }).catch(function () {}); });
      });
      return chain.then(load);
    }).catch(fail);
  }

  // ---------- copies: computer → orOS disk ----------
  // Every file under the picked items: [{ src, rel, size }].
  function walkComputer(items) {
    var out = [];
    function add(path, rel) {
      return api.list(path).then(function (kids) {
        out.push({ dir: true, rel: rel });
        var chain = Promise.resolve();
        kids.forEach(function (k) {
          chain = chain.then(function () {
            if (k.dir) return add(k.path, rel + "/" + k.name);
            out.push({ src: k.path, rel: rel + "/" + k.name, size: k.size });
          });
        });
        return chain;
      });
    }
    var chain = Promise.resolve();
    items.forEach(function (r) {
      chain = chain.then(function () {
        if (r.dir) return add(r.path, r.name);
        out.push({ src: r.path, rel: r.name, size: r.size });
      });
    });
    return chain.then(function () { return out; });
  }

  function copyToDisk(items) {
    var fs = disk();
    if (!fs || busy || !ctx.pickFolder) return;
    ctx.pickFolder(t("c.toDiskTitle"), t("c.toDiskOk")).then(function (dest) {
      if (!dest) return null;
      return Promise.all([walkComputer(items), fs.ls(dest).catch(function () { return []; })]).then(function (res) {
        var plan = res[0], taken = res[1].map(function (e) { return e.name; });
        var bytes = plan.reduce(function (s, p) { return s + (p.size || 0); }, 0);
        var ask = bytes > BIG_COPY
          ? confirmBox(t("c.toDiskTitle"), t("c.bigCopy", { size: fmtKB(bytes) }), t("c.continue"), false)
          : Promise.resolve(true);
        return ask.then(function (ok) {
          if (!ok) return null;
          // Top-level names that are taken get " (2)".
          var rename = {};
          items.forEach(function (r) {
            var n = C.uniqueName(r.name, taken);
            taken.push(n);
            rename[r.name] = n;
          });
          return runToDisk(plan, dest, rename);
        });
      });
    }).catch(function (e) { busy = false; fail(e); });
  }

  function runToDisk(plan, dest, rename) {
    var fs = disk();
    busy = true;
    var files = plan.filter(function (p) { return !p.dir; }).length;
    var i = 0, done = 0, failed = 0;
    function target(rel) {
      var cut = rel.indexOf("/");
      var top = cut < 0 ? rel : rel.slice(0, cut);
      return dest + "/" + (rename[top] || top) + (cut < 0 ? "" : rel.slice(cut));
    }
    var chain = Promise.resolve();
    plan.forEach(function (p) {
      chain = chain.then(function () {
        if (p.dir) return fs.mkdir(target(p.rel)).catch(function () {});
        i++;
        status(t("c.copying", { i: i, n: files }));
        return api.read(p.src).then(function (got) {
          return fs.write(target(p.rel), got.blob);
        }).then(function () { done++; }, function () { failed++; });
      });
    });
    return chain.then(function () {
      busy = false;
      status("");
      toast(t("c.copiedToDisk", { n: done }) + (failed ? " · " + t("c.failedSome", { n: failed }) : ""));
      if (ctx.onDiskChanged) ctx.onDiskChanged();
      if (ctx.markDirty) ctx.markDirty();
    });
  }

  // ---------- copies: orOS disk → computer ----------
  // A folder picker over the computer's writable places.
  function pickComputerFolder() {
    return new Promise(function (resolve) {
      var d = el("dialog", "cmp-dlg cmp-pick");
      d.appendChild(el("h3", "", t("c.sendTitle")));
      var where = el("nav", "dbx-crumbs");
      d.appendChild(where);
      var list = el("ul", "cmp-pick-list");
      d.appendChild(list);
      var row = el("menu", "dlg-row");
      row.appendChild(textBtn("", t("c.cancel"), function () { d.close(); resolve(null); }));
      var ok = textBtn("primary", t("c.sendOk"), function () { d.close(); resolve(at); });
      row.appendChild(ok);
      d.appendChild(row);
      var at = PREFIX;
      function show(p) {
        at = p;
        ok.disabled = p === PREFIX;
        where.innerHTML = "";
        C.crumbs(p, folderLabel, t("c.tree"), t("c.home")).forEach(function (c, i) {
          if (i) where.appendChild(el("span", "crumb-sep", "/"));
          var b = el("button", "crumb", c.name);
          b.type = "button";
          b.addEventListener("click", function () { show(c.path); });
          where.appendChild(b);
        });
        list.innerHTML = "";
        var job = p === PREFIX
          ? api.roots().then(function (r) {
              var out = [{ name: t("c.home"), path: PREFIX + "/home" }];
              (r.disks || []).forEach(function (dk) { if (!dk.readonly) out.push({ name: dk.name, path: C.fromApi(dk.path) }); });
              return out;
            })
          : api.list(p).then(function (l) {
              return C.sortEntries(l, LOC).filter(function (e) { return e.dir; }).map(function (e) {
                return { name: p === PREFIX + "/home" ? folderLabel(e.name) : e.name, path: e.path };
              });
            });
        job.then(function (rows) {
          if (at !== p) return;
          rows.forEach(function (r) {
            var li = el("li");
            var b = el("button", "cmp-pick-row");
            b.type = "button";
            b.innerHTML = ICON.folder;
            b.appendChild(el("span", "", r.name));
            b.addEventListener("click", function () { show(r.path); });
            li.appendChild(b);
            list.appendChild(li);
          });
        }, fail);
      }
      d.addEventListener("cancel", function () { resolve(null); });
      d.addEventListener("close", function () { d.remove(); });
      document.body.appendChild(d);
      d.showModal();
      show(active && !trashMode && cwd !== PREFIX ? cwd : PREFIX);
    });
  }

  // orOS disk paths (files or folders) → copies on this computer. The
  // orOS disk keeps its copies (it is synced; nothing leaves it here).
  function exportFrom(paths) {
    var fs = disk();
    if (!available || !fs || busy || !paths || !paths.length) return Promise.resolve();
    return pickComputerFolder().then(function (dest) {
      if (!dest) return null;
      return api.list(dest).then(function (l) {
        var taken = l.map(function (e) { return e.name; });
        busy = true;
        var done = 0, failed = 0, i = 0;
        function put(src, dst) {
          return fs.stat(src).then(function (st) {
            if (st && st.dir) {
              return api.op({ op: "mkdir", path: dst }).then(function () {
                return fs.ls(src).then(function (kids) {
                  var chain = Promise.resolve();
                  kids.forEach(function (k) {
                    chain = chain.then(function () { return put(src + "/" + k.name, dst + "/" + k.name); });
                  });
                  return chain;
                });
              });
            }
            i++;
            status(t("c.copying", { i: i, n: "…" }));
            return fs.read(src).then(function (b) {
              return api.write(dst, b instanceof Blob ? b : new Blob([b]));
            }).then(function () { done++; }, function (e) {
              failed++;
              if (e && (e.code === "readonly" || e.code === "full")) throw e;
            });
          });
        }
        var chain = Promise.resolve();
        paths.forEach(function (p) {
          chain = chain.then(function () {
            var n = C.uniqueName(C.baseName(p), taken);
            taken.push(n);
            return put(p, C.join(dest, n));
          });
        });
        return chain.then(function () {
          busy = false;
          status("");
          toast(t("c.copiedHere", { n: done }) + (failed ? " · " + t("c.failedSome", { n: failed }) : ""));
          if (active) load();
        }, function (e) { busy = false; status(""); fail(e); if (active) load(); });
      });
    }).catch(function (e) { busy = false; fail(e); });
  }

  // ---------- navigation ----------
  function go(path) {
    trashMode = false;
    cwd = (C.toApi(path) !== null) ? path : PREFIX;
    if (C.placeOf(cwd) === null) cwd = PREFIX;
    saveView();
    load();
  }

  function setMode(on) {
    active = on;
    document.body.classList.toggle("cmp-mode", on);
    saveView();
  }

  function treeNode() {
    var wrap = el("div", "dbx-tree cmp-tree");
    if (!available) { wrap.hidden = true; return wrap; }
    var node = el("div", "tnode" + (active ? " selected" : ""));
    node.style.paddingLeft = "6px";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.appendChild(el("span", "caret empty"));
    var g = el("span", "glyph");
    g.innerHTML = ICON.pc;
    node.appendChild(g);
    node.appendChild(el("span", "tname", t("c.tree")));
    function open() {
      if (ctx && ctx.closeDrawer) ctx.closeDrawer();
      enter(active ? cwd : ((readView() || {}).path || PREFIX));
    }
    node.addEventListener("click", open);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    wrap.appendChild(node);
    return wrap;
  }

  function enter(path) {
    if (!available) return;
    if (ctx && ctx.onEnter) ctx.onEnter();
    setMode(true);
    ensurePanel();
    go(typeof path === "string" ? path : PREFIX);
    if (ctx && ctx.afterEnter) ctx.afterEnter();
  }

  function leave() {
    if (!active) return;
    renderToken++;
    setMode(false);
  }

  // From the shell (a disk opened in System › Disks): "/disks/X" or
  // "/home/...".
  function openAt(apiPath) {
    var p = C.fromApi(apiPath);
    if (!p || (p !== PREFIX && C.placeOf(p) === null)) return;
    if (!probed) { pendingAt = p; return; }
    if (available) enter(p);
  }

  function init(c) {
    ctx = c || {};
    if (!C) return;
    api = C.client();
    C.probe(api).then(function (ok) {
      probed = true;
      available = ok;
      if (!ok) return;
      if (ctx.onAvailable) ctx.onAvailable();
      var view = readView();
      if (pendingAt) enter(pendingAt);
      else if (view && view.on) enter(view.path);
      pendingAt = null;
    });
  }

  window.OrosFilesComputer = {
    init: init,
    treeNode: treeNode,
    enter: enter,
    leave: leave,
    openAt: openAt,
    exportFrom: exportFrom,
    isActive: function () { return active; },
    isAvailable: function () { return available; },
    icon: ICON.pc
  };
})();
