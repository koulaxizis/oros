// ============================================================
// orOS Files — dropbox.js (the whole Dropbox, next to the disk)
// ------------------------------------------------------------
// A "Dropbox" place under the orOS disk in the Files tree. It shows
// the user's whole Dropbox (read only): folders, files, search,
// preview and download. orOS sync is not involved: sync keeps its
// own App-folder Dropbox app, and this view connects a SECOND
// Dropbox app (Full Dropbox, OrosDropboxCore.APP_KEY or the user's
// own key) only when the user presses Connect here.
//
// Sign-in: OAuth 2.0 + PKCE, public client, no secret. A popup opens
// dropbox.com; Dropbox sends it to files/dropbox-callback.html (same
// origin), which hands code + state over on a BroadcastChannel and
// in localStorage CB_KEY (the fallback when the popup is blocked and
// the whole tab went to Dropbox). The state must match this device's
// PKCE record.
//
// Device-local (never synced; the factory reset removes them):
//   IndexedDB "oros-files-dbx"  keys/device (non-extractable AES-GCM),
//                               creds/dropbox {iv, data} = sealed
//                               { access, refresh, exp, key, who }
//   oros-files-dbx-key          the user's own app key (optional)
//   oros-files-dbx-pkce         { state, verifier, redirect, key, mode, t }
//   oros-files-dbx-cb           { code?, error?, state, t } (one-shot)
//   oros-files-dbx-view         { on, path } the last place shown
//   oros-files-dbx-sync         lower-case paths found to be orOS
//                               sync's own encrypted folder (hidden)
//
// Files is the only caller: OrosFilesDropbox.init(ctx) at boot,
// treeNode() from renderTree(), leave() from navigate().
// ============================================================
(function () {
  "use strict";

  var C = window.OrosDropboxCore;
  if (!C) return;

  var DB_NAME  = "oros-files-dbx";
  var KEY_LS   = "oros-files-dbx-key";
  var PKCE_LS  = "oros-files-dbx-pkce";
  var CB_LS    = "oros-files-dbx-cb";
  var VIEW_LS  = "oros-files-dbx-view";
  var SYNC_LS  = "oros-files-dbx-sync";
  var JOB_LS   = "oros-files-dbx-job";
  var CHANNEL  = "oros-files-dbx";
  var PKCE_MAX_MS = 15 * 60 * 1000;
  var LIST_PAGES = 50;                    // 50 × 2000 entries per folder
  var PV_TEXT = 512 * 1024;               // same caps as the disk preview
  var PV_IMAGE = 10 * 1024 * 1024;

  var LANG = (function () {
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();

  var STRINGS = {
    en: {
      "tree":        "Dropbox",
      "up":          "Go to parent folder",
      "refresh":     "Refresh",
      "account":     "Dropbox account",
      "disconnect":  "Disconnect Dropbox",
      "disconnected":"Dropbox disconnected on this device",
      "search":      "Search in Dropbox…",
      "searchClear": "Clear search",
      "loading":     "Loading…",
      "empty":       "This folder is empty",
      "items":       "{n} items",
      "oneItem":     "1 item",
      "results":     "{n} results",
      "noResults":   "No matches found",
      "col.name":    "Name",
      "col.size":    "Size",
      "col.date":    "Modified",
      "setup.title": "Dropbox for Files is not set up yet",
      "setup.body":  "Browsing your whole Dropbox needs a Dropbox app with \"Full Dropbox\" access. orOS sync is not affected: it keeps using its own folder.",
      "setup.own":   "Use my own app key",
      "setup.steps": "At dropbox.com/developers/apps create an app with Scoped access and Full Dropbox. Under Permissions tick files.metadata.read, files.content.read and files.content.write. Under Settings add this redirect URI:",
      "setup.key":   "App key",
      "setup.save":  "Save",
      "setup.bad":   "An app key is 8 to 32 lowercase letters and digits.",
      "setup.saved": "App key saved on this device",
      "setup.reset": "Forget my app key",
      "connect.title": "See your whole Dropbox here",
      "connect.body":  "Browse every folder of your Dropbox, preview files and download copies. Files travel straight between this browser and Dropbox, with no orOS server in between.",
      "connect.note":  "orOS asks Dropbox to read your files and, for moving files into the encrypted disk, to remove the originals. The connection stays on this device.",
      "connect.go":    "Connect Dropbox",
      "connect.wait":  "Finish the sign-in in the Dropbox window…",
      "connected":   "Dropbox connected",
      "denied":      "Dropbox sign-in was cancelled",
      "failed":      "Dropbox sign-in failed. Try again.",
      "offline":     "You are offline",
      "noCrypto":    "This browser can't keep the Dropbox connection safely.",
      "err.auth":    "The Dropbox connection has ended. Connect again.",
      "err.scope":   "The Dropbox app is missing a permission (files.metadata.read, files.content.read).",
      "err.busy":    "Dropbox is busy. Try again in a minute.",
      "err.notfound":"This folder no longer exists in Dropbox.",
      "err.net":     "Dropbox could not be reached.",
      "retry":       "Try again",
      "sync.title":  "orOS sync folder",
      "sync.body":   "This is orOS sync's own folder. Everything in it is encrypted and only orOS sync reads it, so it is not shown here.",
      "pv.download": "Download",
      "pv.close":    "Close preview",
      "pv.none":     "No preview for this file. Download it to open it.",
      "pv.big":      "This file is too large to preview ({n}). Download it instead.",
      "pv.fail":     "The file couldn't be read from Dropbox.",
      "pv.notUtf8":  "This file is not UTF-8 text. Download it to open it.",
      "pv.noDl":     "Dropbox does not allow downloading this file (for example a Paper doc).",
      "dl.started":  "Download started",
      "dl.fail":     "Download failed",
      "disk":        "Files",
      "sel.n":       "{n} selected",
      "sel.all":     "Select all",
      "sel.one":     "Select",
      "sel.clear":   "Clear selection",
      "x.copy":      "Copy to orOS disk",
      "x.move":      "Move to orOS disk",
      "x.copyTitle": "Copy to the orOS disk",
      "x.moveTitle": "Move to the orOS disk",
      "x.copyOk":    "Copy here",
      "x.moveOk":    "Move here",
      "x.gather":    "Collecting files…",
      "x.none":      "Nothing to transfer.",
      "x.confirmCopy": "Copy {n} files ({size}) to \"{dst}\"?",
      "x.confirmMove": "Move {n} files ({size}) to \"{dst}\"?",
      "x.moveNote":  "Each original goes to Dropbox's deleted files (restorable there for 30 days) only after its encrypted copy is confirmed in orOS sync. Anything not confirmed stays in Dropbox.",
      "x.skipped":   "{n} items are left out (orOS sync's folder, files Dropbox won't let download, files over 300 MB, or past the limit of 1000 files / 1 GB per transfer).",
      "x.go":        "Start",
      "x.cancel":    "Cancel",
      "x.stop":      "Stop",
      "x.copying":   "Copying {i} of {n}…",
      "x.waiting":   "Waiting for orOS sync to save the encrypted copies…",
      "x.deleting":  "Removing originals from Dropbox…",
      "x.copied":    "{n} files copied to the orOS disk",
      "x.moved":     "{n} files moved to the orOS disk",
      "x.kept":      "{n} originals stay in Dropbox (their encrypted copy was not confirmed, or they changed)",
      "x.failed":    "{n} files could not be copied",
      "x.stopped":   "Stopped. Files already copied stay on the disk; no original was removed.",
      "x.needSync":  "Moving needs orOS sync connected and unlocked, so the encrypted copy exists before the original is removed. Copy works without it.",
      "x.busy":      "A transfer is already running.",
      "x.resume":    "A copy or move to the orOS disk was interrupted.",
      "x.resumeGo":  "Continue",
      "x.resumeDrop":"Discard"
    },
    el: {
      "tree":        "Dropbox",
      "up":          "Μετάβαση στον γονικό φάκελο",
      "refresh":     "Ανανέωση",
      "account":     "Λογαριασμός Dropbox",
      "disconnect":  "Αποσύνδεση Dropbox",
      "disconnected":"Το Dropbox αποσυνδέθηκε σε αυτή τη συσκευή",
      "search":      "Αναζήτηση στο Dropbox…",
      "searchClear": "Καθαρισμός αναζήτησης",
      "loading":     "Φόρτωση…",
      "empty":       "Αυτός ο φάκελος είναι κενός",
      "items":       "{n} στοιχεία",
      "oneItem":     "1 στοιχείο",
      "results":     "{n} αποτελέσματα",
      "noResults":   "Δεν βρέθηκαν αντιστοιχίσεις",
      "col.name":    "Όνομα",
      "col.size":    "Μέγεθος",
      "col.date":    "Τροποποίηση",
      "setup.title": "Το Dropbox στα Αρχεία δεν έχει ρυθμιστεί ακόμα",
      "setup.body":  "Για να βλέπεις όλο το Dropbox χρειάζεται μια εφαρμογή Dropbox με πρόσβαση «Full Dropbox». Ο συγχρονισμός του orOS δεν επηρεάζεται: συνεχίζει με τον δικό του φάκελο.",
      "setup.own":   "Χρήση δικού μου app key",
      "setup.steps": "Στο dropbox.com/developers/apps φτιάξε εφαρμογή με Scoped access και Full Dropbox. Στα Permissions τσέκαρε τα files.metadata.read, files.content.read και files.content.write. Στα Settings πρόσθεσε αυτό το redirect URI:",
      "setup.key":   "App key",
      "setup.save":  "Αποθήκευση",
      "setup.bad":   "Ένα app key έχει 8 έως 32 πεζά γράμματα και ψηφία.",
      "setup.saved": "Το app key αποθηκεύτηκε σε αυτή τη συσκευή",
      "setup.reset": "Διαγραφή του δικού μου app key",
      "connect.title": "Δες εδώ όλο το Dropbox σου",
      "connect.body":  "Περιηγήσου σε κάθε φάκελο του Dropbox, δες προεπισκόπηση και κατέβασε αντίγραφα. Τα αρχεία πηγαίνουν κατευθείαν από αυτόν τον browser στο Dropbox, χωρίς κανέναν server του orOS στη μέση.",
      "connect.note":  "Το orOS ζητά από το Dropbox να διαβάζει τα αρχεία σου και, για τη μεταφορά αρχείων στον κρυπτογραφημένο δίσκο, να αφαιρεί τα πρωτότυπα. Η σύνδεση μένει σε αυτή τη συσκευή.",
      "connect.go":    "Σύνδεση με Dropbox",
      "connect.wait":  "Ολοκλήρωσε τη σύνδεση στο παράθυρο του Dropbox…",
      "connected":   "Το Dropbox συνδέθηκε",
      "denied":      "Η σύνδεση με το Dropbox ακυρώθηκε",
      "failed":      "Η σύνδεση με το Dropbox απέτυχε. Δοκίμασε ξανά.",
      "offline":     "Δεν υπάρχει σύνδεση στο διαδίκτυο",
      "noCrypto":    "Αυτός ο browser δεν μπορεί να κρατήσει με ασφάλεια τη σύνδεση με το Dropbox.",
      "err.auth":    "Η σύνδεση με το Dropbox έληξε. Συνδέσου ξανά.",
      "err.scope":   "Στην εφαρμογή Dropbox λείπει μια άδεια (files.metadata.read, files.content.read).",
      "err.busy":    "Το Dropbox είναι απασχολημένο. Δοκίμασε ξανά σε ένα λεπτό.",
      "err.notfound":"Αυτός ο φάκελος δεν υπάρχει πια στο Dropbox.",
      "err.net":     "Δεν ήταν δυνατή η επικοινωνία με το Dropbox.",
      "retry":       "Δοκίμασε ξανά",
      "sync.title":  "Φάκελος συγχρονισμού του orOS",
      "sync.body":   "Αυτός είναι ο φάκελος του συγχρονισμού του orOS. Όλα μέσα του είναι κρυπτογραφημένα και τα διαβάζει μόνο ο συγχρονισμός, γι' αυτό δεν εμφανίζονται εδώ.",
      "pv.download": "Λήψη",
      "pv.close":    "Κλείσιμο προεπισκόπησης",
      "pv.none":     "Δεν υπάρχει προεπισκόπηση για αυτό το αρχείο. Κατέβασέ το για να το ανοίξεις.",
      "pv.big":      "Το αρχείο είναι πολύ μεγάλο για προεπισκόπηση ({n}). Κατέβασέ το.",
      "pv.fail":     "Το αρχείο δεν διαβάστηκε από το Dropbox.",
      "pv.notUtf8":  "Το αρχείο δεν είναι κείμενο UTF-8. Κατέβασέ το για να το ανοίξεις.",
      "pv.noDl":     "Το Dropbox δεν επιτρέπει τη λήψη αυτού του αρχείου (π.χ. έγγραφο Paper).",
      "dl.started":  "Ξεκίνησε η λήψη",
      "dl.fail":     "Η λήψη απέτυχε",
      "disk":        "Αρχεία",
      "sel.n":       "{n} επιλεγμένα",
      "sel.all":     "Επιλογή όλων",
      "sel.one":     "Επιλογή",
      "sel.clear":   "Καθαρισμός επιλογής",
      "x.copy":      "Αντιγραφή στον δίσκο orOS",
      "x.move":      "Μεταφορά στον δίσκο orOS",
      "x.copyTitle": "Αντιγραφή στον δίσκο του orOS",
      "x.moveTitle": "Μεταφορά στον δίσκο του orOS",
      "x.copyOk":    "Αντιγραφή εδώ",
      "x.moveOk":    "Μεταφορά εδώ",
      "x.gather":    "Συλλογή αρχείων…",
      "x.none":      "Δεν υπάρχει κάτι για μεταφορά.",
      "x.confirmCopy": "Αντιγραφή {n} αρχείων ({size}) στο «{dst}»;",
      "x.confirmMove": "Μεταφορά {n} αρχείων ({size}) στο «{dst}»;",
      "x.moveNote":  "Κάθε πρωτότυπο πηγαίνει στα διαγραμμένα του Dropbox (επαναφέρεται από εκεί για 30 ημέρες) μόνο αφού επιβεβαιωθεί το κρυπτογραφημένο αντίγραφό του στον συγχρονισμό του orOS. Ό,τι δεν επιβεβαιωθεί μένει στο Dropbox.",
      "x.skipped":   "{n} στοιχεία μένουν εκτός (ο φάκελος συγχρονισμού του orOS, αρχεία που το Dropbox δεν αφήνει να κατέβουν, αρχεία πάνω από 300 MB, ή πέρα από το όριο των 1000 αρχείων / 1 GB ανά μεταφορά).",
      "x.go":        "Έναρξη",
      "x.cancel":    "Άκυρο",
      "x.stop":      "Διακοπή",
      "x.copying":   "Αντιγραφή {i} από {n}…",
      "x.waiting":   "Αναμονή για να αποθηκεύσει ο συγχρονισμός τα κρυπτογραφημένα αντίγραφα…",
      "x.deleting":  "Αφαίρεση των πρωτοτύπων από το Dropbox…",
      "x.copied":    "Αντιγράφηκαν {n} αρχεία στον δίσκο του orOS",
      "x.moved":     "Μεταφέρθηκαν {n} αρχεία στον δίσκο του orOS",
      "x.kept":      "{n} πρωτότυπα μένουν στο Dropbox (δεν επιβεβαιώθηκε το κρυπτογραφημένο αντίγραφο ή άλλαξαν στο μεταξύ)",
      "x.failed":    "{n} αρχεία δεν αντιγράφηκαν",
      "x.stopped":   "Διακόπηκε. Όσα αρχεία αντιγράφηκαν μένουν στον δίσκο· κανένα πρωτότυπο δεν αφαιρέθηκε.",
      "x.needSync":  "Η μεταφορά χρειάζεται τον συγχρονισμό του orOS συνδεδεμένο και ξεκλείδωτο, ώστε να υπάρχει το κρυπτογραφημένο αντίγραφο πριν αφαιρεθεί το πρωτότυπο. Η αντιγραφή δουλεύει και χωρίς αυτόν.",
      "x.busy":      "Μια μεταφορά είναι ήδη σε εξέλιξη.",
      "x.resume":    "Μια αντιγραφή ή μεταφορά στον δίσκο του orOS διακόπηκε.",
      "x.resumeGo":  "Συνέχεια",
      "x.resumeDrop":"Απόρριψη"
    }
  };

  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    Object.keys(vars || {}).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  var ICON = {
    box:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 2 1 5.3l5 3.2 5-3.2L6 2zm12 0-5 3.3 5 3.2 5-3.2L18 2zM1 11.7l5 3.2 5-3.2-5-3.2-5 3.2zm17-3.2-5 3.2 5 3.2 5-3.2-5-3.2zM6 16.1l5 3.2 5-3.2-5-3.2-5 3.2z"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>',
    user: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  // ---------- state ----------
  var ctx = null;
  var active = false;
  var cwd = "";
  var rows = [];               // current listing (or search results)
  var query = null;            // active search text, or null
  var renderToken = 0;
  var sortField = "name", sortAsc = true;
  var tok;                     // undefined = not read; null = none; record
  var waiting = false;         // popup sign-in running
  var refreshing = null;       // single-flight refresh promise
  var pvUrl = null;
  var sel = {};                // lower path → row (selection in the list)
  var shown = [];              // rows on screen, in order
  var jobRunning = false;
  var stopAsked = false;

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
    if (title) { b.title = title; b.setAttribute("aria-label", title); }
    b.addEventListener("click", fn);
    return b;
  }
  function readJSON(k) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v && typeof v === "object" ? v : null; }
    catch (e) { return null; }
  }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function toast(s) { if (ctx && ctx.toast) ctx.toast(s); }

  function ownKey() {
    var k = "";
    try { k = localStorage.getItem(KEY_LS) || ""; } catch (e) {}
    return C.validKey(k) ? k : "";
  }
  function appKey() { return ownKey() || (C.validKey(C.APP_KEY) ? C.APP_KEY : ""); }

  function syncRoots() {
    try { var a = JSON.parse(localStorage.getItem(SYNC_LS) || "[]"); return Array.isArray(a) ? a.filter(function (s) { return typeof s === "string"; }) : []; }
    catch (e) { return []; }
  }
  function addSyncRoot(lower) {
    var a = syncRoots();
    if (a.indexOf(lower) >= 0) return;
    a.push(lower);
    try { localStorage.setItem(SYNC_LS, JSON.stringify(a.slice(-20))); } catch (e) {}
  }

  function saveView() { writeJSON(VIEW_LS, { on: active, path: cwd }); }

  // ---------- sealed token (IndexedDB, non-extractable key) ----------
  function idb(store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("keys")) d.createObjectStore("keys");
        if (!d.objectStoreNames.contains("creds")) d.createObjectStore("creds");
      };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var d = req.result, res;
        var tx = d.transaction(store, mode);
        var r = fn(tx.objectStore(store));
        if (r) r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { d.close(); resolve(res); };
        tx.onerror = tx.onabort = function () { d.close(); reject(tx.error); };
      };
    });
  }
  function deviceKey() {
    return idb("keys", "readonly", function (s) { return s.get("device"); }).then(function (k) {
      if (k) return k;
      return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (nk) {
        return idb("keys", "readwrite", function (s) { s.put(nk, "device"); }).then(function () { return nk; });
      });
    });
  }
  function saveTok(rec) {
    return deviceKey().then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(JSON.stringify(rec)))
        .then(function (sealed) { return idb("creds", "readwrite", function (s) { s.put({ iv: iv.buffer, data: sealed }, "dropbox"); }); })
        .then(function () { tok = rec; });
    });
  }
  function readTok() {
    if (tok !== undefined) return Promise.resolve(tok);
    if (typeof indexedDB === "undefined" || !window.crypto || !crypto.subtle) { tok = null; return Promise.resolve(null); }
    return idb("creds", "readonly", function (s) { return s.get("dropbox"); }).then(function (rec) {
      if (!rec) return null;
      return deviceKey().then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data);
      }).then(function (plain) {
        var j = JSON.parse(new TextDecoder().decode(plain));
        if (!j || typeof j.access !== "string" || !C.validKey(j.key)) return null;
        return { access: j.access, refresh: typeof j.refresh === "string" ? j.refresh : "",
                 exp: +j.exp || 0, key: j.key, who: typeof j.who === "string" ? j.who : "" };
      });
    }).catch(function () { return null; }).then(function (r) { tok = r; return r; });
  }
  function dropTok() {
    tok = null;
    return idb("creds", "readwrite", function (s) { s.delete("dropbox"); }).catch(function () {});
  }

  // ---------- network ----------
  function fail(kind) { var e = new Error(kind); e.kind = kind; return e; }

  function accessToken(force) {
    return readTok().then(function (r) {
      if (!r) throw fail("auth");
      if (!force && r.access && r.exp > Date.now()) return r.access;
      if (!r.refresh) { dropTok(); throw fail("auth"); }
      if (refreshing) return refreshing;
      refreshing = fetch(C.TOKEN_URL, {
        method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: r.refresh, client_id: r.key }).toString()
      }).then(function (res) {
        if (res.status === 400 || res.status === 401) { dropTok(); throw fail("auth"); }
        if (!res.ok) throw fail(C.errorKind(res.status, null));
        return res.json();
      }, function () { throw fail(navigator.onLine === false ? "offline" : "net"); }).then(function (j) {
        var n = C.tokenOf(j, Date.now());
        if (!n) throw fail("net");
        var rec = { access: n.access, refresh: n.refresh || r.refresh, exp: n.exp, key: r.key, who: r.who };
        return saveTok(rec).then(function () { return rec.access; });
      });
      refreshing.then(clearRefresh, clearRefresh);
      return refreshing;
    });
  }
  function clearRefresh() { refreshing = null; }

  // One Dropbox call. send(token) → fetch promise. A stale token is
  // refreshed once; every failure becomes an Error with .kind.
  function call(send, retried) {
    if (navigator.onLine === false) return Promise.reject(fail("offline"));
    return accessToken(!!retried).then(function (at) {
      return send(at).then(null, function () { throw fail(navigator.onLine === false ? "offline" : "net"); });
    }).then(function (res) {
      if (res.ok) return res;
      return res.json().then(null, function () { return null; }).then(function (body) {
        var kind = C.errorKind(res.status, body);
        if (kind === "expired" && !retried) return call(send, true);
        if (kind === "expired" || kind === "auth") { dropTok(); throw fail("auth"); }
        throw fail(kind);
      });
    });
  }

  function rpc(endpoint, args) {
    return call(function (at) {
      return fetch(C.RPC + endpoint, {
        method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { Authorization: "Bearer " + at, "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
    }).then(function (res) { return res.json(); });
  }

  function download(path) {
    return call(function (at) {
      return fetch(C.CONTENT + "files/download", {
        method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { Authorization: "Bearer " + at, "Dropbox-API-Arg": C.headerArg({ path: path }) }
      });
    }).then(function (res) { return res.blob(); });
  }

  function listFolder(path) {
    var out = [];
    function page(j, n) {
      out = out.concat(C.mapList(j && j.entries));
      if (j && j.has_more && typeof j.cursor === "string" && n < LIST_PAGES) {
        return rpc("files/list_folder/continue", { cursor: j.cursor }).then(function (k) { return page(k, n + 1); });
      }
      return out;
    }
    return rpc("files/list_folder", { path: path, limit: 2000, include_non_downloadable_files: true })
      .then(function (j) { return page(j, 1); });
  }

  function searchFiles(q, path) {
    var options = { max_results: 100, file_status: "active", filename_only: true };
    if (path) options.path = path;
    return rpc("files/search_v2", { query: q.slice(0, 200), options: options }).then(function (j) {
      var raw = [];
      ((j && j.matches) || []).forEach(function (m) {
        var md = m && m.metadata;
        if (md && md[".tag"] === "metadata" && md.metadata) raw.push(md.metadata);
      });
      return C.mapList(raw);
    });
  }

  // ---------- sign-in ----------
  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomStr(n) { return b64url(crypto.getRandomValues(new Uint8Array(n))).slice(0, n); }
  function redirectUri() {
    var u = new URL("dropbox-callback.html", location.href);
    return u.origin + u.pathname;
  }

  function connect() {
    var key = appKey();
    if (!key) { render(); return; }
    if (navigator.onLine === false) { toast(t("offline")); return; }
    if (!window.crypto || !crypto.subtle || typeof indexedDB === "undefined") { toast(t("noCrypto")); return; }
    var verifier = randomStr(64), state = randomStr(24), redirect = redirectUri();
    // Open the popup inside the click, point it at Dropbox afterwards.
    var w = null;
    try { w = window.open("about:blank", "oros-dropbox-auth", "popup,width=560,height=760"); } catch (e) { w = null; }
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then(function (buf) {
      var url = C.authorizeUrl({ key: key, redirect: redirect, state: state, challenge: b64url(new Uint8Array(buf)) });
      writeJSON(PKCE_LS, { state: state, verifier: verifier, redirect: redirect, key: key, mode: w ? "popup" : "redirect", t: Date.now() });
      del(CB_LS);
      if (w) {
        try { w.opener = null; } catch (e) {}
        w.location.href = url;
        waiting = true;
        render();
        return;
      }
      active = true; saveView();
      var top = window;
      try { if (window.top && window.top.location.origin === location.origin) top = window.top; } catch (e) {}
      top.location.assign(url);
    }).catch(function () { if (w) try { w.close(); } catch (e) {} toast(t("failed")); });
  }

  function takeCallback(cb) {
    if (!cb || typeof cb !== "object") return Promise.resolve(false);
    var p = readJSON(PKCE_LS);
    if (!p || !cb.state || p.state !== cb.state || Date.now() - (p.t || 0) > PKCE_MAX_MS || !C.validKey(p.key)) return Promise.resolve(false);
    del(PKCE_LS);
    del(CB_LS);
    waiting = false;
    if (cb.error || !cb.code) {
      toast(t(cb.error === "access_denied" ? "denied" : "failed"));
      if (active) render();
      return Promise.resolve(false);
    }
    return fetch(C.TOKEN_URL, {
      method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: String(cb.code), code_verifier: p.verifier,
                                  redirect_uri: p.redirect, client_id: p.key }).toString()
    }).then(function (r) {
      if (!r.ok) throw new Error("failed");
      return r.json();
    }).then(function (j) {
      var n = C.tokenOf(j, Date.now());
      if (!n) throw new Error("failed");
      return saveTok({ access: n.access, refresh: n.refresh, exp: n.exp, key: p.key, who: "" });
    }).then(function () {
      return rpc("users/get_current_account", null).then(function (a) {
        var who = a && a.name && typeof a.name.display_name === "string" ? C.cleanName(a.name.display_name).slice(0, 80) : "";
        if (who && tok) { var rec = tok; rec.who = who; return saveTok(rec); }
      }, function () {});
    }).then(function () {
      toast(t("connected"));
      if (active) go(cwd); else enter("");
      return true;
    }).catch(function () {
      toast(t("failed"));
      if (active) render();
      return false;
    });
  }
  function finishPending() { return takeCallback(readJSON(CB_LS)); }

  function disconnect() {
    readTok().then(function (r) {
      dropTok();
      if (r) {
        fetch(C.RPC + "auth/token/revoke", { method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
                                             headers: { Authorization: "Bearer " + r.access } }).catch(function () {});
      }
      rows = []; query = null; cwd = "";
      saveView();
      toast(t("disconnected"));
      render();
    });
  }

  // ---------- view ----------
  function ensurePanel() {
    if ($("dbx-panel")) return;
    var bar = el("div", "dbx-bar");
    bar.id = "dbx-bar";
    bar.appendChild(btn("tool", ICON.up, t("up"), function () { if (cwd) go(C.parentPath(cwd)); }));
    var crumbsNav = el("nav", "dbx-crumbs");
    crumbsNav.id = "dbx-crumbs";
    bar.appendChild(crumbsNav);
    bar.appendChild(btn("tool", ICON.refresh, t("refresh"), function () { if (query !== null) runSearch(query); else go(cwd); }));
    var acct = btn("tool", ICON.user, t("account"), function (ev) { ev.stopPropagation(); accountMenu(acct); });
    acct.id = "dbx-acct";
    bar.appendChild(acct);
    var host = $("bar");
    if (host) host.appendChild(bar);

    var panel = el("section", "dbx-panel");
    panel.id = "dbx-panel";
    var sb = el("div", "search-bar dbx-search");
    var ic = el("span", "search-ic");
    ic.innerHTML = ICON.search;
    sb.appendChild(ic);
    var inp = el("input");
    inp.type = "text";
    inp.id = "dbx-q";
    inp.placeholder = t("search");
    inp.setAttribute("aria-label", t("search"));
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var q = inp.value.trim(); if (q) runSearch(q); else clearSearch(); }
      else if (e.key === "Escape") { inp.value = ""; clearSearch(); }
    });
    inp.addEventListener("input", function () { if (!inp.value.trim() && query !== null) clearSearch(); });
    sb.appendChild(inp);
    sb.appendChild(btn("dbx-qx", ICON.x, t("searchClear"), function () { inp.value = ""; clearSearch(); }));
    panel.appendChild(sb);

    var hdr = el("div", "entry-list-header");
    hdr.id = "dbx-head";
    var all = el("button", "dbx-check");
    all.type = "button";
    all.id = "dbx-all";
    all.setAttribute("role", "checkbox");
    all.setAttribute("aria-checked", "false");
    all.setAttribute("aria-label", t("sel.all"));
    all.title = t("sel.all");
    all.addEventListener("click", function () {
      var every = shown.length && shown.every(function (r) { return sel[r.lower]; });
      sel = {};
      if (!every) shown.forEach(function (r) { if (!locked(r)) sel[r.lower] = r; });
      paintSel();
    });
    hdr.appendChild(all);
    [["col.name", "name"], ["col.size", "size"], ["col.date", "date"]].forEach(function (c) {
      var th = el("button", "col-th");
      th.type = "button";
      th.dataset.field = c[1];
      th.appendChild(el("span", "col-th-label", t(c[0])));
      th.appendChild(el("span", "sort-ind"));
      th.addEventListener("click", function () {
        if (sortField === c[1]) sortAsc = !sortAsc; else { sortField = c[1]; sortAsc = true; }
        paintRows();
      });
      hdr.appendChild(th);
    });
    panel.appendChild(hdr);

    var ul = el("ul", "dbx-list");
    ul.id = "dbx-entries";
    panel.appendChild(ul);
    var msg = el("div", "dbx-msg");
    msg.id = "dbx-msg";
    msg.hidden = true;
    panel.appendChild(msg);

    // Selection bar: copy / move the selection into the orOS disk.
    var sb2 = el("div", "dbx-selbar");
    sb2.id = "dbx-selbar";
    sb2.hidden = true;
    sb2.appendChild(el("span", "dbx-seln"));
    var sp = el("span", "spacer");
    sb2.appendChild(sp);
    [["x.copy", "copy", ""], ["x.move", "move", "primary"]].forEach(function (b) {
      var x = el("button", "pv-btn " + b[2], t(b[0]));
      x.type = "button";
      x.dataset.mode = b[1];
      x.addEventListener("click", function () { transfer(b[1], selectedRows()); });
      sb2.appendChild(x);
    });
    sb2.appendChild(btn("pv-x", ICON.x, t("sel.clear"), function () { sel = {}; paintSel(); }));
    panel.appendChild(sb2);

    // Transfer progress.
    var jb = el("div", "dbx-job");
    jb.id = "dbx-job";
    jb.hidden = true;
    jb.appendChild(el("span", "dbx-job-text"));
    var stop = el("button", "pv-btn", t("x.stop"));
    stop.type = "button";
    stop.addEventListener("click", function () { stopAsked = true; stop.disabled = true; });
    jb.appendChild(stop);
    panel.appendChild(jb);
    var st = el("div", "dbx-status");
    st.id = "dbx-status";
    panel.appendChild(st);

    var split = $("split");
    if (split) split.appendChild(panel);
  }

  var acctMenu = null;
  function closeAccountMenu() {
    if (acctMenu) { acctMenu.remove(); acctMenu = null; document.removeEventListener("click", closeAccountMenu); }
  }
  function accountMenu(anchor) {
    if (acctMenu) { closeAccountMenu(); return; }
    readTok().then(function (r) {
      if (!r) return;
      acctMenu = el("div", "dbx-menu");
      acctMenu.setAttribute("role", "menu");
      if (r.who) acctMenu.appendChild(el("div", "dbx-menu-who", r.who));
      var b = el("button", "", t("disconnect"));
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", function () { closeAccountMenu(); disconnect(); });
      acctMenu.appendChild(b);
      var rc = anchor.getBoundingClientRect();
      acctMenu.style.top = Math.round(rc.bottom + 4) + "px";
      acctMenu.style.right = Math.max(8, Math.round(window.innerWidth - rc.right)) + "px";
      document.body.appendChild(acctMenu);
      setTimeout(function () { document.addEventListener("click", closeAccountMenu); }, 0);
    });
  }

  function setMode(on) {
    active = on;
    document.body.classList.toggle("dbx-mode", on);
    saveView();
  }

  // Message area: title, text, optional buttons/extra nodes.
  function showMsg(title, body, extra) {
    var m = $("dbx-msg");
    $("dbx-entries").innerHTML = "";
    m.innerHTML = "";
    m.hidden = false;
    if (title) m.appendChild(el("strong", "", title));
    if (body) m.appendChild(el("p", "", body));
    (extra || []).forEach(function (n) { m.appendChild(n); });
    $("dbx-head").hidden = true;
    $("dbx-entries").hidden = true;
    $("dbx-status").textContent = "";
  }
  function hideMsg() { $("dbx-msg").hidden = true; $("dbx-head").hidden = false; $("dbx-entries").hidden = false; }

  function primary(label, fn) {
    var b = el("button", "pv-btn primary", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function ownKeyForm() {
    var box = el("details", "dbx-own");
    if (!appKey()) box.open = true;
    box.appendChild(el("summary", "", t("setup.own")));
    box.appendChild(el("p", "", t("setup.steps")));
    var uri = el("code", "dbx-uri", redirectUri());
    box.appendChild(uri);
    var row = el("div", "dbx-own-row");
    var inp = el("input");
    inp.type = "text";
    inp.placeholder = t("setup.key");
    inp.setAttribute("aria-label", t("setup.key"));
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.maxLength = 32;
    inp.value = ownKey();
    row.appendChild(inp);
    var save = el("button", "pv-btn", t("setup.save"));
    save.type = "button";
    save.addEventListener("click", function () {
      var k = inp.value.trim();
      if (!C.validKey(k)) { toast(t("setup.bad")); return; }
      try { localStorage.setItem(KEY_LS, k); } catch (e) {}
      toast(t("setup.saved"));
      render();
    });
    row.appendChild(save);
    box.appendChild(row);
    if (ownKey()) {
      var forget = el("button", "dbx-link", t("setup.reset"));
      forget.type = "button";
      forget.addEventListener("click", function () { del(KEY_LS); render(); });
      box.appendChild(forget);
    }
    return box;
  }

  function paintCrumbs() {
    var nav = $("dbx-crumbs");
    nav.innerHTML = "";
    var list = C.crumbs(cwd);
    list.forEach(function (c, i) {
      if (i) nav.appendChild(el("span", "crumb-sep", "/"));
      var last = i === list.length - 1;
      var b = el("button", "crumb" + (last ? " current" : ""), i ? c.name : t("tree"));
      b.type = "button";
      if (!last) b.addEventListener("click", function () { go(c.path); });
      nav.appendChild(b);
    });
    var up = $("dbx-bar").firstChild;
    if (up) up.disabled = !cwd;
  }

  function render() {
    if (!active) return;
    ensurePanel();
    paintCrumbs();
    closeAccountMenu();
    readTok().then(function (r) {
      if (!active) return;
      $("dbx-acct").hidden = !r;
      $("dbx-q").parentNode.hidden = !r;
      if (!r) {
        if (!appKey()) {
          showMsg(t("setup.title"), t("setup.body"), [ownKeyForm()]);
          return;
        }
        var go1 = primary(waiting ? t("connect.wait") : t("connect.go"), connect);
        go1.disabled = waiting;
        showMsg(t("connect.title"), t("connect.body"), [go1, el("p", "dbx-note", t("connect.note")), ownKeyForm()]);
        return;
      }
      if (offerResume()) return;
      if (query !== null) runSearch(query); else load();
    });
  }

  function load() {
    var my = ++renderToken;
    if (C.isUnder(cwd, syncRoots())) { showSyncNotice(); return; }
    hideMsg();
    $("dbx-entries").innerHTML = "";
    $("dbx-status").textContent = t("loading");
    listFolder(cwd).then(function (list) {
      if (my !== renderToken || !active) return;
      if (C.isSyncFolder(list)) {
        addSyncRoot(cwd.toLowerCase());
        showSyncNotice();
        return;
      }
      rows = list;
      paintRows();
    }, function (e) {
      if (my !== renderToken || !active) return;
      showError(e);
    });
  }

  function showSyncNotice() {
    rows = [];
    var lock = el("span", "dbx-lock");
    lock.innerHTML = ICON.lock;
    showMsg(t("sync.title"), t("sync.body"), [lock]);
  }

  function showError(e) {
    var kind = (e && e.kind) || "net";
    if (kind === "auth") { tok = null; render(); toast(t("err.auth")); return; }
    if (kind === "offline") { showMsg("", t("offline"), [primary(t("retry"), function () { go(cwd); })]); return; }
    showMsg("", t("err." + kind) === "err." + kind ? t("err.net") : t("err." + kind),
            [primary(t("retry"), function () { if (query !== null) runSearch(query); else go(cwd); })]);
  }

  function fmtSize(r) { return r.dir ? "-" : (ctx && ctx.fmtKB ? ctx.fmtKB(r.size || 0) : String(r.size)); }
  function fmtDate(r) {
    if (r.dir || !r.mtime) return "-";
    try {
      return new Date(r.mtime).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
    } catch (e) { return "-"; }
  }

  function locked(r) { return C.isUnder(r.path, syncRoots()); }

  function selectedRows() {
    return Object.keys(sel).map(function (k) { return sel[k]; });
  }

  function paintSel() {
    var n = Object.keys(sel).length;
    [].forEach.call(document.querySelectorAll("#dbx-entries .entry"), function (li) {
      var on = !!sel[li.dataset.lower];
      li.classList.toggle("selected", on);
      var c = li.querySelector(".dbx-check");
      if (c) c.setAttribute("aria-checked", on ? "true" : "false");
    });
    var all = $("dbx-all");
    if (all) all.setAttribute("aria-checked", n && shown.length && shown.every(function (r) { return sel[r.lower] || locked(r); }) ? "true" : (n ? "mixed" : "false"));
    var bar = $("dbx-selbar");
    if (!bar) return;
    bar.hidden = !n || jobRunning;
    bar.querySelector(".dbx-seln").textContent = t("sel.n", { n: n });
  }

  function paintRows() {
    hideMsg();
    var ul = $("dbx-entries");
    ul.innerHTML = "";
    var roots = syncRoots();
    var list = C.sortRows(rows.filter(function (r) { return query === null || !C.isUnder(r.path, roots); }), sortField, sortAsc, LANG);
    [].forEach.call($("dbx-head").querySelectorAll(".col-th"), function (th) {
      var on = th.dataset.field === sortField;
      th.classList.toggle("sorted", on);
      th.querySelector(".sort-ind").textContent = on ? (sortAsc ? " ▲" : " ▼") : "";
    });
    shown = list;
    list.forEach(function (r) {
      var li = el("li", "entry" + (query !== null ? " search-result" : "") + (sel[r.lower] ? " selected" : ""));
      li.tabIndex = 0;
      li.dataset.lower = r.lower;
      var isLocked = locked(r);
      var ck = el("button", "dbx-check");
      ck.type = "button";
      ck.setAttribute("role", "checkbox");
      ck.setAttribute("aria-checked", sel[r.lower] ? "true" : "false");
      ck.setAttribute("aria-label", t("sel.one") + ": " + r.name);
      ck.disabled = isLocked;
      ck.addEventListener("click", function (e) {
        e.stopPropagation();
        if (sel[r.lower]) delete sel[r.lower]; else sel[r.lower] = r;
        paintSel();
      });
      li.appendChild(ck);
      var g = el("span", "glyph " + (r.dir ? "folder" : "file"));
      g.innerHTML = isLocked ? ICON.lock : (r.dir ? ICON.folder : ICON.file);
      li.appendChild(g);
      li.appendChild(el("span", "ename col-name", r.name));
      if (query !== null) {
        li.appendChild(el("span", "subpath", C.parentPath(r.path) || "/"));
      } else {
        li.appendChild(el("span", "col-size", fmtSize(r)));
        li.appendChild(el("span", "col-date", fmtDate(r)));
      }
      li.addEventListener("click", function () { activate(r); });
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); activate(r); }
        else if (e.key === " " && !isLocked) { e.preventDefault(); ck.click(); }
      });
      ul.appendChild(li);
    });
    paintSel();
    var n = list.length;
    $("dbx-status").textContent = query !== null
      ? (n ? t("results", { n: n }) : t("noResults"))
      : (n === 1 ? t("oneItem") : t("items", { n: n }));
    $("dbx-head").hidden = query !== null;
    if (!n && query === null) showMsg("", t("empty"));
  }

  function activate(r) {
    if (r.dir) {
      if (query !== null) { $("dbx-q").value = ""; query = null; }
      go(r.path);
    } else {
      preview(r);
    }
  }

  function go(path) {
    sel = {};
    var p = C.normPath(path);
    cwd = p === null ? "" : p;
    saveView();
    if (!active) return;
    paintCrumbs();
    render();
  }

  function runSearch(q) {
    if (query !== q) sel = {};
    query = q;
    var my = ++renderToken;
    hideMsg();
    $("dbx-entries").innerHTML = "";
    $("dbx-status").textContent = t("loading");
    searchFiles(q, cwd).then(function (list) {
      if (my !== renderToken || !active) return;
      rows = list;
      paintRows();
    }, function (e) {
      if (my !== renderToken || !active) return;
      showError(e);
    });
  }
  function clearSearch() {
    if (query === null) return;
    query = null;
    go(cwd);
  }

  // ---------- preview + download ----------
  function closePreview() {
    var o = $("dbx-pv");
    if (o) o.remove();
    if (pvUrl) { URL.revokeObjectURL(pvUrl); pvUrl = null; }
    document.removeEventListener("keydown", pvKey);
  }
  function pvKey(e) { if (e.key === "Escape") closePreview(); }

  function preview(r) {
    closePreview();
    var o = el("div");
    o.id = "dbx-pv";
    o.setAttribute("role", "dialog");
    var head = el("div", "pv-head");
    var info = el("div", "pv-info");
    info.appendChild(el("strong", "", r.name));
    info.appendChild(el("span", "pv-meta", (C.parentPath(r.path) || "/") + " · " + fmtSize(r) +
      (r.mtime ? " · " + new Date(r.mtime).toLocaleString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "")));
    head.appendChild(info);
    var acts = el("div", "pv-actions");
    acts.id = "dbx-pv-acts";
    if (r.dl) {
      [["x.copy", "copy"], ["x.move", "move"]].forEach(function (b) {
        var x = el("button", "pv-btn dbx-pv-x", t(b[0]));
        x.type = "button";
        x.addEventListener("click", function () { closePreview(); transfer(b[1], [r]); });
        acts.appendChild(x);
      });
      var d = el("button", "pv-btn primary", t("pv.download"));
      d.type = "button";
      d.addEventListener("click", function () { save(r); });
      acts.appendChild(d);
    }
    head.appendChild(acts);
    head.appendChild(btn("pv-x", ICON.x, t("pv.close"), closePreview));
    var body = el("div", "pv-body");
    body.id = "dbx-pv-body";
    o.appendChild(head);
    o.appendChild(body);
    o.addEventListener("click", function (e) { if (e.target === o) closePreview(); });
    document.body.appendChild(o);
    document.addEventListener("keydown", pvKey);

    function msg(s) { body.innerHTML = ""; body.appendChild(el("div", "pv-msg", s)); }
    if (!r.dl) { msg(t("pv.noDl")); return; }
    var img = ctx && ctx.isImageExt && ctx.isImageExt(r.name);
    var txt = ctx && ctx.isTextExt && ctx.isTextExt(r.name);
    if (!img && !txt) { msg(t("pv.none")); return; }
    if (r.size > (img ? PV_IMAGE : PV_TEXT)) { msg(t("pv.big", { n: fmtSize(r) })); return; }
    body.appendChild(el("div", "pv-loading", t("loading")));
    download(r.path).then(function (blob) {
      if (!$("dbx-pv") || $("dbx-pv") !== o) return;
      if (img) {
        pvUrl = URL.createObjectURL(blob);
        body.innerHTML = "";
        var im = el("img", "pv-img");
        im.alt = "";
        im.src = pvUrl;
        body.appendChild(im);
        return;
      }
      return blob.arrayBuffer().then(function (buf) {
        var s;
        try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { msg(t("pv.notUtf8")); return; }
        body.innerHTML = "";
        body.appendChild(el("pre", "", s));
      });
    }).catch(function (e) {
      if (e && e.kind === "auth") { closePreview(); showError(e); return; }
      msg(t("pv.fail"));
    });
  }

  function save(r) {
    var ext = (r.name.lastIndexOf(".") > 0) ? r.name.slice(r.name.lastIndexOf(".") + 1).toLowerCase() : "";
    var mime = ctx && ctx.mimeFor ? ctx.mimeFor(r.name) : "application/octet-stream";
    download(r.path).then(function (blob) {
      var dlg = ctx && ctx.dialogHost ? ctx.dialogHost() : null;
      if (dlg && typeof dlg.saveFile === "function") {
        var opts = { blob: blob, filename: r.name, mime: mime };
        if (ext && /^[a-z0-9]{1,10}$/.test(ext)) {
          var accept = {};
          accept[mime] = ["." + ext];
          opts.types = [{ description: ext.toUpperCase() + " file", accept: accept }];
        }
        return dlg.saveFile(opts).then(function (res) { if (res && res.ok) toast(t("dl.started")); });
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = r.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
      toast(t("dl.started"));
    }).catch(function () { toast(t("dl.fail")); });
  }

  // ---------- Wave 2: copy / move into the orOS disk ----------
  // The disk is the encrypted area: Vault Drive syncs every file of it
  // through orOS sync, sealed with the user's passphrase. A copy is a
  // download from Dropbox written to the disk (fs.js tells the vault).
  // A MOVE also removes the Dropbox original, and only when its
  // encrypted copy is confirmed: the vault's synced manifest holds the
  // destination with the same SHA-256 and nothing for it is queued
  // (OrosDropboxCore.confirmedCopy). The removal is conditional on the
  // rev that was copied (delete_v2 parent_rev) and lands in Dropbox's
  // deleted files. Every step is saved in JOB_LS, so an interrupted
  // transfer continues without duplicates or loses nothing.
  //   job = { mode, dest, folders: [path], items: [{ src, rev, hash,
  //           size, rel, dst?, h?, st: "todo"|"copied"|"failed"|
  //           "deleted"|"kept" }], t }
  var VAULT_WAIT_MS = 5 * 60 * 1000;

  function vault() { try { return ctx && ctx.vault ? ctx.vault() : null; } catch (e) { return null; } }
  function vaultUsable() {
    var v = vault();
    try { return !!(v && v.status().usable); } catch (e) { return false; }
  }
  function disk() { return ctx && ctx.fs ? ctx.fs() : null; }
  function saveJob(job) { writeJSON(JOB_LS, job); }
  function readJob() {
    var j = readJSON(JOB_LS);
    return j && (j.mode === "copy" || j.mode === "move") && typeof j.dest === "string" && Array.isArray(j.items) ? j : null;
  }
  function dropJob() { del(JOB_LS); }

  function sha256Hex(buf) {
    return crypto.subtle.digest("SHA-256", buf).then(function (h) {
      var b = new Uint8Array(h), x = "";
      for (var i = 0; i < b.length; i++) x += ("0" + b[i].toString(16)).slice(-2);
      return x;
    });
  }
  function digest(bytes) { return crypto.subtle.digest("SHA-256", bytes); }

  function listRecursive(path) {
    var out = [];
    function page(j, n) {
      out = out.concat(C.mapList(j && j.entries));
      if (j && j.has_more && typeof j.cursor === "string" && n < LIST_PAGES) {
        return rpc("files/list_folder/continue", { cursor: j.cursor }).then(function (k) { return page(k, n + 1); });
      }
      return out;
    }
    return rpc("files/list_folder", { path: path, recursive: true, limit: 2000 }).then(function (j) { return page(j, 1); });
  }

  function jobText(s) {
    var jb = $("dbx-job");
    if (!jb) return;
    jb.hidden = !s;
    jb.querySelector(".dbx-job-text").textContent = s || "";
  }

  // A small modal confirm (native <dialog>, textContent only).
  function confirmBox(lines, okText) {
    return new Promise(function (resolve) {
      var d = el("dialog", "f-dialog dbx-confirm");
      lines.forEach(function (l, i) { d.appendChild(el(i ? "p" : "h3", i ? "" : "", l)); });
      var row = el("div", "dlg-row");
      var no = el("button", "", t("x.cancel"));
      no.type = "button";
      var yes = el("button", "primary", okText);
      yes.type = "button";
      function done(v) { try { d.close(); } catch (e) {} d.remove(); resolve(v); }
      no.addEventListener("click", function () { done(false); });
      yes.addEventListener("click", function () { done(true); });
      d.addEventListener("cancel", function (e) { e.preventDefault(); done(false); });
      row.appendChild(no);
      row.appendChild(yes);
      d.appendChild(row);
      document.body.appendChild(d);
      d.showModal();
      yes.focus();
    });
  }

  function transfer(mode, picked) {
    if (jobRunning || readJob()) { toast(t("x.busy")); return; }
    picked = (picked || []).filter(function (r) { return !locked(r); });
    if (!picked.length) return;
    if (mode === "move" && !vaultUsable()) { toast(t("x.needSync")); return; }
    var fs = disk();
    if (!fs || !ctx.pickFolder) return;
    jobText(t("x.gather"));
    var listings = {};
    var folders = picked.filter(function (r) { return r.dir; });
    var chain = Promise.resolve();
    folders.forEach(function (f) {
      chain = chain.then(function () { return listRecursive(f.path).then(function (l) { listings[f.path] = l; }); });
    });
    chain.then(function () {
      jobText("");
      var plan = C.planItems(picked, listings, syncRoots());
      if (!plan.items.length) { toast(t("x.none")); return; }
      return ctx.pickFolder(t(mode === "move" ? "x.moveTitle" : "x.copyTitle"),
                            t(mode === "move" ? "x.moveOk" : "x.copyOk")).then(function (dest) {
        if (!dest) return;
        var lines = [t(mode === "move" ? "x.confirmMove" : "x.confirmCopy",
                       { n: plan.items.length, size: ctx.fmtKB(plan.bytes), dst: dest === ctx.diskRoot ? t("disk") : C.baseName(dest) })];
        if (mode === "move") lines.push(t("x.moveNote"));
        if (plan.skipped.length) lines.push(t("x.skipped", { n: plan.skipped.length }));
        return confirmBox(lines, t("x.go")).then(function (ok) {
          if (!ok) return;
          if (mode === "move" && !vaultUsable()) { toast(t("x.needSync")); return; }
          var job = { mode: mode, dest: dest, folders: folders.map(function (f) { return f.path; }), t: Date.now(),
                      items: plan.items.map(function (it) { it.st = "todo"; return it; }) };
          saveJob(job);
          sel = {};
          paintSel();
          return runJob(job);
        });
      });
    }).catch(function (e) {
      jobText("");
      showError(e);
    });
  }

  // One item: download, check, write to the disk (never over another file).
  function copyItem(job, it) {
    var fs = disk();
    var dir = job.dest + (it.rel.indexOf("/") > 0 ? "/" + it.rel.slice(0, it.rel.lastIndexOf("/")) : "");
    var name = it.rel.slice(it.rel.lastIndexOf("/") + 1);
    var blob, h;
    return download(it.src).then(function (b) {
      blob = b;
      return b.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      return (it.hash ? C.contentHash(bytes, digest) : Promise.resolve("")).then(function (ch) {
        if (it.hash && ch !== it.hash) throw fail("net");        // a damaged download never lands
        return sha256Hex(buf);
      });
    }).then(function (hex) {
      h = hex;
      // Resume: the planned destination may already hold this content.
      if (it.dst) {
        return fs.read(it.dst).then(function (b) { return b.arrayBuffer(); }).then(sha256Hex).then(function (have) {
          return have === h ? "same" : "other";
        }, function () { return "none"; });
      }
      return "none";
    }).then(function (state) {
      if (state === "same") return null;
      if (state === "none" && it.dst) return fs.write(it.dst, blob);
      return fs.mkdir(dir).then(null, function () {}).then(function () {
        return fs.ls(dir).then(function (l) { return (l || []).map(function (e) { return e.name; }); }, function () { return []; });
      }).then(function (taken) {
        it.dst = dir + "/" + C.uniqueName(name, taken);
        saveJob(job);                                  // the name is fixed before the write
        return fs.write(it.dst, blob);
      });
    }).then(function () {
      it.h = h;
      it.st = "copied";
      saveJob(job);
    });
  }

  // Wait until the vault has pushed every copied file (or give up).
  function waitVault(job) {
    var v = vault();
    var started = Date.now();
    function pending() {
      return job.items.some(function (it) { return it.st === "copied" && it.dst && v.isQueued(it.dst); });
    }
    function round() {
      if (stopAsked) return Promise.resolve(false);
      if (!vaultUsable()) return Promise.resolve(false);
      var st = v.status();
      if (!st.busy && !pending()) return Promise.resolve(true);
      if (Date.now() - started > VAULT_WAIT_MS) return Promise.resolve(false);
      var kick = st.busy ? Promise.resolve() : v.sync("files-dropbox").then(null, function () {});
      return kick.then(function () { return new Promise(function (r) { setTimeout(r, 1500); }); }).then(round);
    }
    // The vault queues each write after a short debounce: one sync first.
    return (v && typeof v.sync === "function" ? v.sync("files-dropbox").then(null, function () {}) : Promise.resolve()).then(round);
  }

  function removeOriginals(job) {
    var v = vault();
    var chain = Promise.resolve();
    job.items.forEach(function (it) {
      if (it.st !== "copied") return;
      chain = chain.then(function () {
        if (stopAsked) return;
        var entry = null, queued = true;
        try { entry = v.manifestEntry(it.dst); queued = v.isQueued(it.dst); } catch (e) {}
        if (!C.confirmedCopy(it, entry, queued) || !it.rev) { it.st = "kept"; saveJob(job); return; }
        return rpc("files/delete_v2", { path: it.src, parent_rev: it.rev }).then(function () {
          it.st = "deleted";
        }, function (e) {
          if (e && e.kind === "auth") throw e;
          it.st = e && e.kind === "notfound" ? "deleted" : "kept";   // gone already = nothing to keep
        }).then(function () { saveJob(job); });
      });
    });
    // A selected folder goes too, once no file is left anywhere in it.
    return chain.then(function () {
      var c2 = Promise.resolve();
      if (stopAsked) return c2;
      (job.folders || []).forEach(function (f) {
        var mine = job.items.filter(function (it) { return it.src.toLowerCase().indexOf(f.toLowerCase() + "/") === 0; });
        if (!mine.length || mine.some(function (it) { return it.st !== "deleted"; })) return;
        c2 = c2.then(function () {
          return listRecursive(f).then(function (l) {
            if (l.some(function (r) { return !r.dir; })) return;
            return rpc("files/delete_v2", { path: f });
          }).then(null, function () {});
        });
      });
      return c2;
    });
  }

  function runJob(job) {
    jobRunning = true;
    stopAsked = false;
    var stopBtn = $("dbx-job") && $("dbx-job").querySelector("button");
    if (stopBtn) stopBtn.disabled = false;
    paintSel();
    var todo = job.items.filter(function (it) { return it.st === "todo"; });
    var n = job.items.length, i = n - todo.length;
    var chain = Promise.resolve();
    todo.forEach(function (it) {
      chain = chain.then(function () {
        if (stopAsked) return;
        i++;
        jobText(t("x.copying", { i: i, n: n }));
        return copyItem(job, it).then(null, function (e) {
          if (e && (e.kind === "auth" || e.kind === "offline")) throw e;
          it.st = "failed";
          saveJob(job);
        });
      });
    });
    return chain.then(function () {
      if (stopAsked) return "stopped";
      if (job.mode !== "move") return "done";
      jobText(t("x.waiting"));
      return waitVault(job).then(function () {
        if (stopAsked) return "stopped";
        jobText(t("x.deleting"));
        return removeOriginals(job).then(function () { return stopAsked ? "stopped" : "done"; });
      });
    }).then(function (how) {
      var copied = 0, moved = 0, kept = 0, failed = 0;
      job.items.forEach(function (it) {
        if (it.st === "copied") copied++;
        else if (it.st === "deleted") moved++;
        else if (it.st === "kept") kept++;
        else if (it.st === "failed") failed++;
      });
      if (job.mode === "move") kept += copied;          // copied but never confirmed
      dropJob();
      if (how === "stopped") toast(t("x.stopped"));
      else if (job.mode === "move") { if (moved) toast(t("x.moved", { n: moved })); }
      else if (copied) toast(t("x.copied", { n: copied }));
      if (kept) toast(t("x.kept", { n: kept }));
      if (failed) toast(t("x.failed", { n: failed }));
    }, function (e) {
      // Offline / signed out: the job stays saved and can continue later.
      showError(e);
    }).then(function () {
      jobRunning = false;
      jobText("");
      paintSel();
      if (active) render();
    });
  }

  // An interrupted transfer (tab closed, offline, signed out) is offered
  // again when the Dropbox view opens.
  function offerResume() {
    var job = readJob();
    if (!job || jobRunning) return false;
    var go1 = primary(t("x.resumeGo"), function () {
      hideMsg();
      if (job.mode === "move" && !vaultUsable() && job.items.some(function (it) { return it.st === "todo" || it.st === "copied"; })) {
        // Without sync nothing can be confirmed: copy what is left, keep every original.
        job.items.forEach(function (it) { if (it.st === "copied") it.st = "kept"; });
        job.mode = "copy";
        saveJob(job);
        toast(t("x.needSync"));
      }
      runJob(job);
    });
    var drop = el("button", "pv-btn", t("x.resumeDrop"));
    drop.type = "button";
    drop.addEventListener("click", function () { dropJob(); render(); });
    showMsg(t("x.resume"), "", [go1, drop]);
    return true;
  }

  // ---------- Files integration ----------
  function treeNode() {
    var wrap = el("div", "dbx-tree");
    var node = el("div", "tnode" + (active ? " selected" : ""));
    node.style.paddingLeft = "6px";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    var caret = el("span", "caret empty");
    node.appendChild(caret);
    var g = el("span", "glyph");
    g.innerHTML = ICON.box;
    node.appendChild(g);
    node.appendChild(el("span", "tname", t("tree")));
    function open() { if (ctx && ctx.closeDrawer) ctx.closeDrawer(); enter(active ? cwd : (readJSON(VIEW_LS) || {}).path || ""); }
    node.addEventListener("click", open);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    wrap.appendChild(node);
    return wrap;
  }

  function enter(path) {
    var p = C.normPath(typeof path === "string" ? path : "");
    cwd = p === null ? "" : p;
    query = null;
    var q = $("dbx-q");
    if (q) q.value = "";
    setMode(true);
    ensurePanel();
    if (ctx && ctx.onEnter) ctx.onEnter();
    render();
  }

  function leave() {
    if (!active) return;
    closePreview();
    closeAccountMenu();
    renderToken++;
    setMode(false);
  }

  function init(c) {
    ctx = c || {};
    try {
      new BroadcastChannel(CHANNEL).onmessage = function (e) { takeCallback(e.data); };
    } catch (e) { /* old browser: the storage event still works */ }
    window.addEventListener("storage", function (e) {
      if (e.key === CB_LS && e.newValue) finishPending();
    });
    var v = readJSON(VIEW_LS);
    if (v && v.on) enter(typeof v.path === "string" ? v.path : "");
    finishPending();
  }

  window.OrosFilesDropbox = {
    init: init,
    treeNode: treeNode,
    enter: enter,
    leave: leave,
    isActive: function () { return active; }
  };
})();
