// ============================================================
// orOS Chore Wheel — a wheel shared with a household (pure; BR-HH)
// A shared wheel is a household document of kind "chores"
// (household/engine.js). Everyone in the household sees the same
// members, chores and "done" marks; who I am in the wheel is each
// member's own item, so each person's reminder is only for their turn.
// Items, one per record (the household merge stamps them, so a
// record's m is its item's last change):
//   "mb:<id>"         a member: c { name, color, icon, away }, o order
//                     (content and place in the order merge apart, as
//                     in mergeChores)
//   "tk:<id>"         a chore: v { name, icon, freq, weight, mode, who, start, off }
//   "dn:<task>:<day>" a done / skipped mark: v [state, by]
//   "st:<task>:<day>" a hand-over or spin: v member id ("" back to the turn)
//   "me:<member id>"  v: the wheel member that household member is
// Only the marks of the last EV_DAYS days (and later ones), at most
// EV_MAX, travel: a household document holds at most 3000 items.
//   project(d, me, today) → { m: { t }, items }   (d: Chore Wheel data)
//   fromDoc(view)         → the items as the document holds them
//   build(view)           → { data, me, by } (data: Chore Wheel data,
//                            by: { record id or mark key: member id })
//   copyOf(view, now)     → { data, me } stamped now (an own copy)
//   collect(H)            → [{ id, t, hh, me, data }] every shared wheel
//                            this device can see, me = this person's
//   mirror(H, ls)         → writes MIRROR_KEY (device-local plain JSON
//                            { ver: 1, wheels }) when it changed; the
//                            shell's reminder, Today, search and the
//                            Calendar feed read it
// Exposes window.OrosChoresHouse and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosChoresCore || (typeof require === "function" ? require("./core.js") : null);
  var MIRROR_KEY = "oros-chores-hh";
  var FIELDS = ["c", "o", "v"];
  var EV_DAYS = 92, EV_MAX = 1500;
  var MID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var EV_RE = /^(dn|st):([a-z0-9]{6,40}):(\d{4}-\d{2}-\d{2})$/;

  function plain(x) { return JSON.parse(JSON.stringify(x)); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  function project(d, me, today) {
    var items = {}, data = C.mergeChores(d, d);
    data.members.forEach(function (mb) {
      items["mb:" + mb.id] = { c: { name: mb.name, color: mb.color, icon: mb.icon, away: mb.away }, o: mb.order };
    });
    data.tasks.forEach(function (tk) {
      items["tk:" + tk.id] = { v: { name: tk.name, icon: tk.icon, freq: plain(tk.freq), weight: tk.weight, mode: tk.mode,
                                    who: tk.who.slice(), start: tk.start, off: tk.off } };
    });
    // the newest marks: days from EV_DAYS ago on, newest first
    var from = C.dnToYmd(C.ymdToDn(today) - EV_DAYS), ev = [];
    [["done", "dn"], ["set", "st"]].forEach(function (p) {
      Object.keys(data[p[0]]).forEach(function (k) {
        var km = C.KEY_RE.exec(k);
        if (!km || km[2] < from || !C.taskById(data, km[1])) return;
        var x = data[p[0]][k];
        ev.push({ id: p[1] + ":" + km[1] + ":" + km[2], day: km[2], v: p[0] === "done" ? [x[0], x[1]] : x[0] });
      });
    });
    ev.sort(function (x, y) { return cmpStr(y.day, x.day) || cmpStr(x.id, y.id); });
    ev.slice(0, EV_MAX).forEach(function (e) { items[e.id] = { v: e.v }; });
    Object.keys(me || {}).forEach(function (mid) {
      if (MID_RE.test(mid)) items["me:" + mid] = { v: typeof me[mid] === "string" && C.ID_RE.test(me[mid]) ? me[mid] : null };
    });
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
    var raw = { ver: C.DATA_VER, members: [], tasks: [], done: {}, set: {}, tombs: {} }, me = {}, by = {};
    (view && view.items || []).forEach(function (it) {
      var i = it.id.indexOf(":"), k = it.id.slice(0, i), rest = it.id.slice(i + 1), m = stampOf(it);
      var who = typeof it._by === "string" ? it._by : "";
      if (k === "me") {
        if (MID_RE.test(rest) && typeof it.v === "string" && C.ID_RE.test(it.v)) me[rest] = it.v;
      } else if (k === "mb" && C.ID_RE.test(rest)) {
        var c = it.c && typeof it.c === "object" ? it.c : {};
        raw.members.push({ id: rest, m: m, name: c.name, color: c.color, icon: c.icon, away: c.away,
                           order: it.o, om: m });
        if (who) by[rest] = who;
      } else if (k === "tk" && C.ID_RE.test(rest) && it.v && typeof it.v === "object" && !Array.isArray(it.v)) {
        var tk = plain(it.v);
        tk.id = rest;
        tk.m = m;
        raw.tasks.push(tk);
        if (who) by[rest] = who;
      } else {
        var e = EV_RE.exec(it.id);
        if (!e) return;
        var key = e[2] + "|" + e[3];
        if (e[1] === "dn" && Array.isArray(it.v)) raw.done[key] = [it.v[0], it.v[1], m];
        else if (e[1] === "st" && typeof it.v === "string") raw.set[key] = [it.v, m];
        if (who) by[key] = who;
      }
    });
    return { data: C.mergeChores(raw, raw), me: me, by: by };
  }
  function build(view) { return records(view, function (it) { return it._t || 1; }); }
  function copyOf(view, now) {
    var r = records(view, function () { return now; });
    return { data: r.data, me: r.me };
  }

  function collect(H) {
    var out = [];
    if (!H || typeof H.docs !== "function") return out;
    H.docs("chores").forEach(function (d) {
      if (!d.ready) return;
      var v = H.view(d.box, d.id, ["o"]);
      if (!v) return;
      var b = build(v), mid = typeof H.me === "function" ? H.me(d.box) : "";
      out.push({ id: d.id, t: typeof v.m.t === "string" ? v.m.t : "", hh: d.hh || "", me: (mid && b.me[mid]) || "", data: b.data });
    });
    out.sort(function (a, b) { return cmpStr(a.id, b.id); });
    return out;
  }
  var lastMirror = null;
  function mirror(H, ls) {
    ls = ls || root.localStorage;
    var wheels = collect(H);
    var text = wheels.length ? JSON.stringify({ ver: 1, wheels: wheels }) : "";
    if (text === lastMirror) return false;
    lastMirror = text;
    try { if (text) ls.setItem(MIRROR_KEY, text); else ls.removeItem(MIRROR_KEY); } catch (e) {}
    return true;
  }
  // The wheels in the mirror, for readers that only see localStorage.
  function readMirror(raw) {
    var out = [];
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.wheels)) return out;
    raw.wheels.forEach(function (w) {
      if (!w || typeof w !== "object" || !w.data || typeof w.data !== "object") return;
      var data = C.mergeChores(w.data, w.data);
      out.push({ id: String(w.id || ""), t: typeof w.t === "string" ? w.t : "", hh: typeof w.hh === "string" ? w.hh : "",
                 me: typeof w.me === "string" && C.memberById(data, w.me) ? w.me : "", data: data });
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

  var api = { MIRROR_KEY: MIRROR_KEY, FIELDS: FIELDS, EV_DAYS: EV_DAYS, EV_MAX: EV_MAX,
              project: project, fromDoc: fromDoc, build: build, copyOf: copyOf,
              collect: collect, mirror: mirror, readMirror: readMirror, bootShell: bootShell };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.OrosChoresHouse = api;
    if (root.parent === root && root.orosHousehold) bootShell();      // the shell, not an app frame
  }
})(typeof window !== "undefined" ? window : globalThis);
