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
      "connect.note":  "orOS asks Dropbox to read your files and, for moving files into the encrypted disk later, to change them. The connection stays on this device.",
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
      "dl.fail":     "Download failed"
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
      "connect.note":  "Το orOS ζητά από το Dropbox να διαβάζει τα αρχεία σου και, για τη μεταφορά αρχείων στον κρυπτογραφημένο δίσκο αργότερα, να τα αλλάζει. Η σύνδεση μένει σε αυτή τη συσκευή.",
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
      "dl.fail":     "Η λήψη απέτυχε"
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
    list.forEach(function (r) {
      var li = el("li", "entry" + (query !== null ? " search-result" : ""));
      li.tabIndex = 0;
      var locked = r.dir && C.isUnder(r.path, roots);
      var g = el("span", "glyph " + (r.dir ? "folder" : "file"));
      g.innerHTML = locked ? ICON.lock : (r.dir ? ICON.folder : ICON.file);
      li.appendChild(g);
      li.appendChild(el("span", "ename col-name", r.name));
      if (query !== null) {
        li.appendChild(el("span", "subpath", C.parentPath(r.path) || "/"));
      } else {
        li.appendChild(el("span", "col-size", fmtSize(r)));
        li.appendChild(el("span", "col-date", fmtDate(r)));
      }
      li.addEventListener("click", function () { activate(r); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); activate(r); } });
      ul.appendChild(li);
    });
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
    var p = C.normPath(path);
    cwd = p === null ? "" : p;
    saveView();
    if (!active) return;
    paintCrumbs();
    render();
  }

  function runSearch(q) {
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
