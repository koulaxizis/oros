// ============================================================
// orOS Podcasts — store.js (device-local storage, v1.0.0)
// IndexedDB "oros-podcasts", never synced (R30: big data stays out
// of localStorage and out of the sync blob):
//   feeds  showId → { id, at, etag, mod, show, eps[] }   parsed feed cache
//   files  epId   → { id, s, blob, type, size, at }      downloaded episodes
// Loaded twice: by the shell (podcasts/host.js plays downloads while
// the app window is closed) and by the app. Same origin, same DB.
// Every call resolves (null / false on failure): a browser without
// IndexedDB (or a private window) still streams online.
// ============================================================
(function (root) {
  "use strict";
  var DB_NAME = "oros-podcasts", DB_VER = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      var idb;
      try { idb = root.indexedDB; } catch (e) { idb = null; }
      if (!idb) { resolve(null); return; }
      var rq;
      try { rq = idb.open(DB_NAME, DB_VER); } catch (e) { resolve(null); return; }
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains("feeds")) db.createObjectStore("feeds", { keyPath: "id" });
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
      };
      rq.onsuccess = function () {
        var db = rq.result;
        // Another tab upgrades: let it, reopen on the next call.
        db.onversionchange = function () { try { db.close(); } catch (e) {} dbp = null; };
        resolve(db);
      };
      rq.onerror = rq.onblocked = function () { dbp = null; resolve(null); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var t, out = null;
        try { t = db.transaction(store, mode); } catch (e) { resolve(null); return; }
        t.oncomplete = function () { resolve(out); };
        t.onerror = t.onabort = function () { resolve(mode === "readwrite" ? false : null); };
        fn(t.objectStore(store), function (v) { out = v; });
      });
    });
  }
  function get(store, id) {
    return tx(store, "readonly", function (s, done) {
      var r = s.get(id);
      r.onsuccess = function () { done(r.result || null); };
    });
  }
  function put(store, rec) {
    return tx(store, "readwrite", function (s, done) { s.put(rec); done(true); });
  }
  function del(store, id) {
    return tx(store, "readwrite", function (s, done) { s.delete(id); done(true); });
  }
  // All records without the blobs (sizes for the Downloads tab).
  function list(store) {
    return tx(store, "readonly", function (s, done) {
      var out = [];
      var r = s.openCursor();
      r.onsuccess = function () {
        var c = r.result;
        if (!c) { done(out); return; }
        var v = c.value, o = {};
        for (var k in v) if (k !== "blob" && k !== "eps") o[k] = v[k];
        if (v.eps) o.n = v.eps.length;
        out.push(o);
        c.continue();
      };
    }).then(function (x) { return x || []; });
  }

  root.OrosPodcastsStore = {
    open: open,
    getFeed: function (id) { return get("feeds", id); },
    putFeed: function (rec) { return put("feeds", rec); },
    delFeed: function (id) { return del("feeds", id); },
    listFeeds: function () { return list("feeds"); },
    getFile: function (id) { return get("files", id); },
    putFile: function (rec) { return put("files", rec); },
    delFile: function (id) { return del("files", id); },
    listFiles: function () { return list("files"); },
    usage: function () {
      try {
        var st = root.navigator && root.navigator.storage;
        return st && st.estimate ? st.estimate().catch(function () { return null; }) : Promise.resolve(null);
      } catch (e) { return Promise.resolve(null); }
    },
    persist: function () {
      try {
        var st = root.navigator && root.navigator.storage;
        return st && st.persist ? st.persist().catch(function () { return false; }) : Promise.resolve(false);
      } catch (e) { return Promise.resolve(false); }
    }
  };
})(typeof window !== "undefined" ? window : this);
