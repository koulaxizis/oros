// ============================================================
// orOS Garage — a vehicle shared with a household (pure; BR-HH wave
// 7e)
// The family car: a household document of kind "garage" holds ONE
// vehicle with its fill-ups, services, service plans, tyres, renewals,
// costs and odometer readings, one item per record (household/whole.js).
// The settings (currency) and the reminder prefs never travel. Sharing
// MOVES the vehicle (household/group.js: the own copies get tombstones,
// stop sharing brings it back), so the app shows the own vehicles and
// the shared ones side by side in its vehicle bar, no record twice.
// A vehicle with more than ROW_MAX records cannot be shared (a
// household document holds at most 3000 items, and the app's merge
// drops the rows of a vehicle that is not there: they must all move).
// Receipt photos travel as names; the pictures stay on the sharer's
// orOS disk.
//   only / moved / union / split   household/group.js
//   fits(own, vid)         → true when the vehicle's records fit
//   whole                  for household/share.js
//   collect(H) / mirror(H, ls) / readMirror(raw) / withShared(own, ls)
//                           the shell's mirror "oros-garage-hh"; the
//                           shell's reminders, Today, the Calendar feed
//                           and Travel read withShared(own)
// Exposes window.OrosGarageHouse and, under Node, module.exports.
// household/whole.js is needed for sharing only; household/group.js
// always.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosGarageCore || (typeof require === "function" ? require("./core.js") : null);
  var Wh = root.OrosHouseWhole || (typeof require === "function" ? require("../household/whole.js") : null);
  var MIRROR_KEY = "oros-garage-hh";
  var ROWS = ["fuel", "service", "plans", "tyres", "renewals", "costs", "odo"];
  var ROW_MAX = 2900;

  function normalize(d) { return C.merge(d, d); }
  function empty() { return C.merge(null, null); }
  var W = Wh ? Wh.make({
    parts: [{ k: "vehicles", t: "list", p: "v" }, { k: "fuel", t: "list", p: "f" }, { k: "service", t: "list", p: "s" },
            { k: "plans", t: "list", p: "pl" }, { k: "tyres", t: "list", p: "ty" }, { k: "renewals", t: "list", p: "rn" },
            { k: "costs", t: "list", p: "c" }, { k: "odo", t: "list", p: "o" }],
    merge: function (a, b) { var out = C.merge(a, b); out.tombs = {}; return out; },
    empty: empty
  }) : null;
  var G = (root.OrosHouseGroup || (typeof require === "function" ? require("../household/group.js") : null)).make({
    normalize: normalize, empty: empty, parent: "vehicles", children: ROWS, key: "v"
  });
  var only = G.only, moved = G.moved, union = G.union, split = G.split;
  function fits(own, vid) { return moved(own, vid).length <= ROW_MAX; }

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function windowed(d) { var out = normalize(d); out.settings = empty().settings; out.tombs = {}; return out; }
  function project(d) { return W.project(windowed(d)); }
  function build(view) { return W.build(view); }
  function copyOf(view, now) { return W.copyOf(view, now); }
  var whole = W ? {
    fromDoc: W.fromDoc, build: build, copyOf: copyOf, project: project,
    push: function (last, d, x, raw) { return W.push(last, windowed(d), x, raw); }
  } : null;

  function collect(H) {
    var out = [];
    if (!H || typeof H.docs !== "function" || !W) return out;
    H.docs("garage").forEach(function (d) {
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
      if (!s || typeof s !== "object" || !s.data || !Array.isArray(s.data.vehicles)) return;
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

  var api = { MIRROR_KEY: MIRROR_KEY, ROW_MAX: ROW_MAX, W: W, whole: whole, window: windowed, project: project, build: build, copyOf: copyOf,
              only: only, moved: moved, fits: fits, union: union, split: split,
              collect: collect, mirror: mirror, readMirror: readMirror, withShared: withShared, bootShell: bootShell };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.OrosGarageHouse = api;
    if (root.parent === root && root.orosHousehold) bootShell();      // the shell, not an app frame
  }
})(typeof window !== "undefined" ? window : globalThis);
