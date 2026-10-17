// ============================================================
// orOS Bookmarks — import.js (wave 5: "Import from another app")
// Reads a bookmarks file from a read-later app or a browser backup
// and makes the plan of one import. Pure: no DOM, no storage;
// bookmarks.js runs the picker, the preview dialog, the one write
// and the Undo.
//
// Sources (detected from the JSON shape or the CSV header):
//   instapaper  Instapaper CSV (URL, Title, Selection, Folder,
//               Timestamp[, Tags]). Folder Unread → "Instapaper",
//               Archive → "Instapaper › Archive", Starred →
//               "Instapaper" + favourite, any other → "Instapaper ›
//               <name>". Selection → description.
//   wallabag    wallabag JSON export (array of { url, title, tags,
//               is_archived, is_starred, created_at, content… }):
//               "wallabag" / "wallabag › Archive", starred →
//               favourite. The saved article (content) is NOT read.
//   linkwarden  Linkwarden JSON backup ({ collections: [{ name,
//               parentId?, links: [{ name, url, description, tags:
//               [{ name }], createdAt }] }] }): a collection → folder
//               (nested by parentId).
//   linkding    linkding REST-shaped JSON ({ results: [{ url, title,
//               description, tag_names, date_added, unread }] }) →
//               Unsorted. (Its HTML export is the Netscape file.)
//   firefox     Firefox bookmarks backup (.json, Library › Backup):
//               nested x-moz-place-container / x-moz-place; place:
//               queries, separators and the tags root are skipped;
//               the menu goes to the top, the toolbar / other /
//               mobile roots become folders, subfolders nest.
//   chromium    Chrome / Edge / Brave / Vivaldi "Bookmarks" file
//               (roots.bookmark_bar / other / synced; date_added in
//               µs since 1601): the bar and mobile roots become
//               folders, "Other bookmarks" goes to the top.
//   anything else (browser HTML, Pocket, Raindrop, Pinboard, any CSV
//   with a url column) → core.parseImport, as before.
//
// parse(text, name, names) → { kind, entries[] } (core's entry shape:
//   { url, title, path[], tags[], note, added, fav })
// plan(data, res, opts) → what one import does to Bookmarks data:
//   { kind, total, here, bad, from, to,
//     folders: [{ id, name, parent }],          new folders, in order
//     items:   [{ id, url, title, note, tags, fav, added, folderId }] }
//   Ids are stable ("imp-" + hash of the address key / the folder's
//   parent and name), so a second import of the same file adds only
//   what is missing; a link already here (any id, same core.dupeKey)
//   is never touched. Existing folders are matched by name (any case)
//   among their siblings, as the HTML import always did.
// UMD: window.OrosBookmarksImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function core() { return NODE ? require("./core.js") : root.OrosBookmarksCore; }

  var MAX_ENTRIES = 50000;          // bookmarks read from one file
  var MAX_DEPTH = 12;               // folder levels kept
  var ROOT = "unsorted";
  var WEB = /^https?:\/\//i;

  function str(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
  function oneLine(v, n) { return kit().clean(v, n); }
  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }
  function isObj(v) { return !!v && typeof v === "object" && !isArr(v); }

  // ms since 1970 from seconds / ms / µs / an ISO date (0 = none)
  function when(v) {
    if (v == null || v === "") return 0;
    var s = str(v).trim(), t;
    if (/^\d{1,17}$/.test(s)) {
      t = Number(s);
      if (t < 1e11) t *= 1000;
      else if (t > 1e14) t = t / 1000;
    } else t = Date.parse(s);
    if (!isFinite(t) || t < 315532800000 || t > 4102444800000) return 0;   // 1980..2100
    return Math.floor(t);
  }
  // Chromium: µs since 1601-01-01 (a string in the file)
  function chromeWhen(v) {
    var s = str(v).trim();
    if (!/^\d{1,18}$/.test(s)) return 0;
    return when(Math.floor(Number(s) / 1000 - 11644473600000));
  }

  function tagList(v) {
    var raw = [];
    if (isArr(v)) raw = v;
    else if (typeof v === "string") {
      var s = v.trim();
      if (/^\[/.test(s)) { var j = kit().json(s); raw = isArr(j) ? j : s.replace(/[\[\]\x22]/g, "").split(","); }
      else raw = s.split(/[,|]/);
    }
    var seen = {}, out = [];
    raw.forEach(function (x) {
      if (isObj(x)) x = x.name || x.label || x.title || x.slug || "";
      x = oneLine(x, 32).replace(/^#/, "");
      if (!x || seen[x.toLowerCase()] || out.length >= 12) return;
      seen[x.toLowerCase()] = 1;
      out.push(x);
    });
    return out;
  }

  function Out(kind) { this.kind = kind; this.entries = []; }
  Out.prototype.add = function (url, title, path, tags, note, added, fav) {
    if (this.entries.length >= MAX_ENTRIES || typeof url !== "string") return;
    url = url.trim();
    if (!url) return;
    this.entries.push({
      url: url.slice(0, 2048), title: oneLine(title, 256), path: (path || []).slice(0, MAX_DEPTH),
      tags: tags || [], note: kit().cleanText(note, 1024), added: added || 0, fav: fav === true
    });
  };
  Out.prototype.done = function () { return { kind: this.kind, entries: this.entries }; };

  // ---------- Instapaper CSV ----------
  function instapaper(text, names) {
    var K = kit(), t = K.csv(text, { delim: "," });
    var h = t.head;
    var cu = K.col(h, ["url"]), ct = K.col(h, ["title"]), cs = K.col(h, ["selection", "description"]),
        cf = K.col(h, ["folder"]), cd = K.col(h, ["timestamp", "time", "date"]), cg = K.col(h, ["tags", "tag"]);
    var top = names.instapaper || "Instapaper", arch = names.archive || "Archive";
    var o = new Out("instapaper");
    t.rows.forEach(function (r) {
      function v(k) { return k >= 0 && k < r.length ? r[k] : ""; }
      var f = oneLine(v(cf), 64), low = f.toLowerCase(), path = [top], fav = false;
      if (low === "archive") path = [top, arch];
      else if (low === "starred") fav = true;
      else if (f && low !== "unread") path = [top, f];
      o.add(v(cu), v(ct), path, tagList(v(cg)), v(cs), when(v(cd)), fav);
    });
    return o.done();
  }
  function isInstapaper(text) {
    var K = kit(), first = String(text).replace(/^﻿/, "").split(/\r?\n/, 1)[0] || "";
    if (first.length > 300 || first.charAt(0) === "<") return false;
    var h = K.csv(first, { delim: "," }).head;
    return K.col(h, ["url"]) >= 0 && K.col(h, ["selection"]) >= 0 && K.col(h, ["folder"]) >= 0;
  }

  // ---------- wallabag ----------
  function isWallabagEntry(x) {
    return isObj(x) && typeof x.url === "string" &&
      ("is_archived" in x || "is_starred" in x || "reading_time" in x || "domain_name" in x);
  }
  function wallabag(list, names) {
    var top = names.wallabag || "wallabag", arch = names.archive || "Archive";
    var o = new Out("wallabag");
    list.forEach(function (x) {
      if (!isObj(x)) return;
      var archived = x.is_archived === true || x.is_archived === 1 || x.is_archived === "1";
      var starred = x.is_starred === true || x.is_starred === 1 || x.is_starred === "1";
      // content / preview text deliberately not read: metadata only
      o.add(x.url, x.title, archived ? [top, arch] : [top], tagList(x.tags), "",
        when(x.created_at), starred);
    });
    return o.done();
  }

  // ---------- Linkwarden ----------
  function linkwarden(j) {
    var o = new Out("linkwarden");
    var cols = isArr(j.collections) ? j.collections : [];
    var byId = {};
    cols.forEach(function (c) { if (isObj(c) && c.id != null) byId[String(c.id)] = c; });
    function pathOf(c) {
      var out = [], seen = {}, cur = c;
      while (cur && out.length < MAX_DEPTH) {
        var k = cur.id != null ? String(cur.id) : "";
        if (k && seen[k]) break;
        if (k) seen[k] = 1;
        var nm = oneLine(cur.name, 64);
        if (nm) out.unshift(nm);
        cur = cur.parentId != null ? byId[String(cur.parentId)] : (isObj(cur.parent) ? byId[String(cur.parent.id)] : null);
      }
      return out;
    }
    function link(l, path) {
      if (!isObj(l)) return;
      o.add(l.url, l.name || l.title, path, tagList(l.tags), l.description || "",
        when(l.createdAt || l.created_at || l.importDate), l.pinned === true);
    }
    cols.forEach(function (c) {
      if (!isObj(c)) return;
      var p = pathOf(c);
      (isArr(c.links) ? c.links : []).forEach(function (l) { link(l, p); });
    });
    if (isArr(j.links)) j.links.forEach(function (l) {
      var c = isObj(l) && l.collectionId != null ? byId[String(l.collectionId)] : null;
      link(l, c ? pathOf(c) : []);
    });
    return o.done();
  }

  // ---------- linkding (REST shape) ----------
  function isLinkdingEntry(x) { return isObj(x) && typeof x.url === "string" && ("tag_names" in x || "date_added" in x); }
  function linkding(list) {
    var o = new Out("linkding");
    list.forEach(function (x) {
      if (!isObj(x)) return;
      o.add(x.url, x.title || x.website_title, [], tagList(x.tag_names), x.description || x.notes || "",
        when(x.date_added), false);
    });
    return o.done();
  }

  // ---------- Firefox backup ----------
  var FF_ROOTS = {
    bookmarksMenuFolder: "", toolbarFolder: "toolbar", unfiledBookmarksFolder: "other", mobileFolder: "mobile"
  };
  var FF_RAW = /^(menu|toolbar|unfiled|mobile|tags|placesroot)$/i;
  function firefox(j, names) {
    var o = new Out("firefox");
    function desc(n) {
      var a = isArr(n.annos) ? n.annos : [];
      for (var i = 0; i < a.length; i++) {
        if (isObj(a[i]) && a[i].name === "bookmarkProperties/description") return str(a[i].value);
      }
      return "";
    }
    function walk(n, path, depth) {
      if (!isObj(n) || depth > 64) return;
      var type = str(n.type);
      if (type === "text/x-moz-place") {
        var uri = str(n.uri);
        if (/^place:/i.test(uri)) return;             // smart folders, history queries
        o.add(uri, n.title, path, tagList(n.tags), desc(n), when(n.dateAdded), false);
        return;
      }
      if (type !== "text/x-moz-place-container") return; // separators and the rest
      var here = path;
      if (n.root === "tagsFolder") return;              // old backups: tags as folders
      if (n.root && n.root in FF_ROOTS) {
        var r = FF_ROOTS[n.root];
        if (!r) here = [];
        else here = [oneLine(n.title, 64) && !FF_RAW.test(str(n.title)) ? oneLine(n.title, 64) : names["ff." + r]];
      } else if (n.root !== "placesRoot" && depth > 0) {
        var nm = oneLine(n.title, 64);
        if (nm) here = path.concat([nm]);
      }
      (isArr(n.children) ? n.children : []).forEach(function (c) { walk(c, here, depth + 1); });
    }
    walk(j, [], 0);
    return o.done();
  }

  // ---------- Chromium "Bookmarks" ----------
  function chromium(j, names) {
    var o = new Out("chromium");
    function walk(n, path, depth) {
      if (!isObj(n) || depth > 64) return;
      if (n.type === "url") { o.add(n.url, n.name, path, [], "", chromeWhen(n.date_added), false); return; }
      if (n.type !== "folder") return;
      var nm = oneLine(n.name, 64), here = depth === 0 ? path : nm ? path.concat([nm]) : path;
      (isArr(n.children) ? n.children : []).forEach(function (c) { walk(c, here, depth + 1); });
    }
    var R = j.roots;
    function top(n, def) { return [isObj(n) && oneLine(n.name, 64) ? oneLine(n.name, 64) : def]; }
    walk(R.bookmark_bar, top(R.bookmark_bar, names["cr.bar"]), 0);
    walk(R.other, [], 0);
    walk(R.synced, top(R.synced, names["cr.mobile"]), 0);
    return o.done();
  }

  // ---------- detection ----------
  function parseJson(j, names) {
    if (isArr(j)) {
      var firstObj = null;
      for (var i = 0; i < j.length && i < 50; i++) if (isObj(j[i])) { firstObj = j[i]; break; }
      if (isWallabagEntry(firstObj)) return wallabag(j, names);
      if (isLinkdingEntry(firstObj)) return linkding(j);
      return null;
    }
    if (!isObj(j)) return null;
    if (j.type === "text/x-moz-place-container") return firefox(j, names);
    if (isObj(j.roots) && ("bookmark_bar" in j.roots || "other" in j.roots)) return chromium(j, names);
    if (isArr(j.collections)) return linkwarden(j);
    if (isArr(j.results) && isLinkdingEntry(j.results[0])) return linkding(j.results);
    var items = isArr(j.items) ? j.items : isObj(j._embedded) && isArr(j._embedded.items) ? j._embedded.items : null;
    if (items && isWallabagEntry(items[0])) return wallabag(items, names);
    return null;
  }

  var NAMES = {
    instapaper: "Instapaper", wallabag: "wallabag", archive: "Archive",
    "ff.toolbar": "Bookmarks Toolbar", "ff.other": "Other Bookmarks", "ff.mobile": "Mobile Bookmarks",
    "cr.bar": "Bookmarks bar", "cr.mobile": "Mobile bookmarks"
  };

  function parse(text, name, names) {
    var nm = {};
    Object.keys(NAMES).forEach(function (k) { nm[k] = (names && names[k]) || NAMES[k]; });
    text = str(text).replace(/^﻿/, "");
    var lead = text.slice(0, 200).replace(/^\s+/, "").charAt(0);
    if (lead === "{" || lead === "[") {
      var j = kit().json(text);
      if (j != null) return parseJson(j, nm) || { kind: "", entries: [] };
    }
    if (isInstapaper(text)) return instapaper(text, nm);
    var r = core().parseImport(text, name || "", names);
    return { kind: r.kind || "", entries: (r.entries || []).slice(0, MAX_ENTRIES) };
  }

  // ---------- the plan ----------
  // data: Bookmarks state ({ items, folders }); opts.unsorted: names
  // that mean the Unsorted folder as a first path part (lower case).
  function plan(data, res, opts) {
    var C = core(), K = kit();
    opts = opts || {};
    var items = (data && data.items) || {}, folders = (data && data.folders) || {};
    var unsorted = (opts.unsorted || ["unsorted"]).map(function (x) { return str(x).toLowerCase(); });
    var have = {};
    Object.keys(items).forEach(function (id) { have[C.dupeKey(items[id].url)] = 1; });
    var out = { kind: (res && res.kind) || "", total: 0, here: 0, bad: 0, from: 0, to: 0, folders: [], items: [] };
    var made = {}, newF = {};
    function childNamed(pid, low) {
      if (made[pid + "\n" + low]) return made[pid + "\n" + low];
      var ids = C.childrenOf(folders, pid);
      for (var i = 0; i < ids.length; i++) {
        var f = folders[ids[i]];
        if (ids[i] !== ROOT && f && str(f.name).toLowerCase() === low) return ids[i];
      }
      return "";
    }
    function folderFor(path) {
      var pid = "", fid = ROOT;
      for (var i = 0; i < path.length && i < MAX_DEPTH; i++) {
        var name = oneLine(path[i], 64), low = name.toLowerCase();
        if (!name) continue;
        if (i === 0 && unsorted.indexOf(low) >= 0) continue;
        var id = childNamed(pid, low);
        if (!id) {
          var base = "imp-" + K.hash("f|" + pid + "\n" + low), n = 0;
          id = base;
          while (folders[id] || newF[id]) id = base + "-" + (++n);
          newF[id] = 1;
          out.folders.push({ id: id, name: name, parent: pid });
        }
        made[pid + "\n" + low] = id;
        pid = id;
        fid = id;
      }
      return fid;
    }
    ((res && res.entries) || []).forEach(function (e) {
      out.total++;
      var raw = str(e.url).trim();
      var norm = (WEB.test(raw) || !/^[a-z][a-z0-9+.-]*:/i.test(raw)) ? C.normUrl(raw) : null;
      if (!norm) { out.bad++; return; }
      var key = C.dupeKey(norm);
      if (have[key]) { out.here++; return; }
      have[key] = 1;
      var id = "imp-" + K.hash("u|" + key) + K.hash("v|" + key), n = 0;
      while (items[id]) id = "imp-" + K.hash("u|" + key) + K.hash("v|" + key) + "-" + (++n);
      var it = { id: id, url: norm, title: e.title || "", note: e.note || "", tags: e.tags || [],
                 fav: e.fav === true, added: e.added || 0, folderId: folderFor(e.path || []) };
      if (it.added) {
        if (!out.from || it.added < out.from) out.from = it.added;
        if (it.added > out.to) out.to = it.added;
      }
      out.items.push(it);
    });
    // folders no new bookmark needs (every link of a branch already here) are not made
    var used = {};
    out.items.forEach(function (it) { used[it.folderId] = 1; });
    var parentOf = {};
    out.folders.forEach(function (f) { parentOf[f.id] = f.parent; });
    Object.keys(used).forEach(function (id) {
      var guard = 0;
      while (parentOf[id] !== undefined && guard++ < 64) { used[id] = 1; id = parentOf[id]; }
    });
    out.folders = out.folders.filter(function (f) { return used[f.id]; });
    return out;
  }

  var API = { parse: parse, plan: plan, MAX_ENTRIES: MAX_ENTRIES };
  if (NODE) module.exports = API;
  else root.OrosBookmarksImport = API;
})(typeof window !== "undefined" ? window : this);
