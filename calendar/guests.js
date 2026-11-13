// ============================================================
// orOS Calendar — guests of an event (events with RSVP, wave E1)
// Pure: no DOM, no storage, no clock (the caller passes `now`).
//
// Synced slice "calguests" (storage key oros-calendar-guests), kept
// apart from the "calendar" slice so the event bytes, ICS, CalDAV and
// household sharing never see guests:
//   { ver: 1,
//     lists:   [ { id: <event id>, cap: 0–100000 (0 = no limit),
//                  mtime, g: [ guest ] } ],     sorted by id
//     deleted: [ { id, mtime } ] }              sorted by id
//   guest = { id, n (name ≤ 80), m? (email ≤ 200), p? (phone ≤ 40),
//             c? (Contacts id ≤ 64), s: "i" invited (no answer) |
//             "y" coming | "m" maybe | "n" not coming | "w" waiting,
//             k (plus-ones 0–20), w? (ms: joined the waiting list),
//             in? (ms: checked in), x? (note ≤ 200), mtime }
// A list tombstone has the event id; a guest tombstone
// "<event id>/<guest id>". Per guest the newer mtime wins (equal:
// smaller JSON), so two phones checking in different guests both
// keep theirs. A guest newer than its tombstone (or its list's)
// survives. Guest tombstones a list tombstone covers are dropped.
// merge(get, get) = get (R26): canonical order, optional keys absent.
//
// Exposes window.OrosCalGuests and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var LIM = { guests: 2000, lists: 500, name: 80, mail: 200, phone: 40, note: 200, plus: 20, cap: 100000 };
  var STATUSES = ["i", "y", "m", "n", "w"];
  var ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
  // event ids come from many places (imports, CalDAV): any one-line text without "/"
  var EV_RE = /^[^\/\u0000-\u001f\u007f]{1,200}$/;

  function num(v) { return typeof v === "number" && isFinite(v); }
  function str(v, max) {
    if (typeof v !== "string") return "";
    // one line, no control characters
    return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function mailOk(m) { return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(m); }

  // strict = merge time: rows without a valid mtime are dropped
  function normGuest(g, strict) {
    if (!g || typeof g !== "object" || typeof g.id !== "string" || !ID_RE.test(g.id)) return null;
    if (strict && !num(g.mtime)) return null;
    var n = str(g.n, LIM.name);
    if (!n) return null;
    var out = { id: g.id, n: n };
    var m = str(g.m, LIM.mail);
    if (m && mailOk(m)) out.m = m;
    var p = str(g.p, LIM.phone).replace(/[^0-9+()\-. ]/g, "");
    if (p) out.p = p;
    if (typeof g.c === "string" && ID_RE.test(g.c)) out.c = g.c;
    out.s = STATUSES.indexOf(g.s) === -1 ? "i" : g.s;
    out.k = num(g.k) ? Math.max(0, Math.min(LIM.plus, Math.floor(g.k))) : 0;
    if (out.s === "w") out.w = num(g.w) && g.w > 0 ? Math.floor(g.w) : (num(g.mtime) ? Math.floor(g.mtime) : 1);
    if (num(g.in) && g.in > 0) out["in"] = Math.floor(g["in"]);
    var x = str(g.x, LIM.note);
    if (x) out.x = x;
    out.mtime = num(g.mtime) ? g.mtime : 0;
    return out;
  }
  function normTomb(d) {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || !d.id || d.id.length > 270 || !num(d.mtime)) return null;
    return { id: d.id, mtime: d.mtime };
  }
  function normList(l, strict) {
    if (!l || typeof l !== "object" || typeof l.id !== "string" || !EV_RE.test(l.id)) return null;
    if (strict && !num(l.mtime)) return null;
    var cap = num(l.cap) ? Math.max(0, Math.min(LIM.cap, Math.floor(l.cap))) : 0;
    var g = (Array.isArray(l.g) ? l.g : []).map(function (x) { return normGuest(x, strict); }).filter(Boolean);
    return { id: l.id, cap: cap, mtime: num(l.mtime) ? l.mtime : 0, g: g };
  }

  function newer(a, b) {   // a beats b?
    if (!b) return true;
    if (a.mtime !== b.mtime) return a.mtime > b.mtime;
    return JSON.stringify(a) < JSON.stringify(b);
  }
  function byId(a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); }

  function merge(local, remote) {
    var tomb = {}, lists = {}, guests = {};
    [local, remote].forEach(function (side) {
      if (!side || typeof side !== "object") return;
      (Array.isArray(side.deleted) ? side.deleted : []).map(normTomb).filter(Boolean).forEach(function (d) {
        if (!tomb[d.id] || d.mtime > tomb[d.id].mtime) tomb[d.id] = d;
      });
      (Array.isArray(side.lists) ? side.lists : []).forEach(function (raw) {
        var l = normList(raw, true);
        if (!l) return;
        var head = { id: l.id, cap: l.cap, mtime: l.mtime };
        if (newer(head, lists[l.id])) lists[l.id] = head;
        var gs = guests[l.id] || (guests[l.id] = {});
        l.g.forEach(function (g) { if (newer(g, gs[g.id])) gs[g.id] = g; });
      });
    });
    var outLists = [];
    Object.keys(lists).forEach(function (lid) {
      var lt = tomb[lid], head = lists[lid], gs = guests[lid] || {}, keep = [];
      Object.keys(gs).forEach(function (gid) {
        var g = gs[gid], gt = tomb[lid + "/" + gid];
        if (lt && lt.mtime >= g.mtime) return;          // the list was deleted after it
        if (gt && gt.mtime >= g.mtime) return;          // the guest was removed
        if (gt) delete tomb[lid + "/" + gid];           // edited after the removal: back
        keep.push(g);
      });
      var headAlive = !lt || head.mtime > lt.mtime;
      if (!keep.length && !headAlive) return;
      if (lt && (headAlive || keep.length)) delete tomb[lid];
      keep.sort(byId);
      outLists.push({ id: lid, cap: headAlive ? head.cap : 0, mtime: headAlive ? head.mtime : lt.mtime, g: keep });
    });
    // guest tombstones under a list tombstone that covers them say nothing more
    Object.keys(tomb).forEach(function (id) {
      var i = id.indexOf("/");
      if (i > 0) {
        var lt = tomb[id.slice(0, i)];
        if (lt && lt.mtime >= tomb[id].mtime) delete tomb[id];
      }
    });
    outLists.sort(byId);
    var deleted = Object.keys(tomb).sort().map(function (id) { return tomb[id]; });
    return { ver: 1, lists: outLists, deleted: deleted };
  }

  function empty() { return { ver: 1, lists: [], deleted: [] }; }
  function listOf(data, evId) {
    var ls = data && Array.isArray(data.lists) ? data.lists : [];
    for (var i = 0; i < ls.length; i++) if (ls[i].id === evId) return ls[i];
    return null;
  }
  function seatsOf(g) { return 1 + (g.k || 0); }

  // { yes, seats, maybe, no, open (no answer), wait, waitSeats, inN, inSeats, total, free (null = no limit) }
  function counts(list) {
    var c = { yes: 0, seats: 0, maybe: 0, no: 0, open: 0, wait: 0, waitSeats: 0, inN: 0, inSeats: 0, total: 0, free: null };
    var gs = list && list.g ? list.g : [];
    gs.forEach(function (g) {
      c.total++;
      if (g.s === "y") { c.yes++; c.seats += seatsOf(g); }
      else if (g.s === "m") c.maybe++;
      else if (g.s === "n") c.no++;
      else if (g.s === "w") { c.wait++; c.waitSeats += seatsOf(g); }
      else c.open++;
      if (g["in"]) { c.inN++; c.inSeats += seatsOf(g); }
    });
    if (list && list.cap > 0) c.free = Math.max(0, list.cap - c.seats);
    return c;
  }
  // Does this guest fit as "coming" (ignoring the guest's own current seats)?
  function fits(list, g) {
    if (!list || !(list.cap > 0)) return true;
    var used = 0;
    list.g.forEach(function (x) { if (x.s === "y" && x.id !== g.id) used += seatsOf(x); });
    return used + seatsOf(g) <= list.cap;
  }
  // The waiting list, in order (first come, first served).
  function waiting(list) {
    return (list && list.g ? list.g : []).filter(function (g) { return g.s === "w"; })
      .sort(function (a, b) { return (a.w - b.w) || (a.id < b.id ? -1 : 1); });
  }
  // The first waiting guest who fits in the free places now (null: none,
  // or no limit set — with no limit nobody needs to wait).
  function nextUp(list) {
    if (!list || !(list.cap > 0)) return null;
    var free = counts(list).free, w = waiting(list);
    for (var i = 0; i < w.length; i++) if (seatsOf(w[i]) <= free) return w[i];
    return null;
  }
  // The status a wished one becomes: "y" when full → "w".
  function settle(list, g, wish) {
    if (wish === "y" && !fits(list, g)) return "w";
    return STATUSES.indexOf(wish) === -1 ? "i" : wish;
  }

  // ---------- edits (return a NEW state; the caller saves it) ----------
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function ensureList(st, evId, now) {
    var l = listOf(st, evId);
    if (l) return l;
    if (typeof evId !== "string" || !EV_RE.test(evId) || st.lists.length >= LIM.lists) return null;
    l = { id: evId, cap: 0, mtime: now, g: [] };
    st.lists.push(l);
    st.lists.sort(byId);
    st.deleted = st.deleted.filter(function (d) { return d.id !== evId; });
    return l;
  }
  // put one guest (new or changed). Returns { state, guest, status } or { error }.
  function putGuest(data, evId, raw, now) {
    var st = clone(data || empty());
    var l = ensureList(st, evId, now);
    if (!l) return { error: "lists" };
    var old = null, i;
    for (i = 0; i < l.g.length; i++) if (l.g[i].id === raw.id) { old = l.g[i]; break; }
    if (!old && l.g.length >= LIM.guests) return { error: "full-list" };
    var g = normGuest(Object.assign({}, old || {}, raw, { mtime: now }), false);
    if (!g) return { error: "name" };
    var wish = g.s;
    g.s = settle(l, g, wish);
    if (g.s === "w") g.w = old && old.s === "w" && old.w ? old.w : now;
    else delete g.w;
    g.mtime = now;
    g = normGuest(g, true);
    if (old) l.g[i] = g; else l.g.push(g);
    l.g.sort(byId);
    st.deleted = st.deleted.filter(function (d) { return d.id !== evId + "/" + g.id; });
    return { state: st, guest: g, bumped: wish === "y" && g.s === "w" };
  }
  function removeGuest(data, evId, gid, now) {
    var st = clone(data || empty()), l = listOf(st, evId);
    if (!l) return st;
    l.g = l.g.filter(function (g) { return g.id !== gid; });
    st.deleted.push({ id: evId + "/" + gid, mtime: now });
    return merge(st, null);
  }
  function setCap(data, evId, cap, now) {
    var st = clone(data || empty()), l = ensureList(st, evId, now);
    if (!l) return st;
    l.cap = num(cap) ? Math.max(0, Math.min(LIM.cap, Math.floor(cap))) : 0;
    l.mtime = now;
    return merge(st, null);
  }
  // Check in (or undo it). Someone who is at the door takes a place,
  // whatever the list said: a checked-in guest is "coming".
  function checkIn(data, evId, gid, on, now) {
    var st = clone(data || empty()), l = listOf(st, evId);
    if (!l) return st;
    l.g.forEach(function (g) {
      if (g.id !== gid) return;
      if (on) { g["in"] = now; g.s = "y"; delete g.w; } else delete g["in"];
      g.mtime = now;
    });
    return merge(st, null);
  }
  function dropList(data, evId, now) {
    var st = clone(data || empty());
    st.lists = st.lists.filter(function (l) { return l.id !== evId; });
    st.deleted.push({ id: evId, mtime: now });
    return merge(st, null);
  }

  // A Contacts card → guest fields (first email and phone).
  function fromContact(c, name) {
    var g = { n: str(name, LIM.name), c: c && typeof c.id === "string" ? c.id : undefined };
    var em = c && Array.isArray(c.emails) && c.emails[0] ? c.emails[0].v : "";
    var ph = c && Array.isArray(c.phones) && c.phones[0] ? c.phones[0].v : "";
    if (em) g.m = em;
    if (ph) g.p = ph;
    return g;
  }

  // CSV (RFC 4180, ; never used as separator). A cell that a
  // spreadsheet would run as a formula (= + - @ tab CR) gets a ' first.
  function cell(v) {
    var s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // labels: { head: [8 names], status: { i, y, m, n, w } }, when(ms) → text
  function csv(list, labels, when) {
    var rows = [labels.head.map(cell).join(",")];
    (list && list.g ? list.g.slice() : []).sort(function (a, b) {
      return a.n.localeCompare(b.n);
    }).forEach(function (g) {
      rows.push([g.n, g.m || "", g.p || "", labels.status[g.s] || "", g.k || 0,
        g.s === "w" && g.w ? when(g.w) : "", g["in"] ? when(g["in"]) : "", g.x || ""].map(cell).join(","));
    });
    return "﻿" + rows.join("\r\n") + "\r\n";
  }

  // Filter + order for the screen: q = search text (name, email,
  // phone, note; accents and case ignored), f = "all" | a status | "in".
  function fold(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function view(list, q, f) {
    var fq = fold(q).trim();
    var order = { y: 0, m: 1, i: 2, w: 3, n: 4 };
    return (list && list.g ? list.g : []).filter(function (g) {
      if (f === "in" ? !g["in"] : (f && f !== "all" && g.s !== f)) return false;
      if (!fq) return true;
      return fold(g.n + " " + (g.m || "") + " " + (g.p || "") + " " + (g.x || "")).indexOf(fq) !== -1;
    }).sort(function (a, b) {
      if (a.s !== b.s) return order[a.s] - order[b.s];
      if (a.s === "w") return (a.w - b.w) || (a.id < b.id ? -1 : 1);
      return a.n.localeCompare(b.n) || (a.id < b.id ? -1 : 1);
    });
  }

  var api = { LIM: LIM, STATUSES: STATUSES, normGuest: normGuest, merge: merge, empty: empty,
    listOf: listOf, counts: counts, fits: fits, waiting: waiting, nextUp: nextUp, settle: settle,
    putGuest: putGuest, removeGuest: removeGuest, setCap: setCap, checkIn: checkIn, dropList: dropList,
    fromContact: fromContact, csv: csv, view: view, seatsOf: seatsOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosCalGuests = api;
})(typeof window !== "undefined" ? window : null);
