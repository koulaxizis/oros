// ============================================================
// orOS My App — data model (pure, no DOM)
// Loaded by index.html before app.js, and by Node in the tests.
// Data in localStorage "oros-myapp-data":
//   { ver: 1, items: [{ id, text, done, mtime }], tombs: { id: ms } }
// Sync rules (OROS_BIBLE.md Part I, Part VI):
//   - merge(a, b) === merge(b, a): union by id, the newer mtime
//     wins, a tie goes to the larger JSON (never "local wins");
//   - merge(a, a) === a, so a pull never makes the slice dirty;
//   - a tombstone at least as new as the item deletes it, a newer
//     edit brings the item back (R17);
//   - no uid() or Date.now() inside the merge;
//   - serialize() is canonical: items sorted by id, tombs by key.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var MAX_TEXT = 2000;

  function empty() { return { ver: VER, items: [], tombs: {} }; }

  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }

  // A bad row is dropped, never repaired with a fresh id or time.
  function cleanItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = str(raw.id, 64);
    if (!id) return null;
    return { id: id, text: str(raw.text, MAX_TEXT), done: raw.done === true, mtime: ms(raw.mtime) };
  }

  function newer(a, b) {
    if (a.mtime !== b.mtime) return a.mtime > b.mtime;
    return JSON.stringify(a) > JSON.stringify(b);
  }

  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

  // Any input (old version, another device, a broken file) → the
  // canonical shape. Every merge ends here.
  function normalize(d) {
    return mergeLists([d]);
  }

  function mergeLists(list) {
    var items = {}, tombs = {};
    list.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      (Array.isArray(d.items) ? d.items : []).forEach(function (raw) {
        var it = cleanItem(raw);
        if (it && (!items[it.id] || newer(it, items[it.id]))) items[it.id] = it;
      });
      var t = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      Object.keys(t).forEach(function (id) {
        var at = ms(t[id]);
        if (at && id.length <= 64 && at > (tombs[id] || 0)) tombs[id] = at;
      });
    });
    var out = empty();
    out.items = Object.keys(items).map(function (id) { return items[id]; })
      .filter(function (it) { return !(tombs[it.id] >= it.mtime); })
      .sort(byId);
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    return out;
  }

  function merge(local, remote) { return mergeLists([local, remote]); }

  function serialize(d) { return JSON.stringify(normalize(d)); }

  // ---------- edits (the app passes the clock in) ----------
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function add(d, text, now, id) {
    var out = normalize(d);
    var t = str(text, MAX_TEXT).trim();
    if (!t) return out;
    out.items.push({ id: id || uid(), text: t, done: false, mtime: now });
    return normalize(out);
  }

  function update(d, id, patch, now) {
    var out = normalize(d);
    out.items.forEach(function (it) {
      if (it.id !== id) return;
      if (typeof patch.text === "string") it.text = str(patch.text, MAX_TEXT);
      if (typeof patch.done === "boolean") it.done = patch.done;
      it.mtime = Math.max(now, it.mtime + 1);
    });
    return out;
  }

  function remove(d, id, now) {
    var out = normalize(d);
    var it = out.items.filter(function (x) { return x.id === id; })[0];
    out.tombs[id] = Math.max(now, it ? it.mtime : 0);
    return normalize(out);
  }

  // Newest first by creation (ids start with the creation time), so a
  // tick or an edit does not move the row.
  function live(d) {
    return normalize(d).items.slice().sort(function (a, b) { return byId(b, a); });
  }

  var API = {
    VER: VER, empty: empty, normalize: normalize, merge: merge, serialize: serialize,
    uid: uid, add: add, update: update, remove: remove, live: live
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.MyAppCore = API;
})(typeof window !== "undefined" ? window : globalThis);
