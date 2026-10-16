// ============================================================
// orOS Bookmarks — .orosbookmarks file (bookmarks/package.js,
// window.OrosBookmarksPackage). The descriptor of Bookmarks for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every bookmark and folder (with its nesting) in one orOS
// bundle; opening one ADDS what this device lacks, with its ids. Pure
// (no DOM, no storage), so the app and `node --test` run the same
// code. Needs core.js (window.OrosBookmarksCore; require("./core.js")
// under Node).
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; bookmarks.js then runs the
//                            result through settle + canonState + save,
//                            so sync carries it)
//   DESC.norm(data)          a file's data → { ver, folders, items } with
//                            the app's own record checks (http/https
//                            addresses only, known fields, typed and
//                            capped; missing stamps are 0, never "now")
//   DESC.strip(state)        the slice → { ver, folders, items }: no
//                            tombstones (deleted), no settings, no root
//                            folder ("unsorted" is on every device), no
//                            saved-copy record (arch: the copies are
//                            files in /internal/Bookmarks/Archive and
//                            are not in the file for now)
//   DESC.tombIds(state)      the ids in state.deleted
//   DESC.previews(state)     bookmarks.html (core.js buildNetscape, the
//                            app's own "Export bookmarks")
//   settle(local, next, addedIds, updatedIds, now)
//                            after the kit's open: "added" and
//                            "lastVisit" of the file's records clamped
//                            to now + 5 min; an updated bookmark keeps
//                            this device's saved copy, visits and the
//                            newer link check (as the sync merge does)
//   kindOf(id, state)        "item" | "folder" | ""
// ============================================================
(function (root) {
  "use strict";

  var K = typeof module === "object" && module.exports ? require("./core.js") : root.OrosBookmarksCore;
  var ROOT = "unsorted";
  var LIM = { items: 100000, folders: 5000, tags: 12, tag: 32, title: 256, note: 1024, url: 2048, name: 64 };
  var RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  var FUTURE = 5 * 60 * 1000;

  var hasOwn = Object.prototype.hasOwnProperty;
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function ts(v) { return typeof v === "number" && isFinite(v) && v > 0 && v < 1e15 ? Math.floor(v) : 0; }
  function text(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
  function line(v, max) { return text(typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ") : v, max); }

  function normItem(raw, id) {
    if (!isObj(raw) || !RE_ID.test(id) || raw.id !== id) return null;
    var url = text(raw.url, LIM.url);
    if (!/^https?:\/\//i.test(url) || !K.normUrl(url)) return null;
    var out = {
      id: id, url: url,
      title: line(raw.title, LIM.title) || url,
      note: text(typeof raw.note === "string" ? raw.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ") : "", LIM.note),
      folderId: typeof raw.folderId === "string" && RE_ID.test(raw.folderId) ? raw.folderId : ROOT,
      tags: (Array.isArray(raw.tags) ? raw.tags : []).slice(0, LIM.tags)
        .map(function (tg) { return line(tg, LIM.tag); }).filter(Boolean),
      status: raw.status === "dead" ? "dead" : raw.status === "unknown" ? "unknown" : "ok",
      visits: Math.max(0, Math.min(1e9, Math.floor(typeof raw.visits === "number" && isFinite(raw.visits) ? raw.visits : 0))),
      lastVisit: ts(raw.lastVisit),
      fav: raw.fav === true,
      pos: typeof raw.pos === "number" && isFinite(raw.pos) ? raw.pos : null,
      added: ts(raw.added),
      modified: ts(raw.modified)
    };
    var chk = K.sanChk(raw.chk);
    if (chk) out.chk = chk;
    return out;
  }
  function normFolder(raw, id) {
    if (!isObj(raw) || !RE_ID.test(id) || raw.id !== id || id === ROOT) return null;
    var name = line(raw.name, LIM.name);
    if (!name) return null;
    var out = { id: id, name: name, pos: typeof raw.pos === "number" && isFinite(raw.pos) ? raw.pos : 1000,
                modified: ts(raw.modified) };
    if (typeof raw.parent === "string" && RE_ID.test(raw.parent) && raw.parent !== id && raw.parent !== ROOT) out.parent = raw.parent;
    return out;
  }
  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: 1, folders: {}, items: {} };
    if (isObj(data.deleted)) out.deleted = data.deleted;        // strip and tombIds see it, then it goes
    if (isObj(data.folders)) Object.keys(data.folders).sort().slice(0, LIM.folders).forEach(function (id) {
      var f = normFolder(data.folders[id], id);
      if (f) out.folders[id] = f;
    });
    if (isObj(data.items)) Object.keys(data.items).sort().slice(0, LIM.items).forEach(function (id) {
      var it = normItem(data.items[id], id);
      if (it) out.items[id] = it;
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: 1, folders: {}, items: {} };
    if (isObj(s.folders)) Object.keys(s.folders).forEach(function (id) {
      if (id !== ROOT && hasOwn.call(s.folders, id)) out.folders[id] = s.folders[id];
    });
    if (isObj(s.items)) Object.keys(s.items).forEach(function (id) {
      var it = s.items[id];
      if (!isObj(it)) return;
      var c = {};
      Object.keys(it).forEach(function (k) { if (k !== "arch") c[k] = it[k]; });
      out.items[id] = c;
    });
    return JSON.parse(JSON.stringify(out));
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.deleted) ? Object.keys(state.deleted) : [];
  }

  // bookmarks.html: the same tree as the app's "Export bookmarks"
  // (Unsorted at the top, empty branches left out, newest first).
  function previews(state) {
    var folders = isObj(state.folders) ? state.folders : {}, items = isObj(state.items) ? state.items : {};
    var by = {};
    Object.keys(items).forEach(function (id) {
      var it = items[id], f = it.folderId && hasOwn.call(folders, it.folderId) ? it.folderId : ROOT;
      (by[f] || (by[f] = [])).push(it);
    });
    function list(fid) {
      return (by[fid] || []).slice().sort(function (a, b) { return (b.added - a.added) || (a.id < b.id ? -1 : 1); });
    }
    // the effective tree (core.parentOf: cycles and lost parents are
    // top level), each folder's parent worked out once
    var kidsOf = {};
    Object.keys(folders).forEach(function (id) {
      var p = K.parentOf(folders, id);
      (kidsOf[p] || (kidsOf[p] = [])).push(id);
    });
    function kids(pid) {
      return (kidsOf[pid] || []).slice().sort(function (a, b) {
        return ((Number(folders[a].pos) || 0) - (Number(folders[b].pos) || 0)) || (a < b ? -1 : a > b ? 1 : 0);
      });
    }
    function node(fid) {
      var sub = kids(fid).map(node).filter(Boolean), its = list(fid);
      if (!sub.length && !its.length) return null;
      return { name: folders[fid].name, items: its, folders: sub };
    }
    var built = K.buildNetscape({ items: list(ROOT), folders: kids("").map(node).filter(Boolean) });
    return { "bookmarks.html": built.count ? built.text : "" };
  }

  // After the kit's open, before canonState + save (see the header).
  function settle(local, next, addedIds, updatedIds, now) {
    var lim = (typeof now === "number" ? now : Date.now()) + FUTURE;
    var items = isObj(next) && isObj(next.items) ? next.items : {};
    var mine = isObj(local) && isObj(local.items) ? local.items : {};
    function clamp(it) {
      ["added", "lastVisit"].forEach(function (k) { if (typeof it[k] === "number" && it[k] > lim) it[k] = lim; });
    }
    (addedIds || []).forEach(function (id) { if (isObj(items[id])) clamp(items[id]); });
    (updatedIds || []).forEach(function (id) {
      var it = items[id], old = mine[id];
      if (!isObj(it)) return;
      clamp(it);
      if (!isObj(old)) return;
      it.visits = Math.max(it.visits || 0, old.visits || 0);
      it.lastVisit = Math.max(it.lastVisit || 0, old.lastVisit || 0);
      var chk = K.sideMerge(K.sanChk(old.chk), K.sanChk(it.chk));
      if (chk) it.chk = chk; else delete it.chk;
      var arch = K.sanArch(old.arch);
      if (arch) it.arch = arch; else delete it.arch;
    });
    return next;
  }

  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    if (isObj(s.items) && hasOwn.call(s.items, id)) return "item";
    if (isObj(s.folders) && hasOwn.call(s.folders, id)) return "folder";
    return "";
  }

  var DESC = {
    app: "bookmarks", title: "Bookmarks", slice: "bookmarks", ext: ".orosbookmarks", mime: "application/x-oros-bookmarks",
    colls: {
      folders: { shape: "map", id: "id", stamp: "modified" },
      items: { shape: "map", id: "id", stamp: "modified", clampIn: ["chk"] }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, settle: settle, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosBookmarksPackage = api;
})(this);
