// ============================================================
// orOS Forms — data (forms/core.js, window.OrosFormsCore)
// The synced slice "forms" (localStorage oros-forms-data):
//   { ver: 1, forms: [ record | tombstone ] }   sorted by id
//   record    = the form (engine.js normForm) + { m, c, x? }
//               m: last change (ms), c: made (ms),
//               x: opaque object kept for later waves (publishing);
//                  this version keeps it as it is and never reads it
//   tombstone = { id, m, del: 1 }
// Merge: per form, newer m wins whole; equal m → the tombstone, else
// the larger canonical JSON (R26: merge(a, a) = a, same order always).
// A form is edited in one place at a time in practice; per-question
// merge is not worth the risk of a half-merged form.
// Pure, Node-tested (tests/forms.test.js).
// ============================================================
(function (root) {
  "use strict";

  var E = (typeof module !== "undefined" && module.exports) ? require("./engine.js") : root.OrosFormsEngine;
  var STORAGE_KEY = "oros-forms-data";
  var DATA_VER = 1;
  var MAX_FORMS = 500;
  var X_MAX = 200000;          // characters of the opaque x object

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function stamp(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }

  function normRecord(r) {
    if (!isObj(r) || typeof r.id !== "string" || !E.ID_RE.test(r.id)) return null;
    var m = stamp(r.m);
    if (r.del) return { id: r.id, m: m, del: 1 };
    var f = E.normForm(r);
    var out = { id: f.id, m: m, c: stamp(r.c) || m, title: f.title };
    if (f.desc) out.desc = f.desc;
    out.qs = f.qs;
    out.set = f.set;
    if (isObj(r.x)) {
      try { var s = JSON.stringify(r.x); if (s.length <= X_MAX) out.x = JSON.parse(s); } catch (e) {}
    }
    return out;
  }

  function normalize(d) {
    d = isObj(d) ? d : {};
    var byId = {};
    (Array.isArray(d.forms) ? d.forms : []).forEach(function (r) {
      var n = normRecord(r);
      if (!n) return;
      byId[n.id] = byId[n.id] ? pick(byId[n.id], n) : n;
    });
    return { ver: DATA_VER, forms: sorted(byId) };
  }

  function sorted(byId) {
    var list = Object.keys(byId).sort().map(function (k) { return byId[k]; });
    // Over the cap, the oldest live forms go (tombstones are tiny and stay).
    var live = list.filter(function (r) { return !r.del; });
    if (live.length > MAX_FORMS) {
      var drop = {};
      live.slice().sort(function (a, b) { return a.m - b.m || (a.id < b.id ? -1 : 1); })
        .slice(0, live.length - MAX_FORMS).forEach(function (r) { drop[r.id] = 1; });
      list = list.filter(function (r) { return !drop[r.id]; });
    }
    return list;
  }

  function pick(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    if (a.del || b.del) return a.del ? a : b;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    return ja >= jb ? a : b;
  }

  function merge(a, b) {
    var x = normalize(a), y = normalize(b), byId = {};
    x.forms.concat(y.forms).forEach(function (r) { byId[r.id] = byId[r.id] ? pick(byId[r.id], r) : r; });
    return { ver: DATA_VER, forms: sorted(byId) };
  }

  function live(d) { return (d && d.forms || []).filter(function (r) { return !r.del; }); }
  function find(d, id) {
    var list = d && d.forms || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Put a changed form in (new m only when something really changed, R27).
  function put(d, rec, now) {
    var old = find(d, rec.id);
    var next = normRecord(Object.assign({}, rec, { m: old ? old.m : 0, c: old ? old.c : now }));
    if (old && !old.del && JSON.stringify(old) === JSON.stringify(next)) return { data: d, changed: false };
    next.m = Math.max(now, old ? old.m + 1 : 0);
    if (!old || old.del) next.c = now;
    var forms = (d.forms || []).filter(function (r) { return r.id !== rec.id; }).concat([next]);
    return { data: normalize({ forms: forms }), changed: true, rec: next };
  }

  function remove(d, id, now) {
    var old = find(d, id);
    if (!old || old.del) return { data: d, changed: false };
    var forms = d.forms.filter(function (r) { return r.id !== id; })
      .concat([{ id: id, m: Math.max(now, old.m + 1), del: 1 }]);
    return { data: normalize({ forms: forms }), changed: true, old: old };
  }

  // Undo of a delete: the old form comes back with a newer stamp.
  function restore(d, rec, now) {
    var cur = find(d, rec.id);
    var r = Object.assign({}, rec, { m: Math.max(now, cur ? cur.m + 1 : 0) });
    var forms = (d.forms || []).filter(function (x) { return x.id !== rec.id; }).concat([r]);
    return normalize({ forms: forms });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, DATA_VER: DATA_VER, MAX_FORMS: MAX_FORMS,
    normRecord: normRecord, normalize: normalize, merge: merge,
    live: live, find: find, put: put, remove: remove, restore: restore
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosFormsCore = api;
})(typeof window !== "undefined" ? window : this);
