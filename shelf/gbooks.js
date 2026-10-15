// orOS Media Shelf — one-time import from Google Books (shelf/gbooks.js)
//
// The sign-in, the token and its revoke are /google-import.js's
// (window.OrosGoogleImport). Google Books has no read-only scope, so
// the scope is "books", and orOS only ever sends GET requests:
//   mylibrary/bookshelves → the person's shelves
//   mylibrary/bookshelves/<id>/volumes → the books on each
// Each book comes in once, however many shelves hold it, and goes
// through the Shelf's Goodreads import (planImport in shelf.js, kind
// "gb"): the same duplicate check by title and author, the same
// states and history entries, the same preview, one write and Undo.
// Shelves → the Shelf:
//   4 Have read → Done · 3 Reading now → Now · 2 To read → Want
//   0 Favorites → ♥ favourite · 7 My eBooks → e-book
//   1 Purchased, 5 Reviewed → Want (unless another shelf says more)
//   6 Recently viewed, 8 Books for you, 9 Browsing history → left out
//   a shelf of your own (id 1000 and up) → a tag with its name
// Title, authors, first-publication year, page count; the date Google
// last changed the book in your library is its "added" date. Covers
// and ISBNs are not kept (the Shelf keeps neither for Goodreads).
// Ids "gb" + a hash of the volume id: the same book on two devices,
// or imported twice, is the same row.
// Pure (tests/google-import.test.js): records(shelves) → rows for planImport
// Browser: read(api, progress) → shelves [{ id, title, volumes }]
(function (root) {
  "use strict";

  var GI = typeof module !== "undefined" && module.exports ? require("../google-import.js") : root.OrosGoogleImport;
  var API = "https://www.googleapis.com/books/v1/mylibrary/bookshelves";
  var SKIP = { 6: 1, 8: 1, 9: 1 };
  var RANK = { want: 0, now: 1, done: 2 };
  var MAX = 5000, PAGE = 40;

  function line(v, n) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  function ymd(s) {
    var m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  function idOf(vid, kind) { return "gb" + GI.hash("gbooks|" + vid + (kind ? "|" + kind : "")); }

  // shelves: [{ id, title, volumes: [Google volumes] }] → one row per book
  function records(shelves) {
    var by = {}, order = [];
    (Array.isArray(shelves) ? shelves : []).forEach(function (sh) {
      var sid = +(sh && sh.id);
      if (!isFinite(sid) || SKIP[sid]) return;
      var st = sid === 4 ? "done" : sid === 3 ? "now" : "want";
      var tag = sid >= 1000 ? line(sh.title, 30).replace(/,/g, "") : "";
      (Array.isArray(sh.volumes) ? sh.volumes : []).forEach(function (v) {
        var vid = v && typeof v.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v.id) ? v.id : "";
        var vi = v && v.volumeInfo;
        if (!vid || !vi || !line(vi.title, 200)) return;
        var r = by[vid];
        if (!r) {
          if (order.length >= MAX) return;
          var year = parseInt(String(vi.publishedDate || "").slice(0, 4), 10);
          var pages = typeof vi.pageCount === "number" && vi.pageCount > 0 ? Math.min(100000, Math.floor(vi.pageCount)) : 0;
          r = by[vid] = {
            id: idOf(vid), sid: { s: idOf(vid, "s"), d: idOf(vid, "d") },
            title: line(vi.title, 200),
            by: line((Array.isArray(vi.authors) ? vi.authors : []).filter(function (a) { return typeof a === "string"; }).join(", "), 120),
            year: year >= 1 && year <= 9999 ? year : 0, size: pages, fmt: "p", st: "want", fav: 0, tags: [],
            added: ymd(v.userInfo && v.userInfo.updated)
          };
          order.push(vid);
        }
        if (RANK[st] > RANK[r.st]) r.st = st;
        if (sid === 0) r.fav = 1;
        if (sid === 7) r.fmt = "e";
        if (tag && r.tags.indexOf(tag) < 0 && r.tags.length < 10) r.tags.push(tag);
      });
    });
    return order.map(function (k) { return by[k]; });
  }

  function read(api, progress) {
    var shelves = [], n = 0;
    return api.getJson(API).then(function (d) {
      (d && Array.isArray(d.items) ? d.items : []).forEach(function (s) {
        var id = s && +s.id;
        if (isFinite(id) && id >= 0 && !SKIP[id] && shelves.length < 100) shelves.push({ id: id, title: line(s.title, 60), volumes: [] });
      });
      return shelves.reduce(function (p, sh) {
        return p.then(function () {
          return api.pages(function (cur) {
            return API + "/" + sh.id + "/volumes?maxResults=" + PAGE + "&startIndex=" + (cur || "0");
          }, function (d2) {
            var items = d2 && Array.isArray(d2.items) ? d2.items : [];
            items.forEach(function (v) { if (n < MAX) { sh.volumes.push(v); n++; } });
            if (progress) progress(n);
            var total = d2 && typeof d2.totalItems === "number" ? d2.totalItems : 0;
            return items.length && sh.volumes.length < total && n < MAX ? String(sh.volumes.length) : "";
          }, 130);
        });
      }, Promise.resolve());
    }).then(function () { return shelves; });
  }

  var api = { records: records, read: read, idOf: idOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosShelfGbooks = api;
})(typeof window !== "undefined" ? window : this);
