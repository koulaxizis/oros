// ============================================================
// orOS "Send to someone" — share/out.js (pure, v1.0.0)
// "My shared links": the links with an expiry this person made
// (BR-SHARE-RELAY). Loaded at boot by the shell, which syncs the list
// as slice "shareOut" (localStorage "oros-share-out"), so a link can
// be revoked from any of the person's devices. The orOS sync is
// end-to-end encrypted, so the keys inside never reach Dropbox in
// clear.
//
// Data: { v:1, items: { <id>: entry } }
//   live entry: { c: link code (r1./q1.), d: revoke secret, k: kind,
//                 t: title ≤ 120, x: expiry ms, a: made ms, p?: 1 (password) }
//   revoked:    { g: 1, k, t, x, a }   (secrets dropped)
// merge(a, b) is deterministic and associative: union by id, a
// revoke wins, and items that expired before the newest item was
// made leave (their relay copy is gone anyway). The newest item never
// leaves, so the cut-off is the same whatever the merge order.
// No DOM; window.OrosShareOut / module.exports.
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-share-out";
  var DAY = 86400000;
  var ID_RE = /^[A-Za-z0-9_-]{22}$/;
  var CODE_RE = /^(r1|q1)\.([A-Za-z0-9_-]{22})\.[A-Za-z0-9_.-]{43,120}$/;
  var SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
  var KIND_RE = /^[a-z]{1,12}$/;
  var MAX_ITEMS = 500;

  function num(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function title(v) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").trim().slice(0, 120) : "";
  }
  // One entry, cleaned; null when it is not one.
  function clean(id, e) {
    if (!ID_RE.test(id) || !e || typeof e !== "object") return null;
    var x = num(e.x), a = num(e.a);
    if (!x || !a) return null;
    var o = { k: typeof e.k === "string" && KIND_RE.test(e.k) ? e.k : "note", t: title(e.t), x: x, a: a };
    if (e.g) { o.g = 1; return o; }
    var m = typeof e.c === "string" && CODE_RE.exec(e.c);
    if (!m || m[2] !== id || typeof e.d !== "string" || !SECRET_RE.test(e.d)) return null;
    o.c = e.c; o.d = e.d;
    if (e.p) o.p = 1;
    return o;
  }
  function norm(data) {
    var out = { v: 1, items: {} };
    var items = data && typeof data === "object" && data.items && typeof data.items === "object" ? data.items : {};
    Object.keys(items).forEach(function (id) {
      var e = clean(id, items[id]);
      if (e) out.items[id] = e;
    });
    return out;
  }
  // Keeps the newest MAX_ITEMS and drops what expired before the newest was made.
  function trim(o) {
    var ids = Object.keys(o.items), newest = 0;
    ids.forEach(function (id) { if (o.items[id].a > newest) newest = o.items[id].a; });
    ids = ids.filter(function (id) { return o.items[id].x >= newest; });
    ids.sort(function (p, q) { return (o.items[q].a - o.items[p].a) || (p < q ? -1 : p > q ? 1 : 0); });
    var items = {};
    ids.slice(0, MAX_ITEMS).sort().forEach(function (id) { items[id] = o.items[id]; });
    return { v: 1, items: items };
  }
  function merge(a, b) {
    var A = norm(a), B = norm(b), out = { v: 1, items: {} };
    var ids = Object.keys(A.items).concat(Object.keys(B.items));
    ids.forEach(function (id) {
      if (out.items[id]) return;
      var p = A.items[id], q = B.items[id], r;
      if (!p || !q) r = p || q;
      else if (p.g || q.g) {
        var g = p.g ? p : q;
        r = { k: g.k, t: g.t, x: Math.max(p.x, q.x), a: Math.min(p.a, q.a), g: 1 };
      } else r = JSON.stringify(p) <= JSON.stringify(q) ? p : q;
      out.items[id] = r;
    });
    return trim(out);
  }

  // ---------- Local store (localStorage, the sync slice's key) ----------
  function store() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function read() {
    var s = store();
    if (!s) return { v: 1, items: {} };
    try { return norm(JSON.parse(s.getItem(KEY) || "null")); } catch (e) { return { v: 1, items: {} }; }
  }
  function write(o) {
    var s = store();
    if (!s) return false;
    try { s.setItem(KEY, JSON.stringify(trim(norm(o)))); } catch (e) { return false; }
    try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {}
    return true;
  }
  // entry = { id, c, d, k, t, x, a, p? }
  function add(entry) {
    var o = read();
    var e = clean(entry && entry.id, entry);
    if (!e) return false;
    o.items[entry.id] = e;
    return write(o);
  }
  function markRevoked(id) {
    var o = read(), e = o.items[id];
    if (!e) return false;
    o.items[id] = { k: e.k, t: e.t, x: e.x, a: e.a, g: 1 };
    return write(o);
  }
  // The live links, newest first: [{ id, c, d, k, t, x, a, p }]
  function list(now) {
    var o = read(), t = now || Date.now();
    return Object.keys(o.items).filter(function (id) {
      var e = o.items[id];
      return !e.g && e.x > t;
    }).map(function (id) {
      var e = o.items[id], r = { id: id };
      Object.keys(e).forEach(function (k) { r[k] = e[k]; });
      return r;
    }).sort(function (p, q) { return q.a - p.a; });
  }

  var api = { KEY: KEY, DAY: DAY, norm: norm, merge: merge, read: read, write: write,
              add: add, markRevoked: markRevoked, list: list };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosShareOut = api;
})(typeof window !== "undefined" ? window : globalThis);
