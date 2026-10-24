// ============================================================
// orOS Together — a relationship shared with a household (pure;
// BR-HH wave 7d)
// A couple shares ONE relationship: a household document of kind
// "together" holds it with its moments, special days and meetings, one
// item per record (household/whole.js). Gift ideas never travel (they
// are surprises), nor do the settings. Sharing MOVES the relationship
// (the own copies get tombstones, stop sharing brings it back), so the
// app can show the own relationships and the shared ones side by side
// as tabs, with no record on screen twice:
//   union(own, sets)       → what the app shows and the readers (shell
//                             notice, Today, Calendar) read: the own data
//                             without what moved + every shared record,
//                             the own settings and gift ideas
//   split(next, sets)      → { own, parts: [data per set] }: an edit of
//                             the union goes back where each record lives
//                             (a relationship and its rows to its set;
//                             new relationships, gifts, settings and
//                             tombstones stay own)
//   moved(own, relId)      → the ids that travel with that relationship
//   whole                  for household/share.js
//   collect(H) / mirror(H, ls) / readMirror(raw) / withShared(own, ls)
//                           the shell's mirror "oros-together-hh"
// Photos are paths on the sharer's orOS disk: they travel as names, the
// pictures stay there.
// Exposes window.TogetherHouse and, under Node, module.exports.
// household/whole.js is needed for sharing only; household/group.js
// always (the Calendar loads it and this file).
// ============================================================
(function (root) {
  "use strict";

  var C = root.TogetherCore || (typeof require === "function" ? require("./core.js") : null);
  var Wh = root.OrosHouseWhole || (typeof require === "function" ? require("../household/whole.js") : null);
  var MIRROR_KEY = "oros-together-hh";
  var ROWS = ["moments", "days", "meets"];

  var W = Wh ? Wh.make({
    parts: [{ k: "rels", t: "list", p: "r" }, { k: "moments", t: "list", p: "mo" },
            { k: "days", t: "list", p: "d" }, { k: "meets", t: "list", p: "me" }],
    merge: function (a, b) { var out = C.merge(a, b); out.gifts = []; out.tombs = {}; return out; },
    empty: function () { return C.empty(); }
  }) : null;

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function windowed(d) { var out = C.normalize(d); out.gifts = []; out.tombs = {}; return out; }
  function project(d) { return W.project(windowed(d)); }
  function build(view) { return W.build(view); }
  function copyOf(view, now) { return W.copyOf(view, now); }
  var whole = W ? {
    fromDoc: W.fromDoc, build: build, copyOf: copyOf, project: project,
    push: function (last, d, x, raw) { return W.push(last, windowed(d), x, raw); }
  } : null;

  // One relationship and its rows (household/group.js); gifts stay own.
  var G = (root.OrosHouseGroup || (typeof require === "function" ? require("../household/group.js") : null)).make({
    normalize: function (d) { return C.normalize(d); }, empty: function () { return C.empty(); },
    parent: "rels", children: ROWS, key: "rel", keep: ["gifts"]
  });
  var only = G.only, moved = G.moved, union = G.union, split = G.split;

  function collect(H) {
    var out = [];
    if (!H || typeof H.docs !== "function" || !W) return out;
    H.docs("together").forEach(function (d) {
      if (!d.ready) return;
      var v = H.view(d.box, d.id);
      if (!v) return;
      out.push({ id: d.id, t: typeof v.m.t === "string" ? v.m.t : "", hh: d.hh || "", data: build(v).data });
    });
    out.sort(function (a, b) { return cmpStr(a.id, b.id); });
    return out;
  }
  var lastMirror = null;
  function mirror(H, ls) {
    ls = ls || root.localStorage;
    var sets = collect(H);
    var text = sets.length ? JSON.stringify({ ver: 1, sets: sets }) : "";
    if (text === lastMirror) return false;
    lastMirror = text;
    try { if (text) ls.setItem(MIRROR_KEY, text); else ls.removeItem(MIRROR_KEY); } catch (e) {}
    return true;
  }
  function readMirror(raw) {
    var out = [];
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.sets)) return out;
    raw.sets.forEach(function (s) {
      if (!s || typeof s !== "object" || !s.data || typeof s.data !== "object") return;
      out.push({ id: String(s.id || ""), t: typeof s.t === "string" ? s.t : "", hh: typeof s.hh === "string" ? s.hh : "",
                 data: windowed(s.data) });
    });
    return out;
  }
  function withShared(own, ls) {
    ls = ls || root.localStorage;
    var sets = [];
    try { sets = readMirror(JSON.parse(ls.getItem(MIRROR_KEY) || "null")); } catch (e) {}
    return sets.length ? union(own, sets) : own;
  }
  function bootShell() {
    var H = root.orosHousehold;
    if (!H || typeof H.on !== "function" || !W) return;
    var queued = false;
    function later() {
      if (queued) return;
      queued = true;
      setTimeout(function () { queued = false; mirror(H); }, 50);
    }
    H.on(function (e) { if (e && (e.type === "doc" || e.type === "list" || e.type === "roster")) later(); });
    Promise.resolve(H.ready()).then(later, function () {});
  }

  var api = { MIRROR_KEY: MIRROR_KEY, W: W, whole: whole, window: windowed, project: project, build: build, copyOf: copyOf,
              only: only, moved: moved, union: union, split: split,
              collect: collect, mirror: mirror, readMirror: readMirror, withShared: withShared, bootShell: bootShell };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.TogetherHouse = api;
    if (root.parent === root && root.orosHousehold) bootShell();      // the shell, not an app frame
  }
})(typeof window !== "undefined" ? window : globalThis);
