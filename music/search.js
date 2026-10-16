// ============================================================
// orOS Music — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-music-data (playlists, liked
// songs) and the device's index (IndexedDB "oros-music", store
// "tracks"), never writes either.
// Hits:
//   - one per playlist (name; number of songs as text);
//   - one per song this device has (title; artist · album as text);
//   - one per album (album name; artist as text).
// Liked songs that are not on this device are left out (nothing to
// play). The IndexedDB is opened WITHOUT a version: a device that
// never ran Music has no database, and the upgrade is aborted so
// nothing gets created. The index is re-read at most every 10 s.
// Opens through the generic deep link: target { pl } | { track } |
// { album }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-music-data";
  var DB_NAME = "oros-music";
  var FRESH_MS = 10000;
  var cache = null;          // { at, idb, list }

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }
  // Same album key as core.js (albumKey): "b:" + hash(fold(artist) | fold(album)).
  function fold(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  function hash(text) {
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 16777619);
      h2 ^= c; h2 = Math.imul(h2 ^ (h2 >>> 13), 0x5bd1e995);
    }
    return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 14);
  }
  function albumKey(r) { var al = fold(r.al); return al ? "b:" + hash(fold(r.aa || r.a) + "|" + al) : ""; }

  function readTracks() {
    var idb = null;
    try { idb = root.indexedDB; } catch (e) { idb = null; }
    if (cache && cache.idb === idb && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.list);
    return new Promise(function (resolve) {
      if (!idb || typeof idb.open !== "function") { resolve([]); return; }
      var rq;
      try { rq = idb.open(DB_NAME); } catch (e) { resolve([]); return; }
      rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (e) {} };
      rq.onerror = function (e) { if (e && typeof e.preventDefault === "function") e.preventDefault(); resolve([]); };
      rq.onblocked = function () { resolve([]); };
      rq.onsuccess = function () {
        var db = rq.result, out = [];
        function done() { try { db.close(); } catch (e) {} cache = { at: Date.now(), idb: idb, list: out }; resolve(out); }
        try {
          if (!db.objectStoreNames.contains("tracks")) { done(); return; }
          var tx = db.transaction("tracks", "readonly"), r = tx.objectStore("tracks").getAll();
          r.onsuccess = function () {
            out = (r.result || []).filter(function (x) { return x && typeof x.k === "string"; })
              .map(function (x) { return { k: x.k, t: str(x.t), a: str(x.a), aa: str(x.aa), al: str(x.al) }; });
          };
          tx.oncomplete = done;
          tx.onerror = tx.onabort = done;
        } catch (e) { done(); }
      };
    });
  }

  function build(ctx, d, list) {
    var out = [], el = ctx.lang === "el";
    var tombs = d && d.tombs && typeof d.tombs === "object" ? d.tombs : {};
    (d && Array.isArray(d.pls) ? d.pls : []).forEach(function (p) {
      if (!p || typeof p.id !== "string") return;
      if (typeof tombs[p.id] === "number" && tombs[p.id] >= (p.m || 0)) return;
      var n = Array.isArray(p.it) ? p.it.length : 0;
      out.push({ id: p.id, title: str(p.n) || (el ? "Λίστα" : "Playlist"),
        text: (el ? "Λίστα · " : "Playlist · ") + n + (el ? (n === 1 ? " τραγούδι" : " τραγούδια") : (n === 1 ? " song" : " songs")),
        target: { pl: p.id } });
    });
    var seenSong = {}, albums = {};
    list.forEach(function (r) {
      if (!seenSong[r.k]) {
        seenSong[r.k] = 1;
        out.push({ id: r.k, title: r.t || "?", text: [r.a, r.al].filter(Boolean).join(" · "), target: { track: r.k } });
      }
      var ak = albumKey(r);
      if (ak && !albums[ak]) albums[ak] = { id: ak, title: r.al, text: (el ? "Άλμπουμ · " : "Album · ") + (r.aa || r.a || ""), target: { album: ak } };
    });
    Object.keys(albums).forEach(function (k) { out.push(albums[k]); });
    return out;
  }

  var PROVIDER = {
    id: "music",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      return readTracks().then(function (list) { return build(ctx, d, list); }, function () { return build(ctx, d, []); });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var reg = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < reg.length; i++) if (reg[i] && reg[i].id === PROVIDER.id) return;
    reg.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
