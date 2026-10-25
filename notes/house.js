// ============================================================
// orOS Notes — a notebook shared with a household (pure; BR-HH
// wave 7f)
// A household shares ONE notebook: a household document of kind
// "notes" holds it with its pages and labels, one item per record
// (household/whole.js). Sharing MOVES the notebook (the own copies get
// tombstones, stop sharing brings it back), so the notebook selector
// shows the own notebooks and the shared ones together, with no page
// twice (household/group.js). Two people editing one page: the app's
// own merge decides, and keeps both texts as it does between devices.
// Records keep their own clocks (mtime, ct, st, h): the item stamp is
// not written into them, so a built notebook is exactly what was sent.
// A page longer than PAGE_MAX characters cannot travel: the household
// keeps the version it has and the longer one is kept as a page of
// the own notebooks (long()). A notebook over NB_MAX in all is not
// shared (fits()).
// notes.js owns the merge and the canonical form, so this file is a
// factory:
//   make({ merge(a, b), canon(d) }) → {
//     whole                  for household/share.js
//     build(view), copyOf(view, now), project(d)
//     only(own, nb), moved(own, nb), tombs(own, nb)   (tombstone keys
//                             "nb:<id>", "lbl:<id>", page id)
//     union(own, sets), split(next, sets)
//     fits(own, nb)          → "" | "long" (a page) | "full"
//     long(part)             → the ids of pages too long to travel
//   }
// Exposes window.OrosNotesHouse and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var Wh = root.OrosHouseWhole || (typeof require === "function" ? require("../household/whole.js") : null);
  var Gr = root.OrosHouseGroup || (typeof require === "function" ? require("../household/group.js") : null);
  var PAGE_MAX = 60000, NB_MAX = 480000;
  var LISTS = ["notebooks", "pages", "labels"];

  function plain(x) { return JSON.parse(JSON.stringify(x)); }
  function empty() { return { ver: 3, notebooks: [], pages: [], labels: [], tombs: {} }; }
  function tombKey(k, id) { return k === "notebooks" ? "nb:" + id : (k === "labels" ? "lbl:" + id : id); }
  function noStamp(d) {
    LISTS.forEach(function (k) { (d[k] || []).forEach(function (r) { delete r.m; }); });
    return d;
  }
  function size(r) { var c = {}; Object.keys(r).forEach(function (k) { if (k !== "id") c[k] = r[k]; }); return JSON.stringify(c).length; }

  function make(o) {
    var canon = function (d) { return o.canon(d || empty()); };
    function windowed(d) { var out = canon(d); out.tombs = {}; return out; }
    var W = Wh.make({
      parts: [{ k: "notebooks", t: "list", p: "n" }, { k: "pages", t: "list", p: "pg" }, { k: "labels", t: "list", p: "l" }],
      merge: function (a, b) { var out = o.merge(a, b) || empty(); out.tombs = {}; return out; },
      empty: empty
    });
    function project(d) { return W.project(windowed(d)); }
    function build(view) {
      var b = W.build(view);
      b.data = canon(noStamp(b.data));
      return b;
    }
    // An own copy of a notebook that left a household: newer than the
    // tombstones it meets (the structure clock of a page moves, its text
    // clock and history stay, so nothing reads as a second text).
    function copyOf(view, now) {
      var d = noStamp(W.copyOf(view, now));
      d.notebooks.forEach(function (n) { n.mtime = Math.max(n.mtime || 0, now); });
      d.labels.forEach(function (l) { l.mtime = Math.max(l.mtime || 0, now); });
      d.pages.forEach(function (p) {
        if (typeof p.ct !== "number") p.ct = p.mtime || 0;
        p.st = Math.max(p.st || 0, now);
        p.mtime = Math.max(p.mtime || 0, now);
      });
      return canon(d);
    }
    var whole = {
      fromDoc: W.fromDoc, build: build, copyOf: copyOf, project: project,
      push: function (last, d, x, raw) { return W.push(last, windowed(d), x, raw); }
    };

    var G = Gr.make({ normalize: canon, empty: empty, parent: "notebooks", children: ["pages", "labels"], key: "nb", tomb: tombKey });
    function long(part) {
      return (part.pages || []).filter(function (p) { return size(p) > PAGE_MAX; }).map(function (p) { return p.id; });
    }
    function fits(own, nb) {
      var d = G.only(own, nb);
      if (long(d).length) return "long";
      var n = 0;
      LISTS.forEach(function (k) { d[k].forEach(function (r) { n += size(r) + 40; }); });
      return n > NB_MAX ? "full" : "";
    }
    return { W: W, whole: whole, project: project, build: build, copyOf: copyOf, window: windowed,
             only: G.only, moved: G.moved, tombs: G.tombs, union: G.union, split: G.split,
             fits: fits, long: long, tombKey: tombKey };
  }

  var api = { PAGE_MAX: PAGE_MAX, NB_MAX: NB_MAX, make: make, empty: empty, plain: plain };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosNotesHouse = api;
})(typeof window !== "undefined" ? window : globalThis);
