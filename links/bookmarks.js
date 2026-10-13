// ============================================================
// orOS Connected services — Bookmarks platforms (links/bookmarks.js, v1.0.0)
// Pure: the requests that read a Raindrop.io account (collections and
// bookmarks, integrations wave 6C), what the answers mean, and the plan
// that brings them into Bookmarks. No DOM, no storage, no network:
// bookmarks/platforms.js makes the calls through the shell
// (orosLinks.call) and bookmarks.js applies the plan.
//   KINDS[p]: what is read, in order
//   req(p, kind, at) → one GET (at = the page number, 0 first)
//   read(p, kind, data, at) → { items, next } (next -1 = the last page)
//   plan(st, got, ctx) → what changes in Bookmarks (st = its state)
//   count(plan) → { add, upd }
// The platform is only read; Bookmarks stays the source of truth:
//   - a collection (nested ones too, by their own name) → a folder; an
//     existing folder of the same name is used; Unsorted → Unsorted
//   - a bookmark → a bookmark: link, title, note (or the excerpt),
//     tags, "important" as a favourite
//   - ids from L.extId: the same bookmark imported on two devices lands
//     on the same row, and a second import finds it again
//   - a folder or bookmark deleted here is not brought back unless
//     asked; a new link that is already here (same page) is skipped
//   - an update touches only the title and the note, and only adds
//     tags; folder, favourite, visits and order here are never touched
// Everything from the platform is plain text from here on (textContent).
// ============================================================
(function (root) {
  "use strict";

  var L = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosLinksCore;

  var PLATFORMS = ["raindrop"];
  var KINDS = { raindrop: ["collections", "children", "raindrops"] };
  var MAX = { collections: 1000, children: 1000, raindrops: 5000 };
  var PAGE = 50;                                  // Raindrop's largest page
  var ROOT = "unsorted";                          // Bookmarks' root folder
  var TITLE_LEN = 256, NOTE_LEN = 1024, NAME_LEN = 64, TAG_LEN = 32, MAX_TAGS = 12;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function xid(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v ? String(v) : ""; }
  function line(v, max) { return L.cleanText(typeof v === "string" ? v : "", max); }
  function block(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ");
    v = v.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return v.length > max ? v.slice(0, max).trim() : v;
  }
  function key(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function webUrl(v) {
    if (typeof v !== "string" || v.length > 2048 || !/^https?:\/\/[^\s]+$/i.test(v)) return "";
    return v;
  }

  function req(p, kind, at) {
    if (kind === "collections") return { m: "GET", path: "/collections" };
    if (kind === "children") return { m: "GET", path: "/collections/childrens" };
    return { m: "GET", path: "/raindrops/0?perpage=" + PAGE + "&page=" + (at || 0) };
  }

  function readCollection(x) {
    if (!x || typeof x !== "object") return null;
    var id = xid(x._id);
    if (!id || +id <= 0) return null;               // system collections are not folders
    return { xid: id, name: line(x.title, NAME_LEN) };
  }
  function readRaindrop(x) {
    if (!x || typeof x !== "object") return null;
    var id = xid(x._id), url = webUrl(x.link);
    if (!id || !url) return null;
    var col = x.collection && typeof x.collection === "object" ? xid(x.collection.$id) : xid(x.collectionId);
    if (col === "-99") return null;                 // the trash
    var tags = [], seen = {};
    (Array.isArray(x.tags) ? x.tags : []).forEach(function (tg) {
      var s = line(tg, TAG_LEN), k = key(s);
      if (s && !seen[k] && tags.length < MAX_TAGS) { seen[k] = 1; tags.push(s); }
    });
    return {
      xid: id, url: url, col: col && +col > 0 ? col : "",
      title: line(x.title, TITLE_LEN),
      note: block(typeof x.note === "string" && x.note.trim() ? x.note : x.excerpt, NOTE_LEN),
      tags: tags, fav: x.important === true
    };
  }
  // A page: { result, items } (Raindrop). Collections come whole;
  // bookmarks page while a page is full.
  function read(p, kind, data, at) {
    var list = data && typeof data === "object" && Array.isArray(data.items) ? data.items : [];
    var items = [];
    list.forEach(function (x) {
      var r = kind === "raindrops" ? readRaindrop(x) : readCollection(x);
      if (r) items.push(r);
    });
    var next = kind === "raindrops" && list.length >= PAGE ? (at || 0) + 1 : -1;
    return { items: items, next: next };
  }

  // st: Bookmarks' state { items, folders, deleted }
  // got: { collections, children, raindrops } from read
  // ctx: { p, acct, upd, revive, dupe (url → the key Bookmarks compares links by) }
  function plan(st, got, ctx) {
    var p = ctx.p, acct = ctx.acct;
    var items = st && st.items && typeof st.items === "object" ? st.items : {};
    var folders = st && st.folders && typeof st.folders === "object" ? st.folders : {};
    var deleted = st && st.deleted && typeof st.deleted === "object" ? st.deleted : {};
    var dupe = typeof ctx.dupe === "function" ? ctx.dupe : key;
    var out = { folders: { add: [] }, items: { add: [], upd: [] }, same: 0, here: 0, gone: 0 };

    var folderByName = {};
    Object.keys(folders).sort().forEach(function (id) {
      var f = folders[id];
      if (f && typeof f.name === "string" && id !== ROOT && !has(folderByName, key(f.name))) folderByName[key(f.name)] = id;
    });
    var cols = {};
    ((got && got.collections) || []).concat((got && got.children) || []).forEach(function (c) { if (!has(cols, c.xid)) cols[c.xid] = c; });
    var folderOf = {};                              // collection id → folder id ("" = gone)
    function folderFor(col) {
      if (!col || !has(cols, col)) return ROOT;
      if (has(folderOf, col)) return folderOf[col];
      var c = cols[col], k = key(c.name);
      if (!c.name) return (folderOf[col] = ROOT);
      if (has(folderByName, k)) return (folderOf[col] = folderByName[k]);
      var id = L.extId(p, acct, "folder", col);
      if (has(deleted, id) && !ctx.revive) return (folderOf[col] = "");
      folderByName[k] = id;
      out.folders.add.push({ id: id, name: c.name });
      return (folderOf[col] = id);
    }

    var byUrl = {};
    Object.keys(items).forEach(function (id) { var it = items[id]; if (it && typeof it.url === "string") byUrl[dupe(it.url)] = id; });

    ((got && got.raindrops) || []).forEach(function (r) {
      var id = L.extId(p, acct, "bookmark", r.xid);
      var cur = has(items, id) ? items[id] : null;
      if (cur) {
        if (!ctx.upd) { out.same++; return; }
        var f = {};
        if (r.title && cur.title !== r.title) f.title = r.title;
        if (r.note && (cur.note || "") !== r.note) f.note = r.note;
        var tags = Array.isArray(cur.tags) ? cur.tags.slice() : [], low = tags.map(key);
        r.tags.forEach(function (tg) { if (low.indexOf(key(tg)) < 0 && tags.length < MAX_TAGS) { tags.push(tg); low.push(key(tg)); } });
        if (tags.length !== (Array.isArray(cur.tags) ? cur.tags.length : 0)) f.tags = tags;
        if (Object.keys(f).length) out.items.upd.push({ id: id, f: f });
        else out.same++;
        return;
      }
      if (has(deleted, id) && !ctx.revive) { out.gone++; return; }
      var dk = dupe(r.url);
      if (has(byUrl, dk)) { out.here++; return; }
      var fid = folderFor(r.col);
      if (!fid) { out.gone++; return; }
      byUrl[dk] = id;
      out.items.add.push({ id: id, url: r.url, title: r.title || r.url, note: r.note, tags: r.tags, fav: r.fav, folderId: fid });
    });
    // folders no new bookmark needs stay out
    var used = {};
    out.items.add.forEach(function (a) { used[a.folderId] = 1; });
    out.folders.add = out.folders.add.filter(function (f) { return used[f.id]; });
    return out;
  }
  function count(pl) {
    return { add: pl.folders.add.length + pl.items.add.length, upd: pl.items.upd.length };
  }

  var api = { PLATFORMS: PLATFORMS, KINDS: KINDS, MAX: MAX, PAGE: PAGE, ROOT: ROOT, req: req, read: read, plan: plan, count: count };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksBookmarks = api;
})(typeof window !== "undefined" ? window : this);
