// ============================================================
// orOS Files — universal search provider (v1.2.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: lists the local disk through the shell's
// window.orosFS (ls only; file contents are never read). One hit
// per file or folder: its name, the folder it is in as text.
// The listing is walked at most every 10 s and capped (depth 12,
// 3,000 entries) so a big disk cannot stall the search. Files'
// Trash (/internal/.trash) and Documents' texts (/internal/.docs) are never listed.
// Opens through the generic deep link: target { path, dir }.
// W5 (Documents, DOCS-1; card 3, Chris 2026-11-15): one more hit per
// document that is not private (files/docs-due.js searchHits): its
// details and the first 300 characters of its text, so the Assistant
// and orOS Gate (both search through this) see the same. The texts
// are read in the background, at most 4 at a time, and kept in memory
// by the time they were read; a search never waits for them.
// Opens the document in Files: target { doc }.
// T3 (TAGS-1; Chris 2026-11-17 «Ναι, μόνο τα ονόματα»): a disk hit
// also carries its tag names ("Tags: …", OrosDocsDue.fileTags), so a
// search for a tag finds its files. Names only; a private document's
// file never gets any.
// ============================================================
(function (root) {
  "use strict";
  var ROOT = "/internal";
  var MAX_DEPTH = 12, MAX_ENTRIES = 3000, FRESH_MS = 10000;
  var walked = null, walkedAt = 0, walking = null;

  function walk(fs) {
    var out = [];
    function dir(path, depth) {
      if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return Promise.resolve();
      return Promise.resolve(fs.ls(path)).then(function (list) {
        var subs = [];
        (Array.isArray(list) ? list : []).forEach(function (e) {
          if (!e || typeof e.name !== "string" || out.length >= MAX_ENTRIES) return;
          if (path === ROOT && (e.name === ".trash" || e.name === ".docs")) return;   // Files' Trash and Documents' text stay out

          var p = path + "/" + e.name;
          out.push({ path: p, name: e.name, dir: !!e.dir, parent: path });
          if (e.dir) subs.push(p);
        });
        return subs.reduce(function (chain, p) {
          return chain.then(function () { return dir(p, depth + 1); });
        }, Promise.resolve());
      }, function () {});
    }
    return dir(ROOT, 0).then(function () { return out; });
  }

  function listing(fs) {
    if (walked && Date.now() - walkedAt < FRESH_MS) return Promise.resolve(walked);
    if (!walking) {
      walking = walk(fs).then(function (l) {
        walked = l; walkedAt = Date.now(); walking = null; return l;
      }, function () { walking = null; return walked || []; });
    }
    return walking;
  }

  // ---------- W5: Documents ----------
  var TEXT_DIR = ROOT + "/.docs/text", READ_MAX = 2000, WALK_WAIT = 800;
  var snips = {}, warming = false;      // id → { at, s }
  function txAt(d) { return d && d.x && d.x.tx && typeof d.x.tx.at === "number" ? d.x.tx.at : 0; }
  function warm(fs, D, raw) {
    if (warming || !fs || typeof fs.readText !== "function") return;
    var live = D.docs(raw), want = live.filter(function (d) {
      var at = txAt(d);
      return at && !D.isPrivate(raw, d) && (!snips[d.id] || snips[d.id].at !== at);
    });
    var keep = {};
    live.forEach(function (d) { if (snips[d.id]) keep[d.id] = snips[d.id]; });
    snips = keep;
    if (!want.length) return;
    warming = true;
    var i = 0;
    function next() {
      if (i >= want.length) return Promise.resolve();
      var d = want[i++], at = txAt(d);
      return Promise.resolve(fs.readText(TEXT_DIR + "/" + d.id + ".txt")).then(function (t) {
        snips[d.id] = { at: at, s: D.snippet(String(t || "").slice(0, READ_MAX)) };
      }, function () { snips[d.id] = { at: at, s: "" }; }).then(next);
    }
    Promise.all([next(), next(), next(), next()]).then(function () { warming = false; }, function () { warming = false; });
  }
  function docHits(ctx, fs) {
    var D = root.OrosDocsDue, raw = D ? ctx.readJSON(D.KEY) : null;
    if (!D || typeof D.searchHits !== "function" || !raw) return [];
    warm(fs, D, raw);
    return D.searchHits(raw, ctx.code || ctx.lang, function (id) { return snips[id] ? snips[id].s : ""; });
  }

  var PROVIDER = {
    id: "files",
    keys: ["oros-files-docs", "oros-files-tags"],
    search: function (ctx) {
      var fs = root.orosFS, docs = [];
      try { docs = docHits(ctx, fs); } catch (e) { docs = []; }
      // Every item, no query (the Assistant's label filter, orOS Gate's
      // copy for when orOS is closed): the documents only, at once.
      if (!fs || typeof fs.ls !== "function" || !ctx.words || !ctx.words.length) return docs;
      // A big disk's first walk may outlast the search: the documents
      // are answered anyway (search.js skips a provider after 1 s).
      var slow = new Promise(function (r) { setTimeout(function () { r(null); }, WALK_WAIT); });
      return Promise.race([listing(fs), slow]).then(function (l) {
        if (!l) return docs;
        var tg = {}, word = "Tags";
        try {
          var D = root.OrosDocsDue;
          if (D && typeof D.fileTags === "function") {
            tg = D.fileTags(ctx.readJSON("oros-files-tags"), ctx.readJSON(D.KEY), ctx.code || ctx.lang) || {};
            word = D.tagsWord ? D.tagsWord(ctx.code || ctx.lang) : word;
          }
        } catch (e) { tg = {}; }
        return docs.concat(l.map(function (e) {
          var where = e.parent === ROOT ? "/" : e.parent.slice(ROOT.length);
          var names = Object.prototype.hasOwnProperty.call(tg, e.path) ? tg[e.path] : null;
          return {
            id: e.path,
            title: e.name + (e.dir ? "/" : ""),
            text: names && names.length ? where + "\n" + word + ": " + names.join(", ") : where,
            target: { path: e.path, dir: e.dir }
          };
        }));
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PROVIDER;
    module.exports._walk = walk;
    module.exports._reset = function () { snips = {}; warming = false; walked = null; walkedAt = 0; walking = null; };
  }
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
