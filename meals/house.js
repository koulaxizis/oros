// ============================================================
// orOS Meal Planner — the meal plan shared with a household (pure;
// BR-HH wave 7)
// A shared plan is a household document of kind "meals": recipes,
// the week plan, shopping ticks and own items, the pantry, aisle and
// "always at home" choices, nutrition matches and the settings, one
// item per record (household/whole.js). Deleted ready recipes travel
// as the item "sd" { v: { recipe id: stamp } }, so a ready recipe one
// person deleted stays deleted for everyone.
// Plan days, ticks and own shopping items older than WINDOW_DAYS do
// not travel (a household document holds at most 3000 items); they
// leave the document with the next change.
//   W                       the whole-data maker (household/whole.js)
//   whole                   the same with the window and "sd", for
//                            household/share.js
//   window(d, today)        → the data that travels
//   project(d, today)       → { items }  (the items to share)
//   build(view)             → { data, by, raw } (data with the ready-
//                              recipe tombstones from "sd")
//   extra(data)             → { sd: { v } } or {} (the app's item)
//   copyOf(view, now)       → data stamped now (an own copy)
//   collect(H)              → [{ id, t, hh, data }] every shared plan
//   mirror(H, ls)           → writes MIRROR_KEY ({ ver: 1, plans }) when
//                              it changed; Today reads it
//   readMirror(raw)         → the plans
// Exposes window.OrosMealsHouse and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosMealsCore;
  var Wh = root.OrosHouseWhole || (typeof require === "function" ? require("../household/whole.js") : null);
  var MIRROR_KEY = "oros-meals-hh";
  var WINDOW_DAYS = 120;

  var W = Wh.make({
    parts: [
      { k: "rc", t: "list", p: "r" }, { k: "mn", t: "list", p: "n" }, { k: "pa", t: "list", p: "pa" },
      { k: "pl", t: "map", p: "pl" }, { k: "ck", t: "map", p: "ck" }, { k: "ai", t: "map", p: "ai" },
      { k: "pn", t: "map", p: "pn" }, { k: "nu", t: "map", p: "nu" }, { k: "set", t: "one", p: "set" }
    ],
    merge: function (a, b) { return C.mergeMeals(a, b); },
    empty: function () { return C.emptyData(); }
  });

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  function windowed(d, today) {
    var data = C.mergeMeals(d, d), from = C.addDays(today, -WINDOW_DAYS);
    var pl = {}, ck = {};
    Object.keys(data.pl).forEach(function (k) { if (k.slice(0, 10) >= from) pl[k] = data.pl[k]; });
    Object.keys(data.ck).forEach(function (k) { if (k.slice(0, 10) >= from) ck[k] = data.ck[k]; });
    data.pl = pl; data.ck = ck;
    data.mn = data.mn.filter(function (x) { return x.w >= from; });
    return data;
  }
  function seedTombs(d) {
    var out = {}, n = 0;
    (C.SEED_IDS || []).forEach(function (id) { if (d.tombs && typeof d.tombs[id] === "number") { out[id] = d.tombs[id]; n++; } });
    return n ? out : null;
  }
  function extra(data) {
    var sd = seedTombs(data);
    return sd ? { sd: { v: sd } } : {};
  }
  function project(d, today) {
    var data = windowed(d, today), items = W.project(data).items;
    var x = extra(data);
    Object.keys(x).forEach(function (id) { items[id] = x[id]; });
    return { items: items };
  }
  function withSeeds(b) {
    var sd = null;
    b.rest.forEach(function (it) { if (it.id === "sd" && it.v && typeof it.v === "object") sd = it.v; });
    if (sd) {
      var raw = JSON.parse(JSON.stringify(b.data));
      Object.keys(sd).forEach(function (id) {
        if ((C.SEED_IDS || []).indexOf(id) >= 0 && typeof sd[id] === "number" && sd[id] > 0) raw.tombs[id] = Math.max(raw.tombs[id] || 0, Math.floor(sd[id]));
      });
      b.data = C.mergeMeals(raw, raw);
    }
    return b;
  }
  function build(view) { return withSeeds(W.build(view)); }
  function copyOf(view, now) {
    var b = withSeeds({ data: W.copyOf(view, now), rest: (view && view.items || []).filter(function (it) { return it.id === "sd"; }) });
    return b.data;
  }

  // What household/share.js needs: the parts, with the window and the
  // ready-recipe tombstones.
  function todayYmd() { return C.localYmd(new Date()); }
  var whole = {
    fromDoc: W.fromDoc, build: build, copyOf: copyOf,
    project: function (d) { return project(d, todayYmd()); },
    push: function (last, d, x, raw) { return W.push(last, windowed(d, todayYmd()), x, raw); }
  };

  function collect(H) {
    var out = [];
    if (!H || typeof H.docs !== "function") return out;
    H.docs("meals").forEach(function (d) {
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
    var plans = collect(H);
    var text = plans.length ? JSON.stringify({ ver: 1, plans: plans }) : "";
    if (text === lastMirror) return false;
    lastMirror = text;
    try { if (text) ls.setItem(MIRROR_KEY, text); else ls.removeItem(MIRROR_KEY); } catch (e) {}
    return true;
  }
  function readMirror(raw) {
    var out = [];
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.plans)) return out;
    raw.plans.forEach(function (p) {
      if (!p || typeof p !== "object" || !p.data || typeof p.data !== "object") return;
      out.push({ id: String(p.id || ""), t: typeof p.t === "string" ? p.t : "", hh: typeof p.hh === "string" ? p.hh : "",
                 data: C.mergeMeals(p.data, p.data) });
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

  var api = { MIRROR_KEY: MIRROR_KEY, WINDOW_DAYS: WINDOW_DAYS, W: W, whole: whole,
              window: windowed, project: project, build: build, extra: extra, copyOf: copyOf,
              collect: collect, mirror: mirror, readMirror: readMirror, bootShell: bootShell };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.OrosMealsHouse = api;
    if (root.parent === root && root.orosHousehold) bootShell();      // the shell, not an app frame
  }
})(typeof window !== "undefined" ? window : globalThis);
