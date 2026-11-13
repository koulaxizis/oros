// ============================================================
// orOS Transfer — the app (transfer/index.html, inside the shell) and
// the receive page (transfer/receive.html, any browser, no orOS needed).
// Send: tick files and folders on the orOS disk (or add files from the
// device), create a link; the other side opens it, sees the list and
// accepts. The files go straight between the two browsers (engine.js).
// Receive: a code or the link; save to the orOS disk (Transfers, every
// file ≤ 200 MB) or to the device (one file, or a ZIP).
// Nothing is synced by this app itself (no slice): it keeps no data.
// Rules: R8 (shell APIs only from the parent, guarded), R33 (files in
// and out through orosDialog), textContent only.
// ============================================================
(function () {
  "use strict";

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    console.log("transfer/app.js v" + (m ? m[1] : "?") + " boot");
  })();

  var APP_ID = "transfer";
  var C = window.OrosTransferCore, E = window.OrosTransferEngine, S = window.OrosTransferStore;
  var PAGE = document.body.getAttribute("data-page") === "receive" ? "receive" : "app";
  var SHOW_MAX = 200;                       // files listed in the offer

  // ---------- 1. Language ----------
  var STR = {
    en: {
      "app.name": "Transfer",
      "tab.send": "Send", "tab.recv": "Receive",
      "send.intro": "Pick files and folders from the orOS disk or this device. The other person opens the link or types the code; the files go straight between the two browsers, end-to-end encrypted.",
      "disk.empty": "This folder is empty.",
      "disk.none": "The orOS disk is not available here.",
      "disk.root": "orOS disk",
      "disk.open": "Open {n}",
      "disk.pick": "Choose {n}",
      "btn.addLocal": "Add from this device…",
      "send.chosen": "To send",
      "send.none": "Nothing chosen yet. Tick files or folders above.",
      "send.sum": "{n} files · {s}",
      "send.counting": "Counting…",
      "btn.makeLink": "Create link",
      "btn.remove": "Remove",
      "share.code": "Code",
      "share.keep": "Keep this page open until the transfer is done. The link works once, for one person.",
      "btn.copy": "Copy", "copied": "Link copied",
      "btn.cancel": "Cancel", "btn.sendMore": "Send something else",
      "recv.intro": "Type the code you were given, or open the link you got.",
      "recv.code": "Code",
      "btn.receive": "Receive",
      "recv.badCode": "That is not a code. It has 12 letters and digits, like 7K2M-9QXH-4RTB.",
      "dest.where": "Save to",
      "dest.disk": "The orOS disk (Transfers folder)",
      "dest.device": "This device",
      "dest.deviceZip": "This device, as one ZIP file",
      "dest.tooBig": "Files over {s} go to the device only: the orOS disk syncs every file whole.",
      "dest.noDisk": "Open the link inside orOS to save to its disk.",
      "space.low": "This browser has about {s} free; this transfer needs {t}.",
      "btn.decline": "Decline", "btn.accept": "Accept",
      "btn.openFiles": "Open in Files", "btn.save": "Save", "btn.recvMore": "Receive something else",
      "offer.sum": "{n} files · {s} from {dev}",
      "offer.more": "… and {n} more",
      "st.connecting": "Connecting…",
      "st.wait.send": "Waiting for the other person to open the link…",
      "st.wait.recv": "The sender is not here yet. Their Transfer page has to be open; this page waits.",
      "st.linking": "Connecting directly to {dev}…",
      "st.offered": "{dev} is looking at the list…",
      "st.offer": "Do you want these files?",
      "st.sending": "Sending…",
      "st.receiving": "Receiving…",
      "st.done.send": "Done. Every file arrived whole.",
      "st.done.recv": "Done. Every file arrived whole.",
      "st.done.disk": "Saved in {f} on the orOS disk.",
      "st.done.file": "Ready. Press Save to keep it on this device.",
      "st.saved": "Saved.",
      "st.someBad": "{n} files did not arrive whole: {names}",
      "st.someBadZip": "{n} files in the ZIP did not arrive whole: {names}. Ask for them again.",
      "prog": "{a} of {b}",
      "err.noroom": "Could not reach the sender. Check the code, or someone else is already receiving it.",
      "err.left": "The other side closed the page.",
      "err.nodirect": "These two devices could not connect directly (a strict network, a VPN or a firewall). Try both on the same Wi-Fi, or another network.",
      "err.declined": "The transfer was declined.",
      "err.cancelled": "The transfer was cancelled.",
      "err.lost": "The connection was lost. Start the transfer again.",
      "err.bad": "Something arrived that was not part of this transfer. It was stopped.",
      "err.version": "The other side runs another version of Transfer. Reload both pages.",
      "err.nocrypto": "This browser cannot encrypt (it needs a secure https page).",
      "err.io": "Could not read or write a file (storage full?). The transfer was stopped.",
      "err.mem": "This browser keeps transfers in memory, up to {s}. Use another browser for this one.",
      "into.oros": "Receive into my orOS instead",
      "full": "This device is out of storage space."
    },
    el: {
      "app.name": "Μεταφορά",
      "tab.send": "Αποστολή", "tab.recv": "Λήψη",
      "send.intro": "Διάλεξε αρχεία και φακέλους από τον δίσκο του orOS ή από αυτή τη συσκευή. Ο άλλος ανοίγει τον σύνδεσμο ή γράφει τον κωδικό· τα αρχεία πάνε κατευθείαν από browser σε browser, κρυπτογραφημένα από άκρο σε άκρο.",
      "disk.empty": "Ο φάκελος είναι άδειος.",
      "disk.none": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.",
      "disk.root": "Δίσκος orOS",
      "disk.open": "Άνοιγμα {n}",
      "disk.pick": "Επιλογή {n}",
      "btn.addLocal": "Προσθήκη από τη συσκευή…",
      "send.chosen": "Για αποστολή",
      "send.none": "Δεν έχεις διαλέξει τίποτα ακόμα. Τσέκαρε αρχεία ή φακέλους από πάνω.",
      "send.sum": "{n} αρχεία · {s}",
      "send.counting": "Μέτρηση…",
      "btn.makeLink": "Δημιουργία συνδέσμου",
      "btn.remove": "Αφαίρεση",
      "share.code": "Κωδικός",
      "share.keep": "Κράτα αυτή τη σελίδα ανοιχτή μέχρι να τελειώσει η μεταφορά. Ο σύνδεσμος ισχύει μία φορά, για ένα άτομο.",
      "btn.copy": "Αντιγραφή", "copied": "Ο σύνδεσμος αντιγράφηκε",
      "btn.cancel": "Ακύρωση", "btn.sendMore": "Αποστολή κάτι άλλου",
      "recv.intro": "Γράψε τον κωδικό που σου έδωσαν ή άνοιξε τον σύνδεσμο που πήρες.",
      "recv.code": "Κωδικός",
      "btn.receive": "Λήψη",
      "recv.badCode": "Αυτό δεν είναι κωδικός. Έχει 12 γράμματα και ψηφία, όπως 7K2M-9QXH-4RTB.",
      "dest.where": "Αποθήκευση σε",
      "dest.disk": "Τον δίσκο του orOS (φάκελος Transfers)",
      "dest.device": "Αυτή τη συσκευή",
      "dest.deviceZip": "Αυτή τη συσκευή, ως ένα αρχείο ZIP",
      "dest.tooBig": "Αρχεία πάνω από {s} πάνε μόνο στη συσκευή: ο δίσκος του orOS συγχρονίζει κάθε αρχείο ολόκληρο.",
      "dest.noDisk": "Άνοιξε τον σύνδεσμο μέσα στο orOS για να αποθηκεύσεις στον δίσκο του.",
      "space.low": "Αυτός ο browser έχει περίπου {s} ελεύθερα· η μεταφορά χρειάζεται {t}.",
      "btn.decline": "Απόρριψη", "btn.accept": "Αποδοχή",
      "btn.openFiles": "Άνοιγμα στα Αρχεία", "btn.save": "Αποθήκευση", "btn.recvMore": "Λήψη κάτι άλλου",
      "offer.sum": "{n} αρχεία · {s} από {dev}",
      "offer.more": "… και {n} ακόμα",
      "st.connecting": "Σύνδεση…",
      "st.wait.send": "Περιμένω τον άλλον να ανοίξει τον σύνδεσμο…",
      "st.wait.recv": "Ο αποστολέας δεν είναι εδώ ακόμα. Η σελίδα Μεταφορά του πρέπει να είναι ανοιχτή· αυτή η σελίδα περιμένει.",
      "st.linking": "Απευθείας σύνδεση με {dev}…",
      "st.offered": "Ο/Η {dev} κοιτάζει τη λίστα…",
      "st.offer": "Θέλεις αυτά τα αρχεία;",
      "st.sending": "Αποστολή…",
      "st.receiving": "Λήψη…",
      "st.done.send": "Έγινε. Όλα τα αρχεία έφτασαν ακέραια.",
      "st.done.recv": "Έγινε. Όλα τα αρχεία έφτασαν ακέραια.",
      "st.done.disk": "Αποθηκεύτηκαν στο {f} του δίσκου orOS.",
      "st.done.file": "Έτοιμο. Πάτησε Αποθήκευση για να το κρατήσεις σε αυτή τη συσκευή.",
      "st.saved": "Αποθηκεύτηκε.",
      "st.someBad": "{n} αρχεία δεν έφτασαν ακέραια: {names}",
      "st.someBadZip": "{n} αρχεία μέσα στο ZIP δεν έφτασαν ακέραια: {names}. Ζήτα τα ξανά.",
      "prog": "{a} από {b}",
      "err.noroom": "Δεν βρέθηκε ο αποστολέας. Έλεγξε τον κωδικό, ή κάποιος άλλος τον παραλαμβάνει ήδη.",
      "err.left": "Η άλλη πλευρά έκλεισε τη σελίδα.",
      "err.nodirect": "Οι δύο συσκευές δεν μπόρεσαν να συνδεθούν απευθείας (αυστηρό δίκτυο, VPN ή firewall). Δοκίμασε και τις δύο στο ίδιο Wi-Fi ή σε άλλο δίκτυο.",
      "err.declined": "Η μεταφορά απορρίφθηκε.",
      "err.cancelled": "Η μεταφορά ακυρώθηκε.",
      "err.lost": "Η σύνδεση χάθηκε. Ξεκίνα τη μεταφορά από την αρχή.",
      "err.bad": "Έφτασε κάτι που δεν ανήκει σε αυτή τη μεταφορά. Σταμάτησε.",
      "err.version": "Η άλλη πλευρά έχει άλλη έκδοση της Μεταφοράς. Ανανέωσε και τις δύο σελίδες.",
      "err.nocrypto": "Αυτός ο browser δεν μπορεί να κρυπτογραφήσει (χρειάζεται ασφαλή σελίδα https).",
      "err.io": "Δεν ήταν δυνατό να διαβαστεί ή να γραφτεί ένα αρχείο (γέμισε ο χώρος;). Η μεταφορά σταμάτησε.",
      "err.mem": "Αυτός ο browser κρατά τις μεταφορές στη μνήμη, έως {s}. Χρησιμοποίησε άλλον browser γι' αυτήν.",
      "into.oros": "Λήψη στο orOS μου",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε."
    }
  };

  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent !== window && window.parent.orosLang) || "";
      if (!l && PAGE === "receive") l = /^el\b/i.test(navigator.language || "") ? "el" : "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  function t(k, v) {
    var s = STR[LANG][k] || STR.en[k] || k;
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function size(n) { return C.fmtSize(n, LANG); }
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. Shell APIs (R8) ----------
  function shell() { try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function FS() {
    if (PAGE !== "app") return null;
    try { var p = shell(); return (p && p.orosFS) || null; } catch (e) { return null; }
  }
  function dialogs() {
    try { var p = shell(); if (p && p.orosDialog) return p.orosDialog; } catch (e) {}
    return window.orosDialog || null;
  }

  // ---------- 3. Palette (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--accent-ink", "--panel-bg", "--border", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      if (window.parent === window) return;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      if (window.parent === window) return;
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  // ---------- 4. Little helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function show(id, on) { var n = $(id); if (n) n.hidden = !on; }
  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }
  function setProg(id, a, b) {
    var p = $(id);
    if (!p) return;
    p.hidden = false;
    p.firstChild.style.width = (b > 0 ? Math.min(100, a / b * 100) : 100).toFixed(1) + "%";
  }
  function devName() { return C.browserLabel(navigator.userAgent); }
  function errText(e) { return t("err." + e) !== "err." + e ? t("err." + e) : t("err.bad"); }
  // Keep the screen awake while a transfer runs, where the browser allows it.
  var wake = null;
  function stayAwake(on) {
    try {
      if (on && !wake && navigator.wakeLock) navigator.wakeLock.request("screen").then(function (w) { wake = w; }, function () {});
      if (!on && wake) { wake.release(); wake = null; }
    } catch (e) {}
  }
  // A page closing mid-transfer asks first.
  var busy = false;
  window.addEventListener("beforeunload", function (e) { if (busy) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- 5. Send: pick from the disk ----------
  var ROOT = "/internal";
  var cwd = ROOT;
  var chosen = [];      // { key, kind: "disk"|"local", path?, dir?, file?, name }
  function isChosen(key) { return chosen.some(function (c) { return c.key === key; }); }
  function hiddenName(n) { return n.charAt(0) === "."; }

  function renderCrumbs() {
    var nav = $("crumbs");
    nav.textContent = "";
    var parts = cwd === ROOT ? [] : cwd.slice(ROOT.length + 1).split("/");
    var b = el("button", "crumb", t("disk.root"));
    b.type = "button";
    b.addEventListener("click", function () { go(ROOT); });
    nav.appendChild(b);
    parts.forEach(function (p, i) {
      nav.appendChild(el("span", "sep", "›"));
      var c = el("button", "crumb", p);
      c.type = "button";
      var to = ROOT + "/" + parts.slice(0, i + 1).join("/");
      c.addEventListener("click", function () { go(to); });
      nav.appendChild(c);
    });
  }
  function go(path) { cwd = path; renderDisk(); }
  function renderDisk() {
    var fs = FS(), list = $("disk");
    renderCrumbs();
    list.textContent = "";
    show("disk-empty", false);
    if (!fs) { show("disk-none", true); return; }
    show("disk-none", false);
    var at = cwd;
    Promise.resolve(fs.ready && fs.ready()).then(function () { return fs.ls(at); }).then(function (entries) {
      if (at !== cwd) return;
      entries = (entries || []).filter(function (e) { return !hiddenName(e.name) && !(at === ROOT && e.name === "Drive"); });
      entries.sort(function (a, b) { return (b.dir - a.dir) || a.name.localeCompare(b.name); });
      list.textContent = "";
      show("disk-empty", !entries.length);
      entries.forEach(function (e) {
        var path = at + "/" + e.name, key = "d:" + path;
        var li = el("li", e.dir ? "dir" : "");
        var box = el("input");
        box.type = "checkbox";
        box.checked = isChosen(key);
        box.setAttribute("aria-label", t("disk.pick", { n: e.name }));
        box.addEventListener("change", function () {
          if (box.checked) chosen.push({ key: key, kind: "disk", path: path, dir: !!e.dir, name: e.name });
          else chosen = chosen.filter(function (c) { return c.key !== key; });
          renderChosen();
        });
        li.appendChild(box);
        if (e.dir) {
          var open = el("button", "name link", e.name);
          open.type = "button";
          open.setAttribute("aria-label", t("disk.open", { n: e.name }));
          open.addEventListener("click", function () { go(path); });
          li.appendChild(open);
        } else {
          var lab = el("span", "name", e.name);
          lab.addEventListener("click", function () { box.click(); });
          li.appendChild(lab);
        }
        list.appendChild(li);
      });
    }, function () { if (at === cwd) show("disk-empty", true); });
  }

  // Every file under the chosen items → [{ path (relative), size, mtime, get() → Blob }]
  function walk(fs, path, rel, out) {
    return fs.ls(path).then(function (entries) {
      var q = Promise.resolve();
      (entries || []).forEach(function (e) {
        if (hiddenName(e.name)) return;
        var p = path + "/" + e.name, r = rel + "/" + e.name;
        q = q.then(function () {
          if (e.dir) return walk(fs, p, r, out);
          return fs.stat(p).then(function (st) { out.push({ path: r, size: st.size || 0, mtime: st.mtime || 0, src: p }); }, function () {});
        });
      });
      return q;
    });
  }
  var expandSeq = 0, expanded = null;
  function expand() {
    var fs = FS(), out = [], q = Promise.resolve();
    chosen.forEach(function (c) {
      q = q.then(function () {
        if (c.kind === "local") { out.push({ path: c.name, size: c.file.size, mtime: c.file.lastModified || 0, file: c.file }); return null; }
        if (c.dir) return walk(fs, c.path, c.name, out);
        return fs.stat(c.path).then(function (st) { out.push({ path: c.name, size: st.size || 0, mtime: st.mtime || 0, src: c.path }); }, function () {});
      });
    });
    return q.then(function () { return out; });
  }
  function renderChosen() {
    var list = $("chosen");
    list.textContent = "";
    chosen.forEach(function (c) {
      var li = el("li", c.dir ? "dir" : "");
      li.appendChild(el("span", "name", c.kind === "disk" ? c.path.slice(ROOT.length + 1) : c.name));
      var rm = el("button", "chip small", t("btn.remove"));
      rm.type = "button";
      rm.addEventListener("click", function () {
        chosen = chosen.filter(function (x) { return x !== c; });
        renderChosen();
        renderDisk();
      });
      li.appendChild(rm);
      list.appendChild(li);
    });
    show("chosen-empty", !chosen.length);
    $("make-link").disabled = !chosen.length;
    var seq = ++expandSeq;
    expanded = null;
    $("chosen-sum").textContent = chosen.length ? t("send.counting") : "";
    if (!chosen.length) return;
    expand().then(function (all) {
      if (seq !== expandSeq) return;
      expanded = all;
      var total = all.reduce(function (a, f) { return a + f.size; }, 0);
      $("chosen-sum").textContent = t("send.sum", { n: all.length, s: size(total) });
      $("make-link").disabled = !all.length;
    });
  }
  function addLocal() {
    var d = dialogs();
    if (!d || typeof d.openFiles !== "function") return;
    d.openFiles("").then(function (files) {
      (files || []).forEach(function (f) {
        var key = "l:" + f.name + ":" + f.size + ":" + f.lastModified;
        if (!isChosen(key)) chosen.push({ key: key, kind: "local", file: f, name: f.name });
      });
      renderChosen();
    });
  }

  // ---------- 6. Send: the transfer ----------
  var sender = null;
  function qrSvg(text) {
    var Q = window.orosQR;
    if (!Q || typeof Q.encode !== "function") return null;
    var mods;
    try { mods = Q.encode(text, { ecl: "M" }).modules; } catch (e) { return null; }
    var n = mods.length, q = 4, sz = n + q * 2, d = "";
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (mods[y][x]) d += "M" + (x + q) + " " + (y + q) + "h1v1h-1z";
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + sz + " " + sz);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR");
    var bg = document.createElementNS(ns, "rect");
    bg.setAttribute("width", sz); bg.setAttribute("height", sz); bg.setAttribute("fill", "#ffffff");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", d); p.setAttribute("fill", "#000000");
    svg.appendChild(bg); svg.appendChild(p);
    return svg;
  }
  function startSend() {
    if (!expanded || !expanded.length) return;
    var fs = FS(), list = expanded.slice();
    var manifest = C.buildManifest(list);
    // buildManifest keeps the order and drops only empty paths
    var src = [];
    list.forEach(function (f) { if (C.cleanPath(f.path)) src.push(f); });
    var code = C.newCode(), link = C.linkFor(code, location.origin);
    $("share-code").textContent = C.fmtCode(code);
    $("share-link").value = link;
    var qr = $("share-qr");
    qr.textContent = "";
    var svg = qrSvg(link);
    if (svg) qr.appendChild(svg);
    show("pick", false); show("share", true);
    show("send-again", false); show("send-cancel", true); show("send-prog", false);
    $("send-detail").textContent = "";
    var blobs = {};
    function blobOf(i) {
      if (blobs[i]) return Promise.resolve(blobs[i]);
      var f = src[i];
      var p = f.file ? Promise.resolve(f.file) : fs.read(f.src);
      return p.then(function (b) { blobs = {}; blobs[i] = b; return b; });
    }
    var dev = "";
    sender = new E.Transfer({
      role: "sender", code: code, dev: devName(), files: manifest,
      read: function (i, a, b) {
        return blobOf(i).then(function (blob) { return blob.slice(a, b).arrayBuffer(); }).then(function (buf) { return new Uint8Array(buf); });
      },
      onState: function (p, info) {
        var st = $("send-status");
        st.className = "status";
        if (info.dev) dev = info.dev;
        if (p === "connecting") st.textContent = t("st.connecting");
        else if (p === "wait") st.textContent = t("st.wait.send");
        else if (p === "linking") st.textContent = t("st.linking", { dev: dev });
        else if (p === "offered") st.textContent = t("st.offered", { dev: dev });
        else if (p === "sending") { st.textContent = t("st.sending"); busy = true; stayAwake(true); }
        else if (p === "done") {
          busy = false; stayAwake(false);
          var bad = info.bad || [];
          st.textContent = bad.length ? t("st.someBad", { n: bad.length, names: bad.slice(0, 5).map(function (i) { return manifest[i].p; }).join(", ") }) : t("st.done.send");
          st.className = "status " + (bad.length ? "warn" : "ok");
          end();
        } else if (p === "error") {
          busy = false; stayAwake(false);
          st.textContent = errText(info.e);
          st.className = "status warn";
          end();
        }
      },
      onProgress: function (pr) {
        setProg("send-prog", pr.bytes, pr.total);
        $("send-detail").textContent = t("prog", { a: size(pr.bytes), b: size(pr.total) });
      }
    }).start();
    function end() { show("send-cancel", false); show("send-again", true); sender = null; }
  }
  function cancelSend() { if (sender) sender.cancel(); }
  function sendAgain() {
    chosen = []; expanded = null;
    show("share", false); show("pick", true);
    renderChosen(); renderDisk();
  }

  // ---------- 7. Receive ----------
  var receiver = null, sink = null, result = null, offerInfo = null;
  function recvStatus(text, cls) { var s = $("recv-status"); s.textContent = text; s.className = "status" + (cls ? " " + cls : ""); }
  function resetRecv() {
    show("offer", false); show("recv-prog", false); show("recv-bad", false);
    show("open-files", false); show("save-file", false); show("recv-again", false); show("recv-cancel", true);
    $("recv-detail").textContent = "";
    result = null;
  }
  function startRecv(code) {
    if (receiver) return;
    resetRecv();
    show("code-form", false); show("recv-box", true);
    var dev = "";
    receiver = new E.Transfer({
      role: "receiver", code: code, dev: devName(),
      onState: function (p, info) {
        if (info.dev) dev = info.dev;
        if (p === "connecting") recvStatus(t("st.connecting"));
        else if (p === "wait") recvStatus(t("st.wait.recv"));
        else if (p === "linking") recvStatus(t("st.linking", { dev: dev }));
        else if (p === "offer") showOffer(info, dev);
        else if (p === "receiving") { recvStatus(t("st.receiving")); busy = true; stayAwake(true); }
        else if (p === "done") finishRecv(info);
        else if (p === "error") {
          busy = false; stayAwake(false);
          recvStatus(errText(info.e), "warn");
          if (sink) sink.drop();
          sink = null;
          endRecv();
        }
      },
      onProgress: function (pr) {
        setProg("recv-prog", pr.bytes, pr.total);
        $("recv-detail").textContent = t("prog", { a: size(pr.bytes), b: size(pr.total) });
      }
    }).start();
  }
  function endRecv() { receiver = null; show("recv-cancel", false); show("offer", false); show("recv-again", true); }
  function showOffer(o, dev) {
    offerInfo = o;
    recvStatus(t("st.offer"));
    show("offer", true);
    show("recv-cancel", false);           // Decline is the way out here
    $("offer-sum").textContent = t("offer.sum", { n: o.files.length, s: size(o.total), dev: dev || "?" });
    var list = $("offer-list");
    list.textContent = "";
    o.files.slice(0, SHOW_MAX).forEach(function (f) {
      var li = el("li");
      li.appendChild(el("span", "name", f.p));
      li.appendChild(el("span", "dim", size(f.s)));
      list.appendChild(li);
    });
    if (o.files.length > SHOW_MAX) list.appendChild(el("li", "dim", t("offer.more", { n: o.files.length - SHOW_MAX })));
    var disk = $("dest-disk"), dev2 = $("dest-dev"), why = $("dest-disk-why");
    var diskOk = !!FS() && o.biggest <= C.DISK_MAX;
    disk.disabled = !diskOk;
    why.hidden = diskOk;
    why.textContent = !FS() ? t("dest.noDisk") : t("dest.tooBig", { s: size(C.DISK_MAX) });
    $("dest-dev-txt").textContent = o.files.length > 1 ? t("dest.deviceZip") : t("dest.device");
    (diskOk ? disk : dev2).checked = true;
    checkSpace();
  }
  function destValue() { return $("dest-disk").checked ? "disk" : "device"; }
  function checkSpace() {
    var o = offerInfo, warn = $("space-warn"), acc = $("accept");
    if (!o) return;
    acc.disabled = false;
    warn.hidden = true;
    if (!S.canScratch() && o.total > C.MEM_MAX) {
      warn.textContent = t("err.mem", { s: size(C.MEM_MAX) });
      warn.hidden = false; acc.disabled = true;
      return;
    }
    // disk: the scratch copy and the disk copy of one file exist at once
    var need = o.total + (destValue() === "disk" ? o.biggest : 0);
    S.freeBytes().then(function (free) {
      if (free === null || free >= need || offerInfo !== o) return;
      warn.textContent = t("space.low", { s: size(free), t: size(need) });
      warn.hidden = false;
      acc.disabled = true;
    });
  }
  function accept() {
    if (!receiver || !offerInfo) return;
    var dest = destValue();
    sink = S.sink({ dest: dest, files: offerInfo.files, fs: FS(), zipName: "orOS Transfer " + new Date().toISOString().slice(0, 10) + ".zip" });
    show("offer", false);
    show("recv-cancel", true);
    receiver.accept(sink);
  }
  function finishRecv(info) {
    var bad = info.bad || [], files = offerInfo ? offerInfo.files : [];
    var s = sink;
    if (!s) { endRecv(); return; }
    s.finish().then(function (r) {
      busy = false; stayAwake(false);
      result = r;
      var badNames = bad.slice(0, 5).map(function (i) { return files[i] ? files[i].p : "?"; }).join(", ");
      if (bad.length) {
        $("recv-bad").textContent = t(r.kind === "file" && files.length > 1 ? "st.someBadZip" : "st.someBad", { n: bad.length, names: badNames });
        show("recv-bad", true);
      }
      if (r.kind === "disk") {
        recvStatus(t("st.done.disk", { f: r.folder.slice(ROOT.length + 1) }), "ok");
        show("open-files", true);
        s.drop();
        sink = null;
      } else if (r.file && !(files.length === 1 && bad.length)) {
        recvStatus(t("st.done.file"), "ok");
        show("save-file", true);
      } else {
        recvStatus(t("st.someBad", { n: bad.length, names: badNames }), "warn");
        s.drop(); sink = null;
      }
      endRecv();
      show("recv-cancel", false);
    }, function () {
      busy = false; stayAwake(false);
      recvStatus(t("err.io"), "warn");
      s.drop(); sink = null;
      endRecv();
    });
  }
  function saveResult() {
    var d = dialogs();
    if (!result || !result.file || !d) return;
    d.saveFile({ blob: result.file, filename: result.name, mime: result.file.type || "application/octet-stream" }).then(function (r) {
      if (!r || !r.ok) return;
      recvStatus(t("st.saved"), "ok");
      show("save-file", false);
      // a download may still be reading the file: drop the scratch copy later
      var s = sink; sink = null;
      setTimeout(function () { if (s) s.drop(); }, 120000);
    });
  }
  function openInFiles() {
    try {
      var p = shell();
      if (p && result && result.folder && typeof p.__orosOpenAt === "function") p.__orosOpenAt("files", { path: result.folder, dir: true });
    } catch (e) {}
  }
  function recvAgain() {
    if (sink) { sink.drop(); sink = null; }
    resetRecv();
    show("recv-box", false); show("code-form", true);
    $("code-in").value = "";
    if (PAGE === "receive") try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }

  // ---------- 8. Tabs, wiring, deep links ----------
  function tab(which) {
    var send = which === "send";
    $("tab-send").classList.toggle("on", send); $("tab-send").setAttribute("aria-selected", String(send));
    $("tab-recv").classList.toggle("on", !send); $("tab-recv").setAttribute("aria-selected", String(!send));
    show("send", send); show("recv", !send);
  }
  function codeFromHash(h) {
    var m = /^#(?:r=)?(.+)$/.exec(String(h || ""));
    return m ? C.normCode(decodeURIComponent(m[1])) : "";
  }
  function wire() {
    if ($("tab-send")) {
      $("tab-send").addEventListener("click", function () { tab("send"); });
      $("tab-recv").addEventListener("click", function () { tab("recv"); });
      $("add-local").addEventListener("click", addLocal);
      $("make-link").addEventListener("click", startSend);
      $("send-cancel").addEventListener("click", cancelSend);
      $("send-again").addEventListener("click", sendAgain);
      $("copy-link").addEventListener("click", function () {
        var v = $("share-link").value;
        try { navigator.clipboard.writeText(v).then(function () { toast(t("copied")); }, function () { $("share-link").select(); }); }
        catch (e) { $("share-link").select(); }
      });
    }
    $("code-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var c = C.normCode($("code-in").value);
      if (!c) { toast(t("recv.badCode")); return; }
      startRecv(c);
    });
    [].forEach.call(document.querySelectorAll('input[name="dest"]'), function (r) { r.addEventListener("change", checkSpace); });
    $("accept").addEventListener("click", accept);
    $("decline").addEventListener("click", function () { if (receiver) receiver.decline(); });
    $("recv-cancel").addEventListener("click", function () { if (receiver) receiver.cancel(); else recvAgain(); });
    $("save-file").addEventListener("click", saveResult);
    $("open-files").addEventListener("click", openInFiles);
    $("recv-again").addEventListener("click", recvAgain);
    var into = $("into-oros");
    if (into) {
      var known = false;
      try { known = localStorage.getItem("oros-lang") !== null; } catch (e) {}
      into.hidden = true;
      into.textContent = t("into.oros");
      into.addEventListener("click", function (ev) {
        ev.preventDefault();
        var c = codeFromHash(location.hash) || C.normCode($("code-in").value);
        if (receiver) receiver.cancel();
        location.href = "../?open=transfer&app-at=" + encodeURIComponent("#r=" + (c ? C.fmtCode(c) : ""));
      });
      into.dataset.known = known ? "1" : "";
    }
  }
  // A link or another app hands over a code: { receive: code }
  window.__orosOpenAt = function (target) {
    var c = target && typeof target.receive === "string" ? C.normCode(target.receive) : "";
    if (!c) return;
    if ($("tab-recv")) tab("recv");
    $("code-in").value = C.fmtCode(c);
    startRecv(c);
  };
  function takePending() {
    var c = codeFromHash(location.hash);
    if (c) {
      if ($("tab-recv")) tab("recv");
      $("code-in").value = C.fmtCode(c);
      var into = $("into-oros");
      if (into && into.dataset.known) into.hidden = false;
      startRecv(c);
      return;
    }
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 9. Boot ----------
  function boot() {
    applyI18n();
    wire();
    inheritPalette();
    watchPalette();
    if ($("disk")) { renderDisk(); renderChosen(); }
    S.sweep();
    takePending();
    window.addEventListener("hashchange", function () {
      var c = codeFromHash(location.hash);
      if (c && !receiver) { $("code-in").value = C.fmtCode(c); startRecv(c); }
    });
  }
  boot();
})();
