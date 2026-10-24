// ============================================================
// orOS Household — share.js (an app frame's side of "share the whole
// app with a household", BR-HH wave 7; no DOM)
// The bookkeeping Meal Planner, Baby, Pet Care, Together, Garage and
// Notes have in common: which household copies exist, which one is on
// screen, what was last read (so only changed records leave), own
// copies of copies that left a household. The app draws the chips and
// the dialog; this file never touches the page.
//   var S = OrosHouseShare.attach({
//     kind: "meals",                 // household document kind
//     whole: OrosHouseWhole.make(…), // the app's parts
//     adopt: function (data) {},     // an own copy of a copy that left
//                                    // a household (merge it into the
//                                    // own data and store it)
//     extra: function (g, data) {}   // optional: the app's own items
//                                    // ({ id: fields }) to send along
//   });
//   S.api()            → window.parent.orosHousehold or null
//   S.inject()         → true when what is on screen may have changed
//   S.pick(pref, ownEmpty) → the key on screen ("" = own): pref "own",
//                        "<box>/<doc>" or ""; a household copy is
//                        picked when the own data is empty
//   S.active()         → the key on screen; S.get(key) → the copy
//                        { box, id, hh, t, last, raw, by, rest, data }
//   S.keys()           → the household copies, sorted
//   S.push(data)       → sends what changed in the copy on screen
//   S.share(box, title, data) → Promise of "<box>/<doc>"
//   S.unshare()        → Promise (the copy on screen leaves for all)
//   S.households()     → [{ box, name }]
//   S.member(mid)      → { name, initials, color } of the copy on screen
//   S.me()             → this person's member id in the copy on screen
// Exposes window.OrosHouseShare and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var KEY_RE = /^[A-Za-z0-9_-]{1,40}\/[A-Za-z0-9_-]{1,40}$/;

  function attach(o) {
    var HC = root.OrosHouseCore || null;
    var groups = {}, active = "";

    function api() {
      if (!HC) return null;
      if (o.host) return o.host;
      try {
        var p = root.parent;
        return p && p !== root && p.orosHousehold && typeof p.orosHousehold.docs === "function" ? p.orosHousehold : null;
      } catch (e) { return null; }
    }
    function sig() {
      return Object.keys(groups).sort().map(function (k) { return k + ":" + groups[k].t; }).join(",") + "|" + active + "|" +
             (active ? JSON.stringify(groups[active].data) + JSON.stringify(groups[active].rest) : "");
    }
    function inject() {
      var h = api();
      if (!h) return false;
      var before = sig(), g = {};
      h.docs(o.kind).forEach(function (d) {
        if (!d.ready) return;
        var v = h.view(d.box, d.id);
        if (!v) return;
        var b = o.whole.build(v);
        g[d.box + "/" + d.id] = { box: d.box, id: d.id, hh: d.hh || "", t: (typeof v.m.t === "string" && v.m.t) || d.title || d.hh || "",
                                  last: o.whole.fromDoc(v), raw: b.raw, by: b.by, rest: b.rest, data: b.data };
      });
      groups = g;
      if (active && !groups[active]) active = "";
      var made = copies(h);
      return made || sig() !== before;
    }
    // The own copy of a household copy that left (unshared by me, or the
    // household is gone): stamped now, so it is newer than what it meets.
    function copies(h) {
      var made = false, now = Date.now();
      h.archived(o.kind).forEach(function (a) {
        if (a.take) {
          var data = o.whole.copyOf(HC.view(a.doc), now);
          if (data) { o.adopt(data); made = true; }
        }
        h.dropArchived(a.box, a.id);
      });
      return made;
    }
    function pick(pref, ownEmpty) {
      var keys = Object.keys(groups).sort(), want = "";
      if (pref && pref !== "own" && groups[pref]) want = pref;
      else if (pref !== "own" || ownEmpty) want = ownEmpty && keys.length ? keys[0] : "";
      active = want;
      return active;
    }
    function push(data) {
      var h = api(), g = groups[active];
      if (!h || !g) return false;
      g.data = data;
      var r = o.whole.push(g.last, data, o.extra ? o.extra(g, data) : null, g.raw);
      g.last = r.items;
      if (r.diff) h.change(g.box, g.id, { set: r.diff.set, del: r.diff.del });
      return !!r.diff;
    }
    function share(box, title, data) {
      var h = api();
      if (!h) return Promise.reject(new Error("no household"));
      var items = o.whole.project(data).items;
      return Promise.resolve(h.share(box, o.kind, title, { set: items })).then(function (id) {
        inject();
        active = groups[box + "/" + id] ? box + "/" + id : active;
        return box + "/" + id;
      });
    }
    function unshare() {
      var h = api(), g = groups[active];
      if (!h || !g) return Promise.reject(new Error("nothing shared"));
      return Promise.resolve(h.unshare(g.box, g.id)).then(function () { active = ""; inject(); });
    }
    function households() {
      var h = api();
      return h ? h.list().map(function (x) { return { box: x.box, name: x.name || "" }; }) : [];
    }
    function member(mid) {
      var h = api(), g = groups[active];
      return h && g && mid ? h.member(g.box, mid) : null;
    }
    function me() {
      var h = api(), g = groups[active];
      return h && g && typeof h.me === "function" ? h.me(g.box) || "" : "";
    }
    return {
      api: api, inject: inject, pick: pick, push: push, share: share, unshare: unshare,
      households: households, member: member, me: me,
      active: function () { return active; },
      get: function (k) { return groups[k] || null; },
      keys: function () { return Object.keys(groups).sort(); },
      okKey: function (k) { return typeof k === "string" && (k === "own" || KEY_RE.test(k)); }
    };
  }

  var api = { attach: attach };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosHouseShare = api;
})(typeof window !== "undefined" ? window : globalThis);
