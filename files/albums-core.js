// ============================================================
// orOS Files — albums-core.js (ALB v1, wave P2): the virtual albums
// of the Photos view. Pure, no DOM, no disk. Exposes
// window.OrosAlbumsCore (browser) or module.exports (tests).
//
// An album lists photos, it never holds them (Chris 2026-11-13
// «Εικονικά»): a photo stays where it is on the disk, and removing it
// from an album or deleting the album never touches the file.
//
// State (slice "files-photos", key "oros-files-albums"):
//   { v: 1,
//     albums: [{ id "a-…", m, n (name), cv? (cover item key),
//                it: [{ k, p, m, x? }] }],         sorted by id, it by k
//     tombs: { id: ms } }
// An item key k is "h:<sha256>" (the vault manifest knows the file:
// the album follows it through moves and renames on every device) or
// "p:<path>" (a file sync does not hold); p is the last known path.
//
// Merge (R5, R17, R26): per album the fields (n, cv) go with the
// larger m (equal m: larger canonical JSON); per item the larger m
// wins (equal m: the removal, then larger JSON). A deleted album
// leaves a tomb; a tomb at or after the album's newest touch (its m
// or any item's m) hides it, so a later edit elsewhere brings it
// back (the tomb stays, so an old copy met later stays hidden). Every writer stamps max(now, newest stamp it replaces + 1),
// so a local edit always wins locally, and an unchanged edit returns
// the same state object (R27). Caps: 500 albums, 10,000 items per
// album, 1,000 removed items and 500 tombs kept (newest first).
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-files-albums";
  var SLICE = "files-photos";
  var ROOT = "/internal/";
  var MAX_ALBUMS = 500, MAX_ITEMS = 10000, MAX_GONE = 1000, MAX_TOMBS = 500;
  var MAX_NAME = 80, MAX_PATH = 1024;
  var HKEY = /^h:[0-9a-f]{64}$/;

  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function stamp(n) { return typeof n === "number" && isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  function okPath(p) {
    return typeof p === "string" && p.indexOf(ROOT) === 0 && p.length <= MAX_PATH &&
      p.indexOf("\u0000") < 0 && !/(^|\/)\.\.?(\/|$)/.test(p.slice(ROOT.length));
  }
  function okKey(k) {
    if (typeof k !== "string") return false;
    if (HKEY.test(k)) return true;
    return k.indexOf("p:") === 0 && okPath(k.slice(2));
  }
  function cleanName(n) {
    if (typeof n !== "string") return "";
    return n.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  }
  function canon(o) { return JSON.stringify(o); }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
  function byK(a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; }

  // ---------- normalising ----------
  function normItem(o) {
    if (!isObj(o) || !okKey(o.k)) return null;
    var m = stamp(o.m);
    if (!m) return null;
    var it = { k: o.k, p: okPath(o.p) ? o.p : (o.k.indexOf("p:") === 0 ? o.k.slice(2) : ""), m: m };
    if (!it.p) return null;
    if (o.x) it.x = 1;
    return it;
  }
  // Items of one album: one per key (the winner), live ones capped,
  // removed ones kept newest first up to MAX_GONE.
  function itemWins(a, b) {
    if (a.m !== b.m) return a.m > b.m;
    if (!!a.x !== !!b.x) return !!a.x;
    return canon(a) > canon(b);
  }
  function normItems(arr) {
    var map = {};
    (Array.isArray(arr) ? arr : []).forEach(function (o) {
      var it = normItem(o);
      if (!it) return;
      var cur = map[it.k];
      if (!cur || itemWins(it, cur)) map[it.k] = it;
    });
    var live = [], gone = [];
    Object.keys(map).forEach(function (k) { (map[k].x ? gone : live).push(map[k]); });
    function newest(a, b) { return b.m - a.m || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); }
    if (live.length > MAX_ITEMS) live = live.sort(newest).slice(0, MAX_ITEMS);
    if (gone.length > MAX_GONE) gone = gone.sort(newest).slice(0, MAX_GONE);
    return live.concat(gone).sort(byK);
  }
  function touched(a) {
    var m = a.m;
    for (var i = 0; i < a.it.length; i++) if (a.it[i].m > m) m = a.it[i].m;
    return m;
  }
  function normAlbum(o) {
    if (!isObj(o) || typeof o.id !== "string" || !/^a-[A-Za-z0-9_-]{1,40}$/.test(o.id)) return null;
    var m = stamp(o.m);
    if (!m) return null;
    var a = { id: o.id, m: m, n: cleanName(o.n), it: normItems(o.it) };
    if (okKey(o.cv)) a.cv = o.cv;
    if (!a.n) a.n = "…";
    return a;
  }
  function fieldsWin(a, b) {
    if (a.m !== b.m) return a.m > b.m;
    return canon({ n: a.n, cv: a.cv || "" }) > canon({ n: b.n, cv: b.cv || "" });
  }
  function joinAlbums(a, b) {
    var f = fieldsWin(a, b) ? a : b;
    var out = { id: a.id, m: Math.max(a.m, b.m), n: f.n, it: normItems(a.it.concat(b.it)) };
    if (f.cv) out.cv = f.cv;
    return out;
  }
  function norm(raw) {
    var o = isObj(raw) ? raw : {};
    var tombs = {};
    if (isObj(o.tombs)) {
      var tk = Object.keys(o.tombs).filter(function (k) { return /^a-[A-Za-z0-9_-]{1,40}$/.test(k) && stamp(o.tombs[k]); });
      if (tk.length > MAX_TOMBS) tk = tk.sort(function (x, y) { return o.tombs[y] - o.tombs[x] || (x < y ? -1 : 1); }).slice(0, MAX_TOMBS);
      tk.sort().forEach(function (k) { tombs[k] = stamp(o.tombs[k]); });
    }
    var map = {};
    (Array.isArray(o.albums) ? o.albums : []).forEach(function (x) {
      var a = normAlbum(x);
      if (!a) return;
      map[a.id] = map[a.id] ? joinAlbums(map[a.id], a) : a;
    });
    var albums = Object.keys(map).map(function (k) { return map[k]; })
      .filter(function (a) { return !(tombs[a.id] && tombs[a.id] >= touched(a)); });
    if (albums.length > MAX_ALBUMS) albums = albums.sort(function (x, y) { return touched(y) - touched(x) || byId(x, y); }).slice(0, MAX_ALBUMS);
    albums.sort(byId);
    return { v: 1, albums: albums, tombs: tombs };
  }

  function merge(a, b) {
    a = norm(a); b = norm(b);
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (t) {
      Object.keys(t).forEach(function (k) { if (!tombs[k] || t[k] > tombs[k]) tombs[k] = t[k]; });
    });
    return norm({ v: 1, albums: a.albums.concat(b.albums), tombs: tombs });
  }

  // ---------- reading ----------
  function find(s, id) {
    for (var i = 0; i < s.albums.length; i++) if (s.albums[i].id === id) return s.albums[i];
    return null;
  }
  function live(a) { return a ? a.it.filter(function (it) { return !it.x; }) : []; }
  // Albums for the list: by name (locale order is the caller's), then id.
  function list(s) { return s.albums.slice(); }
  // The key a photo record goes into an album under.
  function keyOf(rec) {
    if (!rec) return "";
    if (typeof rec.h === "string" && /^[0-9a-f]{64}$/.test(rec.h)) return "h:" + rec.h;
    return okPath(rec.k) ? "p:" + rec.k : "";
  }
  // Matches album items to the records found on this device: by hash
  // first, then by key path, then by the last known path.
  function resolve(a, recs) {
    var byH = {}, byP = {};
    (recs || []).forEach(function (r) {
      if (r.h) byH[r.h] = r;
      byP[r.k] = r;
    });
    var found = [], missing = 0;
    live(a).forEach(function (it) {
      var r = it.k.indexOf("h:") === 0 ? byH[it.k.slice(2)] : byP[it.k.slice(2)];
      if (!r) r = byP[it.p];
      if (r) found.push(r); else missing++;
    });
    return { recs: found, missing: missing };
  }
  function albumsWith(s, key) {
    return s.albums.filter(function (a) {
      for (var i = 0; i < a.it.length; i++) if (a.it[i].k === key && !a.it[i].x) return true;
      return false;
    }).map(function (a) { return a.id; });
  }

  // ---------- writing (each returns a new state, or s unchanged) ----------
  function newId(now, rnd) {
    var r = typeof rnd === "function" ? rnd : Math.random;
    var tail = "";
    for (var i = 0; i < 6; i++) tail += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return "a-" + Math.floor(now).toString(36) + tail;
  }
  function replace(s, a) {
    var albums = s.albums.filter(function (x) { return x.id !== a.id; }).concat([a]).sort(byId);
    return { v: 1, albums: albums, tombs: s.tombs };
  }
  function create(s, name, now, rnd) {
    var n = cleanName(name);
    if (!n || s.albums.length >= MAX_ALBUMS) return { state: s, id: "" };
    var id = newId(now, rnd);
    while (find(s, id) || s.tombs[id]) id = newId(now, rnd);
    var m = Math.max(stamp(now), 1);
    return { state: replace(s, { id: id, m: m, n: n, it: [] }), id: id };
  }
  function rename(s, id, name, now) {
    var a = find(s, id), n = cleanName(name);
    if (!a || !n || n === a.n) return s;
    var out = { id: a.id, m: Math.max(stamp(now), a.m + 1), n: n, it: a.it };
    if (a.cv) out.cv = a.cv;
    return replace(s, out);
  }
  function setCover(s, id, key, now) {
    var a = find(s, id);
    if (!a || (key && !okKey(key)) || (a.cv || "") === (key || "")) return s;
    var out = { id: a.id, m: Math.max(stamp(now), a.m + 1), n: a.n, it: a.it };
    if (key) out.cv = key;
    return replace(s, out);
  }
  function remove(s, id, now) {
    var a = find(s, id);
    if (!a) return s;
    var tombs = {};
    Object.keys(s.tombs).forEach(function (k) { tombs[k] = s.tombs[k]; });
    tombs[id] = Math.max(stamp(now), touched(a));
    return norm({ v: 1, albums: s.albums.filter(function (x) { return x.id !== id; }), tombs: tombs });
  }
  // items: [{ k, p }]; a live item with the same key and path is left.
  function addItems(s, id, items, now) {
    var a = find(s, id);
    if (!a) return s;
    var map = {}, changed = false;
    a.it.forEach(function (it) { map[it.k] = it; });
    var liveN = live(a).length;
    (items || []).forEach(function (x) {
      if (!x || !okKey(x.k) || !okPath(x.p)) return;
      var cur = map[x.k];
      if (cur && !cur.x && cur.p === x.p) return;
      if (!cur || cur.x) { if (liveN >= MAX_ITEMS) return; liveN++; }
      map[x.k] = { k: x.k, p: x.p, m: Math.max(stamp(now), cur ? cur.m + 1 : 1) };
      changed = true;
    });
    if (!changed) return s;
    var out = { id: a.id, m: a.m, n: a.n, it: normItems(Object.keys(map).map(function (k) { return map[k]; })) };
    if (a.cv) out.cv = a.cv;
    return replace(s, out);
  }
  function removeItems(s, id, keys, now) {
    var a = find(s, id);
    if (!a) return s;
    var want = {}, changed = false;
    (keys || []).forEach(function (k) { want[k] = true; });
    var it = a.it.map(function (x) {
      if (!want[x.k] || x.x) return x;
      changed = true;
      return { k: x.k, p: x.p, m: Math.max(stamp(now), x.m + 1), x: 1 };
    });
    if (!changed) return s;
    var out = { id: a.id, m: a.m, n: a.n, it: normItems(it) };
    if (a.cv && !want[a.cv]) out.cv = a.cv;
    else if (a.cv) out.m = Math.max(stamp(now), a.m + 1);   // the cover went: fields changed too
    return replace(s, out);
  }
  // A file this device moved inside Files: path-keyed items follow it
  // (hash-keyed ones only get the new hint). from/to may be folders.
  function carry(s, from, to, now) {
    if (!okPath(from) || !okPath(to) || from === to) return s;
    function moved(p) {
      if (p === from) return to;
      if (p.indexOf(from + "/") === 0) return to + p.slice(from.length);
      return null;
    }
    var next = s;
    s.albums.forEach(function (a) {
      var add = [], drop = [];
      a.it.forEach(function (it) {
        if (it.x) return;
        var np = moved(it.p);
        if (!np || !okPath(np)) return;
        if (it.k.indexOf("p:") === 0) { drop.push(it.k); add.push({ k: "p:" + np, p: np }); }
        else add.push({ k: it.k, p: np });
      });
      if (drop.length) next = removeItems(next, a.id, drop, now);
      if (add.length) next = addItems(next, a.id, add, now);
    });
    return next;
  }

  var api = {
    VERSION: "1.0.0", KEY: KEY, SLICE: SLICE,
    MAX_ALBUMS: MAX_ALBUMS, MAX_ITEMS: MAX_ITEMS, MAX_NAME: MAX_NAME,
    norm: norm, merge: merge, find: find, live: live, list: list, keyOf: keyOf,
    resolve: resolve, albumsWith: albumsWith, touched: touched,
    create: create, rename: rename, setCover: setCover, remove: remove,
    addItems: addItems, removeItems: removeItems, carry: carry, okKey: okKey
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosAlbumsCore = api;
})(this);
