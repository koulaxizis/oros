// ============================================================
// orOS Files — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: lists the local disk through the shell's
// window.orosFS (ls only; file contents are never read). One hit
// per file or folder: its name, the folder it is in as text.
// The listing is walked at most every 10 s and capped (depth 12,
// 3,000 entries) so a big disk cannot stall the search.
// Opens through the generic deep link: target { path, dir }.
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

  var PROVIDER = {
    id: "files",
    keys: [],
    search: function (ctx) {
      var fs = root.orosFS;
      if (!fs || typeof fs.ls !== "function") return [];
      return listing(fs).then(function (l) {
        return l.map(function (e) {
          var where = e.parent === ROOT ? "/" : e.parent.slice(ROOT.length);
          return {
            id: e.path,
            title: e.name + (e.dir ? "/" : ""),
            text: where,
            target: { path: e.path, dir: e.dir }
          };
        });
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PROVIDER;
    module.exports._walk = walk;
  }
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
