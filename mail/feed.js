// ============================================================
// orOS Mail — read-only feed bridge (v1.0.0)
// Lets another orOS app show a Mail folder as a list of articles
// ("newsletters as feeds" in the Reader). Same contract as the
// universal search provider (mail/search.js):
//   - READ-ONLY: reads oros-mail-data (accounts, for names and
//     tombstones) and the device's message cache (IndexedDB
//     "oros-mail", stores "folders", "heads" and "bodies"). Never
//     writes either, never opens the "keys" / "creds" stores (sealed
//     passwords), never calls the relay, never sets \Seen.
//   - The database is opened WITHOUT a version: a device that never
//     ran Mail has no database, and the upgrade is aborted so nothing
//     gets created. Closed after every call (Mail's own upgrades are
//     never blocked).
//   - What it can give is what Mail already keeps on this device:
//     the headers of the folders Mail has opened here (up to 500 per
//     folder) and the bodies of the messages opened here (Mail keeps
//     the last 200). A message whose body is not on the device comes
//     back with cached: false; opening it in Mail downloads it.
//   - Bodies are decoded with Mail's own mail/mime.js (pure), loaded
//     next to this file. The caller sanitises the HTML (it is the
//     sender's markup, untrusted).
// Loaded by path: <script src="../mail/feed.js">. Exposes
// window.orosMailFeed (module.exports in Node, for tests):
//   folders()               -> Promise<[{ acct, acctName, email, folder, label, role }]>
//                              folders of live accounts this device
//                              knows, Sent / Drafts / Trash / Spam left out
//   messages(acct, folder, max?)
//                           -> Promise<null | { acct, folder, uidv, at,
//                              msgs: [{ uid, mid, subj, from: {name, addr},
//                              date, seen, cached, html, text }] }>
//                              newest first; null = no such account or
//                              folder cache on this device
//   open(acct, folder, uid) -> the shell deep link target for Mail
//                              ({ acct, folder, uid }), same as search
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mail-data";
  var DB_NAME = "oros-mail";
  var MAX_MSGS = 200;
  var MAX_SOURCE = 8 * 1024 * 1024;
  var MAX_HTML = 1024 * 1024;
  var MAX_TEXT = 200000;
  var SKIP_ROLES = { sent: 1, drafts: 1, trash: 1, junk: 1 };
  var SPECIAL_NAMES = {          // = mail.js folderRole()
    sent: /^(sent|sent items|sent messages|sent mail|απεσταλμένα)$/i,
    drafts: /^(drafts?|πρόχειρα)$/i,
    trash: /^(trash|deleted|deleted items|deleted messages|bin|κάδος|διαγραμμένα)$/i,
    junk: /^(junk|spam|junk e-mail|bulk mail|ανεπιθύμητα)$/i,
    archive: /^(archive|archives|αρχειοθήκη)$/i
  };

  // ---------- pure (tests) ----------
  function decodeName(name, M) {
    name = String(name || "");
    try { if (M && typeof M.utf7Decode === "function") return M.utf7Decode(name); } catch (e) {}
    return name;
  }
  function folderRole(f, M) {
    var name = String(f && f.name || "");
    if (/^inbox$/i.test(name)) return "inbox";
    var fl = (f && Array.isArray(f.flags) ? f.flags : []).join(" ").toLowerCase();
    var roles = ["sent", "drafts", "trash", "junk", "archive", "all", "flagged"];
    for (var i = 0; i < roles.length; i++) if (fl.indexOf("\\" + roles[i]) >= 0) return roles[i];
    var leaf = decodeName(name, M);
    if (f && f.delim && leaf.indexOf(f.delim) >= 0) leaf = leaf.slice(leaf.lastIndexOf(f.delim) + 1);
    for (var k in SPECIAL_NAMES) if (SPECIAL_NAMES[k].test(leaf)) return k;
    return "";
  }
  // "INBOX.News.Daily" → "News › Daily" (INBOX itself stays "INBOX").
  function folderLabel(f, M) {
    var name = decodeName(f && f.name, M);
    var parts = f && f.delim ? name.split(f.delim) : [name];
    if (parts.length > 1 && /^inbox$/i.test(parts[0])) parts.shift();
    return parts.filter(Boolean).join(" › ") || name;
  }
  function liveAccounts(d) {
    var out = {};
    if (!d || !Array.isArray(d.accounts)) return out;
    var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
    d.accounts.forEach(function (a) {
      if (!a || typeof a.id !== "string" || !/^[a-z0-9]{6,40}$/.test(a.id)) return;
      var t = tombs[a.id];
      if (typeof t === "number" && t >= (typeof a.m === "number" ? a.m : 0)) return;
      out[a.id] = a;
    });
    return out;
  }
  // folder lists ({acct: [folder]}) → the rows folders() returns
  function folderRows(d, lists, M) {
    var live = liveAccounts(d), out = [];
    Object.keys(lists).sort().forEach(function (acct) {
      var a = live[acct];
      if (!a || !Array.isArray(lists[acct])) return;
      lists[acct].forEach(function (f) {
        if (!f || typeof f.name !== "string" || !f.name) return;
        if (Array.isArray(f.flags) && f.flags.some(function (x) { return /^\\noselect$/i.test(x); })) return;
        var role = folderRole(f, M);
        if (SKIP_ROLES[role]) return;
        out.push({ acct: acct, acctName: String(a.name || a.email || ""), email: String(a.email || ""),
                   folder: f.name, label: folderLabel(f, M), role: role });
      });
    });
    return out;
  }
  // One cached source → { html, text } (either may be "").
  function decodeBody(raw, M) {
    if (typeof raw !== "string" || !raw || raw.length > MAX_SOURCE || !M) return null;
    try {
      var p = M.parseMessage(M.b64ToBin(raw));
      var html = typeof p.html === "string" ? p.html : "";
      var text = typeof p.text === "string" ? p.text : "";
      if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
      return { html: html, text: text };
    } catch (e) { return null; }
  }
  // heads record + { bodyKey: raw } → the messages() answer
  function toMessages(rec, raws, M, max) {
    var msgs = (Array.isArray(rec.msgs) ? rec.msgs : []).filter(function (m) {
      return m && typeof m.uid === "number" && m.uid > 0 &&
             !(Array.isArray(m.flags) && m.flags.indexOf("\\Deleted") >= 0);
    }).sort(function (a, b) { return b.uid - a.uid; }).slice(0, max || MAX_MSGS);
    return {
      acct: rec.acct, folder: rec.folder, uidv: rec.uidv || 0, at: rec.at || 0,
      msgs: msgs.map(function (m) {
        var key = rec.acct + "|" + rec.folder + "|" + rec.uidv + "|" + m.uid;
        var b = raws && raws[key] !== undefined ? decodeBody(raws[key], M) : null;
        var from = m.from && typeof m.from === "object" ? m.from : {};
        return {
          uid: m.uid, mid: typeof m.mid === "string" ? m.mid.slice(0, 300) : "",
          subj: typeof m.subj === "string" ? m.subj : "",
          from: { name: typeof from.name === "string" ? from.name : "", addr: typeof from.addr === "string" ? from.addr : "" },
          date: typeof m.date === "number" && isFinite(m.date) && m.date > 0 ? m.date : 0,
          seen: Array.isArray(m.flags) && m.flags.indexOf("\\Seen") >= 0,
          cached: !!b, html: b ? b.html : "", text: b ? b.text : ""
        };
      })
    };
  }

  // ---------- mime.js next to this file ----------
  var MIME_SRC = "../mail/mime.js";
  try {
    var cs = root.document && root.document.currentScript;
    if (cs && typeof cs.src === "string" && /feed\.js(?=[?#]|$)/.test(cs.src)) {
      MIME_SRC = cs.src.replace(/feed\.js(?=[?#]|$)/, "mime.js");
    }
  } catch (e) {}
  var mimeLoading = null;
  function mime() {
    var M = root.orosMailMime;
    if (M && typeof M.parseMessage === "function") return Promise.resolve(M);
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
      if (!(M2 && typeof M2.parseMessage === "function")) { mimeLoading = null; return null; }
      return M2;
    });
  }

  // ---------- IndexedDB, read-only ----------
  function openDb() {
    return new Promise(function (resolve) {
      var idb = null;
      try { idb = root.indexedDB; } catch (e) { idb = null; }
      if (!idb || typeof idb.open !== "function") { resolve(null); return; }
      var rq;
      try { rq = idb.open(DB_NAME); } catch (e) { resolve(null); return; }
      rq.onupgradeneeded = function () {        // no such database: create nothing
        try { rq.transaction.abort(); } catch (e) {}
      };
      rq.onerror = function (e) {
        if (e && typeof e.preventDefault === "function") e.preventDefault();
        resolve(null);
      };
      rq.onblocked = function () { resolve(null); };
      rq.onsuccess = function () {
        var db = rq.result;
        var names = db.objectStoreNames;
        if (!names.contains("heads") || !names.contains("folders") || !names.contains("bodies")) {
          try { db.close(); } catch (e) {}
          resolve(null);
          return;
        }
        db.onversionchange = function () { try { db.close(); } catch (e) {} };
        resolve(db);
      };
    });
  }
  function readData() {
    try { return JSON.parse(root.localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }

  function folders() {
    var d = readData();
    if (!d || !Array.isArray(d.accounts) || !d.accounts.length) return Promise.resolve([]);
    return Promise.all([openDb(), mime()]).then(function (r) {
      var db = r[0], M = r[1];
      if (!db) return [];
      return new Promise(function (resolve) {
        var lists = {};
        function done() { try { db.close(); } catch (e) {} resolve(folderRows(d, lists, M)); }
        try {
          var tx = db.transaction("folders", "readonly");
          var c = tx.objectStore("folders").openCursor();
          c.onsuccess = function () {
            var cur = c.result;
            if (!cur) return;
            if (typeof cur.key === "string" && cur.value && Array.isArray(cur.value.list)) lists[cur.key] = cur.value.list;
            cur.continue();
          };
          tx.oncomplete = done;
          tx.onerror = tx.onabort = done;
        } catch (e) { done(); }
      });
    });
  }

  function messages(acct, folder, max) {
    if (typeof acct !== "string" || typeof folder !== "string" || !folder) return Promise.resolve(null);
    if (!liveAccounts(readData())[acct]) return Promise.resolve(null);
    return Promise.all([openDb(), mime()]).then(function (r) {
      var db = r[0], M = r[1];
      if (!db) return null;
      return new Promise(function (resolve) {
        var rec = null, raws = {};
        function done() {
          try { db.close(); } catch (e) {}
          resolve(rec && Array.isArray(rec.msgs) ? toMessages(rec, raws, M, max) : null);
        }
        try {
          var tx = db.transaction(["heads", "bodies"], "readonly");
          var hr = tx.objectStore("heads").get(acct + "|" + folder);
          hr.onsuccess = function () {
            rec = hr.result && Array.isArray(hr.result.msgs) ? hr.result : null;
            if (!rec) return;
            var bs = tx.objectStore("bodies");
            rec.msgs.slice().sort(function (a, b) { return b.uid - a.uid; }).slice(0, max || MAX_MSGS).forEach(function (m) {
              if (!m || typeof m.uid !== "number") return;
              var key = acct + "|" + folder + "|" + rec.uidv + "|" + m.uid;
              var g = bs.get(key);
              g.onsuccess = function () { if (g.result && typeof g.result.raw === "string") raws[key] = g.result.raw; };
            });
          };
          tx.oncomplete = done;
          tx.onerror = tx.onabort = done;
        } catch (e) { done(); }
      });
    });
  }

  function open(acct, folder, uid) {
    return { acct: String(acct || ""), folder: String(folder || ""), uid: typeof uid === "number" ? uid : undefined };
  }

  var api = { folders: folders, messages: messages, open: open,
              _pure: { folderRole: folderRole, folderLabel: folderLabel, folderRows: folderRows,
                       decodeBody: decodeBody, toMessages: toMessages, liveAccounts: liveAccounts } };
  root.orosMailFeed = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
