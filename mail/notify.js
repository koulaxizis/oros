// ============================================================
// orOS Mail — new-mail notices (v1.0.0)
// Runs in the SHELL window (index.html loads it after
// notifications.js), so a new message in an Inbox shows a notice
// while orOS is open, also with the Mail window closed.
//   - every 3 minutes while online (the browser slows timers in a
//     background tab; notifications.js then uses the system
//     notification when its permission was given), plus on "online"
//     and when the tab comes back; at most one check at a time
//   - per account with a password sealed on THIS device: one relay
//     "list" of the Inbox's 5 newest headers. New = UID above this
//     device's mark and not \Seen. The first check of an account
//     (or a new UIDVALIDITY) only takes the mark: no flood of old mail
//   - one notice per new message (sender, subject), key
//     "n:<acct>:<uidvalidity>:<uid>" so two devices announcing the
//     same message show it once in the synced bell; more than 3 at
//     once → one "N new messages" notice
//   - deep link "mail:msg:<acct>.<uid>" opens that message
//   - per-app toggle "mail" and quiet hours: notifications.js
// Reads: oros-mail-data (accounts, relay), IndexedDB "oros-mail"
// stores "keys" + "creds" (the sealed password, decrypted with the
// device key exactly as mail.js does; the key never leaves
// IndexedDB). The database is opened WITHOUT a version and closed
// after each check, so Mail's own upgrades are never blocked.
// Writes only the device-local marks "oros-mail-notify"
// { acctId: { v: uidvalidity, m: highest uid seen } }, never synced.
// An auth failure silences that account until its password changes
// on this device. orOS closed = no check (honest limit).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mail-data";
  var MARKS_KEY = "oros-mail-notify";
  var DB_NAME = "oros-mail";
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";   // = mail.js
  var EVERY_MS = 3 * 60 * 1000;
  var BACKOFF_MAX = 30 * 60 * 1000;
  var CALL_TIMEOUT = 45000;
  var PEEK = 5;              // newest Inbox headers per check
  var MAX_EACH = 3;          // more new messages than this → one summary

  // ---------- pure core (tests) ----------
  // res: relay "list" answer; mark: { v, m } | null.
  // → { mark, fresh: [msg] } (newest first; msg as in res.msgs)
  function freshMessages(res, mark) {
    var msgs = (res && Array.isArray(res.msgs) ? res.msgs : []).filter(function (x) { return x && x.uid > 0; });
    var top = msgs.reduce(function (a, x) { return Math.max(a, x.uid); }, 0);
    var v = res ? res.uidvalidity : 0;
    if (!mark || mark.v !== v) return { mark: { v: v, m: top }, fresh: [] };
    var fresh = msgs.filter(function (x) {
      return x.uid > mark.m && !(Array.isArray(x.flags) && x.flags.indexOf("\\Seen") >= 0);
    }).sort(function (a, b) { return b.uid - a.uid; });
    return { mark: { v: v, m: Math.max(mark.m, top) }, fresh: fresh };
  }

  // ---------- strings ----------
  function el() { return root.orosLang === "el"; }
  function T(key, n) {
    var s = {
      newOne: el() ? "Νέο email" : "New e-mail",
      many: el() ? "{n} νέα email" : "{n} new e-mails",
      nosubj: el() ? "(χωρίς θέμα)" : "(no subject)"
    }[key];
    return s.replace("{n}", n);
  }

  // ---------- device store ----------
  function loadMarks() {
    try {
      var m = JSON.parse(root.localStorage.getItem(MARKS_KEY) || "null");
      return m && typeof m === "object" ? m : {};
    } catch (e) { return {}; }
  }
  function saveMarks(m) {
    try { root.localStorage.setItem(MARKS_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function readData() {
    try {
      var d = JSON.parse(root.localStorage.getItem(KEY) || "null");
      if (!d || !Array.isArray(d.accounts)) return null;
      return d;
    } catch (e) { return null; }
  }

  function openDb() {
    return new Promise(function (resolve) {
      var idb = null;
      try { idb = root.indexedDB; } catch (e) {}
      if (!idb || typeof idb.open !== "function") { resolve(null); return; }
      var rq;
      try { rq = idb.open(DB_NAME); } catch (e) { resolve(null); return; }
      rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (e) {} };   // no database: create nothing
      rq.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); resolve(null); };
      rq.onblocked = function () { resolve(null); };
      rq.onsuccess = function () {
        var d = rq.result;
        d.onversionchange = function () { d.close(); };
        if (!d.objectStoreNames.contains("keys") || !d.objectStoreNames.contains("creds")) { d.close(); resolve(null); return; }
        resolve(d);
      };
    });
  }
  function get(d, store, key) {
    return new Promise(function (resolve) {
      try {
        var r = d.transaction(store, "readonly").objectStore(store).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  // The password sealed by mail.js (savePass): AES-GCM with the
  // non-extractable device key.
  function password(d, acctId) {
    return Promise.all([get(d, "keys", "device"), get(d, "creds", acctId)]).then(function (r) {
      var key = r[0], rec = r[1];
      if (!key || !rec || !rec.iv || !rec.data) return null;
      return root.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data)
        .then(function (plain) { return new TextDecoder().decode(plain); });
    }).catch(function () { return null; });
  }

  // ---------- mime.js (header decoding), loaded once ----------
  var MIME_SRC = "mail/mime.js";
  try {
    var cs = root.document && root.document.currentScript;
    if (cs && /notify\.js(?=[?#]|$)/.test(cs.src || "")) MIME_SRC = cs.src.replace(/notify\.js(?=[?#]|$)/, "mime.js");
  } catch (e) {}
  var mimeLoading = null;
  function mime() {
    var M = root.orosMailMime;
    if (M && typeof M.summary === "function") return Promise.resolve(M);
    var doc = root.document;
    if (!doc || !doc.head) return Promise.resolve(null);
    if (!mimeLoading) {
      mimeLoading = new Promise(function (resolve) {
        var s = doc.createElement("script");
        s.src = MIME_SRC;
        s.async = true;
        s.onload = s.onerror = function () { resolve(); };
        doc.head.appendChild(s);
      });
    }
    return mimeLoading.then(function () {
      var M2 = root.orosMailMime;
      return M2 && typeof M2.summary === "function" ? M2 : null;
    });
  }

  // ---------- relay ----------
  function list(url, acct, pass) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, CALL_TIMEOUT);
    return fetch(url + "/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "list", folder: "INBOX", limit: PEEK,
        acct: { host: acct.imap.host, port: acct.imap.port, sec: acct.imap.sec,
                user: acct.imap.user || acct.email, pass: pass } }),
      signal: ctl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      if (!j || !j.ok) throw { code: (j && j.error && j.error.code) || "relay" };
      return j.data;
    }, function (e) {
      clearTimeout(timer);
      throw e && e.code ? e : { code: "network" };
    });
  }

  // ---------- the check ----------
  var busy = false, timer = null, wait = EVERY_MS, lastAt = 0;
  var silenced = {};          // acctId → the password that failed

  function emitFor(acct, fresh, uidv, M) {
    var N = root.orosNotifs;
    if (!fresh.length || !N || typeof N.emit !== "function") return;
    if (fresh.length > MAX_EACH) {
      N.emit({ ns: "mail", type: "new", key: "n:" + acct.id + ":" + uidv + ":" + fresh[0].uid + ":all",
               title: T("many", fresh.length), body: acct.email,
               deepLink: "mail:msg:" + acct.id + "." + fresh[0].uid, ttlDays: 3 });
      return;
    }
    fresh.forEach(function (x) {
      var s = null;
      try { s = M ? M.summary(M.b64ToBin(x.hdr || "")) : null; } catch (e) {}
      var from = s && s.from ? (s.from.name || s.from.addr) : "";
      var subj = s ? s.subject : "";
      N.emit({ ns: "mail", type: "new", key: "n:" + acct.id + ":" + uidv + ":" + x.uid,
               title: String(from || T("newOne")).slice(0, 120),
               body: String(subj || T("nosubj")).slice(0, 200),
               deepLink: "mail:msg:" + acct.id + "." + x.uid, ttlDays: 3 });
    });
  }

  function check() {
    if (busy) return Promise.resolve();
    function later() { wait = EVERY_MS; schedule(); return Promise.resolve(); }
    if (!root.navigator.onLine) return later();
    var data = readData();
    if (!data || !data.accounts.length) return later();
    var tombs = data.tombs || {};
    var accts = data.accounts.filter(function (a) {
      return a && typeof a.id === "string" && /^[a-z0-9]{6,40}$/.test(a.id) && a.imap && a.imap.host &&
             !(tombs[a.id] >= a.m);
    }).slice(0, 10);
    if (!accts.length) return later();
    var url = (data.relay && typeof data.relay.url === "string" && data.relay.url) || DEFAULT_RELAY;
    busy = true;
    lastAt = Date.now();
    var failed = false;
    return Promise.all([openDb(), mime()]).then(function (r) {
      var d = r[0], M = r[1];
      if (!d) return;
      var marks = loadMarks();
      return accts.reduce(function (p, acct) {
        return p.then(function () {
          return password(d, acct.id).then(function (pw) {
            if (!pw || silenced[acct.id] === pw) return;
            return list(url, acct, pw).then(function (res) {
              var out = freshMessages(res, marks[acct.id]);
              marks[acct.id] = out.mark;
              saveMarks(marks);
              emitFor(acct, out.fresh, res.uidvalidity, M);
            }, function (e) {
              if (e.code === "auth") silenced[acct.id] = pw;
              else failed = true;
            });
          });
        });
      }, Promise.resolve()).then(function () {
        // forget marks of removed accounts
        Object.keys(marks).forEach(function (id) {
          if (!accts.some(function (a) { return a.id === id; })) delete marks[id];
        });
        saveMarks(marks);
      }).then(function () { d.close(); }, function () { d.close(); });
    }).catch(function () { failed = true; }).then(function () {
      busy = false;
      wait = failed ? Math.min(BACKOFF_MAX, wait * 2) : EVERY_MS;
      schedule();
    });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(check, wait);
  }
  function soon() {
    // tab back / online: check now unless one ran in the last minute
    if (Date.now() - lastAt > 60000) { wait = EVERY_MS; check(); }
  }

  var api = { v: 1, freshMessages: freshMessages, check: check };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  if (root.__orosMailNotify && root.__orosMailNotify.v >= 1) return;
  root.__orosMailNotify = api;
  setTimeout(check, 20000);          // after boot settles (notifications.js ready)
  root.addEventListener("online", soon);
  root.document.addEventListener("visibilitychange", function () {
    if (root.document.visibilityState === "visible") soon();
  });
})(typeof window !== "undefined" ? window : globalThis);
