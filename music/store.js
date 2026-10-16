// ============================================================
// orOS Music — store.js (device-local index, v1.0.0)
// IndexedDB "oros-music", never synced:
//   tracks  keyPath "p" (orOS disk path): what the scan read from
//           each file { p, sz, mt, k, t, a, aa, al, n, dn, g, y, d,
//           art, add, fmt }
//   art     keyPath "id": one small JPEG per album (or per song with
//           no album) { id, blob }
// The music files themselves live on the orOS disk (/internal/Music,
// window.orosFS), where Files shows them and Vault Drive syncs them
// like any other file. This index can always be rebuilt from them.
// Loaded in the app window and in the shell (host.js, covers for
// the lock screen).
// ============================================================
(function (w) {
  "use strict";
  if (w.OrosMusicStore) return;
  var NAME = "oros-music", VER = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var idb = null;
      try { idb = w.indexedDB; } catch (e) { idb = null; }
      if (!idb) { reject(new Error("no-idb")); return; }
      var rq = idb.open(NAME, VER);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains("tracks")) db.createObjectStore("tracks", { keyPath: "p" });
        if (!db.objectStoreNames.contains("art")) db.createObjectStore("art", { keyPath: "id" });
      };
      rq.onsuccess = function () {
        var db = rq.result;
        // Factory reset / another tab upgrading: let go, reopen on next use.
        db.onversionchange = function () { try { db.close(); } catch (e) {} dbp = null; };
        resolve(db);
      };
      rq.onerror = function () { dbp = null; reject(rq.error || new Error("idb")); };
      rq.onblocked = function () { dbp = null; reject(new Error("blocked")); };
    });
    return dbp;
  }
  function run(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode), os = tx.objectStore(store), out;
        try { out = fn(os); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(out && typeof out === "object" && "readyState" in out ? out.result : out); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error("tx")); };
      });
    });
  }
  function all() {
    return run("tracks", "readonly", function (os) { return os.getAll(); }).then(function (r) { return Array.isArray(r) ? r : []; });
  }
  function putTracks(list) {
    if (!list || !list.length) return Promise.resolve(0);
    return run("tracks", "readwrite", function (os) { list.forEach(function (r) { os.put(r); }); return list.length; });
  }
  function delTracks(paths) {
    if (!paths || !paths.length) return Promise.resolve(0);
    return run("tracks", "readwrite", function (os) { paths.forEach(function (p) { os.delete(p); }); return paths.length; });
  }
  function getTrack(p) { return run("tracks", "readonly", function (os) { return os.get(p); }); }
  function getArt(id) {
    if (!id) return Promise.resolve(null);
    return run("art", "readonly", function (os) { return os.get(id); }).then(function (r) { return r && r.blob ? r.blob : null; }, function () { return null; });
  }
  function hasArt(id) { return run("art", "readonly", function (os) { return os.count(id); }).then(function (n) { return n > 0; }, function () { return false; }); }
  function putArt(id, blob) { return run("art", "readwrite", function (os) { os.put({ id: id, blob: blob }); return true; }); }
  function artIds() { return run("art", "readonly", function (os) { return os.getAllKeys(); }).then(function (r) { return r || []; }); }
  function delArt(ids) {
    if (!ids || !ids.length) return Promise.resolve(0);
    return run("art", "readwrite", function (os) { ids.forEach(function (id) { os.delete(id); }); return ids.length; });
  }
  // Duration learnt while playing (the scan could not read it).
  function setDuration(p, d) {
    return getTrack(p).then(function (r) {
      if (!r || r.d || !(d > 0)) return false;
      r.d = Math.round(d);
      return putTracks([r]).then(function () { return true; });
    }).catch(function () { return false; });
  }

  w.OrosMusicStore = { open: open, all: all, putTracks: putTracks, delTracks: delTracks, getTrack: getTrack, getArt: getArt,
    hasArt: hasArt, putArt: putArt, artIds: artIds, delArt: delArt, setDuration: setDuration };
})(window);
