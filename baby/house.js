// ============================================================
// orOS Baby — the children shared with a household (pure; BR-HH
// wave 7b)
// Two parents (or a parent and a grandparent) log feeds, sleep and
// nappies on their own phones and see the same day. A shared Baby is
// a household document of kind "baby": children, events, growth,
// marks and the milk stash, one item per record (household/whole.js).
// Sharing MOVES the records that travel into the household (the own
// copies get tombstones), so a child is never on screen twice and the
// shell's feed reminder never counts a feed that went elsewhere; stop
// sharing gives them back. Units stay each person's own (prefs never
// travel). Deleted records do not travel: their item goes.
// Events of the last EV_DAYS days travel (and every running timer),
// newest first, at most EV_MAX; older ones stay on the device that
// shared them and come back when it stops sharing.
//   whole                  for household/share.js
//   project(d, now)        → { items }
//   build(view)            → { data, by, raw }
//   moved(d, now)          → { kids, ev, gr, mk, st }: the ids that travel
//   copyOf(view, now)      → data stamped now (an own copy)
//   collect(H)             → [{ id, t, hh, data }] every shared Baby
//   mirror(H, ls)          → writes MIRROR_KEY ({ ver: 1, sets }) when it
//                             changed; the shell's reminders and Today
//                             read it
//   readMirror(raw)        → [{ id, t, hh, data }]
// Exposes window.orosBabyHouse and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var C = root.orosBabyCore || (typeof require === "function" ? require("./core.js") : null);
  var Wh = root.OrosHouseWhole || (typeof require === "function" ? require("../household/whole.js") : null);
  var MIRROR_KEY = "oros-baby-hh";
  var EV_DAYS = 90, EV_MAX = 2400;
  var LISTS = ["kids", "ev", "gr", "mk", "st"];

  var W = Wh.make({
    parts: [
      { k: "kids", t: "list", p: "k" }, { k: "ev", t: "list", p: "e" }, { k: "gr", t: "list", p: "g" },
      { k: "mk", t: "list", p: "mk" }, { k: "st", t: "list", p: "s" }
    ],
    merge: function (a, b) { return C.mergeBaby(a, b); },
    empty: function () { return C.empty(); }
  });

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  // What travels: live records, recent events (running timers always).
  function windowed(d, now) {
    var data = C.normalize(d), from = now - EV_DAYS * 86400000, out = { ver: data.ver, prefs: data.prefs, pm: data.pm };
    LISTS.forEach(function (f) { out[f] = (data[f] || []).filter(function (x) { return !x.del; }); });
    var keep = out.ev.filter(function (e) { return e.e === undefined && (e.t === "feed" || e.t === "sleep"); });
    var rest = out.ev.filter(function (e) { return keep.indexOf(e) < 0 && e.ts >= from; });
    rest.sort(function (x, y) { return y.ts - x.ts || cmpStr(x.id, y.id); });
    out.ev = keep.concat(rest.slice(0, Math.max(0, EV_MAX - keep.length)));
    return out;
  }
  function project(d, now) { return W.project(windowed(d, now)); }
  function moved(d, now) {
    var w = windowed(d, now), out = {};
    LISTS.forEach(function (f) { out[f] = (w[f] || []).map(function (x) { return x.id; }).sort(cmpStr); });
    return out;
  }
  function build(view) { return W.build(view); }
  function copyOf(view, now) { return W.copyOf(view, now); }

  var whole = {
    fromDoc: W.fromDoc, build: build, copyOf: copyOf,
    project: function (d) { return project(d, Date.now()); },
    push: function (last, d, x, raw) { return W.push(last, windowed(d, Date.now()), x, raw); }
  };

  function collect(H) {
    var out = [];
    if (!H || typeof H.docs !== "function") return out;
    H.docs("baby").forEach(function (d) {
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
      if (!s || typeof s !== "object" || !C.looksLikeData(s.data)) return;
      out.push({ id: String(s.id || ""), t: typeof s.t === "string" ? s.t : "", hh: typeof s.hh === "string" ? s.hh : "",
                 data: C.normalize(s.data) });
    });
    return out;
  }
  // Tombstones of the own data are left out: they belong to records that
  // moved into a household, which the sets carry.
  function union(own, sets) {
    var live = C.empty();
    if (own) LISTS.forEach(function (f) { live[f] = (own[f] || []).filter(function (x) { return x && !x.del; }); });
    if (own) { live.prefs = own.prefs; live.pm = own.pm; }
    var out = C.normalize(live);
    (sets || []).forEach(function (s) {
      var d = {};
      LISTS.forEach(function (f) { d[f] = (s.data[f] || []).filter(function (x) { return x && !x.del; }); });
      out = C.mergeBaby(out, { kids: d.kids, ev: d.ev, gr: d.gr, mk: d.mk, st: d.st });
    });
    return out;
  }
  // The shell keeps the mirror fresh while it runs.
  function bootShell() {
    var H = root.orosHousehold;
    if (!H || typeof H.on !== "function") return;
    var queued = false;
    function later() {
      if (queued) return;
      queued = true;
      setTimeout(function () { queued = false; mirror(H); }, 50);
    }
    H.on(function (e) { if (e && (e.type === "doc" || e.type === "list" || e.type === "roster")) later(); });
    Promise.resolve(H.ready()).then(later, function () {});
  }

  var api = { MIRROR_KEY: MIRROR_KEY, EV_DAYS: EV_DAYS, EV_MAX: EV_MAX, W: W, whole: whole,
              window: windowed, project: project, build: build, moved: moved, copyOf: copyOf,
              collect: collect, mirror: mirror, readMirror: readMirror, union: union, bootShell: bootShell };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.orosBabyHouse = api;
    if (root.parent === root && root.orosHousehold) bootShell();      // the shell, not an app frame
  }
})(typeof window !== "undefined" ? window : globalThis);
