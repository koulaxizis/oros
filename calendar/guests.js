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

  var LIM = { guests: 2000, lists: 500, name: 80, mail: 200, phone: 40, note: 200, plus: 20, cap: 100000, seats: 21, seatsDefault: 4 };
  var STATUSES = ["i", "y", "m", "n", "w"];
  var ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
  // event ids come from many places (imports, CalDAV): any one-line text without "/"
  // ticket key of a list (E3): 32 random bytes, base64url
  var SK_RE = /^[A-Za-z0-9_-]{43}$/;
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
    var out = { id: l.id, cap: cap, mtime: num(l.mtime) ? l.mtime : 0, g: g };
    if (typeof l.sk === "string" && SK_RE.test(l.sk)) out.sk = l.sk;
    // RSVP links (E2): seats one answer may take, open sign-up on/off,
    // links stopped, and the form's secrets at the relay
    if (num(l.ms) && l.ms >= 1) out.ms = Math.min(LIM.seats, Math.floor(l.ms));
    if (l.op === 1) out.op = 1;
    if (l.off === 1) out.off = 1;
    var rv = normRv(l.rv);
    if (rv) out.rv = rv;
    return out;
  }
  // { k, sec, key, priv } of forms/pub.js newKeys (priv = the RSA JWK
  // the answers are opened with). Made once; never changes.
  var RV_K = /^[a-z0-9]{16}$/, RV_SEC = /^[A-Za-z0-9]{32}$/, B64U = /^[A-Za-z0-9_-]{1,1200}$/;
  function normRv(rv) {
    if (!rv || typeof rv !== "object" || !RV_K.test(rv.k || "") || !RV_SEC.test(rv.sec || "") || !SK_RE.test(rv.key || "")) return null;
    var p = rv.priv, jwk = { kty: "RSA" };
    if (!p || typeof p !== "object" || p.kty !== "RSA") return null;
    var parts = ["n", "e", "d", "p", "q", "dp", "dq", "qi"];
    for (var i = 0; i < parts.length; i++) {
      if (typeof p[parts[i]] !== "string" || !B64U.test(p[parts[i]])) return null;
      jwk[parts[i]] = p[parts[i]];
    }
    jwk.alg = "RSA-OAEP-256";
    return { k: rv.k, sec: rv.sec, key: rv.key, priv: jwk };
  }

  function newer(a, b) {   // a beats b?
    if (!b) return true;
    if (a.mtime !== b.mtime) return a.mtime > b.mtime;
    return JSON.stringify(a) < JSON.stringify(b);
  }
  function byId(a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); }

  function merge(local, remote) {
    var tomb = {}, lists = {}, guests = {}, keys = {}, rvs = {};
    [local, remote].forEach(function (side) {
      if (!side || typeof side !== "object") return;
      (Array.isArray(side.deleted) ? side.deleted : []).map(normTomb).filter(Boolean).forEach(function (d) {
        if (!tomb[d.id] || d.mtime > tomb[d.id].mtime) tomb[d.id] = d;
      });
      (Array.isArray(side.lists) ? side.lists : []).forEach(function (raw) {
        var l = normList(raw, true);
        if (!l) return;
        var head = { id: l.id, cap: l.cap, mtime: l.mtime };
        if (l.ms) head.ms = l.ms;
        if (l.op) head.op = 1;
        if (l.off) head.off = 1;
        if (newer(head, lists[l.id])) lists[l.id] = head;
        // the ticket key never changes once made: the smallest one wins
        // (two devices making one before they synced is the only clash)
        if (l.sk && (!keys[l.id] || l.sk < keys[l.id])) keys[l.id] = l.sk;
        // the same for the RSVP form: the smallest relay name wins
        if (l.rv && (!rvs[l.id] || l.rv.k < rvs[l.id].k)) rvs[l.id] = l.rv;
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
      var row = { id: lid, cap: headAlive ? head.cap : 0, mtime: headAlive ? head.mtime : lt.mtime, g: keep };
      if (headAlive) ["ms", "op", "off"].forEach(function (f) { if (head[f]) row[f] = head[f]; });
      if (keys[lid]) row.sk = keys[lid];
      if (rvs[lid]) row.rv = rvs[lid];
      outLists.push(row);
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

  // ---------- tickets (wave E3) ----------
  // A ticket is "OT1.<guest id>.<sig>", sig = the first 16 bytes of
  // HMAC-SHA-256(list key, "orOS ticket|<event id>|<guest id>"),
  // base64url. No name or email in the code: the door looks the guest
  // up in the list, offline. `subtle` = crypto.subtle (passed in).
  function b64u(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = typeof atob === "function" ? atob(b) : Buffer.from(b, "base64").toString("binary");
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // a new key from 32 random bytes the caller passes (crypto.getRandomValues)
  function newKey(rand32) { return b64u(rand32); }
  // Give the list a ticket key if it has none (returns a new state).
  function withKey(data, evId, rand32, now) {
    var st = clone(data || empty()), l = ensureList(st, evId, now);
    if (!l || l.sk) return st;
    l.sk = newKey(rand32);
    l.mtime = now;
    return merge(st, null);
  }
  var TIX_RE = /^OT1\.([A-Za-z0-9_.:-]{1,64})\.([A-Za-z0-9_-]{22})$/;
  function sign(subtle, sk, evId, gid) {
    var enc = new TextEncoder();
    return subtle.importKey("raw", unb64u(sk), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (k) { return subtle.sign("HMAC", k, enc.encode("orOS ticket|" + evId + "|" + gid)); })
      .then(function (buf) { return b64u(new Uint8Array(buf).slice(0, 16)); });
  }
  function ticket(subtle, list, gid) {
    if (!list || !list.sk) return Promise.reject(new Error("nokey"));
    return sign(subtle, list.sk, list.id, gid).then(function (sig) { return "OT1." + gid + "." + sig; });
  }
  function parseTicket(text) {
    var m = TIX_RE.exec(String(text || "").trim());
    return m ? { gid: m[1], sig: m[2] } : null;
  }
  function sameStr(a, b) {             // constant time for equal lengths
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }
  // What the door says about a scanned code:
  //   { r: "bad" }        not an orOS ticket, or not for this event
  //   { r: "removed" }    signed for this event, but the guest was removed
  //   { r: "in", g }      already checked in (g.in = when)
  //   { r: "ok", g }      coming: let in
  //   { r: "ask", g }     on the list but not "coming" (maybe, no answer,
  //                       waiting, not coming): the person at the door decides
  function check(subtle, list, text) {
    var p = parseTicket(text);
    if (!p || !list || !list.sk) return Promise.resolve({ r: "bad" });
    return sign(subtle, list.sk, list.id, p.gid).then(function (sig) {
      if (!sameStr(sig, p.sig)) return { r: "bad" };
      var g = null;
      list.g.forEach(function (x) { if (x.id === p.gid) g = x; });
      if (!g) return { r: "removed" };
      if (g["in"]) return { r: "in", g: g };
      return { r: g.s === "y" ? "ok" : "ask", g: g };
    }, function () { return { r: "bad" }; });
  }

  // ---------- RSVP links (wave E2; relay/forms.js through forms/pub.js) ----------
  // One relay form per event. Its link opens calendar/rsvp.html:
  //   open sign-up   <site>calendar/rsvp.html#<k>.<key>
  //   one guest      … #<k>.<key>~<ticket code>[~<name, base64url UTF-8>]
  // The ticket code (E3) is the guest's proof: an answer that carries it
  // changes only that guest, and the page can show the ticket. The
  // fragment is never sent to any server.
  var SITE = "https://useoros.online/";
  var LINK_RE = /^#?([a-z0-9]{16})\.([A-Za-z0-9_-]{43})(?:~(OT1\.[A-Za-z0-9_.:-]{1,64}\.[A-Za-z0-9_-]{22}))?(?:~([A-Za-z0-9_-]{1,400}))?$/;
  function utf8b64u(s) {
    var b = new TextEncoder().encode(s);
    return b64u(b);
  }
  function rsvpLink(list, code, name, site) {
    if (!list || !list.rv) return "";
    var h = list.rv.k + "." + list.rv.key;
    if (code) {
      h += "~" + code;
      var n = str(name, LIM.name);
      if (n) h += "~" + utf8b64u(n);
    }
    return (site || SITE) + "calendar/rsvp.html#" + h;
  }
  // "#…" (or the whole URL) → { k, key, code?, name? } | null
  function parseRsvp(s) {
    var t = String(s || "").trim(), i = t.indexOf("#");
    var m = LINK_RE.exec(i >= 0 ? t.slice(i) : t);
    if (!m) return null;
    var o = { k: m[1], key: m[2] };
    if (m[3]) o.code = m[3];
    if (m[3] && m[4]) {
      try { o.name = str(new TextDecoder("utf-8", { fatal: true }).decode(unb64u(m[4])), LIM.name); } catch (e) {}
      if (!o.name) delete o.name;
    }
    return o;
  }
  function maxSeats(list) { return list && list.ms ? list.ms : LIM.seatsDefault; }
  // Head edits of the links: { ms?, op?, off? }
  function setRsvp(data, evId, o, now) {
    var st = clone(data || empty()), l = ensureList(st, evId, now);
    if (!l) return st;
    if (o.ms !== undefined) {
      var ms = num(o.ms) ? Math.max(1, Math.min(LIM.seats, Math.floor(o.ms))) : LIM.seatsDefault;
      if (ms === LIM.seatsDefault) delete l.ms; else l.ms = ms;
    }
    if (o.op !== undefined) { if (o.op) l.op = 1; else delete l.op; }
    if (o.off !== undefined) { if (o.off) l.off = 1; else delete l.off; }
    l.mtime = now;
    return merge(st, null);
  }
  // The form's secrets, kept once made (returns a new state)
  function withRsvp(data, evId, rv, now) {
    var st = clone(data || empty()), l = ensureList(st, evId, now), n = normRv(rv);
    if (!l || !n || l.rv) return st;
    l.rv = n;
    l.mtime = now;
    return merge(st, null);
  }
  // What the page gets (the app adds pub, the key answers are sealed for).
  // e = { t title, s start ms, e end ms, ad all day, loc, d notes, tz }
  function rsvpDef(list, e, lang) {
    var o = { v: 1, cal: 1, ev: { t: str(e.t, 200) }, ms: maxSeats(list), op: list && list.op ? 1 : 0, l: lang || "en" };
    if (num(e.s)) o.ev.s = e.s;
    if (num(e.e)) o.ev.e = e.e;
    if (e.ad) o.ev.ad = 1;
    var loc = str(e.loc, 300), d = typeof e.d === "string" ? e.d.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 1000) : "";
    if (loc) o.ev.loc = loc;
    if (d) o.ev.d = d;
    if (typeof e.tz === "string" && /^[A-Za-z0-9_+\-\/]{1,60}$/.test(e.tz)) o.ev.tz = e.tz;
    return o;
  }
  // The relay keeps the form until a day after the event (at most 90
  // days from now, at least an hour).
  function rsvpClose(e, now) {
    var end = num(e.e) ? e.e : (num(e.s) ? e.s : now);
    return Math.max(now + 3600000, Math.min(end + 86400000, now + 90 * 86400000));
  }
  // One opened answer → the list. row = { id, at, w? } from "pull",
  // o = the payload the guest's browser sealed:
  //   { rsvp: 1, s: "y"|"m"|"n", k: plus-ones, x?: note,
  //     t: ticket code (one guest's link) | n, m?, p? (open sign-up) }
  // → Promise<{ state, r: "upd"|"new"|"bad"|"gone"|"closed", guest? }>
  // A "yes" the relay put on the waiting list (row.w) stays waiting: a
  // place goes only on the organiser's tap (Chris Q4).
  function rsvpAnswer(subtle, data, evId, row, o, now) {
    var l = listOf(data, evId);
    var same = function (r) { return Promise.resolve({ state: data, r: r }); };
    if (!l || !o || typeof o !== "object" || o.rsvp !== 1 || ["y", "m", "n"].indexOf(o.s) === -1) return same("bad");
    var k = num(o.k) ? Math.max(0, Math.min(maxSeats(l) - 1, Math.floor(o.k))) : 0;
    var wish = o.s === "y" && row && row.w ? "w" : o.s;
    var raw = { s: wish, k: k };
    var x = str(o.x, LIM.note);
    if (x) raw.x = x;
    function put(r) {
      var res = putGuest(data, evId, raw, now);
      return res.error ? { state: data, r: "bad" } : { state: res.state, r: r, guest: res.guest, bumped: res.bumped };
    }
    if (typeof o.t === "string") {
      return check(subtle, l, o.t).then(function (c) {
        if (c.r === "bad") return { state: data, r: "bad" };
        if (c.r === "removed") return { state: data, r: "gone" };
        raw.id = c.g.id;
        if (c.g["in"]) { raw.s = "y"; }            // already at the door: stays in
        return put("upd");
      });
    }
    if (!l.op) return same("closed");
    var n = str(o.n, LIM.name);
    if (!n || !row || !num(row.id)) return same("bad");
    raw.id = "r" + Math.floor(row.id);
    raw.n = n;
    var m = str(o.m, LIM.mail), p = str(o.p, LIM.phone);
    if (m) raw.m = m;
    if (p) raw.p = p;
    return Promise.resolve(put("new"));
  }
  // .ics of the event for the guest's own calendar (RFC 5545, UTC times)
  function icsText(def, uid, stamp) {
    var e = def && def.ev ? def.ev : {};
    function esc(v) { return String(v || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
    function utc(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
    function day(ms) { return new Date(ms).toISOString().slice(0, 10).replace(/-/g, ""); }
    function fold(line) {
      var out = [], b = line;
      while (b.length > 74) { out.push(b.slice(0, 74)); b = " " + b.slice(74); }
      out.push(b);
      return out.join("\r\n");
    }
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//Calendar RSVP//EN", "BEGIN:VEVENT",
             "UID:" + uid + "@useoros.online", "DTSTAMP:" + utc(stamp)];
    if (num(e.s)) {
      if (e.ad) {
        L.push("DTSTART;VALUE=DATE:" + day(e.s));
        L.push("DTEND;VALUE=DATE:" + day(num(e.e) && e.e > e.s ? e.e : e.s + 86400000));
      } else {
        L.push("DTSTART:" + utc(e.s));
        L.push("DTEND:" + utc(num(e.e) && e.e > e.s ? e.e : e.s + 3600000));
      }
    }
    L.push("SUMMARY:" + esc(e.t));
    if (e.loc) L.push("LOCATION:" + esc(e.loc));
    if (e.d) L.push("DESCRIPTION:" + esc(e.d));
    L.push("END:VEVENT", "END:VCALENDAR");
    return L.map(fold).join("\r\n") + "\r\n";
  }

  var api = { LIM: LIM, STATUSES: STATUSES, normGuest: normGuest, merge: merge, empty: empty,
    listOf: listOf, counts: counts, fits: fits, waiting: waiting, nextUp: nextUp, settle: settle,
    putGuest: putGuest, removeGuest: removeGuest, setCap: setCap, checkIn: checkIn, dropList: dropList,
    fromContact: fromContact, csv: csv, view: view, seatsOf: seatsOf,
    withKey: withKey, ticket: ticket, parseTicket: parseTicket, check: check,
    rsvpLink: rsvpLink, parseRsvp: parseRsvp, maxSeats: maxSeats, setRsvp: setRsvp, withRsvp: withRsvp,
    rsvpDef: rsvpDef, rsvpClose: rsvpClose, rsvpAnswer: rsvpAnswer, icsText: icsText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosCalGuests = api;
})(typeof window !== "undefined" ? window : null);
