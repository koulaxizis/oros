// ============================================================
// orOS Mail — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-mail-data (accounts) and the
// device's message cache (IndexedDB "oros-mail", stores "folders",
// "heads" and "bodies"), never writes either. The "keys" and
// "creds" stores (sealed passwords) are never opened.
// One hit per message stored on this device: subject; sender
// name and address and the plain-text body as text; `when` = the
// message date. Bodies are only the ones this device already
// downloaded (opened messages): their MIME source is decoded with
// the app's own mail/mime.js (loaded once into the shell, it is
// pure: no DOM, no storage), the text part preferred, else the HTML
// part turned into text in an INERT document (DOMParser: no
// scripts run, nothing loads; <style>/<script> dropped), like
// Writer's provider. Decoded text is kept in memory per message
// (cached sources never change); new sources are decoded in small
// batches within a time budget, the rest on the next search.
// Skipped: accounts that are gone (tombs, merge rule), the Trash
// and Spam folders, messages flagged \Deleted; a message listed in
// "All mail" / "Starred" as well as in its own folder shows once.
// The IndexedDB is opened WITHOUT a version: a device that never
// ran Mail has no database, and the upgrade is aborted so nothing
// gets created. Folder lists and headers are re-read at most every
// 10 s.
// Opens through the generic deep link: target { acct, folder, uid }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mail-data";
  var DB_NAME = "oros-mail";
  var FRESH_MS = 10000;
  var BUDGET_MS = 600;           // waited per search (mime.js + new bodies)
  var BATCH = 8;                 // sources read per transaction
  var MAX_SOURCE = 8 * 1024 * 1024;
  var MAX_TEXT = 20000;
  var SKIP_ROLES = { trash: 1, junk: 1 };
  var LATE_ROLES = { all: 1, flagged: 1 };
  var SPECIAL_NAMES = {          // = mail.js folderRole()
    sent: /^(sent|sent items|sent messages|sent mail|απεσταλμένα)$/i,
    drafts: /^(drafts?|πρόχειρα)$/i,
    trash: /^(trash|deleted|deleted items|deleted messages|bin|κάδος|διαγραμμένα)$/i,
    junk: /^(junk|spam|junk e-mail|bulk mail|ανεπιθύμητα)$/i,
    archive: /^(archive|archives|αρχειοθήκη)$/i
  };

  var snap = null;               // { at, idb, folders: {acct: [folder]}, heads: [rec], bodyKeys: [key] }
  var texts = {};                // body key → plain text ("" = nothing to read)
  var indexing = null;           // the running decode pass (one at a time)

  // mime.js next to this file: same version query, same precache.
  var MIME_SRC = "mail/mime.js";
  try {
    var cs = root.document && root.document.currentScript;
    if (cs && typeof cs.src === "string" && /search\.js(?=[?#]|$)/.test(cs.src)) {
      MIME_SRC = cs.src.replace(/search\.js(?=[?#]|$)/, "mime.js");
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

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

  function plain(html) {
    html = String(html || "");
    if (!html) return "";
    if (typeof root.DOMParser === "function") {
      try {
        var doc = new root.DOMParser().parseFromString(html, "text/html");
        var drop = doc.querySelectorAll("style,script,head,title,noscript,template");
        for (var i = 0; i < drop.length; i++) if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
        var blocks = doc.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,br,tr,td,blockquote");
        for (var j = 0; j < blocks.length; j++) blocks[j].appendChild(doc.createTextNode(" "));
        return (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ").trim();
      } catch (e) {}
    }
    // Fallback (node tests): strip tags, decode the common entities.
    return html.replace(/<(style|script|head|title|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
      .replace(/\s+/g, " ").trim();
  }

  function bodyText(M, raw) {
    try {
      var p = M.parseMessage(M.b64ToBin(raw));
      var s = typeof p.text === "string" && p.text.trim() ? p.text : plain(p.html);
      s = String(s || "").replace(/\s+/g, " ").trim();
      return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
    } catch (e) { return ""; }
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
        resolve(db);
      };
    });
  }

  function readSnapshot() {
    var idb = null;
    try { idb = root.indexedDB; } catch (e) { idb = null; }
    if (snap && snap.idb === idb && Date.now() - snap.at < FRESH_MS) return Promise.resolve(snap);
    return openDb().then(function (db) {
      var out = { at: Date.now(), idb: idb, folders: {}, heads: [], bodyKeys: [] };
      if (!db) { snap = out; return out; }
      return new Promise(function (resolve) {
        function done() { try { db.close(); } catch (e) {} snap = out; resolve(out); }
        try {
          var tx = db.transaction(["folders", "heads", "bodies"], "readonly");
          var fc = tx.objectStore("folders").openCursor();
          fc.onsuccess = function () {
            var c = fc.result;
            if (!c) return;
            if (typeof c.key === "string" && c.value && Array.isArray(c.value.list)) out.folders[c.key] = c.value.list;
            c.continue();
          };
          var hr = tx.objectStore("heads").getAll();
          hr.onsuccess = function () { out.heads = Array.isArray(hr.result) ? hr.result : []; };
          var br = tx.objectStore("bodies").getAllKeys();
          br.onsuccess = function () { out.bodyKeys = Array.isArray(br.result) ? br.result : []; };
          tx.oncomplete = done;
          tx.onerror = tx.onabort = done;
        } catch (e) { done(); }
      });
    });
  }

  // Decodes the sources not seen yet, BATCH per transaction.
  function indexBodies(M, keys) {
    if (indexing) return indexing;
    var todo = keys.filter(function (k) { return typeof k === "string" && texts[k] === undefined; });
    if (!todo.length) return Promise.resolve();
    indexing = openDb().then(function (db) {
      if (!db) return;
      function next() {
        var part = todo.splice(0, BATCH);
        if (!part.length) { try { db.close(); } catch (e) {} return; }
        return new Promise(function (resolve) {
          var got = {};
          try {
            var tx = db.transaction("bodies", "readonly");
            var st = tx.objectStore("bodies");
            part.forEach(function (k) {
              var r = st.get(k);
              r.onsuccess = function () { got[k] = r.result; };
            });
            tx.oncomplete = tx.onerror = tx.onabort = function () { resolve(got); };
          } catch (e) { resolve(got); }
        }).then(function (got) {
          part.forEach(function (k) {
            var rec = got[k];
            if (!rec || typeof rec.raw !== "string") { texts[k] = ""; return; }
            texts[k] = rec.raw.length > MAX_SOURCE ? "" : bodyText(M, rec.raw);
          });
          return next();
        });
      }
      return next();
    }).then(function () { indexing = null; }, function () { indexing = null; });
    return indexing;
  }

  function role(f, M) {
    var name = String(f && f.name || "");
    if (/^inbox$/i.test(name)) return "inbox";
    var fl = (Array.isArray(f.flags) ? f.flags : []).join(" ").toLowerCase();
    var roles = ["sent", "drafts", "trash", "junk", "archive", "all", "flagged"];
    for (var i = 0; i < roles.length; i++) if (fl.indexOf("\\" + roles[i]) >= 0) return roles[i];
    try { if (M) name = M.utf7Decode(name); } catch (e) {}
    if (f.delim && name.indexOf(f.delim) >= 0) name = name.slice(name.lastIndexOf(f.delim) + 1);
    for (var k in SPECIAL_NAMES) if (SPECIAL_NAMES[k].test(name)) return k;
    return "";
  }

  function build(ctx, d, s, M) {
    var out = [];
    var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
    var live = {};
    (Array.isArray(d.accounts) ? d.accounts : []).forEach(function (a) {
      if (!a || typeof a.id !== "string") return;
      var t = tombs[a.id];
      if (typeof t === "number" && t >= (typeof a.m === "number" ? a.m : 0)) return;
      live[a.id] = a;
    });
    var recs = s.heads.filter(function (r) {
      return r && typeof r.acct === "string" && live[r.acct] && typeof r.folder === "string" &&
             Array.isArray(r.msgs);
    }).map(function (r) {
      var list = s.folders[r.acct] || [], f = null;
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === r.folder) { f = list[i]; break; }
      return { r: r, role: role(f || { name: r.folder }, M) };
    }).filter(function (x) { return !SKIP_ROLES[x.role]; });
    recs.sort(function (a, b) { return (LATE_ROLES[a.role] ? 1 : 0) - (LATE_ROLES[b.role] ? 1 : 0); });

    var seenMid = {};
    recs.forEach(function (x) {
      var r = x.r;
      r.msgs.forEach(function (m) {
        if (!m || typeof m.uid !== "number") return;
        var flags = Array.isArray(m.flags) ? m.flags : [];
        if (flags.indexOf("\\Deleted") >= 0) return;
        if (m.mid) {
          var mk = r.acct + "\n" + m.mid;
          if (seenMid[mk]) return;
          seenMid[mk] = true;
        }
        var from = m.from && typeof m.from === "object" ? m.from : {};
        var body = texts[r.acct + "|" + r.folder + "|" + r.uidv + "|" + m.uid] || "";
        out.push({
          id: r.acct + "|" + r.folder + "|" + m.uid,
          title: str(m.subj) || (ctx.lang === "el" ? "(χωρίς θέμα)" : "(no subject)"),
          text: [str(from.name), str(from.addr), body].filter(Boolean).join(" · "),
          when: typeof m.date === "number" && isFinite(m.date) && m.date > 0 ? m.date : 0,
          target: { acct: r.acct, folder: r.folder, uid: m.uid }
        });
      });
    });
    return out;
  }

  function within(p, ms) {
    return new Promise(function (resolve) {
      var t = setTimeout(resolve, ms);
      Promise.resolve(p).then(function () { clearTimeout(t); resolve(); },
                              function () { clearTimeout(t); resolve(); });
    });
  }

  var PROVIDER = {
    id: "mail",
    keys: [KEY],
    plain: plain,
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.accounts) || !d.accounts.length) return [];
      var M = null, t0 = Date.now();
      return Promise.all([readSnapshot(), within(mime().then(function (m) { M = m; }), BUDGET_MS)])
        .then(function (res) {
          var s = res[0];
          var keep = {};
          s.bodyKeys.forEach(function (k) { keep[k] = true; });
          Object.keys(texts).forEach(function (k) { if (!keep[k]) delete texts[k]; });
          var left = BUDGET_MS - (Date.now() - t0);
          var wait = M && left > 0 ? within(indexBodies(M, s.bodyKeys), left) : null;
          if (M && left <= 0) indexBodies(M, s.bodyKeys);    // ready for the next search
          return Promise.resolve(wait).then(function () { return build(ctx, d, s, M); });
        });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
