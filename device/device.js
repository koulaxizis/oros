// ============================================================
// orOS Device Info — App logic (v1.0.0)
// A read-only look at this device: storage used by each app,
// battery, network, sync state, screen, browser and the browser
// features the orOS apps rely on, plus a plain-text report to copy.
//   - reads only: never changes another app's data, never syncs,
//     never sends anything over the network
//   - asks for no permission; shows the current state where the
//     browser can tell it without asking
// Data:
//   - no synced slice (everything here describes THIS device)
//   - device-local (R10): oros-device-prefs ({ closed[] }: cards the
//     user folded). Stored values of other apps are only measured
//     (length), never shown or copied.
// Sections:
//   1. Constants, i18n, helpers
//   2. Prefs
//   3. Apps list (apps.json + shell names)
//   4. Storage + per-app sizes
//   5. Battery
//   6. Network
//   7. Sync
//   8. Screen
//   9. orOS & browser
//  10. Features
//  11. Report + toast
//  12. Keyboard (Contract Β) + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("device.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var PREFS_KEY = "oros-device-prefs";
  // localStorage limit, in UTF-16 code units of key + value. About
  // 5 million in Chromium and Firefox; Safari is similar. Approximate.
  var LS_LIMIT = 5 * 1024 * 1024;
  var APPS_SHOWN = 10;
  var C = window.DeviceCore;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";
  var DEC = LANG === "el" ? "," : ".";

  var STRINGS = {
    en: {
      "app": "Device Info", "btn.refresh": "Refresh", "btn.copy": "Copy report", "btn.copyShort": "Report",
      "c.storage": "Storage", "c.apps": "Space per app", "c.battery": "Battery",
      "c.network": "Network", "c.sync": "Sync", "c.screen": "Screen",
      "c.system": "orOS & browser", "c.features": "Browser features",
      "about": "Read only: this app changes nothing and sends nothing. Everything describes this device.",
      "na": "Not available", "yes": "Yes", "no": "No", "unknown": "Unknown",
      "s.used": "{used} of {quota}", "s.other": "Files, databases, offline copies",
      "s.noEstimate": "This browser does not say how much space orOS files and databases use.",
      "s.persist": "Protected from automatic clean-up",
      "s.persistHint": "Without protection, the browser may delete orOS data when the device runs low on space. Your synced data stays in the cloud.",
      "s.persistAsk": "Ask for protection",
      "s.persistDenied": "The browser declined. Installing orOS as an app usually helps.",
      "s.persistOk": "Storage is now protected",
      "s.ls": "App data (local storage)", "s.idb": "Databases (Files, wallpaper)",
      "s.caches": "Offline copies and caches", "s.sw": "Service worker",
      "s.lsLimit": "{p}% of the usual browser limit (approximate)",
      "s.lsWarn": "Local storage is almost full. When it fills up, apps cannot save. Delete what you no longer need (old games, map tiles) or export a backup.",
      "s.cache._offline": "orOS files for offline use", "s.cache._other": "Other",
      "s.entries": "{n} items",
      "a.hint": "Local storage per app. Tap an app to open it.",
      "a.showAll": "Show all ({n})", "a.showLess": "Show fewer",
      "a._shell": "orOS (desktop, settings, sync)", "a._pet": "Screen pet", "a._other": "Other (not orOS)",
      "b.level": "Level", "b.charging": "Charging", "b.full": "Full in", "b.empty": "Empty in",
      "b.na": "This browser gives no battery information (Safari and Firefox never do).",
      "n.state": "Connection", "n.online": "Online", "n.offline": "Offline",
      "n.type": "Type", "n.speed": "Estimated speed", "n.rtt": "Latency",
      "n.save": "Data saver", "n.na": "The browser does not share connection details. orOS runs no speed test.",
      "y.connected": "Connected to Dropbox", "y.unlocked": "Unlocked on this device",
      "y.pending": "Changes waiting to upload", "y.every": "Automatic sync",
      "y.everyN": "every {n} min", "y.off": "Off",
      "y.backup": "Last cloud backup copy", "y.export": "Automatic backup to a file",
      "y.exportLast": "Last automatic backup check", "y.folder": "Backup folder",
      "y.never": "Never", "y.notConnected": "Sync is off on this device. Your data lives only here: export a backup now and then.",
      "y.where": "Sync settings",
      "y.daily": "Daily", "y.weekly": "Weekly", "y.monthly": "Monthly",
      "d.screen": "Screen", "d.window": "Window", "d.ratio": "Pixel ratio",
      "d.orient": "Orientation", "d.portrait": "Portrait", "d.landscape": "Landscape",
      "d.color": "Colour depth", "d.bits": "{n}-bit", "d.touch": "Touch",
      "d.points": "yes, {n} points", "d.dark": "System dark mode", "d.motion": "Reduce motion",
      "d.mode": "Running as", "d.installed": "Installed app", "d.tab": "Browser tab",
      "o.version": "orOS version", "o.cache": "Offline copy", "o.apps": "Apps",
      "o.lang": "Language", "o.theme": "Theme", "o.dark": "Dark", "o.light": "Light",
      "o.browser": "Browser (approx.)", "o.os": "System (approx.)", "o.cores": "CPU cores",
      "o.memory": "Memory", "o.memoryV": "about {n} GB", "o.tz": "Time zone",
      "o.locale": "Browser language", "o.secure": "Secure connection (HTTPS)",
      "o.swOn": "Active", "o.swOff": "Not active (no offline use yet)",
      "f.hint": "What the orOS apps can use in this browser.",
      "f.notifications": "Notifications", "f.folder": "Backup folder on disk",
      "f.share": "Share sheet", "f.clipboard": "Copy to clipboard", "f.vibrate": "Vibration",
      "f.wakelock": "Keep the screen on", "f.geolocation": "Location",
      "f.opfs": "Private file storage", "f.serviceworker": "Offline use",
      "f.crypto": "Encryption", "f.audio": "Sound",
      "f.missing": "Missing here, affects: {apps}",
      "f.perm.granted": "allowed", "f.perm.denied": "blocked", "f.perm.prompt": "not asked yet",
      "f.permission": "Permission: {s}",
      "toast.copied": "Report copied", "toast.copyFail": "Could not copy",
      "r.header": "orOS device report · {date}"
    },
    el: {
      "app": "Πληροφορίες συσκευής", "btn.refresh": "Ανανέωση", "btn.copy": "Αντιγραφή αναφοράς", "btn.copyShort": "Αναφορά",
      "c.storage": "Χώρος", "c.apps": "Χώρος ανά εφαρμογή", "c.battery": "Μπαταρία",
      "c.network": "Δίκτυο", "c.sync": "Συγχρονισμός", "c.screen": "Οθόνη",
      "c.system": "orOS και browser", "c.features": "Δυνατότητες browser",
      "about": "Μόνο ανάγνωση: η εφαρμογή δεν αλλάζει και δεν στέλνει τίποτα. Όλα αφορούν αυτή τη συσκευή.",
      "na": "Μη διαθέσιμο", "yes": "Ναι", "no": "Όχι", "unknown": "Άγνωστο",
      "s.used": "{used} από {quota}", "s.other": "Αρχεία, βάσεις, offline αντίγραφα",
      "s.noEstimate": "Ο browser δεν λέει πόσο χώρο πιάνουν τα αρχεία και οι βάσεις του orOS.",
      "s.persist": "Προστασία από αυτόματο καθάρισμα",
      "s.persistHint": "Χωρίς προστασία, ο browser μπορεί να σβήσει δεδομένα του orOS όταν η συσκευή μείνει από χώρο. Ό,τι έχει συγχρονιστεί μένει στο cloud.",
      "s.persistAsk": "Ζήτα προστασία",
      "s.persistDenied": "Ο browser αρνήθηκε. Συνήθως βοηθά η εγκατάσταση του orOS ως εφαρμογή.",
      "s.persistOk": "Ο χώρος προστατεύεται πλέον",
      "s.ls": "Δεδομένα εφαρμογών (local storage)", "s.idb": "Βάσεις δεδομένων (Αρχεία, φόντο)",
      "s.caches": "Offline αντίγραφα και cache", "s.sw": "Service worker",
      "s.lsLimit": "{p}% του συνηθισμένου ορίου του browser (κατά προσέγγιση)",
      "s.lsWarn": "Το local storage σχεδόν γέμισε. Όταν γεμίσει, οι εφαρμογές δεν μπορούν να αποθηκεύσουν. Σβήσε ό,τι δεν χρειάζεσαι (παλιά παιχνίδια, πλακίδια χαρτών) ή κάνε εξαγωγή αντιγράφου.",
      "s.cache._offline": "Αρχεία orOS για offline χρήση", "s.cache._other": "Άλλα",
      "s.entries": "{n} στοιχεία",
      "a.hint": "Local storage ανά εφαρμογή. Πάτα μια εφαρμογή για να ανοίξει.",
      "a.showAll": "Όλες ({n})", "a.showLess": "Λιγότερες",
      "a._shell": "orOS (επιφάνεια, ρυθμίσεις, sync)", "a._pet": "Κατοικίδιο οθόνης", "a._other": "Άλλα (όχι orOS)",
      "b.level": "Φόρτιση", "b.charging": "Φορτίζει", "b.full": "Γεμίζει σε", "b.empty": "Αδειάζει σε",
      "b.na": "Ο browser δεν δίνει πληροφορίες μπαταρίας (Safari και Firefox ποτέ).",
      "n.state": "Σύνδεση", "n.online": "Online", "n.offline": "Offline",
      "n.type": "Τύπος", "n.speed": "Εκτιμώμενη ταχύτητα", "n.rtt": "Καθυστέρηση",
      "n.save": "Εξοικονόμηση δεδομένων", "n.na": "Ο browser δεν δίνει στοιχεία σύνδεσης. Το orOS δεν κάνει τεστ ταχύτητας.",
      "y.connected": "Σύνδεση με Dropbox", "y.unlocked": "Ξεκλείδωτο σε αυτή τη συσκευή",
      "y.pending": "Αλλαγές που περιμένουν upload", "y.every": "Αυτόματος συγχρονισμός",
      "y.everyN": "κάθε {n} λεπτά", "y.off": "Ανενεργός",
      "y.backup": "Τελευταίο αντίγραφο στο cloud", "y.export": "Αυτόματο αντίγραφο σε αρχείο",
      "y.exportLast": "Τελευταίος έλεγχος αυτόματου αντιγράφου", "y.folder": "Φάκελος αντιγράφων",
      "y.never": "Ποτέ", "y.notConnected": "Ο συγχρονισμός είναι κλειστός σε αυτή τη συσκευή. Τα δεδομένα σου υπάρχουν μόνο εδώ: κάνε πού και πού εξαγωγή αντιγράφου.",
      "y.where": "Ρυθμίσεις συγχρονισμού",
      "y.daily": "Καθημερινά", "y.weekly": "Εβδομαδιαία", "y.monthly": "Μηνιαία",
      "d.screen": "Οθόνη", "d.window": "Παράθυρο", "d.ratio": "Πυκνότητα pixel",
      "d.orient": "Προσανατολισμός", "d.portrait": "Κάθετος", "d.landscape": "Οριζόντιος",
      "d.color": "Βάθος χρώματος", "d.bits": "{n}-bit", "d.touch": "Αφή",
      "d.points": "ναι, {n} σημεία", "d.dark": "Σκούρο θέμα συστήματος", "d.motion": "Λιγότερη κίνηση",
      "d.mode": "Τρέχει ως", "d.installed": "Εγκατεστημένη εφαρμογή", "d.tab": "Καρτέλα browser",
      "o.version": "Έκδοση orOS", "o.cache": "Offline αντίγραφο", "o.apps": "Εφαρμογές",
      "o.lang": "Γλώσσα", "o.theme": "Θέμα", "o.dark": "Σκούρο", "o.light": "Φωτεινό",
      "o.browser": "Browser (περίπου)", "o.os": "Σύστημα (περίπου)", "o.cores": "Πυρήνες CPU",
      "o.memory": "Μνήμη", "o.memoryV": "περίπου {n} GB", "o.tz": "Ζώνη ώρας",
      "o.locale": "Γλώσσα browser", "o.secure": "Ασφαλής σύνδεση (HTTPS)",
      "o.swOn": "Ενεργός", "o.swOff": "Ανενεργός (όχι ακόμα offline)",
      "f.hint": "Τι μπορούν να χρησιμοποιήσουν οι εφαρμογές του orOS σε αυτόν τον browser.",
      "f.notifications": "Ειδοποιήσεις", "f.folder": "Φάκελος αντιγράφων στον δίσκο",
      "f.share": "Κοινοποίηση", "f.clipboard": "Αντιγραφή στο πρόχειρο", "f.vibrate": "Δόνηση",
      "f.wakelock": "Οθόνη πάντα ανοιχτή", "f.geolocation": "Τοποθεσία",
      "f.opfs": "Ιδιωτικός χώρος αρχείων", "f.serviceworker": "Offline χρήση",
      "f.crypto": "Κρυπτογράφηση", "f.audio": "Ήχος",
      "f.missing": "Λείπει εδώ, επηρεάζει: {apps}",
      "f.perm.granted": "επιτρέπεται", "f.perm.denied": "μπλοκαρισμένη", "f.perm.prompt": "δεν έχει ζητηθεί",
      "f.permission": "Άδεια: {s}",
      "toast.copied": "Η αναφορά αντιγράφηκε", "toast.copyFail": "Η αντιγραφή απέτυχε",
      "r.header": "Αναφορά συσκευής orOS · {date}"
    }
  };

  function t(key, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function bytes(n) { return C.formatBytes(n, DEC); }
  function num(n, digits) {
    try {
      return Number(n).toLocaleString(LOCALE, { maximumFractionDigits: digits || 0 });
    } catch (e) { return String(n); }
  }
  function when(ms) {
    if (!(ms > 0)) return t("y.never");
    try {
      return new Date(ms).toLocaleString(LOCALE, {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false
      });
    } catch (e) { return new Date(ms).toISOString(); }
  }
  function yn(v) { return v ? t("yes") : t("no"); }
  function parentWin() {
    try { return (window.parent && window.parent !== window) ? window.parent : null; }
    catch (e) { return null; }
  }
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  // Key/value table. rows: [[label, value, cls?]]; also feeds the report.
  function kvTable(rows) {
    var tb = el("table", "kv");
    rows.forEach(function (r) {
      var tr = el("tr");
      var th = el("th", "", r[0]);
      th.setAttribute("scope", "row");
      tr.appendChild(th);
      tr.appendChild(el("td", r[2] || "", r[1]));
      tb.appendChild(tr);
    });
    return tb;
  }
  function barEl(pct, level) {
    var b = el("div", "bar" + (level ? " " + level : ""));
    var f = el("span");
    f.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + "%";
    b.appendChild(f);
    return b;
  }
  function fill(id, nodes) {
    var host = $(id);
    host.textContent = "";
    nodes.forEach(function (n) { if (n) host.appendChild(n); });
  }

  // The report gathers every card's rows here as they render.
  var report = {};

  // ---------- 2. Prefs ----------
  var prefs = { closed: [] };
  function loadPrefs() {
    try {
      var p = JSON.parse(lsGet(PREFS_KEY));
      if (p && Array.isArray(p.closed)) {
        prefs.closed = p.closed.filter(function (x) { return typeof x === "string"; }).slice(0, 20);
      }
    } catch (e) { /* defaults */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* full: folding is cosmetic */ }
  }

  // ---------- 3. Apps list ----------
  var apps = [];          // [{ id, name }] from apps.json
  function loadApps() {
    return fetch("../apps.json").then(function (r) {
      if (!r.ok) throw new Error("apps.json " + r.status);
      return r.json();
    }).then(function (j) {
      apps = (j && Array.isArray(j.apps) ? j.apps : []).filter(function (a) {
        return a && typeof a.id === "string";
      }).map(function (a) { return { id: a.id, name: String(a.name || a.id) }; });
    }).catch(function () { apps = []; });
  }
  function appIds() { return apps.map(function (a) { return a.id; }); }
  function ownerName(id) {
    if (id.charAt(0) === "_") return t("a." + id);
    var p = parentWin();
    try {
      if (p && typeof p.t === "function") {
        var s = p.t("app." + id);
        if (s && s !== "app." + id) return s;
      }
    } catch (e) { /* standalone */ }
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i].name;
    return id;
  }
  function canOpen(id) {
    var p = parentWin();
    return !!(p && id.charAt(0) !== "_" && typeof p.__orosOpenApp === "function" &&
              appIds().indexOf(id) >= 0 && id !== "device");
  }
  function openApp(id) {
    var p = parentWin();
    try { if (p && typeof p.__orosOpenApp === "function") p.__orosOpenApp(id); } catch (e) { /* ignore */ }
  }

  // ---------- 4. Storage + per-app sizes ----------
  function lsEntries() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k === null) continue;
        var v = localStorage.getItem(k);
        out.push({ key: k, len: v ? v.length : 0 });
      }
    } catch (e) { /* storage blocked */ }
    return out;
  }
  function sliceRegistry() {
    try {
      var r = JSON.parse(lsGet("oros-slices"));
      return r && typeof r === "object" ? r : {};
    } catch (e) { return {}; }
  }

  function cacheInfo() {
    if (!window.caches || typeof caches.keys !== "function") return Promise.resolve(null);
    return caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        return caches.open(n).then(function (c) { return c.keys(); })
          .then(function (ks) { return { name: n, count: ks.length }; })
          .catch(function () { return { name: n, count: 0 }; });
      }));
    }).catch(function () { return null; });
  }

  var appsExpanded = false;

  function renderStorage() {
    var st = navigator.storage;
    var est = (st && typeof st.estimate === "function") ? st.estimate().catch(function () { return null; }) : Promise.resolve(null);
    var per = (st && typeof st.persisted === "function") ? st.persisted().catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([est, per, cacheInfo()]).then(function (res) {
      var e = res[0], persisted = res[1], cachesList = res[2];
      var nodes = [], rows = [];

      // App data first: it is what the apps save into, and the browser
      // limit that matters most. (Chromium's estimate() leaves it out.)
      var lsRows = C.sizeByOwner(lsEntries(), appIds(), sliceRegistry());
      var lsBytes = C.totalBytes(lsRows);
      var lsPct = C.percent(lsBytes / 2, LS_LIMIT);
      var big = el("div", "big", bytes(lsBytes) + " ");
      big.appendChild(el("small", "", t("s.ls")));
      nodes.push(big);

      var kv = [];
      if (e && e.quota > 0) {
        kv.push([t("s.other"), t("s.used", { used: bytes(e.usage), quota: bytes(e.quota) })]);
        var d = e.usageDetails;
        if (d) {
          if (typeof d.indexedDB === "number") kv.push([t("s.idb"), bytes(d.indexedDB)]);
          if (typeof d.caches === "number") kv.push([t("s.caches"), bytes(d.caches)]);
          if (typeof d.serviceWorkerRegistrations === "number") kv.push([t("s.sw"), bytes(d.serviceWorkerRegistrations)]);
        }
      }
      if (persisted !== null) kv.push([t("s.persist"), yn(persisted), persisted ? "ok" : "warn-t"]);

      var lim = el("p", "hint", t("s.lsLimit", { p: num(lsPct, lsPct < 10 ? 1 : 0) }));
      nodes.push(barEl(lsPct, lsPct > 90 ? "bad" : lsPct > 80 ? "warn" : ""));
      nodes.push(lim);
      rows.push([t("s.ls"), bytes(lsBytes) + " · " + t("s.lsLimit", { p: num(lsPct, 1) })]);
      if (lsPct > 80) nodes.push(el("p", "note bad", t("s.lsWarn")));
      if (kv.length) nodes.push(kvTable(kv));
      rows = rows.concat(kv);
      if (!(e && e.quota > 0)) nodes.push(el("p", "hint", t("s.noEstimate")));

      if (cachesList && cachesList.length) {
        var ckv = cachesList.map(function (c) {
          var o = C.cacheOwner(c.name);
          var label = o.charAt(0) === "_" ? t("s.cache." + o) : ownerName(o);
          return [label, t("s.entries", { n: num(c.count) })];
        });
        nodes.push(el("p", "hint", t("s.caches")));
        nodes.push(kvTable(ckv));
        rows = rows.concat(ckv);
      }

      if (persisted === false) {
        nodes.push(el("p", "note", t("s.persistHint")));
        if (typeof st.persist === "function") {
          var b = el("button", "act small", t("s.persistAsk"));
          b.type = "button";
          b.addEventListener("click", function () {
            b.disabled = true;
            st.persist().then(function (ok) {
              showToast(ok ? t("s.persistOk") : t("s.persistDenied"));
              renderStorage();
            }).catch(function () { b.disabled = false; });
          });
          nodes.push(b);
        }
      }
      fill("b-storage", nodes);
      report.storage = rows;
      renderApps(lsRows);
    });
  }

  function renderApps(lsRows) {
    var max = lsRows.length ? lsRows[0].bytes : 0;
    var list = el("ul", "apps");
    var shown = appsExpanded ? lsRows : lsRows.slice(0, APPS_SHOWN);
    shown.forEach(function (r) {
      var li = el("li");
      var open = canOpen(r.owner);
      var row = el(open ? "button" : "div", "app-row");
      if (open) {
        row.type = "button";
        row.addEventListener("click", function () { openApp(r.owner); });
      }
      row.appendChild(el("span", "app-name", ownerName(r.owner)));
      row.appendChild(el("span", "app-size", bytes(r.bytes)));
      row.appendChild(barEl(C.percent(r.bytes, max)));
      li.appendChild(row);
      list.appendChild(li);
    });
    var nodes = [el("p", "hint", t("a.hint")), list];
    if (lsRows.length > APPS_SHOWN) {
      var more = el("button", "act small more",
        appsExpanded ? t("a.showLess") : t("a.showAll", { n: lsRows.length }));
      more.type = "button";
      more.addEventListener("click", function () {
        appsExpanded = !appsExpanded;
        renderApps(lsRows);
      });
      nodes.push(more);
    }
    fill("b-apps", nodes);
    report.apps = lsRows.map(function (r) { return [ownerName(r.owner), bytes(r.bytes)]; });
  }

  // ---------- 5. Battery ----------
  var battery = null, batteryReady = false;
  function fmtDuration(sec) {
    if (!isFinite(sec) || !(sec > 0)) return "";
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (m === 60) { h++; m = 0; }
    return (h ? h + " h " : "") + m + " min";
  }
  function renderBattery() {
    if (!batteryReady) return;
    if (!battery) {
      fill("b-battery", [el("p", "hint", t("b.na"))]);
      report.battery = [[t("c.battery"), t("na")]];
      return;
    }
    var pct = Math.round(battery.level * 100);
    var rows = [[t("b.level"), pct + "%"], [t("b.charging"), yn(battery.charging)]];
    var eta = battery.charging ? fmtDuration(battery.chargingTime) : fmtDuration(battery.dischargingTime);
    if (eta) rows.push([battery.charging ? t("b.full") : t("b.empty"), eta]);
    var big = el("div", "big", pct + "%");
    fill("b-battery", [big, barEl(pct, pct <= 10 ? "bad" : pct <= 20 ? "warn" : ""), kvTable(rows.slice(1))]);
    report.battery = rows;
  }
  function initBattery() {
    if (typeof navigator.getBattery !== "function") { batteryReady = true; renderBattery(); return Promise.resolve(); }
    return navigator.getBattery().then(function (b) {
      battery = b;
      batteryReady = true;
      ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"].forEach(function (ev) {
        b.addEventListener(ev, renderBattery);
      });
      renderBattery();
    }).catch(function () { batteryReady = true; renderBattery(); });
  }

  // ---------- 6. Network ----------
  function renderNetwork() {
    var on = navigator.onLine !== false;
    var rows = [[t("n.state"), on ? t("n.online") : t("n.offline"), on ? "ok" : "bad"]];
    var c = navigator.connection;
    if (c) {
      if (c.type) rows.push([t("n.type"), String(c.type)]);
      else if (c.effectiveType) rows.push([t("n.type"), String(c.effectiveType).toUpperCase()]);
      if (typeof c.downlink === "number" && c.downlink > 0) rows.push([t("n.speed"), "≈ " + num(c.downlink, 1) + " Mbps"]);
      if (typeof c.rtt === "number" && c.rtt > 0) rows.push([t("n.rtt"), "≈ " + num(c.rtt) + " ms"]);
      if (typeof c.saveData === "boolean") rows.push([t("n.save"), yn(c.saveData)]);
    }
    var nodes = [kvTable(rows)];
    if (!c) nodes.push(el("p", "hint", t("n.na")));
    fill("b-network", nodes);
    report.network = rows;
  }

  // ---------- 7. Sync ----------
  function renderSync() {
    var s = syncApi();
    var rows = [];
    var connected = false;
    try { connected = !!(s && s.isConnected && s.isConnected()); } catch (e) { /* ignore */ }
    rows.push([t("y.connected"), yn(connected), connected ? "ok" : ""]);
    if (connected) {
      var unlocked = false, dirty = false, every = 0;
      try { unlocked = !!(s.hasPassphrase && s.hasPassphrase()); } catch (e) { /* ignore */ }
      try { dirty = !!(s.isDirty && s.isDirty()); } catch (e) { /* ignore */ }
      try { every = s.getIntervalMinutes ? s.getIntervalMinutes() : 0; } catch (e) { /* ignore */ }
      rows.push([t("y.unlocked"), yn(unlocked), unlocked ? "ok" : "warn-t"]);
      rows.push([t("y.pending"), yn(dirty), dirty ? "warn-t" : ""]);
      rows.push([t("y.every"), every > 0 ? t("y.everyN", { n: every }) : t("y.off")]);
      rows.push([t("y.backup"), when(parseInt(lsGet("oros-sync-last-backup") || "0", 10))]);
    }
    var mode = lsGet("oros-autoexport") || "off";
    var modeLabel = { daily: t("y.daily"), weekly: t("y.weekly"), monthly: t("y.monthly") }[mode] || t("y.off");
    rows.push([t("y.export"), modeLabel]);
    if (mode !== "off" && modeLabel !== t("y.off")) {
      rows.push([t("y.exportLast"), when(parseInt(lsGet("oros-autoexport-last") || "0", 10))]);
      var folder = lsGet("oros-fs-folder-name");
      if (folder) rows.push([t("y.folder"), folder]);
    }
    var nodes = [kvTable(rows)];
    if (!connected) nodes.push(el("p", "note", t("y.notConnected")));
    // Sync is set up in Settings → Sync (the shell opens it there).
    var p = parentWin();
    if (p && p.orosSettings && typeof p.orosSettings.open === "function") {
      var go = el("button", "act small", t("y.where"));
      go.type = "button";
      go.addEventListener("click", function () { p.orosSettings.open("sync"); });
      nodes.push(go);
    }
    fill("b-sync", nodes);
    report.sync = rows;
  }

  // ---------- 8. Screen ----------
  function mq(q, win) {
    try { return !!(win || window).matchMedia(q).matches; } catch (e) { return false; }
  }
  function renderScreen() {
    var p = parentWin() || window;
    var sc = window.screen || {};
    var ww = window.innerWidth, wh = window.innerHeight;
    try { ww = p.innerWidth; wh = p.innerHeight; } catch (e) { /* cross-origin: keep the frame */ }
    var portrait = (sc.orientation && sc.orientation.type) ?
      sc.orientation.type.indexOf("portrait") === 0 : (sc.height >= sc.width);
    var touch = navigator.maxTouchPoints || 0;
    var installed = mq("(display-mode: standalone)", p) || mq("(display-mode: fullscreen)", p) ||
                    mq("(display-mode: window-controls-overlay)", p) || !!navigator.standalone;
    var rows = [
      [t("d.screen"), num(sc.width) + " × " + num(sc.height)],
      [t("d.window"), num(ww) + " × " + num(wh)],
      [t("d.ratio"), num(window.devicePixelRatio || 1, 2) + "×"],
      [t("d.orient"), portrait ? t("d.portrait") : t("d.landscape")],
      [t("d.color"), sc.colorDepth ? t("d.bits", { n: sc.colorDepth }) : t("unknown")],
      [t("d.touch"), touch > 0 ? t("d.points", { n: touch }) : t("no")],
      [t("d.dark"), yn(mq("(prefers-color-scheme: dark)"))],
      [t("d.motion"), yn(mq("(prefers-reduced-motion: reduce)"))],
      [t("d.mode"), installed ? t("d.installed") : t("d.tab")]
    ];
    fill("b-screen", [kvTable(rows)]);
    report.screen = rows;
  }

  // ---------- 9. orOS & browser ----------
  function swState() {
    var sw = navigator.serviceWorker;
    return !!(sw && sw.controller);
  }
  function renderSystem(cacheNames) {
    var ua = navigator.userAgent || "";
    var hint = (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "touch-mac" : "";
    var u = C.parseUA(ua, hint);
    var offline = "";
    (cacheNames || []).forEach(function (n) {
      var m = String(n).match(/^oros-shell-oros-v([\d.]+)$/);
      if (m) offline = m[1];
    });
    var theme = document.documentElement.getAttribute("data-theme") === "light" ? t("o.light") : t("o.dark");
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* old engine */ }
    var rows = [
      [t("o.version"), lsGet("oros-last-version") || SCRIPT_V || t("unknown")],
      [t("o.cache"), swState() ? (offline ? t("o.swOn") + " · " + offline : t("o.swOn")) : t("o.swOff"),
        swState() ? "ok" : "warn-t"],
      [t("o.apps"), apps.length ? num(apps.length) : t("unknown")],
      [t("o.lang"), LANG === "el" ? "Ελληνικά" : "English"],
      [t("o.theme"), theme],
      [t("o.browser"), u.browser ? (u.browser + (u.version ? " " + u.version : "")) : t("unknown")],
      [t("o.os"), u.os ? (u.os + (u.osVersion ? " " + u.osVersion : "")) : t("unknown")],
      [t("o.cores"), navigator.hardwareConcurrency ? num(navigator.hardwareConcurrency) : t("unknown")],
      [t("o.memory"), navigator.deviceMemory ? t("o.memoryV", { n: num(navigator.deviceMemory, 2) }) : t("unknown")],
      [t("o.tz"), tz || t("unknown")],
      [t("o.locale"), navigator.language || t("unknown")],
      [t("o.secure"), yn(window.isSecureContext)]
    ];
    fill("b-system", [kvTable(rows)]);
    report.system = rows;
  }

  // ---------- 10. Features ----------
  function hasFeature(f) {
    var p = parentWin() || window;
    try {
      switch (f) {
        case "notifications": return "Notification" in window;
        case "folder": return typeof p.showDirectoryPicker === "function";
        case "share": return typeof navigator.share === "function";
        case "clipboard": return !!(navigator.clipboard && typeof navigator.clipboard.writeText === "function");
        case "vibrate": return typeof navigator.vibrate === "function";
        case "wakelock": return !!(navigator.wakeLock && typeof navigator.wakeLock.request === "function");
        case "geolocation": return !!navigator.geolocation;
        case "opfs": return !!(navigator.storage && typeof navigator.storage.getDirectory === "function");
        case "serviceworker": return "serviceWorker" in navigator;
        case "crypto": return !!(window.crypto && window.crypto.subtle);
        case "audio": return !!(window.AudioContext || window.webkitAudioContext);
      }
    } catch (e) { /* treat as missing */ }
    return false;
  }
  // Current permission state without asking for anything.
  function permState(f) {
    if (f === "notifications") {
      try {
        var v = window.Notification && Notification.permission;
        return Promise.resolve(v === "default" ? "prompt" : v || null);
      } catch (e) { return Promise.resolve(null); }
    }
    if (f === "geolocation" && navigator.permissions && typeof navigator.permissions.query === "function") {
      return navigator.permissions.query({ name: "geolocation" })
        .then(function (r) { return r.state; }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }
  function renderFeatures() {
    var ids = appIds();
    return Promise.all(C.FEATURES.map(function (f) {
      var has = hasFeature(f);
      return (has ? permState(f) : Promise.resolve(null)).then(function (perm) {
        return { f: f, has: has, perm: perm };
      });
    })).then(function (list) {
      var ul = el("ul", "feat");
      var rows = [];
      list.forEach(function (x) {
        var li = el("li");
        li.appendChild(el("span", "mark " + (x.has ? "ok" : "bad"), x.has ? "✓" : "✗"));
        var txt = el("span", "txt", t("f." + x.f));
        var sub = "";
        if (!x.has) {
          var names = C.featureImpact(x.f, ids).map(ownerName);
          if (names.length) sub = t("f.missing", { apps: names.join(", ") });
        } else if (x.perm && STRINGS.en["f.perm." + x.perm]) {
          sub = t("f.permission", { s: t("f.perm." + x.perm) });
        }
        if (sub) txt.appendChild(el("span", "sub", sub));
        li.appendChild(txt);
        ul.appendChild(li);
        rows.push([t("f." + x.f), (x.has ? "✓" : "✗") + (sub ? " (" + sub + ")" : "")]);
      });
      fill("b-features", [el("p", "hint", t("f.hint")), ul]);
      report.features = rows;
    });
  }

  // ---------- 11. Report + toast ----------
  var ORDER = ["storage", "apps", "battery", "network", "sync", "screen", "system", "features"];
  var TITLES = { storage: "c.storage", apps: "c.apps", battery: "c.battery", network: "c.network",
                 sync: "c.sync", screen: "c.screen", system: "c.system", features: "c.features" };
  function reportText() {
    return C.buildReport(t("r.header", { date: when(Date.now()) }),
      ORDER.filter(function (k) { return report[k]; }).map(function (k) {
        return { title: t(TITLES[k]), rows: report[k] };
      }));
  }
  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = el("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error("copy"));
    });
  }
  function copyReport() {
    copyText(reportText()).then(function () { showToast(t("toast.copied")); },
                                function () { showToast(t("toast.copyFail")); });
  }

  var toastTimer = null;
  function showToast(text) {
    var box = $("toast");
    if (!box) return;
    box.textContent = text;
    box.classList.remove("show");
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }

  // ---------- 12. Keyboard (Contract Β) + palette ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "SUMMARY") return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); refresh(); }
    });
  }

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
      new MutationObserver(function () { inheritPalette(); renderSystem(lastCacheNames); }).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // ---------- 13. Wiring & boot ----------
  var lastCacheNames = [];
  var refreshing = false;
  function refresh() {
    if (refreshing) return Promise.resolve();
    refreshing = true;
    renderNetwork();
    renderSync();
    renderScreen();
    renderBattery();
    var cn = (window.caches && typeof caches.keys === "function") ?
      caches.keys().catch(function () { return []; }) : Promise.resolve([]);
    return Promise.all([renderStorage(), renderFeatures(), cn.then(function (names) {
      lastCacheNames = names || [];
      renderSystem(lastCacheNames);
    })]).catch(function (e) { console.error("device refresh", e); })
      .then(function () { refreshing = false; });
  }

  function applyI18n() {
    document.documentElement.lang = LANG;
    document.title = t("app") + " · orOS";
    $("title").textContent = t("app");
    $("refresh-btn").setAttribute("aria-label", t("btn.refresh"));
    $("refresh-btn").setAttribute("title", t("btn.refresh") + " (R)");
    $("copy-btn").querySelector(".long").textContent = t("btn.copy");
    $("copy-btn").querySelector(".short").textContent = t("btn.copyShort");
    $("copy-btn").setAttribute("aria-label", t("btn.copy"));
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
  }

  function wire() {
    $("refresh-btn").addEventListener("click", refresh);
    $("copy-btn").addEventListener("click", copyReport);
    Array.prototype.forEach.call(document.querySelectorAll("details.card"), function (d) {
      if (prefs.closed.indexOf(d.id) >= 0) d.open = false;
      d.addEventListener("toggle", function () {
        var i = prefs.closed.indexOf(d.id);
        if (d.open && i >= 0) prefs.closed.splice(i, 1);
        else if (!d.open && i < 0) prefs.closed.push(d.id);
        savePrefs();
      });
    });
    window.addEventListener("online", renderNetwork);
    window.addEventListener("offline", renderNetwork);
    if (navigator.connection && typeof navigator.connection.addEventListener === "function") {
      navigator.connection.addEventListener("change", renderNetwork);
    }
    var resizeTimer = null;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderScreen, 150);
    }
    window.addEventListener("resize", onResize);
    try { if (parentWin()) parentWin().addEventListener("resize", onResize); } catch (e) { /* ignore */ }
    window.addEventListener("pagehide", function () {
      try { if (parentWin()) parentWin().removeEventListener("resize", onResize); } catch (e) { /* ignore */ }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });
    wireKeyboard();
  }

  function boot() {
    loadPrefs();
    applyI18n();
    inheritPalette();
    watchPalette();
    wire();
    renderNetwork();
    renderSync();
    renderScreen();
    loadApps().then(function () {
      return Promise.all([initBattery(), refresh()]);
    });
  }

  boot();
})();
