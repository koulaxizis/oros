// ============================================================
// orOS Split — groups shared with a household (pure, no DOM; BR-HH)
// A shared group is a household document of kind "split"
// (household/engine.js). It keeps the group's own id (m.g), so every
// member's Split shows the very same group, people, expenses and
// payments, and a group file or a backup of it still joins up.
// Records live as items, one per record:
//   "p:<own>" a person, "e:<own>" an expense, "y:<own>" a payment,
//   "r:<own>" a repeating expense (<own> = the part of the record id
//   after "<group id>."), each { v: the record without id and m,
//   it: the itemised receipt or null }; the household merge stamps
//   them itself (the record's m is the item's last change).
//   "me:<member id>" { v: person id | null, it: null }: who each member
//   is in the group (Split's "mine"), set by that member only.
// A record is whole in v, so two edits of one expense never mix into
// an expense that does not add up (split.js's normalisers check it
// again anyway).
//   project(gid, d, me) → { m: { t, g, col, cur, arch }, items } of the
//                          group gid in Split data d; me: the member map
//   build(view)         → { gid, group, people, exp, pay, rec, me, by }
//                          raw records (split.js normalises them);
//                          by: { record id: member id of the last change }
//   copyOf(view, now)   → the same records stamped now (an own copy)
//   adopt(doc, gid, d)  → the records of gid in Split data d that the
//                          document does not know yet or that are newer
//                          than its copy and than its deletion (a group
//                          someone already had from a group file, or
//                          an edit on a second device of the person)
// Exposes window.OrosSplitHouse and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var GID_RE = /^[a-z0-9]{1,24}$/, OWN_RE = /^[a-z0-9]{1,24}$/, MID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var KINDS = { p: "people", e: "exp", y: "pay", r: "rec" };
  var KEY_OF = { people: "p", exp: "e", pay: "y", rec: "r" };
  var FIELDS = ["v", "it"];

  function groupOf(id) { var i = id.indexOf("."); return i < 0 ? id : id.slice(0, i); }
  function ownOf(id) { var i = id.indexOf("."); return i < 0 ? "" : id.slice(i + 1); }
  function plain(x) { return JSON.parse(JSON.stringify(x)); }
  function valueOf(rec) {
    var v = {};
    Object.keys(rec).forEach(function (k) { if (k !== "id" && k !== "m" && k !== "it") v[k] = rec[k]; });
    return plain(v);
  }

  function project(gid, d, me) {
    var items = {}, g = null;
    (d.groups || []).forEach(function (x) { if (x && x.id === gid) g = x; });
    Object.keys(KEY_OF).forEach(function (key) {
      (d[key] || []).forEach(function (rec) {
        if (!rec || typeof rec.id !== "string" || groupOf(rec.id) !== gid) return;
        var own = ownOf(rec.id);
        if (!OWN_RE.test(own)) return;
        items[KEY_OF[key] + ":" + own] = { v: valueOf(rec), it: rec.it ? plain(rec.it) : null };
      });
    });
    Object.keys(me || {}).forEach(function (mid) {
      if (MID_RE.test(mid)) items["me:" + mid] = { v: typeof me[mid] === "string" && me[mid] ? me[mid] : null, it: null };
    });
    return {
      m: { t: g ? g.n : "", g: gid, col: g ? g.col : 0, cur: g ? g.cur : "EUR", arch: g && g.arch ? 1 : 0 },
      items: items
    };
  }

  function recordsOf(view, gid, stampOf) {
    var out = { people: [], exp: [], pay: [], rec: [] }, me = {}, by = {};
    (view.items || []).forEach(function (it) {
      var i = it.id.indexOf(":"), k = it.id.slice(0, i), own = it.id.slice(i + 1);
      if (k === "me") {
        if (MID_RE.test(own) && typeof it.v === "string" && it.v) me[own] = it.v;
        return;
      }
      if (!KINDS[k] || !OWN_RE.test(own) || !it.v || typeof it.v !== "object" || Array.isArray(it.v)) return;
      var rec = plain(it.v);
      delete rec.it;
      rec.id = gid + "." + own;
      rec.m = stampOf(it);
      if (it.it && typeof it.it === "object") rec.it = plain(it.it);
      out[KINDS[k]].push(rec);
      if (typeof it._by === "string" && it._by) by[rec.id] = it._by;
    });
    return { lists: out, me: me, by: by };
  }
  function groupOfView(view, gid, m) {
    var vm = view.m || {};
    return { id: gid, m: m, n: typeof vm.t === "string" ? vm.t : "", col: vm.col, cur: vm.cur, arch: vm.arch ? 1 : 0 };
  }
  function build(view) {
    var gid = view && view.m && view.m.g;
    if (typeof gid !== "string" || !GID_RE.test(gid)) return null;
    var top = 1;
    (view.items || []).forEach(function (it) { if (it._t > top) top = it._t; });
    var r = recordsOf(view, gid, function (it) { return it._t || 1; });
    return { gid: gid, group: groupOfView(view, gid, top), people: r.lists.people, exp: r.lists.exp,
             pay: r.lists.pay, rec: r.lists.rec, me: r.me, by: r.by };
  }
  function copyOf(view, now) {
    var gid = view && view.m && view.m.g;
    if (typeof gid !== "string" || !GID_RE.test(gid)) return null;
    var r = recordsOf(view, gid, function () { return now; });
    return { gid: gid, group: groupOfView(view, gid, now), people: r.lists.people, exp: r.lists.exp,
             pay: r.lists.pay, rec: r.lists.rec, me: r.me, by: {} };
  }

  function adopt(doc, gid, d) {
    var out = { people: [], exp: [], pay: [], rec: [] }, it = (doc && doc.it) || {}, dt = (doc && doc.dt) || {};
    Object.keys(KEY_OF).forEach(function (key) {
      (d[key] || []).forEach(function (rec) {
        if (!rec || typeof rec.id !== "string" || groupOf(rec.id) !== gid || !OWN_RE.test(ownOf(rec.id))) return;
        var k = KEY_OF[key] + ":" + ownOf(rec.id), m = typeof rec.m === "number" ? rec.m : 0;
        if (it[k]) {
          var t = 0;
          Object.keys(it[k]).forEach(function (f) { var c = it[k][f]; if (Array.isArray(c) && c[1] > t) t = c[1]; });
          if (m <= t) return;
        } else if (typeof dt[k] === "number" && m <= dt[k]) return;
        out[key].push(plain(rec));
      });
    });
    return out;
  }

  var api = { FIELDS: FIELDS, KINDS: KINDS, project: project, build: build, copyOf: copyOf, adopt: adopt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosSplitHouse = api;
})(typeof window !== "undefined" ? window : globalThis);
