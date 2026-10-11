// ============================================================
// orOS Atelier — folders.js: folders for designs (v1.0.0)
// One record per user, synced as its own slice "atelier-folders"
// (oros-atelier-folders), separate from the designs (the design
// slice's merge keeps only the fields it knows):
//   { ver: 1,
//     folders: [{ id "af-…", m, nm (name), pos }]   ≤ 200
//     place:   { docId: { f (folder id, "" = none), m } }   ≤ 20000
//     dt:      { folderId: m }   tombstones of deleted folders }
// A design is in at most one folder. A place that names a folder
// that no longer exists counts as "no folder". Deleting a folder
// never deletes its designs.
// Merge: per folder and per place the newer stamp wins (equal
// stamps: the larger canonical JSON, so both sides agree); a
// tombstone removes a folder not newer than it. Canonical: fixed
// key order, folders sorted by pos then id, place keys sorted (R26).
// Pure: no DOM. Exposes window.AtelierFolders (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1, MAX_FOLDERS = 200, MAX_PLACE = 20000, MAX_TOMBS = 400;
  var FID = /^af-[a-z0-9]{6,24}$/;
  var DOC = /^[a-z]{1,4}-[a-z0-9]{1,24}$/;          // designkit model ids

  function stamp(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : 0; }
  function num(v) { return typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : 0; }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function name(v) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) : ""; }

  function normFolder(x) {
    if (!x || !FID.test(x.id)) return null;
    var m = stamp(x.m), nm = name(x.nm);
    if (!m || !nm) return null;
    return { id: x.id, m: m, nm: nm, pos: num(x.pos) };
  }
  function normPlace(x) {
    if (!x || typeof x !== "object") return null;
    var m = stamp(x.m);
    if (!m) return null;
    var f = typeof x.f === "string" && FID.test(x.f) ? x.f : "";
    return { f: f, m: m };
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  // merge(a, b) with b optional: also the normalizer
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var dt = {};
    [a.dt, b.dt].forEach(function (t) {
      if (!t || typeof t !== "object") return;
      Object.keys(t).forEach(function (id) {
        var m = stamp(t[id]);
        if (FID.test(id) && m && !(dt[id] >= m)) dt[id] = m;
      });
    });
    var by = {};
    [a.folders, b.folders].forEach(function (l) {
      if (!Array.isArray(l)) return;
      l.forEach(function (x) { var n = normFolder(x); if (n) by[n.id] = newer(by[n.id], n); });
    });
    var folders = Object.keys(by).map(function (id) { return by[id]; })
      .filter(function (x) { return !(dt[x.id] >= x.m); })
      .sort(function (p, q) { return p.pos - q.pos || cmp(p.id, q.id); })
      .slice(0, MAX_FOLDERS);
    var pl = {};
    [a.place, b.place].forEach(function (p) {
      if (!p || typeof p !== "object") return;
      Object.keys(p).forEach(function (d) {
        if (!DOC.test(d)) return;
        var n = normPlace(p[d]);
        if (n) pl[d] = newer(pl[d], n);
      });
    });
    // keep the newest places when there are too many
    var keys = Object.keys(pl);
    if (keys.length > MAX_PLACE) keys = keys.sort(function (p, q) { return pl[q].m - pl[p].m || cmp(p, q); }).slice(0, MAX_PLACE);
    var place = {};
    keys.sort(cmp).forEach(function (d) { place[d] = pl[d]; });
    var tids = Object.keys(dt).sort(function (p, q) { return dt[q] - dt[p] || cmp(p, q); }).slice(0, MAX_TOMBS).sort(cmp);
    var dtOut = {};
    tids.forEach(function (id) { dtOut[id] = dt[id]; });
    return { ver: VER, folders: folders, place: place, dt: dtOut };
  }
  function norm(x) { return merge(x, null); }
  function empty() { return { ver: VER, folders: [], place: {}, dt: {} }; }

  function newId() {
    var s = "", a = new Uint8Array(10);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < a.length; j++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[a[j] % 36];
    return "af-" + s;
  }

  // the folder a design is in ("" = none, also when that folder is gone)
  function folderOf(r, docId) {
    var p = r.place[docId];
    if (!p || !p.f) return "";
    return r.folders.some(function (x) { return x.id === p.f; }) ? p.f : "";
  }

  // Mutations return a new normalized record (now: ms stamp).
  function add(r, nm, now, id) {
    r = norm(r); nm = name(nm);
    if (!nm || r.folders.length >= MAX_FOLDERS) return { r: r, id: "" };
    id = id && FID.test(id) ? id : newId();
    var pos = r.folders.reduce(function (p, x) { return Math.max(p, x.pos); }, 0) + 1;
    r.folders.push({ id: id, m: now, nm: nm, pos: pos });
    return { r: norm(r), id: id };
  }
  function rename(r, id, nm, now) {
    r = norm(r); nm = name(nm);
    r.folders.forEach(function (x) { if (x.id === id && nm) { x.nm = nm; x.m = Math.max(now, x.m + 1); } });
    return norm(r);
  }
  // the designs inside go back to "no folder" (they are never deleted)
  function remove(r, id, now) {
    r = norm(r);
    var f = r.folders.filter(function (x) { return x.id === id; })[0];
    if (!f) return r;
    r.dt[id] = Math.max(now, f.m);
    Object.keys(r.place).forEach(function (d) {
      if (r.place[d].f === id) r.place[d] = { f: "", m: Math.max(now, r.place[d].m + 1) };
    });
    return norm(r);
  }
  function move(r, docIds, folderId, now) {
    r = norm(r);
    if (folderId && !r.folders.some(function (x) { return x.id === folderId; })) return r;
    docIds.forEach(function (d) {
      if (!DOC.test(d)) return;
      var old = r.place[d];
      if (old ? old.f === (folderId || "") : !folderId) return;
      r.place[d] = { f: folderId || "", m: Math.max(now, old ? old.m + 1 : 0) };
    });
    return norm(r);
  }
  var api = { VER: VER, MAX_FOLDERS: MAX_FOLDERS, merge: merge, norm: norm, empty: empty, folderOf: folderOf,
    add: add, rename: rename, remove: remove, move: move };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierFolders = api;
})(typeof window !== "undefined" ? window : this);
