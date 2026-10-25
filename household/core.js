// ============================================================
// orOS Household — shared documents and membership (pure, no DOM)
// One copy for the shell engine (household/engine.js), the Household
// app and the apps that share something (To-Do since wave 1), and for
// Node in the tests (tests/household-core.test.js).
//
// A household shares DOCUMENTS (the roster "r" and one per shared
// list, calendar, …). Every document has ONE shape, merged the same
// way whatever it holds:
//   { v: 1, kind, m: { f: [value, t, by] },            fields of the document
//     it: { id: { f: [value, t, by] } },               its items, field by field
//     dt: { id: t } }                                  deleted items
// t = a hybrid clock stamp (ms, never behind the newest stamp seen),
// by = the member who wrote it. Merge rules (OROS_BIBLE.md BR-HH):
//   - each field: the larger t wins; a tie goes to the larger `by`,
//     then to the larger JSON, so merge(a, b) === merge(b, a);
//   - deleted items: the larger t; an item lives while one of its
//     fields is newer than its deletion (an edit after a delete brings
//     it back, like every orOS slice, R17);
//   - merge(a, a) === a and canon() is canonical (keys sorted), so a
//     pull that brings nothing new never causes an upload;
//   - deletions older than 180 days before the newest stamp are
//     dropped (the box itself is deleted after 180 days unused).
// Apps never write stamps themselves: they hand plain changes to
// apply() (engine: orosHousehold.change), read plain values with
// view(), and find what changed with diffItems().
//
// Membership (the person's own synced slice "household", never shared):
//   { v: 1, hh: { <box>: { name, mid, pub, priv (JWK), keys { epoch: K },
//       epoch, adm (admin token or ""), at, m } }, tomb: { <box>: ms } }
// mergeMembership() follows the same slice rules (R5, R17).
// Exposes window.OrosHouseCore and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var FIELD_RE = /^[a-z][a-zA-Z0-9]{0,15}$/;
  var ITEM_RE = /^[A-Za-z0-9_:-]{1,72}$/;
  var BY_RE = /^[A-Za-z0-9_-]{0,22}$/;
  var BOX_RE = /^[A-Za-z0-9_-]{22}$/;
  var KEY_RE = /^[A-Za-z0-9_-]{43}$/;
  var MAX_ITEMS = 3000;
  var MAX_FIELDS = 24;
  var MAX_VALUE = 8192;         // characters of one field's JSON
  var TOMB_MS = 180 * 86400000;
  var MAX_T = 8.64e15;          // the largest Date

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function stampOk(t) { return typeof t === "number" && isFinite(t) && t > 0 && t <= MAX_T && Math.floor(t) === t; }
  function jsonOf(v) { return JSON.stringify(v === undefined ? null : v); }

  // A plain JSON value of bounded size, or undefined.
  function cleanValue(v) {
    if (v === undefined) return undefined;
    var s;
    try { s = JSON.stringify(v); } catch (e) { return undefined; }
    if (typeof s !== "string" || s.length > MAX_VALUE) return undefined;
    return JSON.parse(s);
  }
  function cleanCell(c) {
    if (!Array.isArray(c) || c.length !== 3 || !stampOk(c[1]) || typeof c[2] !== "string" || !BY_RE.test(c[2])) return null;
    var v = cleanValue(c[0]);
    if (v === undefined) return null;
    return [v, c[1], c[2]];
  }
  function cleanFields(src) {
    var out = {}, n = 0;
    if (!isObj(src)) return out;
    Object.keys(src).sort().forEach(function (f) {
      if (n >= MAX_FIELDS || !FIELD_RE.test(f)) return;
      var c = cleanCell(src[f]);
      if (c) { out[f] = c; n++; }
    });
    return out;
  }

  // Any input → a valid document (bad parts dropped). kind is kept as
  // given when valid, else the fallback.
  function clean(doc, kind) {
    var d = isObj(doc) ? doc : {};
    var out = { v: VER, kind: typeof d.kind === "string" && /^[a-z]{1,16}$/.test(d.kind) ? d.kind : (kind || "list"), m: cleanFields(d.m), it: {}, dt: {} };
    var n = 0;
    if (isObj(d.it)) {
      Object.keys(d.it).sort().forEach(function (id) {
        if (n >= MAX_ITEMS || !ITEM_RE.test(id)) return;
        var f = cleanFields(d.it[id]);
        if (Object.keys(f).length) { out.it[id] = f; n++; }
      });
    }
    if (isObj(d.dt)) {
      Object.keys(d.dt).sort().forEach(function (id) {
        if (ITEM_RE.test(id) && stampOk(d.dt[id])) out.dt[id] = d.dt[id];
      });
    }
    return canon(out);
  }

  function empty(kind) { return { v: VER, kind: kind || "list", m: {}, it: {}, dt: {} }; }

  function newestOf(doc) {
    var mx = 0;
    var scan = function (fs) { Object.keys(fs).forEach(function (f) { if (fs[f][1] > mx) mx = fs[f][1]; }); };
    scan(doc.m || {});
    Object.keys(doc.it || {}).forEach(function (id) { scan(doc.it[id]); });
    Object.keys(doc.dt || {}).forEach(function (id) { if (doc.dt[id] > mx) mx = doc.dt[id]; });
    return mx;
  }
  function itemNewest(fs) {
    var mx = 0;
    Object.keys(fs).forEach(function (f) { if (fs[f][1] > mx) mx = fs[f][1]; });
    return mx;
  }
  function alive(fs, dt) { return dt === undefined || itemNewest(fs) > dt; }

  // Keys sorted, dead items reduced to their deletion, old deletions
  // dropped (measured against the newest stamp in the document, never
  // against this device's clock).
  function canon(doc) {
    var out = { v: VER, kind: doc.kind, m: {}, it: {}, dt: {} };
    var cutoff = newestOf(doc) - TOMB_MS;
    Object.keys(doc.m || {}).sort().forEach(function (f) { out.m[f] = doc.m[f]; });
    Object.keys(doc.it || {}).sort().forEach(function (id) {
      var fs = doc.it[id];
      if (!alive(fs, (doc.dt || {})[id])) return;
      var o = {};
      Object.keys(fs).sort().forEach(function (f) { o[f] = fs[f]; });
      out.it[id] = o;
    });
    Object.keys(doc.dt || {}).sort().forEach(function (id) {
      if (out.it[id]) {
        // alive again: only the fields newer than the deletion count
        var keep = {}, t = doc.dt[id];
        Object.keys(out.it[id]).forEach(function (f) { if (out.it[id][f][1] > t) keep[f] = out.it[id][f]; });
        out.it[id] = keep;
        if (doc.dt[id] >= cutoff) out.dt[id] = doc.dt[id];
        return;
      }
      if (doc.dt[id] >= cutoff) out.dt[id] = doc.dt[id];
    });
    return out;
  }

  function newerCell(x, y) {
    if (x[1] !== y[1]) return x[1] > y[1] ? x : y;
    if (x[2] !== y[2]) return x[2] > y[2] ? x : y;
    return jsonOf(x[0]) >= jsonOf(y[0]) ? x : y;
  }
  function mergeFields(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (f) { out[f] = a[f]; });
    Object.keys(b || {}).forEach(function (f) { out[f] = out[f] ? newerCell(out[f], b[f]) : b[f]; });
    return out;
  }

  // Two copies of the same document → one (symmetric, idempotent).
  function merge(a, b) {
    if (!a && !b) return null;
    if (!a) return canon(b);
    if (!b) return canon(a);
    var kind = a.kind === b.kind ? a.kind : (a.kind > b.kind ? a.kind : b.kind);
    var out = { v: VER, kind: kind, m: mergeFields(a.m, b.m), it: {}, dt: {} };
    var ids = {};
    Object.keys(a.it || {}).forEach(function (id) { ids[id] = 1; });
    Object.keys(b.it || {}).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) {
      var x = (a.it || {})[id], y = (b.it || {})[id];
      out.it[id] = x && y ? mergeFields(x, y) : (x || y);
    });
    [a.dt || {}, b.dt || {}].forEach(function (d) {
      Object.keys(d).forEach(function (id) { out.dt[id] = Math.max(out.dt[id] || 0, d[id]); });
    });
    // a field older than its item's deletion is gone for good
    Object.keys(out.dt).forEach(function (id) {
      var fs = out.it[id];
      if (!fs) return;
      var keep = {};
      Object.keys(fs).forEach(function (f) { if (fs[f][1] > out.dt[id]) keep[f] = fs[f]; });
      if (Object.keys(keep).length) out.it[id] = keep; else delete out.it[id];
    });
    return canon(out);
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Hybrid clock: never behind the newest stamp already seen.
  function clock(seen, now) {
    var n = Math.floor(typeof now === "number" ? now : Date.now());
    return Math.max(n, Math.floor(seen || 0) + 1);
  }

  // Plain changes → a new document. changes = { m: { f: value },
  // set: { id: { f: value } }, del: [id] }. A value of undefined in
  // set/m is ignored. Only fields whose value really changes get the
  // new stamp, so applying the same change twice changes nothing.
  function apply(doc, changes, t, by) {
    var d = doc ? JSON.parse(JSON.stringify(doc)) : empty();
    if (!stampOk(t)) throw new Error("bad stamp");
    by = BY_RE.test(by || "") ? by : "";
    var c = changes || {};
    var put = function (fs, f, v) {
      if (!FIELD_RE.test(f)) return;
      var val = cleanValue(v);
      if (val === undefined) return;
      if (fs[f] && jsonOf(fs[f][0]) === jsonOf(val)) return;
      fs[f] = [val, t, by];
    };
    if (isObj(c.m)) Object.keys(c.m).forEach(function (f) { put(d.m, f, c.m[f]); });
    if (isObj(c.set)) {
      Object.keys(c.set).forEach(function (id) {
        if (!ITEM_RE.test(id) || !isObj(c.set[id])) return;
        var dead = d.dt[id] !== undefined && !(d.it[id] && alive(d.it[id], d.dt[id]));
        var fs = dead ? {} : (d.it[id] || {});
        if (dead) {
          // a deleted item written again: every field it is given is new
          Object.keys(c.set[id]).forEach(function (f) {
            var val = cleanValue(c.set[id][f]);
            if (FIELD_RE.test(f) && val !== undefined) fs[f] = [val, t, by];
          });
        } else {
          Object.keys(c.set[id]).forEach(function (f) { put(fs, f, c.set[id][f]); });
        }
        if (Object.keys(fs).length) d.it[id] = fs;
      });
    }
    if (Array.isArray(c.del)) {
      c.del.forEach(function (id) {
        if (typeof id !== "string" || !ITEM_RE.test(id) || !d.it[id]) return;
        d.dt[id] = t;
        delete d.it[id];
      });
    }
    return canon(d);
  }

  // Plain values: { m: { f: v }, items: [{ id, …fields, _t, _by }] },
  // items sorted by the field "o" (a number, absent = 0), then id.
  // quiet: fields that do not count for _t / _by (who changed an item
  // last), such as its place in a list, which moves when others are added
  function view(doc, quiet) {
    var out = { m: {}, items: [] };
    if (!doc) return out;
    Object.keys(doc.m || {}).forEach(function (f) { out.m[f] = doc.m[f][0]; });
    Object.keys(doc.it || {}).forEach(function (id) {
      var fs = doc.it[id], it = { id: id }, t = 0, by = "";
      Object.keys(fs).forEach(function (f) {
        it[f] = fs[f][0];
        if (quiet && quiet.indexOf(f) >= 0) return;
        if (fs[f][1] > t) { t = fs[f][1]; by = fs[f][2]; }
      });
      it._t = t; it._by = by;
      out.items.push(it);
    });
    out.items.sort(function (x, y) {
      var ox = typeof x.o === "number" ? x.o : 0, oy = typeof y.o === "number" ? y.o : 0;
      if (ox !== oy) return ox - oy;
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    return out;
  }

  // What changed between two plain item maps ({ id: { f: v } }): the
  // fields to set and the ids to delete. Fields named in `fields` only
  // (all fields when omitted); a field that disappears is set to null.
  function diffItems(prev, next, fields) {
    var set = {}, del = [], any = false;
    prev = prev || {}; next = next || {};
    Object.keys(next).forEach(function (id) {
      var a = prev[id] || null, b = next[id] || {}, ch = {}, n = 0;
      var names = fields || Object.keys(b).concat(a ? Object.keys(a) : []);
      names.forEach(function (f) {
        if (f.charAt(0) === "_" || f === "id") return;
        var vb = b[f] === undefined ? null : b[f];
        var va = a ? (a[f] === undefined ? null : a[f]) : undefined;
        if (va === undefined || jsonOf(va) !== jsonOf(vb)) { ch[f] = vb; n++; }
      });
      if (n) { set[id] = ch; any = true; }
    });
    Object.keys(prev).forEach(function (id) { if (!next[id]) { del.push(id); any = true; } });
    del.sort();
    return any ? { set: set, del: del } : null;
  }

  // ---------- the roster document "r" ----------
  // Fields of m: name. Items: "p:<mid>" members { n, c, pub, adm, j },
  // "c:<doc>" shared documents { kind, t }, "i:<ih>" invites
  // { s (the invite secret), pw, exp, n, by }.
  var COLORS = ["#e06c75", "#e5a050", "#ecc75f", "#87cf3e", "#4fc4cf", "#61afef", "#a685e2", "#e07cc0"];
  function roster(doc) {
    var v = view(doc), out = { name: typeof v.m.name === "string" ? v.m.name : "", members: [], docs: [], invites: [] };
    v.items.forEach(function (it) {
      var kind = it.id.slice(0, 2), id = it.id.slice(2);
      if (kind === "p:" && BOX_RE.test(id)) {
        out.members.push({ id: id, name: line(it.n, 40) || "?", color: COLORS[(it.c | 0) % COLORS.length], ci: (it.c | 0) % COLORS.length,
                           pub: typeof it.pub === "string" ? it.pub : "", admin: it.adm === true, joined: typeof it.j === "number" ? it.j : 0 });
      } else if (kind === "c:" && /^[A-Za-z0-9_-]{1,32}$/.test(id)) {
        out.docs.push({ id: id, kind: typeof it.kind === "string" ? it.kind : "", title: line(it.t, 80), by: it._by, t: it._t });
      } else if (kind === "i:" && /^[0-9a-f]{64}$/.test(id)) {
        out.invites.push({ ih: id, secret: typeof it.s === "string" ? it.s : "", pw: it.pw === true, exp: typeof it.exp === "number" ? it.exp : 0,
                           n: typeof it.n === "number" ? it.n : 1, by: typeof it.by === "string" ? it.by : "" });
      }
    });
    out.members.sort(function (a, b) { return a.joined - b.joined || (a.id < b.id ? -1 : 1); });
    return out;
  }
  function line(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function initials(name) {
    var parts = line(name, 40).split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    var s = parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "");
    return s.toUpperCase();
  }

  // ---------- membership (own slice) ----------
  // A household in a shared WebDAV folder (wave 7g): its address and
  // sign-in (the folder's own; household/folder.js).
  function cleanDav(d) {
    if (!isObj(d) || typeof d.url !== "string" || d.url.length > 400) return null;
    var url = d.url.replace(/\/+$/, ""), u;
    try { u = new URL(url); } catch (x) { return null; }
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
    var s = function (v, n) { return typeof v === "string" && v.length <= n ? v : ""; };
    return { url: url, user: s(d.user, 200), pass: s(d.pass, 400), relay: d.relay === true };
  }
  function cleanEntry(e) {
    if (!isObj(e) || !BOX_RE.test(e.mid || "")) return null;
    var keys = {};
    if (isObj(e.keys)) {
      Object.keys(e.keys).forEach(function (ep) {
        if (/^[1-9]\d{0,8}$/.test(ep) && KEY_RE.test(e.keys[ep] || "")) keys[ep] = e.keys[ep];
      });
    }
    if (!Object.keys(keys).length) return null;
    var priv = isObj(e.priv) && e.priv.kty === "EC" && e.priv.crv === "P-256" &&
               ["d", "x", "y"].every(function (k) { return typeof e.priv[k] === "string" && /^[A-Za-z0-9_-]{40,46}$/.test(e.priv[k]); })
               ? { kty: "EC", crv: "P-256", d: e.priv.d, x: e.priv.x, y: e.priv.y } : null;
    if (!priv) return null;
    var epoch = 0;
    Object.keys(keys).forEach(function (ep) { if (+ep > epoch) epoch = +ep; });
    var out = { name: line(e.name, 60), mid: e.mid, pub: typeof e.pub === "string" && /^[A-Za-z0-9_-]{80,100}$/.test(e.pub) ? e.pub : "",
             priv: priv, keys: keys, epoch: epoch, adm: KEY_RE.test(e.adm || "") ? e.adm : "",
             at: stampOk(e.at) ? e.at : 0, m: stampOk(e.m) ? e.m : 0 };
    var dav = cleanDav(e.dav);
    if (dav) out.dav = dav;
    return out;
  }
  function cleanMembership(d) {
    var out = { v: VER, hh: {}, tomb: {} };
    if (!isObj(d)) return out;
    if (isObj(d.tomb)) Object.keys(d.tomb).sort().forEach(function (b) { if (BOX_RE.test(b) && stampOk(d.tomb[b])) out.tomb[b] = d.tomb[b]; });
    if (isObj(d.hh)) {
      Object.keys(d.hh).sort().forEach(function (b) {
        if (!BOX_RE.test(b)) return;
        var e = cleanEntry(d.hh[b]);
        if (e && !(out.tomb[b] >= e.m)) out.hh[b] = e;
      });
    }
    return out;
  }
  function mergeEntry(x, y) {
    // two devices that joined the same household on their own: the
    // smaller member id stays (both sides pick it); keys are the union
    var base = x.mid !== y.mid ? (x.mid < y.mid ? x : y) : (x.m !== y.m ? (x.m > y.m ? x : y) : (jsonOf(x) >= jsonOf(y) ? x : y));
    var out = JSON.parse(JSON.stringify(base));
    out.keys = {};
    [x.keys, y.keys].forEach(function (k) { Object.keys(k).forEach(function (ep) { out.keys[ep] = out.keys[ep] || k[ep]; }); });
    if (x.mid === y.mid) {
      out.adm = base.adm || (base === x ? y.adm : x.adm);
      var nx = x.m >= y.m ? x : y;
      out.name = nx.name;
    }
    out.m = Math.max(x.m, y.m);
    out.at = Math.min(x.at || y.at, y.at || x.at);
    return cleanEntry(out);
  }
  function mergeMembership(a, b) {
    var A = cleanMembership(a), B = cleanMembership(b);
    var out = { v: VER, hh: {}, tomb: {} };
    [A.tomb, B.tomb].forEach(function (t) { Object.keys(t).forEach(function (k) { out.tomb[k] = Math.max(out.tomb[k] || 0, t[k]); }); });
    var boxes = {};
    Object.keys(A.hh).forEach(function (k) { boxes[k] = 1; });
    Object.keys(B.hh).forEach(function (k) { boxes[k] = 1; });
    Object.keys(boxes).forEach(function (k) {
      var x = A.hh[k], y = B.hh[k];
      out.hh[k] = x && y ? mergeEntry(x, y) : (x || y);
    });
    return cleanMembership(out);
  }

  var api = {
    VER: VER, TOMB_MS: TOMB_MS, COLORS: COLORS, MAX_VALUE: MAX_VALUE, BOX_RE: BOX_RE,
    empty: empty, clean: clean, canon: canon, merge: merge, same: same, clock: clock, newestOf: newestOf,
    apply: apply, view: view, diffItems: diffItems, roster: roster, initials: initials, line: line,
    cleanMembership: cleanMembership, mergeMembership: mergeMembership, cleanDav: cleanDav
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosHouseCore = api;
})(typeof window !== "undefined" ? window : globalThis);
