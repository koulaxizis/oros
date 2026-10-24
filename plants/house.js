// ============================================================
// orOS Plant Care — plants shared with a household (pure; BR-HH)
// A shared garden is a household document of kind "plants"
// (household/engine.js): everyone in the household sees the same
// plants, and "I watered it" moves the next due day for all of them
// (the due day is never stored: it comes from the log, core.js).
// Items, one per record (the household merge stamps them, so a
// record's m is its item's last change):
//   "p:<id>"   a plant: v = the plant without id and m
//   "l:<id>"   a log entry: v = the entry without id and m
//   "wh:<id>"  v = the household member the plant's reminder is for
//              (absent: everyone)
// Only entries of the last LOG_DAYS days travel, plus the newest of
// each plant and kind (the base of its schedule), at most LOG_MAX: a
// household document holds at most 3000 items.
//   project(d, who, today) → { m: { t }, items }   (d: Plant Care data)
//   fromDoc(view)          → the items as the document holds them
//   build(view)            → { data, who, by } (who: { plant id: member },
//                             by: { plant or entry id: member id })
//   copyOf(view, now)      → { data } stamped now (an own copy)
//   collect(H)             → [{ id, t, hh, mine, data }] every shared
//                             garden this device can see; mine = the
//                             plants whose reminder is for this person
//   mirror(H, ls)          → writes MIRROR_KEY (device-local plain JSON
//                             { ver: 1, gardens }) when it changed; the
//                             shell's reminder, Today, search and the
//                             Calendar feed read it
//   readMirror(raw)        → the gardens, each with data cut to mine
//                             as `own` (what reminds this person)
// Exposes window.OrosPlantsHouse and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosPlantsCore || (typeof require === "function" ? require("./core.js") : null);
  var MIRROR_KEY = "oros-plants-hh";
  var FIELDS = ["v"];
  var LOG_DAYS = 180, LOG_MAX = 2400;
  var MID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  function plain(x) { return JSON.parse(JSON.stringify(x)); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function strip(rec) {
    var v = {};
    Object.keys(rec).forEach(function (k) { if (k !== "id" && k !== "m") v[k] = rec[k]; });
    return plain(v);
  }

  function project(d, who, today) {
    var items = {}, data = C.merge(d, d);
    data.plants.forEach(function (p) {
      items["p:" + p.id] = { v: strip(p) };
      var w = who && who[p.id];
      if (typeof w === "string" && MID_RE.test(w)) items["wh:" + p.id] = { v: w };
    });
    // the base of every schedule, then the newest entries
    var newest = {}, from = C.addDays(today, -LOG_DAYS), keep = [], rest = [];
    data.log.forEach(function (x) {
      var k = x.p + "|" + x.k, cur = newest[k];
      if (!cur || x.d > cur.d || (x.d === cur.d && x.id > cur.id)) newest[k] = x;
    });
    data.log.forEach(function (x) {
      if (newest[x.p + "|" + x.k] === x) keep.push(x);
      else if (x.d >= from) rest.push(x);
    });
    rest.sort(function (x, y) { return cmpStr(y.d, x.d) || cmpStr(x.id, y.id); });
    keep.concat(rest.slice(0, Math.max(0, LOG_MAX - keep.length))).forEach(function (x) { items["l:" + x.id] = { v: strip(x) }; });
    return { m: { t: "" }, items: items };
  }

  function fromDoc(view) {
    var out = {};
    (view && view.items || []).forEach(function (it) {
      var o = {};
      FIELDS.forEach(function (f) { if (it[f] !== undefined) o[f] = it[f]; });
      out[it.id] = o;
    });
    return out;
  }

  function records(view, stampOf) {
    var raw = { ver: C.DATA_VER, plants: [], log: [], tombs: {} }, who = {}, by = {};
    (view && view.items || []).forEach(function (it) {
      var i = it.id.indexOf(":"), k = it.id.slice(0, i), id = it.id.slice(i + 1);
      if (!C.ID_RE.test(id)) return;
      if (k === "wh") { if (typeof it.v === "string" && MID_RE.test(it.v)) who[id] = it.v; return; }
      if ((k !== "p" && k !== "l") || !it.v || typeof it.v !== "object" || Array.isArray(it.v)) return;
      var rec = plain(it.v);
      rec.id = id;
      rec.m = stampOf(it);
      (k === "p" ? raw.plants : raw.log).push(rec);
      if (typeof it._by === "string" && it._by) by[id] = it._by;
    });
    var data = C.merge(raw, raw);
    Object.keys(who).forEach(function (id) { if (!data.plants.some(function (p) { return p.id === id; })) delete who[id]; });
    return { data: data, who: who, by: by };
  }
  function build(view) { return records(view, function (it) { return it._t || 1; }); }
  function copyOf(view, now) { return { data: records(view, function () { return now; }).data }; }

  function collect(H) {
    var out = [];
    if (!H || typeof H.docs !== "function") return out;
    H.docs("plants").forEach(function (d) {
      if (!d.ready) return;
      var v = H.view(d.box, d.id, ["o"]);
      if (!v) return;
      var b = build(v), mid = typeof H.me === "function" ? H.me(d.box) : "";
      var mine = b.data.plants.filter(function (p) { return !b.who[p.id] || b.who[p.id] === mid; }).map(function (p) { return p.id; });
      out.push({ id: d.id, t: typeof v.m.t === "string" ? v.m.t : "", hh: d.hh || "", mine: mine, data: b.data });
    });
    out.sort(function (a, b) { return cmpStr(a.id, b.id); });
    return out;
  }
  var lastMirror = null;
  function mirror(H, ls) {
    ls = ls || root.localStorage;
    var gardens = collect(H);
    var text = gardens.length ? JSON.stringify({ ver: 1, gardens: gardens }) : "";
    if (text === lastMirror) return false;
    lastMirror = text;
    try { if (text) ls.setItem(MIRROR_KEY, text); else ls.removeItem(MIRROR_KEY); } catch (e) {}
    return true;
  }
  function readMirror(raw) {
    var out = [];
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.gardens)) return out;
    raw.gardens.forEach(function (g) {
      if (!g || typeof g !== "object" || !g.data || typeof g.data !== "object") return;
      var data = C.merge(g.data, g.data), mine = Array.isArray(g.mine) ? g.mine : [];
      var own = { ver: data.ver, plants: data.plants.filter(function (p) { return mine.indexOf(p.id) >= 0; }), log: data.log, tombs: {} };
      out.push({ id: String(g.id || ""), t: typeof g.t === "string" ? g.t : "", hh: typeof g.hh === "string" ? g.hh : "", data: data, own: own });
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

  var api = { MIRROR_KEY: MIRROR_KEY, FIELDS: FIELDS, LOG_DAYS: LOG_DAYS, LOG_MAX: LOG_MAX,
              project: project, fromDoc: fromDoc, build: build, copyOf: copyOf,
              collect: collect, mirror: mirror, readMirror: readMirror, bootShell: bootShell };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.OrosPlantsHouse = api;
    if (root.parent === root && root.orosHousehold) bootShell();      // the shell, not an app frame
  }
})(typeof window !== "undefined" ? window : globalThis);
