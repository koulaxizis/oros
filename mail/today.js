// ============================================================
// orOS Mail — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only. Only COUNTS: one top line per account with unread
// messages in its Inbox ("3 unread · me@example.com · as of 08:40"),
// never a sender, a subject or a message. The count is the one Mail
// keeps on this device (IndexedDB "oros-mail", store "folders",
// written when Mail refreshes its folders), so the line says when
// that was. No relay call, no password, no network. Accounts come
// from oros-mail-data. The database is opened WITHOUT a version and
// closed at once, as mail/notify.js does, so Mail's own upgrades are
// never blocked; no database → no line.
// Mail is in the Assistant's NEVER_APPS: its lines never get the
// "Send to assistant" button (BR-TODAY-6); inside Mail the existing
// Mail → Assistant bridge works per message. Opens that account's
// Inbox (__orosOpenAt: { acct, folder: "INBOX" }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mail-data";
  var DB_NAME = "oros-mail";
  var ACCT_RE = /^[a-z0-9]{6,40}$/;
  var TXT = {
    en: { one: "1 unread", many: "{n} unread", at: "as of {t}" },
    el: { one: "1 αδιάβαστο", many: "{n} αδιάβαστα", at: "στις {t}" }
  };

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  // The living accounts of the synced blob, in its order.
  function accounts(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.accounts)) return [];
    var tombs = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    return data.accounts.filter(function (a) {
      return a && typeof a.id === "string" && ACCT_RE.test(a.id) && typeof a.email === "string" &&
        !(typeof tombs[a.id] === "number" && typeof a.m === "number" && tombs[a.id] >= a.m);
    });
  }

  // Pure (tests): accounts + { acctId: { list, at } } → rows.
  function rows(accts, recs, today, lang) {
    var w = TXT[lang] || TXT.en, out = [];
    accts.forEach(function (a) {
      var rec = recs[a.id];
      if (!rec || !Array.isArray(rec.list)) return;
      var n = 0;
      rec.list.forEach(function (f) {
        if (f && f.name === "INBOX" && typeof f.unseen === "number" && f.unseen > 0) n += Math.floor(f.unseen);
      });
      if (n <= 0) return;
      var text = "";
      if (typeof rec.at === "number" && rec.at > 0) {
        var d = new Date(rec.at), hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
        text = w.at.replace("{t}", ymdOf(d) === today ? hm : pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + " " + hm);
      }
      var who = typeof a.name === "string" && a.name.trim() ? a.name.trim() : a.email;
      out.push({
        id: a.id,
        due: today,
        title: (n === 1 ? w.one : w.many.replace("{n}", n > 9999 ? "9999+" : n)) + " · " + who,
        text: text,
        kind: "info",
        target: { acct: a.id, folder: "INBOX" }
      });
    });
    return out;
  }

  function readFolders(ids) {
    return new Promise(function (resolve) {
      var idb = null;
      try { idb = root.indexedDB; } catch (e) {}
      if (!ids.length || !idb || typeof idb.open !== "function") { resolve({}); return; }
      var rq;
      try { rq = idb.open(DB_NAME); } catch (e) { resolve({}); return; }
      rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (e) {} };   // no database: create nothing
      rq.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); resolve({}); };
      rq.onblocked = function () { resolve({}); };
      rq.onsuccess = function () {
        var db = rq.result, out = {}, left = ids.length;
        db.onversionchange = function () { db.close(); };
        if (!db.objectStoreNames.contains("folders")) { db.close(); resolve({}); return; }
        function done() { if (--left === 0) { db.close(); resolve(out); } }
        try {
          var st = db.transaction("folders", "readonly").objectStore("folders");
          ids.forEach(function (id) {
            var g = st.get(id);
            g.onsuccess = function () { if (g.result) out[id] = g.result; done(); };
            g.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); done(); };
          });
        } catch (e) { db.close(); resolve({}); }
      };
    });
  }

  var PROVIDER = {
    id: "mail",
    keys: [KEY],
    collect: function (ctx) {
      var accts = accounts(ctx.readJSON(KEY));
      if (!accts.length) return [];
      return readFolders(accts.map(function (a) { return a.id; })).then(function (recs) {
        return rows(accts, recs, ctx.today, ctx.lang === "el" ? "el" : "en");
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PROVIDER;
    module.exports.rows = rows;
    module.exports.accounts = accounts;
  }
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
