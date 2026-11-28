// ============================================================
// orOS Files — captions-core.js (CAPTION v1): a photo's description,
// written by the person or suggested on the device (caption/caption.js,
// Florence-2) and kept by the person. Pure, no DOM, no disk. Exposes
// window.OrosCaptionsCore (browser) or module.exports (tests).
//
// State (slice "files-captions", key "oros-files-captions"), synced:
//   { v: 1, items: [{ k, p, d, m }] }   sorted by k
// k is "h:<sha256>" (the vault manifest knows the file, so the words
// follow it through moves on every device) or "p:<path>" (a file sync
// does not hold); p is the last known path (search, Files' search
// provider), d the description (plain text, ≤ 600 characters; "" =
// removed, kept as a tomb so an older copy cannot bring it back) and
// m the time it was set.
//
// Merge (R5, R17, R26): per k the larger m wins (equal: the larger d,
// then the larger p), so two devices end equal. Every writer stamps
// max(now, the stamp it replaces + 1) and an unchanged edit returns
// the same state object (R27). The result is canonical:
// norm(merge(a, b)) equals merge(a, b).
// Caps: 20,000 rows, newest first (tombs go first when over).
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-files-captions";
  var SLICE = "files-captions";
  var MAX_ROWS = 20000, MAX_TEXT = 600, MAX_PATH = 1024;
  var HKEY = /^h:[0-9a-f]{64}$/;

  function stamp(n) { return typeof n === "number" && isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  function cleanText(s) {
    s = String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT).trim() : s;
  }
  function validKey(k) {
    if (typeof k !== "string") return false;
    if (HKEY.test(k)) return true;
    return k.indexOf("p:/") === 0 && k.length <= MAX_PATH + 2;
  }
  function normRow(o) {
    if (!o || typeof o !== "object" || !validKey(o.k)) return null;
    var m = stamp(o.m);
    if (!m) return null;
    var p = typeof o.p === "string" && o.p.charAt(0) === "/" && o.p.length <= MAX_PATH ? o.p : "";
    if (!p && o.k.indexOf("p:") === 0) p = o.k.slice(2);
    return { k: o.k, p: p, d: cleanText(o.d), m: m };
  }
  // Which of two rows for one key wins.
  function better(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    if (a.d !== b.d) return a.d > b.d ? a : b;
    return a.p >= b.p ? a : b;
  }
  function byKey(a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; }
  function cap(rows) {
    if (rows.length <= MAX_ROWS) return rows;
    var keep = rows.slice().sort(function (a, b) {
      if (!!a.d !== !!b.d) return a.d ? -1 : 1;            // descriptions before tombs
      return b.m - a.m || byKey(a, b);
    }).slice(0, MAX_ROWS);
    return keep.sort(byKey);
  }
  function collect(lists) {
    var map = Object.create(null);
    lists.forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (o) {
        var r = normRow(o);
        if (!r) return;
        map[r.k] = map[r.k] ? better(map[r.k], r) : r;
      });
    });
    return cap(Object.keys(map).map(function (k) { return map[k]; }).sort(byKey));
  }
  function norm(raw) {
    var items = raw && typeof raw === "object" && Array.isArray(raw.items) ? raw.items : [];
    return { v: 1, items: collect([items]) };
  }
  function merge(a, b) {
    return { v: 1, items: collect([norm(a).items, norm(b).items]) };
  }

  function keyOf(path, hash) {
    return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? "h:" + hash : "p:" + path;
  }
  function find(state, path, hash) {
    var items = state && state.items || [], k1 = hash ? "h:" + hash : "", k2 = "p:" + path;
    var lo = 0, hi = items.length - 1, out = null;
    [k1, k2].some(function (k) {
      if (!k) return false;
      lo = 0; hi = items.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1, x = items[mid];
        if (x.k === k) { out = x; return true; }
        if (x.k < k) lo = mid + 1; else hi = mid - 1;
      }
      return false;
    });
    return out;
  }
  // The description of a file ("" if none).
  function textOf(state, path, hash) {
    var r = find(state, path, hash);
    return r ? r.d : "";
  }
  // Set (or with "" remove) one file's description.
  function set(state, path, hash, text, now) {
    state = state && state.items ? state : norm(state);
    var k = keyOf(path, hash), d = cleanText(text), old = find(state, path, hash);
    if (old && old.k !== k) old = null;
    if (old ? old.d === d && old.p === path : !d) return state;
    var m = Math.max(stamp(now) || 1, old ? old.m + 1 : 1);
    var row = normRow({ k: k, p: path, d: d, m: m });
    if (!row) return state;
    var items = state.items.filter(function (x) { return x.k !== k; });
    items.push(row);
    return { v: 1, items: cap(items.sort(byKey)) };
  }
  // path → description, for search (live rows only; newest per path).
  function byPath(state) {
    var out = Object.create(null), at = Object.create(null);
    (state && state.items || []).forEach(function (r) {
      if (!r.d || !r.p) return;
      if (!at[r.p] || r.m > at[r.p]) { out[r.p] = r.d; at[r.p] = r.m; }
    });
    return out;
  }

  var api = {
    KEY: KEY, SLICE: SLICE, MAX_TEXT: MAX_TEXT, MAX_ROWS: MAX_ROWS,
    norm: norm, merge: merge, set: set, textOf: textOf, keyOf: keyOf, byPath: byPath, cleanText: cleanText
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosCaptionsCore = api;
})(typeof window !== "undefined" ? window : this);
