// ============================================================
// orOS Media Shelf — feed.js (read-only Calendar feed, v1.0.0)
// The Calendar (calendar/index.html loads this file) shows, under
// the chip "Media Shelf" / «Το ράφι μου»:
//   - every finish (session kind "d"): "Finished: Dune" on that day,
//     rewatches and rereads included (one row per title per day);
//   - the release date of wishlist titles that have one (item field
//     `rel`, set by hand or by the online lookup): "Release: …".
// Nothing is stored or synced by it; it only reads Media Shelf's
// own blob (synced slice "shelf", key oros-shelf-data).
//
// API (window.OrosShelfFeed):
//   byDay(data) → { "YYYY-MM-DD": [{ item, k ("d"|"r"), title }] }
//   label(k, title, lang) → "Finished: Dune" | "Κυκλοφορία: Dune"
// Data: items [{ id, m, title, st, rel? }], sess [{ id, m, it, k, d }],
//   tombs { id: ms } (a tombstoned item or session shows nothing).
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var ID_RE = /^[a-z0-9]{6,40}$/;   // same as shelf.js
  var MAX_ROWS = 20000;

  var TEXT = {
    en: { d: "Finished: {t}", r: "Release: {t}" },
    el: { d: "Τελείωσα: {t}", r: "Κυκλοφορία: {t}" }
  };

  function str(v, n) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n) : "";
  }
  function dead(tombs, x) {
    return Object.prototype.hasOwnProperty.call(tombs, x.id) &&
           typeof tombs[x.id] === "number" && tombs[x.id] >= (x.m || 0);
  }

  function byDay(data) {
    var out = {};
    if (!data || typeof data !== "object") return out;
    var tombs = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    var items = {}, rows = 0;
    (Array.isArray(data.items) ? data.items : []).forEach(function (it) {
      if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id) || dead(tombs, it)) return;
      var title = str(it.title, 200);
      if (!title) return;
      items[it.id] = title;
      if (it.st === "want" && typeof it.rel === "string" && YMD_RE.test(it.rel) && rows < MAX_ROWS) {
        (out[it.rel] = out[it.rel] || []).push({ item: it.id, k: "r", title: title });
        rows++;
      }
    });
    var seen = {};
    (Array.isArray(data.sess) ? data.sess : []).forEach(function (s) {
      if (!s || typeof s !== "object" || s.k !== "d" || typeof s.it !== "string" ||
          typeof s.d !== "string" || !YMD_RE.test(s.d) || !items[s.it] || dead(tombs, s)) return;
      var key = s.d + "|" + s.it;
      if (seen[key] || rows >= MAX_ROWS) return;
      seen[key] = 1;
      (out[s.d] = out[s.d] || []).push({ item: s.it, k: "d", title: items[s.it] });
      rows++;
    });
    Object.keys(out).forEach(function (d) {
      out[d].sort(function (a, b) {
        if (a.k !== b.k) return a.k === "r" ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
    });
    return out;
  }

  function label(k, title, lang) {
    var tx = TEXT[lang] || TEXT.en;
    return (tx[k] || tx.d).replace("{t}", title);
  }

  var api = { byDay: byDay, label: label };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosShelfFeed = api;
})(typeof window !== "undefined" ? window : this);
