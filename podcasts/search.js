// ============================================================
// orOS Podcasts — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-podcasts-data and the device's
// feed cache (IndexedDB "oros-podcasts", store "feeds"), never
// writes either.
// Hits:
//   - one per subscription (show title; author and address as
//     text);
//   - one per episode title this device keeps for a subscribed
//     show (show name as text; `when` = the publish date).
// Skipped: shows a tombs{} entry covers (delete wins ties, as in
// core.js merge) and cached feeds of shows no longer subscribed.
// Show notes and downloads are not searched.
// The IndexedDB is opened WITHOUT a version: a device that never
// ran Podcasts has no database, and the upgrade is aborted so
// nothing gets created. The cache is re-read at most every 10 s.
// Opens through the generic deep link: target { show } or
// { show, ep }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-podcasts-data";
  var DB_NAME = "oros-podcasts";
  var FRESH_MS = 10000;
  var feedsCache = null;       // { at, idb, byId }

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

  // showId → [{ id, title, pub }] (titles only: the notes stay out).
  function cachedFeeds() {
    var idb = null;
    try { idb = root.indexedDB; } catch (e) { idb = null; }
    if (feedsCache && feedsCache.idb === idb && Date.now() - feedsCache.at < FRESH_MS) {
      return Promise.resolve(feedsCache.byId);
    }
    return readStore(DB_NAME, "feeds").then(function (list) {
      var byId = {};
      (Array.isArray(list) ? list : []).forEach(function (r) {
        if (!r || typeof r.id !== "string" || !Array.isArray(r.eps)) return;
        byId[r.id] = r.eps.map(function (e) {
          return e && typeof e.id === "string" ? { id: e.id, title: str(e.title), pub: e.pub } : null;
        }).filter(Boolean);
      });
      feedsCache = { at: Date.now(), idb: idb, byId: byId };
      return byId;
    });
  }

  function build(ctx, d, eps) {
    var out = [];
    var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
    var words = ctx.words || [], fold = ctx.fold || function (s) { return String(s).toLowerCase(); };
    (Array.isArray(d.shows) ? d.shows : []).forEach(function (s) {
      if (!s || typeof s.id !== "string") return;
      var t = tombs[s.id];
      if (typeof t === "number" && t >= (typeof s.m === "number" ? s.m : 0)) return;
      var url = str(s.url);
      var name = str(s.title) || url || (ctx.lang === "el" ? "Podcast χωρίς όνομα" : "Untitled podcast");
      out.push({
        id: s.id,
        title: name,
        text: [str(s.by), url].filter(Boolean).join(" · "),
        target: { show: s.id }
      });
      (eps[s.id] || []).forEach(function (e) {
        var title = e.title || (ctx.lang === "el" ? "Επεισόδιο χωρίς τίτλο" : "Untitled episode");
        // every word in the title or the show name, one in the title
        // (the show's own name alone does not list all its episodes)
        var ft = fold(title), hay = ft + " " + fold(name), inTitle = !words.length;
        for (var i = 0; i < words.length; i++) {
          if (hay.indexOf(words[i]) === -1) return;
          if (ft.indexOf(words[i]) !== -1) inTitle = true;
        }
        if (!inTitle) return;
        out.push({
          id: e.id,
          title: title,
          text: name,
          when: typeof e.pub === "number" && isFinite(e.pub) && e.pub > 0 ? e.pub : 0,
          target: { show: s.id, ep: e.id }
        });
      });
    });
    return out;
  }

  var PROVIDER = {
    id: "podcasts",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || typeof d !== "object" || !Array.isArray(d.shows) || !d.shows.length) return [];
      return cachedFeeds().then(function (eps) { return build(ctx, d, eps); },
                                function () { return build(ctx, d, {}); });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
