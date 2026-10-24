// ============================================================
// orOS Household — whole.js (an app's whole data as one household
// document, BR-HH wave 7; pure, no DOM)
// Meal Planner, Baby, Pet Care, Together, Garage and Notes share all
// of their data with a household the same way: one item per record,
// so the household merge (household/core.js, field by field, newer
// stamp wins) decides per record and the app's own merge cleans the
// result. An app describes its data with parts:
//   { k: "rc", t: "list", p: "r" }   data.rc = [{ id, m, … }]
//   { k: "pl", t: "map",  p: "pl" }  data.pl = { key: { m, … } }
//   { k: "set", t: "one", p: "set" } data.set = { m, … }
// Items:
//   "<p>:<id or key>"   fields { v: the record without id and m }
//   "<p>::<hash>"       an id or key the item id cannot hold (spaces,
//                       accents, "|", too long): fields { k, v }
//   "<p>"               a "one" part
// A value whose JSON is too long for one field (8192 characters) goes
// in chunks: v = { z: count, h: hash }, fields z0…z21 = { h, s }. Every
// write of such a record rewrites all its chunks (each carries the
// hash), so all its fields have one stamp and two people's versions
// never mix; chunks that do not add up are left alone (`raw`), never
// deleted, and the app does not show that record until it is whole.
// Record stamps are the items' last change, so every device rebuilds
// the same data. The app's merge(data, data) drops what it would drop
// anyway (old days, odd values).
//   make(spec) → { project(data) → { items, big }   (big: ids too long)
//                  fromDoc(view) → { id: fields }   (all fields)
//                  build(view)   → { data, by, rest, raw }
//                                   by: { record id or key: member }
//                                   rest: items of other prefixes (the
//                                   app's own, such as "me:<member>")
//                                   raw: ids whose chunks do not add up
//                  copyOf(view, now) → data stamped now (an own copy)
//                  push(last, data, extra, raw) → { diff, items }
//                                   diff: { set, del } or null; items:
//                                   the new last }
//   spec = { parts, merge(a, b), empty() }
// Exposes window.OrosHouseWhole and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var SAFE_RE = /^[A-Za-z0-9_-]{1,60}$/;
  var HASH_RE = /^[0-9a-z]{1,16}$/;
  var ONE_FIELD = 7800;           // longest JSON kept in one field
  var CHUNK = 3800;               // characters of text per chunk
  var CHUNKS = 22;                // z0…z21 (a document item holds 24 fields)

  function plain(x) { return JSON.parse(JSON.stringify(x)); }
  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  // FNV-1a twice (two seeds): 64 bits as base 36, enough to tell keys
  // and chunk versions apart.
  function hash(s) {
    var a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
      b ^= c; b = Math.imul(b, 0x01000193 + 0x200) >>> 0;
    }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
  }
  function strip(rec, keepId) {
    var v = {};
    Object.keys(rec).forEach(function (k) { if (k !== "m" && (keepId || k !== "id")) v[k] = rec[k]; });
    return plain(v);
  }

  // A value → the fields that hold it (v, or v + chunks), or null.
  function pack(v) {
    var s = JSON.stringify(v);
    if (s.length <= ONE_FIELD) return { v: v };
    var h = hash(s), out = {}, n = 0, i = 0;
    while (i < s.length) {
      var len = CHUNK, piece = s.slice(i, i + len);
      while (JSON.stringify({ h: h, s: piece }).length > ONE_FIELD && len > 200) { len = Math.floor(len / 2); piece = s.slice(i, i + len); }
      if (n >= CHUNKS) return null;
      out["z" + n] = { h: h, s: piece };
      n++; i += len;
    }
    out.v = { z: n, h: h };
    return out;
  }
  // The fields of an item → its value, undefined (not whole) or null (no value).
  function unpack(it) {
    var v = it.v;
    if (!isObj(v) || typeof v.z !== "number" || typeof v.h !== "string" || Object.keys(v).length !== 2) return v === undefined ? null : v;
    if (!(v.z >= 1 && v.z <= CHUNKS && Math.floor(v.z) === v.z) || !HASH_RE.test(v.h)) return undefined;
    var s = "";
    for (var i = 0; i < v.z; i++) {
      var c = it["z" + i];
      if (!isObj(c) || c.h !== v.h || typeof c.s !== "string") return undefined;
      s += c.s;
    }
    if (hash(s) !== v.h) return undefined;
    try { return JSON.parse(s); } catch (e) { return undefined; }
  }

  function make(spec) {
    var parts = spec.parts, byP = {};
    parts.forEach(function (pt) { byP[pt.p] = pt; });

    function itemOf(pt, key) {
      if (pt.t === "one") return { id: pt.p, k: null };
      return SAFE_RE.test(key) ? { id: pt.p + ":" + key, k: null } : { id: pt.p + "::" + hash(key), k: key };
    }

    function project(data) {
      var d = spec.merge(data, data), items = {}, big = [];
      var put = function (pt, key, v) {
        var at = itemOf(pt, key), f = pack(v);
        if (!f) { big.push(key || pt.p); return; }
        if (at.k !== null) f.k = at.k;
        items[at.id] = f;
      };
      parts.forEach(function (pt) {
        var src = d[pt.k];
        if (pt.t === "list") (Array.isArray(src) ? src : []).forEach(function (r) { if (r && typeof r.id === "string") put(pt, r.id, strip(r)); });
        else if (pt.t === "map") Object.keys(isObj(src) ? src : {}).forEach(function (k) { if (isObj(src[k])) put(pt, k, strip(src[k])); });
        else if (isObj(src) && src.m > 0) put(pt, "", strip(src));
      });
      return { items: items, big: big };
    }

    function fromDoc(view) {
      var out = {};
      ((view && view.items) || []).forEach(function (it) {
        var o = {};
        Object.keys(it).forEach(function (f) { if (f !== "id" && f.charAt(0) !== "_") o[f] = it[f]; });
        out[it.id] = o;
      });
      return out;
    }

    function records(view, stampOf) {
      var raw = spec.empty(), by = {}, rest = [], bad = [];
      parts.forEach(function (pt) { raw[pt.k] = pt.t === "list" ? [] : (pt.t === "map" ? {} : raw[pt.k]); });
      ((view && view.items) || []).forEach(function (it) {
        var i = it.id.indexOf(":"), p = i < 0 ? it.id : it.id.slice(0, i), pt = byP[p];
        if (!pt) { rest.push(it); return; }
        var key;
        if (pt.t === "one") { if (i >= 0) return; key = ""; }
        else if (it.id.slice(i, i + 2) === "::") {
          if (typeof it.k !== "string" || !it.k || it.id !== pt.p + "::" + hash(it.k)) return;
          key = it.k;
        } else { key = it.id.slice(i + 1); if (!SAFE_RE.test(key)) return; }
        var v = unpack(it);
        if (v === undefined) { bad.push(it.id); return; }
        if (!isObj(v)) return;
        var rec = plain(v);
        rec.m = stampOf(it);
        if (pt.t === "list") { rec.id = key; raw[pt.k].push(rec); }
        else if (pt.t === "map") raw[pt.k][key] = rec;
        else raw[pt.k] = rec;
        if (typeof it._by === "string" && it._by) by[pt.t === "one" ? pt.p : key] = it._by;
      });
      return { data: spec.merge(raw, raw), by: by, rest: rest, raw: bad };
    }
    function build(view) { return records(view, function (it) { return it._t || 1; }); }
    function copyOf(view, now) { return records(view, function () { return now; }).data; }

    // What to send: the records against what was last read; the app's
    // own items (extra) ride along; items that are not whole stay.
    function push(last, data, extra, raw) {
      var cur = project(data).items;
      Object.keys(extra || {}).forEach(function (id) { cur[id] = extra[id]; });
      (raw || []).forEach(function (id) { if (last && last[id]) cur[id] = last[id]; });
      var HC = root.OrosHouseCore || (typeof require === "function" ? require("./core.js") : null);
      return { diff: HC.diffItems(last, cur, null), items: cur };
    }

    return { project: project, fromDoc: fromDoc, build: build, copyOf: copyOf, push: push };
  }

  var api = { make: make, hash: hash, pack: pack, unpack: unpack, ONE_FIELD: ONE_FIELD, CHUNKS: CHUNKS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosHouseWhole = api;
})(typeof window !== "undefined" ? window : globalThis);
