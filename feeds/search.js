// ============================================================
// orOS Reader (feeds) — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-feeds-data and the device's
// article store (IndexedDB "oros-feeds", store "heads"), never
// writes either.
// Hits:
//   - one per subscribed feed (its name; folder, site and address
//     as text);
//   - one per stored article: the saved ones (starred / read later
//     / tagged, synced in items[]) and the ones this device keeps
//     for its subscriptions (heads). Title; summary, feed name and
//     author as text; `when` = the article's date.
// Skipped: rows a tombs{} entry covers ("f:id" / "i:id", delete
// wins ties like core.js merge), stored articles of feeds no
// longer subscribed (saved ones stay: the user kept them).
// The IndexedDB is opened WITHOUT a version: a device that never
// ran the Reader has no database, and the upgrade is aborted so
// nothing gets created. The heads are re-read at most every 10 s.
// Opens through the generic deep link: target { feed } or
// { item, feed }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-feeds-data";
  var DB_NAME = "oros-feeds";
  var FRESH_MS = 10000;
  var headsCache = null;       // { at, idb, list }

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

  // All rows of one store, read-only; null when there is none.
  function readStore(name, store) {
    return new Promise(function (resolve) {
      var idb = null;
      try { idb = root.indexedDB; } catch (e) { idb = null; }
      if (!idb || typeof idb.open !== "function") { resolve(null); return; }
      var rq;
      try { rq = idb.open(name); } catch (e) { resolve(null); return; }
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
        function done(v) { try { db.close(); } catch (e) {} resolve(v); }
        try {
          if (!db.objectStoreNames.contains(store)) { done(null); return; }
          var tx = db.transaction(store, "readonly");
          var r = tx.objectStore(store).getAll();
          var out = null;
          r.onsuccess = function () { out = r.result || []; };
          tx.oncomplete = function () { done(out); };
          tx.onerror = tx.onabort = function () { done(null); };
        } catch (e) { done(null); }
      };
    });
  }

  function heads() {
    var idb = null;
    try { idb = root.indexedDB; } catch (e) { idb = null; }
    if (headsCache && headsCache.idb === idb && Date.now() - headsCache.at < FRESH_MS) {
      return Promise.resolve(headsCache.list);
    }
    return readStore(DB_NAME, "heads").then(function (list) {
      list = Array.isArray(list) ? list : [];
      headsCache = { at: Date.now(), idb: idb, list: list };
      return list;
    });
  }

  function gone(tombs, key, m) {
    var t = tombs[key];
    return typeof t === "number" && t >= (typeof m === "number" ? m : 0);
  }

  function build(ctx, d, headList) {
    var out = [];
    var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
    var folderName = {}, feedName = {}, live = {};
    (Array.isArray(d.folders) ? d.folders : []).forEach(function (f) {
      if (f && typeof f.id === "string" && !gone(tombs, "d:" + f.id, f.m)) folderName[f.id] = str(f.name);
    });
    (Array.isArray(d.feeds) ? d.feeds : []).forEach(function (f) {
      if (!f || typeof f.id !== "string" || gone(tombs, "f:" + f.id, f.m)) return;
      var url = str(f.url);
      var title = str(f.title) || url.replace(/^https?:\/\//, "").split("/")[0] ||
                  (ctx.lang === "el" ? "Ροή χωρίς όνομα" : "Unnamed feed");
      live[f.id] = true;
      feedName[f.id] = title;
      out.push({
        id: "f:" + f.id,
        title: title,
        text: [folderName[f.folder] || "", str(f.site), url].filter(Boolean).join(" · "),
        target: { feed: f.id }
      });
    });

    // Articles: saved first (they carry the user's choice), then the
    // device's stored ones not already listed.
    var words = ctx.words || [], fold = ctx.fold || function (s) { return String(s).toLowerCase(); };
    var seen = {};
    function add(id, feed, title, sum, author, date) {
      if (seen[id]) return;
      title = str(title);
      var text = [str(sum), feedName[feed] || "", str(author)].filter(Boolean).join(" · ");
      var hay = fold(title + " " + text);
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return;
      seen[id] = true;
      out.push({
        id: "i:" + id,
        title: title || (ctx.lang === "el" ? "Άρθρο χωρίς τίτλο" : "Untitled article"),
        text: text,
        when: typeof date === "number" && isFinite(date) && date > 0 ? date : 0,
        target: { item: id, feed: feed }
      });
    }
    (Array.isArray(d.items) ? d.items : []).forEach(function (x) {
      if (!x || typeof x.id !== "string" || typeof x.feed !== "string") return;
      if (gone(tombs, "i:" + x.id, x.m)) return;
      if (!x.star && !x.later && !(Array.isArray(x.tags) && x.tags.length)) return;
      add(x.id, x.feed, x.title, x.sum, x.author, x.date);
    });
    headList.forEach(function (h) {
      if (!h || typeof h.id !== "string" || typeof h.feed !== "string" || !live[h.feed]) return;
      add(h.id, h.feed, h.title, h.snip, h.author, h.date);
    });
    return out;
  }

  var PROVIDER = {
    id: "feeds",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || typeof d !== "object") return [];
      return heads().then(function (list) { return build(ctx, d, list); },
                          function () { return build(ctx, d, []); });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
