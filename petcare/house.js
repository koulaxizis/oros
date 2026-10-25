// ============================================================
// orOS Pet Health Book — the pets shared with a household (pure;
// BR-HH wave 7c)
// A shared book is a household document of kind "petcare": the pets
// and their health records, one item per record (household/whole.js).
// Sharing COPIES the book (the own one stays under "Only mine", as in
// Meal Planner). Each pet keeps its field-group stamps (fm) inside its
// item, so the app's own merge still decides per group on every
// device. Deleted pets and records do not travel: their item goes.
// What travels: every pet, the newest REC_MAX records (by day), and
// photos while they fit PHOTO_BUDGET characters in all (pets in id
// order); a photo that does not fit stays in the sharer's own book.
// The shell's reminders, Today and the Calendar feed read the own
// book and the shared ones together (union): a pet that is in a
// household is read from there, so it reminds once and what the
// household did counts.
//   whole                  for household/share.js
//   window(d)              → the data that travels
//   project(d)             → { items }
//   build(view)            → { data, by, raw }
//   copyOf(view, now)      → data stamped now (an own copy)
//   collect(H)             → [{ id, t, hh, data }] every shared book
//   mirror(H, ls)          → writes MIRROR_KEY ({ ver: 1, sets }) when it
//                             changed
//   readMirror(raw)        → [{ id, t, hh, data }]
//   union(own, sets)       → one book (own pets not in a set + the sets)
//   withShared(own, ls)    → union(own, the mirror in ls)
// Exposes window.OrosPetcareHouse and, under Node, module.exports.
// household/whole.js is needed for sharing only: the readers (shell,
// Calendar) can load this file without it.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosPetcareCore || (typeof require === "function" ? require("./core.js") : null);
  var Wh = root.OrosHouseWhole || (typeof require === "function" ? require("../household/whole.js") : null);
  var MIRROR_KEY = "oros-petcare-hh";
  var REC_MAX = 2800, PHOTO_BUDGET = 160000;

  function empty() { return { ver: C.DATA_VER, pets: [], recs: [], tombs: {} }; }
  var W = Wh ? Wh.make({
    parts: [{ k: "pets", t: "list", p: "p" }, { k: "recs", t: "list", p: "r" }],
    merge: function (a, b) { return C.merge(a, b); },
    empty: empty
  }) : null;

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  function windowed(d) {
    var data = C.merge(d, d), left = PHOTO_BUDGET;
    var pets = data.pets.map(function (p) {
      if (!p.ph) return p;
      if (p.ph.length <= left) { left -= p.ph.length; return p; }
      var q = JSON.parse(JSON.stringify(p));
      q.ph = "";
      return q;
    });
    var recs = data.recs.slice();
    if (recs.length > REC_MAX) {
      recs.sort(function (x, y) { return cmpStr(y.d, x.d) || cmpStr(y.id, x.id); });
      recs = recs.slice(0, REC_MAX);
    }
    return { ver: data.ver, pets: pets, recs: recs, tombs: {} };
  }
  function project(d) { return W.project(windowed(d)); }
  function build(view) { return W.build(view); }
  function copyOf(view, now) { return W.copyOf(view, now); }

  var whole = W ? {
    fromDoc: W.fromDoc, build: build, copyOf: copyOf, project: project,
    push: function (last, d, x, raw) { return W.push(last, windowed(d), x, raw); }
  } : null;

  function collect(H) {
    var out = [];
    if (!H || typeof H.docs !== "function") return out;
    H.docs("petcare").forEach(function (d) {
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
      if (!s || typeof s !== "object" || !s.data || !Array.isArray(s.data.pets)) return;
      out.push({ id: String(s.id || ""), t: typeof s.t === "string" ? s.t : "", hh: typeof s.hh === "string" ? s.hh : "",
                 data: C.merge(s.data, s.data) });
    });
    return out;
  }
  // A pet in a household is read from the household (with its records);
  // the own book adds the pets that are only there.
  function union(own, sets) {
    var o = own && Array.isArray(own.pets) ? C.merge(own, own) : empty();
    if (!sets || !sets.length) return o;
    var inSet = {}, pets = [], recs = [];
    sets.forEach(function (s) {
      s.data.pets.forEach(function (p) { if (!inSet[p.id]) { inSet[p.id] = 1; pets.push(p); } });
    });
    sets.forEach(function (s) { s.data.recs.forEach(function (r) { recs.push(r); }); });
    o.pets.forEach(function (p) { if (!inSet[p.id]) pets.push(p); });
    o.recs.forEach(function (r) { if (!inSet[r.p]) recs.push(r); });
    return C.merge({ pets: pets, recs: recs, tombs: {} }, { pets: [], recs: [], tombs: {} });
  }
  function withShared(own, ls) {
    ls = ls || root.localStorage;
    var sets = [];
    try { sets = readMirror(JSON.parse(ls.getItem(MIRROR_KEY) || "null")); } catch (e) {}
    return sets.length ? union(own, sets) : own;
  }
  // The shell keeps the mirror fresh while it runs.
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

  var api = { MIRROR_KEY: MIRROR_KEY, REC_MAX: REC_MAX, PHOTO_BUDGET: PHOTO_BUDGET, W: W, whole: whole,
              window: windowed, project: project, build: build, copyOf: copyOf,
              collect: collect, mirror: mirror, readMirror: readMirror, union: union, withShared: withShared,
              bootShell: bootShell };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.OrosPetcareHouse = api;
    if (root.parent === root && root.orosHousehold) bootShell();      // the shell, not an app frame
  }
})(typeof window !== "undefined" ? window : globalThis);
