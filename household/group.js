// ============================================================
// orOS Household — group.js (one record and everything that belongs
// to it, shared with a household; BR-HH wave 7; pure, no DOM)
// Together shares one relationship, Garage one vehicle: the parent
// record and the rows that point to it MOVE into a household document
// (the own copies get tombstones, stop sharing brings them back), and
// the app shows the own data and the shared copies side by side, with
// no record twice. An app describes its data:
//   make({
//     normalize(d),  empty(),    // the app's canonical form
//     parent: "rels",            // the list of shareable records
//     children: ["moments", …],  // lists whose rows point to a parent
//     key: "rel",                // the field that points
//     keep: ["gifts"],           // lists that never travel (optional)
//     tomb(list, id)             // the tombstone key of a record
//                                // (optional; Notes: "nb:<id>")
//   })
//   only(own, pid)      → the parent and its rows (what is shared)
//   moved(own, pid)     → their ids, sorted
//   tombs(own, pid)     → their tombstone keys, sorted (= moved without
//                         spec.tomb)
//   union(own, sets)    → what the app shows and the readers read: the
//                         own data without what moved + every shared
//                         record (an own row of a shared parent that
//                         no set holds shows too: split sends it); everything else (settings, `keep`
//                         lists) from the own data; own tombstones of
//                         shared ids left out
//   split(next, sets)   → { own, parts }: an edit of the union back
//                         where each record lives (a shared parent and
//                         its rows to its set, in `sets` order; new
//                         parents, `keep` lists, settings and tombstones
//                         to the own data)
//   sets = [{ data }] (the household copies, as built)
// Exposes window.OrosHouseGroup and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  function make(spec) {
    var P = spec.parent, KIDS = spec.children, K = spec.key, ALL = [P].concat(KIDS);
    var TK = spec.tomb || function (k, id) { return id; };

    function only(own, pid) {
      var d = spec.normalize(own), out = spec.empty();
      out[P] = d[P].filter(function (r) { return r.id === pid; });
      KIDS.forEach(function (k) { out[k] = d[k].filter(function (r) { return r[K] === pid; }); });
      return out;
    }
    function moved(own, pid) {
      var d = only(own, pid), ids = [];
      ALL.forEach(function (k) { d[k].forEach(function (r) { ids.push(r.id); }); });
      return ids.sort(cmpStr);
    }
    function tombs(own, pid) {
      var d = only(own, pid), keys = [];
      ALL.forEach(function (k) { d[k].forEach(function (r) { keys.push(TK(k, r.id)); }); });
      return keys.sort(cmpStr);
    }
    function union(own, sets) {
      var o = spec.normalize(own);
      if (!sets || !sets.length) return o;
      var pids = {}, shared = {}, tk = {}, out = JSON.parse(JSON.stringify(o));
      ALL.forEach(function (k) { out[k] = []; });
      sets.forEach(function (s) {
        (s.data[P] || []).forEach(function (r) { pids[r.id] = 1; });
        ALL.forEach(function (k) {
          (s.data[k] || []).forEach(function (r) { shared[r.id] = 1; tk[TK(k, r.id)] = 1; out[k].push(r); });
        });
      });
      out[P] = out[P].concat(o[P].filter(function (r) { return !pids[r.id]; }));
      // An own row of a shared parent that the set does not hold yet was
      // written on another own device before the move reached it: it
      // shows, and the next split takes it to the household.
      KIDS.forEach(function (k) { out[k] = out[k].concat(o[k].filter(function (r) { return !shared[r.id]; })); });
      out.tombs = {};
      Object.keys(o.tombs || {}).forEach(function (id) { if (!tk[id]) out.tombs[id] = o.tombs[id]; });
      return spec.normalize(out);
    }
    function split(next, sets) {
      var d = spec.normalize(next), at = {};
      var parts = (sets || []).map(function () { return spec.empty(); });
      (sets || []).forEach(function (s, i) { (s.data[P] || []).forEach(function (r) { at[r.id] = i; }); });
      var own = JSON.parse(JSON.stringify(d));
      own[P] = d[P].filter(function (r) { if (r.id in at) { parts[at[r.id]][P].push(r); return false; } return true; });
      KIDS.forEach(function (k) {
        own[k] = d[k].filter(function (r) { if (r[K] in at) { parts[at[r[K]]][k].push(r); return false; } return true; });
      });
      return { own: spec.normalize(own), parts: parts.map(function (p) { return spec.normalize(p); }) };
    }
    return { only: only, moved: moved, tombs: tombs, union: union, split: split };
  }

  var api = { make: make };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosHouseGroup = api;
})(typeof window !== "undefined" ? window : globalThis);
