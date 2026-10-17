// ============================================================
// orOS Files — drive.js (orOS Drive folders, on demand: VD-OD)
// ------------------------------------------------------------
// An "orOS Drive" place in the Files tree. It shows the folders that
// the orOS Drive app mirrors from computers and phones into
// /internal/Drive of the encrypted Vault. Those files stay in the
// cloud until opened (vault.js VD-OD), so this view lists both:
//   · files on this device (the disk, like everywhere in Files);
//   · files in the cloud only (orosVault.remoteOnly).
// Opening a cloud file downloads it onto the disk first, then Files
// opens it as usual. Per folder: "Keep on this device" (the folder is
// downloaded and kept) and "Free up space" (files that are exactly
// what was synced leave the disk; nothing is deleted in the cloud).
//
// Device-local: oros-files-drive-view { on, path } the last place shown.
// Files is the only caller: OrosFilesDrive.init(ctx) at boot,
// treeNode() from renderTree(), leave() from navigate().
// ============================================================
(function () {
  "use strict";

  var VIEW_LS = "oros-files-drive-view";

  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = (function () {
    if (window.orosI18n) return window.orosI18n.lang();
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");

  var STRINGS = {
    en: {
      "tree":       "orOS Drive",
      "up":         "Go to parent folder",
      "refresh":    "Refresh",
      "loading":    "Loading…",
      "empty":      "This folder is empty",
      "items":      "{n} items",
      "oneItem":    "1 item",
      "col.name":   "Name",
      "col.size":   "Size",
      "col.date":   "Modified",
      "state.here": "On this device",
      "state.cloud":"In the cloud only",
      "keep":       "Keep on this device",
      "kept":       "Kept on this device",
      "keptToast":  "This folder will be downloaded and kept on this device",
      "unkeep":     "Stop keeping on this device",
      "free":       "Free up space",
      "freed":      "{n} files are now in the cloud only",
      "freedOne":   "1 file is now in the cloud only",
      "freedNone":  "Nothing to free here (files changed on this device stay)",
      "fetching":   "Downloading {name}…",
      "fetchFail":  "Could not download {name}",
      "off.title":  "Turn on sync to see orOS Drive",
      "off.body":   "orOS Drive folders live in your encrypted Vault. Connect Dropbox and unlock sync in Settings.",
      "intro.title":"No computers or phones yet",
      "intro.body": "Folders you mirror with the orOS Drive app (Windows, Linux, Android) appear here. They stay in the cloud until you open them, so this device does not fill up.",
      "phone":      "Mirror folders of this phone"
    },
    el: {
      "tree":       "orOS Drive",
      "up":         "Στον γονικό φάκελο",
      "refresh":    "Ανανέωση",
      "loading":    "Φόρτωση…",
      "empty":      "Ο φάκελος είναι άδειος",
      "items":      "{n} στοιχεία",
      "oneItem":    "1 στοιχείο",
      "col.name":   "Όνομα",
      "col.size":   "Μέγεθος",
      "col.date":   "Τροποποίηση",
      "state.here": "Σε αυτή τη συσκευή",
      "state.cloud":"Μόνο στο cloud",
      "keep":       "Κράτησέ το σε αυτή τη συσκευή",
      "kept":       "Μένει σε αυτή τη συσκευή",
      "keptToast":  "Ο φάκελος θα κατέβει και θα μείνει σε αυτή τη συσκευή",
      "unkeep":     "Να μη μένει σε αυτή τη συσκευή",
      "free":       "Απελευθέρωση χώρου",
      "freed":      "{n} αρχεία είναι πλέον μόνο στο cloud",
      "freedOne":   "1 αρχείο είναι πλέον μόνο στο cloud",
      "freedNone":  "Δεν υπάρχει κάτι να απελευθερωθεί (όσα άλλαξαν εδώ μένουν)",
      "fetching":   "Λήψη {name}…",
      "fetchFail":  "Δεν ήταν δυνατή η λήψη του {name}",
      "off.title":  "Ενεργοποίησε το sync για να δεις το orOS Drive",
      "off.body":   "Οι φάκελοι του orOS Drive βρίσκονται στο κρυπτογραφημένο Vault σου. Σύνδεσε το Dropbox και ξεκλείδωσε το sync στις Ρυθμίσεις.",
      "intro.title":"Δεν υπάρχουν ακόμα υπολογιστές ή κινητά",
      "intro.body": "Οι φάκελοι που αντικατοπτρίζεις με την εφαρμογή orOS Drive (Windows, Linux, Android) εμφανίζονται εδώ. Μένουν στο cloud μέχρι να τους ανοίξεις, ώστε να μη γεμίζει αυτή η συσκευή.",
      "phone":      "Αντικατόπτριση φακέλων αυτού του κινητού"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "files", LANG);

  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  var ICON = {
    cloud:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    file:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    up:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    refresh:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>',
    pin:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    phone:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    free:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21V9M7 14l5-5 5 5M5 3h14"/></svg>'
  };

  // ---------- state ----------
  var ctx = null;
  var active = false;
  var root = "/internal/Drive";
  var cwd = root;
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
  // DRIVE-A: inside the orOS Android app (phone.js in the shell), the
  // app's own screen mirrors phone folders; null anywhere else.
  function phone() {
    try {
      var p = window.parent && window.parent !== window ? window.parent.orosPhone : null;
      var st = p && p.available() ? p.state() : null;
      return st && st.drive ? p : null;
    } catch (e) { return null; }
  }
  function paintPhone() {
    var b = $("drv-phone");
    if (b) b.hidden = !phone();
  }
  function toast(s) { if (ctx && ctx.toast) ctx.toast(s); }
  function vault() {
    try { var v = ctx && ctx.vault ? ctx.vault() : null; return (v && typeof v.remoteOnly === "function") ? v : null; }
    catch (e) { return null; }
  }
  function disk() { return ctx && ctx.fs ? ctx.fs() : null; }
  function saveView() { try { localStorage.setItem(VIEW_LS, JSON.stringify({ on: active, path: cwd })); } catch (e) {} }
  function readView() { try { return JSON.parse(localStorage.getItem(VIEW_LS) || "null"); } catch (e) { return null; } }
  function under(p, r) { return p === r || p.indexOf(r + "/") === 0; }
  function parentOf(p) { var i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : p; }
  function baseName(p) { return p.slice(p.lastIndexOf("/") + 1); }

  // ---------- panel ----------
  function ensurePanel() {
    if ($("drv-panel")) return;
    var bar = el("div", "dbx-bar drv-bar");
    bar.id = "drv-bar";
    bar.appendChild(btn("tool", ICON.up, t("up"), function () { if (cwd !== root) go(parentOf(cwd)); }));
    var nav = el("nav", "dbx-crumbs");
    nav.id = "drv-crumbs";
    bar.appendChild(nav);
    var keep = btn("tool", ICON.pin, t("keep"), toggleKeep);
    keep.id = "drv-keep";
    bar.appendChild(keep);
    var free = btn("tool", ICON.free, t("free"), freeSpace);
    free.id = "drv-free";
    bar.appendChild(free);
    bar.appendChild(btn("tool", ICON.refresh, t("refresh"), function () { syncThenLoad(); }));
    // Inside a click: Chrome follows the app's intent link only then.
    var ph = btn("tool", ICON.phone, t("phone"), function () { var p = phone(); if (p) p.askPermission("drive"); });
    ph.id = "drv-phone";
    ph.hidden = true;
    bar.appendChild(ph);
    var host = $("bar");
    if (host) host.appendChild(bar);

    var panel = el("section", "dbx-panel drv-panel");
    panel.id = "drv-panel";
    var hdr = el("div", "entry-list-header");
    hdr.id = "drv-head";
    hdr.appendChild(el("span"));
    [["col.name", "name"], ["col.size", "size"], ["col.date", "date"]].forEach(function (c) {
      var th = el("span", "col-th");
      th.dataset.field = c[1];
      th.appendChild(el("span", "col-th-label", t(c[0])));
      hdr.appendChild(th);
    });
    panel.appendChild(hdr);
    var ul = el("ul", "dbx-list drv-list");
    ul.id = "drv-entries";
    panel.appendChild(ul);
    var msg = el("div", "dbx-msg");
    msg.id = "drv-msg";
    msg.hidden = true;
    panel.appendChild(msg);
    var st = el("div", "dbx-status");
    st.id = "drv-status";
    panel.appendChild(st);
    var split = $("split");
    if (split) split.appendChild(panel);
  }

  function showMsg(title, body) {
    var m = $("drv-msg");
    $("drv-entries").innerHTML = "";
    m.innerHTML = "";
    m.hidden = false;
    var ic = el("span", "dbx-lock");
    ic.innerHTML = ICON.cloud;
    m.appendChild(ic);
    if (title) m.appendChild(el("strong", "", title));
    if (body) m.appendChild(el("p", "", body));
    $("drv-head").hidden = true;
    $("drv-entries").hidden = true;
    $("drv-status").textContent = "";
  }
  function hideMsg() { $("drv-msg").hidden = true; $("drv-head").hidden = false; $("drv-entries").hidden = false; }

  function paintBar() {
    paintPhone();
    var nav = $("drv-crumbs");
    nav.innerHTML = "";
    var rel = cwd === root ? [] : cwd.slice(root.length + 1).split("/");
    var path = root;
    var parts = [{ name: t("tree"), path: root }];
    rel.forEach(function (seg) { path += "/" + seg; parts.push({ name: seg, path: path }); });
    parts.forEach(function (c, i) {
      if (i) nav.appendChild(el("span", "crumb-sep", "/"));
      var last = i === parts.length - 1;
      var b = el("button", "crumb" + (last ? " current" : ""), c.name);
      b.type = "button";
      if (!last) b.addEventListener("click", function () { go(c.path); });
      nav.appendChild(b);
    });
    $("drv-bar").firstChild.disabled = cwd === root;
    var v = vault(), inFolder = cwd !== root && !!v;
    var keep = $("drv-keep"), kept = inFolder && v.isKeptOffline(cwd);
    keep.hidden = !inFolder;
    keep.classList.toggle("on", !!kept);
    keep.title = kept ? t("unkeep") : t("keep");
    keep.setAttribute("aria-label", keep.title);
    keep.setAttribute("aria-pressed", kept ? "true" : "false");
    $("drv-free").hidden = !inFolder || !!kept;
  }

  // Rows of `cwd`: the disk's entries plus the cloud-only files (and
  // the folders they imply) right under it.
  function listRows() {
    var v = vault(), fs = disk();
    var rows = {};
    var localP = (fs && typeof fs.ls === "function")
      ? fs.ls(cwd).catch(function () { return []; })
      : Promise.resolve([]);
    return localP.then(function (list) {
      (list || []).forEach(function (e) {
        rows[e.name] = { name: e.name, path: cwd + "/" + e.name, dir: !!e.dir, cloud: false };
      });
      var pre = cwd + "/";
      v.remoteOnly(cwd).forEach(function (r) {
        if (r.path.indexOf(pre) !== 0) return;
        var rest = r.path.slice(pre.length), i = rest.indexOf("/");
        var name = i < 0 ? rest : rest.slice(0, i);
        if (i >= 0) {
          if (!rows[name]) rows[name] = { name: name, path: pre + name, dir: true, cloud: true };
        } else if (!rows[name]) {
          rows[name] = { name: name, path: r.path, dir: false, cloud: true, size: r.s, mtime: r.m };
        }
      });
      var out = Object.keys(rows).map(function (k) { return rows[k]; });
      // Sizes and dates of the local files.
      return Promise.all(out.map(function (r) {
        if (r.dir || r.cloud || !fs || typeof fs.stat !== "function") return null;
        return fs.stat(r.path).then(function (st) { r.size = st.size; r.mtime = st.mtime; }, function () {});
      })).then(function () {
        return out.sort(function (a, b) {
          if (a.dir !== b.dir) return a.dir ? -1 : 1;
          return a.name.localeCompare(b.name, LOC);
        });
      });
    });
  }

  function fmtSize(r) { return r.dir ? "-" : (ctx && ctx.fmtKB ? ctx.fmtKB(r.size || 0) : String(r.size || 0)); }
  function fmtDate(r) {
    if (r.dir || !r.mtime) return "-";
    try {
      return new Date(r.mtime).toLocaleDateString(LOC, { day: "2-digit", month: "2-digit", year: "2-digit" });
    } catch (e) { return "-"; }
  }

  function load() {
    if (!active) return;
    ensurePanel();
    paintBar();
    var v = vault();
    var st = null;
    try { st = v ? v.status() : null; } catch (e) { st = null; }
    if (!v || !st || !st.usable) { showMsg(t("off.title"), t("off.body")); return; }
    var my = ++renderToken;
    hideMsg();
    $("drv-status").textContent = t("loading");
    listRows().then(function (rows) {
      if (my !== renderToken || !active) return;
      paint(rows);
    });
  }

  function paint(rows) {
    var ul = $("drv-entries");
    ul.innerHTML = "";
    if (!rows.length) {
      if (cwd === root) showMsg(t("intro.title"), t("intro.body"));
      else showMsg("", t("empty"));
      return;
    }
    rows.forEach(function (r) {
      var li = el("li", "entry" + (r.cloud ? " drv-cloud" : ""));
      li.tabIndex = 0;
      li.appendChild(el("span", "drv-state"));
      var g = el("span", "glyph " + (r.dir ? "folder" : "file"));
      g.innerHTML = r.dir ? ICON.folder : ICON.file;
      li.appendChild(g);
      var nm = el("span", "ename col-name", r.name);
      if (r.cloud) {
        var c = el("span", "drv-badge");
        c.innerHTML = ICON.cloud;
        c.title = t("state.cloud");
        c.setAttribute("aria-label", t("state.cloud"));
        nm.appendChild(c);
      }
      li.appendChild(nm);
      li.appendChild(el("span", "col-size", fmtSize(r)));
      li.appendChild(el("span", "col-date", fmtDate(r)));
      li.title = r.dir ? r.name : r.name + " · " + (r.cloud ? t("state.cloud") : t("state.here"));
      li.addEventListener("click", function () { activate(r); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); activate(r); } });
      ul.appendChild(li);
    });
    $("drv-status").textContent = rows.length === 1 ? t("oneItem") : t("items", { n: rows.length });
  }

  function activate(r) {
    if (r.dir) { go(r.path); return; }
    if (busy) return;
    var v = vault();
    if (!r.cloud || !v) { openOnDisk(r.path); return; }
    busy = true;
    $("drv-status").textContent = t("fetching", { name: r.name });
    v.fetch(r.path).then(function () {
      busy = false;
      openOnDisk(r.path);
    }, function () {
      busy = false;
      $("drv-status").textContent = "";
      toast(t("fetchFail", { name: r.name }));
    });
  }

  function openOnDisk(path) {
    leave();
    if (ctx && ctx.openFile) ctx.openFile(path);
  }

  function toggleKeep() {
    var v = vault();
    if (!v || cwd === root) return;
    var on = !v.isKeptOffline(cwd);
    if (v.setKeptOffline(cwd, on) && on) toast(t("keptToast"));
    paintBar();
  }

  function freeSpace() {
    var v = vault();
    if (!v || cwd === root || busy) return;
    busy = true;
    v.evict(cwd).then(function (n) {
      busy = false;
      toast(n === 1 ? t("freedOne") : n ? t("freed", { n: n }) : t("freedNone"));
      if (ctx && ctx.onDiskChanged) ctx.onDiskChanged();
      load();
    }, function () { busy = false; load(); });
  }

  function syncThenLoad() {
    var v = vault();
    if (!v) { load(); return; }
    $("drv-status").textContent = t("loading");
    v.sync("drive-view").then(load, load);
  }

  function go(path) {
    cwd = (typeof path === "string" && under(path, root)) ? path : root;
    saveView();
    load();
  }

  function setMode(on) {
    active = on;
    document.body.classList.toggle("drv-mode", on);
    saveView();
  }

  function treeNode() {
    var wrap = el("div", "dbx-tree drv-tree");
    var node = el("div", "tnode" + (active ? " selected" : ""));
    node.style.paddingLeft = "6px";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.appendChild(el("span", "caret empty"));
    var g = el("span", "glyph");
    g.innerHTML = ICON.cloud;
    node.appendChild(g);
    node.appendChild(el("span", "tname", t("tree")));
    function open() {
      if (ctx && ctx.closeDrawer) ctx.closeDrawer();
      enter(active ? cwd : ((readView() || {}).path || root));
    }
    node.addEventListener("click", open);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    wrap.appendChild(node);
    return wrap;
  }

  function enter(path) {
    if (ctx && ctx.onEnter) ctx.onEnter();
    cwd = (typeof path === "string" && under(path, root)) ? path : root;
    setMode(true);
    ensurePanel();
    load();
    if (ctx && ctx.afterEnter) ctx.afterEnter();
  }

  function leave() {
    if (!active) return;
    renderToken++;
    setMode(false);
  }

  function init(c) {
    ctx = c || {};
    var v = vault();
    if (v && typeof v.driveRoot === "string") root = v.driveRoot;
    cwd = root;
    if (v && typeof v.onStatus === "function") {
      var unsub = v.onStatus(function (kind, detail) {
        if (active && kind === "stats" && detail) load();
      });
      // The shell outlives this frame: leave no listener behind.
      window.addEventListener("pagehide", function () { if (typeof unsub === "function") unsub(); });
    }
    try {
      var p = window.parent && window.parent !== window ? window.parent.orosPhone : null;
      if (p && typeof p.onChange === "function") {
        var off = p.onChange(paintPhone);
        window.addEventListener("pagehide", function () { off(); });
      }
    } catch (e) {}
    var view = readView();
    if (view && view.on) enter(view.path);
  }

  window.OrosFilesDrive = {
    init: init,
    treeNode: treeNode,
    enter: enter,
    leave: leave,
    isActive: function () { return active; }
  };
})();
