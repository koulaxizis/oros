// ============================================================
// orOS Library — .oroslibrary file (library/package.js,
// window.OrosLibraryPackage). The descriptor of Library for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): the book records (title, author, tags, finished date),
// where you stopped in each book, every highlight, note and
// bookmark, and the catalogues you added, in one orOS bundle; opening
// one ADDS what this device lacks, with its ids. Pure (no DOM, no
// storage), so the app and `node --test` run the same code. Needs
// core.js (window.LibCore; require("./core.js") under Node).
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; app.js then runs the result
//                            through core.js mergeLibrary + commit, so
//                            sync carries it)
//   DESC.norm(data)          a file's data → { ver, books, pos, marks,
//                            cats } through core.js's own normaliser
//                            (mergeLibrary: typed, capped, canonical);
//                            the "added" stamp clamped to now + 5 min
//   DESC.strip(state)        the slice → { ver, books, pos, marks,
//                            cats? }: no tombstones, no reading stats
//                            (per-device counters), no place or mark of
//                            a book that is not in the list, and no
//                            catalogue whose address carries a login or
//                            a key
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  books.csv (formula guard) and notes.md
//                            (core.js exportMarkdown of every book
//                            with highlights, notes or bookmarks)
//   kindOf(id, state)        "book" | "mark" | "cat" | "" (a place in
//                            a book is keyed by the book's id)
//   safeCatUrl(url)          false for an address with a login or a key
// NEVER the book files (EPUB / PDF / FB2 / CBZ contents) and no
// covers (they are a device cache in IndexedDB, not records): the
// file has no media/. The book files travel through the orOS disk.
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.LibCore;
  var FUTURE = 5 * 60 * 1000;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // A catalogue address that would carry credentials (user:pass@host,
  // or a key / token in the query) never goes into a file.
  var SECRET_Q = /(^|[?&;])[^=&;]*(key|token|auth|pass|secret|sig|session|sid|login)[^=&;]*=/i;
  function safeCatUrl(url) {
    if (typeof url !== "string") return false;
    var m = /^https?:\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?/i.exec(url);
    if (!m || m[1].indexOf("@") >= 0) return false;
    return !(m[3] && SECRET_Q.test(m[3]));
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var s = C.mergeLibrary(data, data);     // the app's own normaliser
    var lim = Date.now() + FUTURE;
    s.books.forEach(function (b) { if (typeof b.added === "number" && b.added > lim) b.added = lim; });
    var out = { ver: s.ver, books: s.books, pos: s.pos, marks: s.marks, cats: s.cats || [] };
    if (Object.keys(s.tombs).length) out.tombs = s.tombs;     // strip and tombIds see them, then they go
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, have = {};
    var books = (Array.isArray(s.books) ? s.books : []).filter(function (b) {
      if (!isObj(b) || typeof b.id !== "string") return false;
      have[b.id] = 1;
      return true;
    });
    var pos = {};
    if (isObj(s.pos)) Object.keys(s.pos).forEach(function (id) { if (have[id] === 1) pos[id] = s.pos[id]; });
    var marks = (Array.isArray(s.marks) ? s.marks : []).filter(function (k) { return isObj(k) && have[k.b] === 1; });
    var out = { ver: typeof s.ver === "number" ? s.ver : 1, books: books, pos: pos, marks: marks };
    var cats = (Array.isArray(s.cats) ? s.cats : []).filter(function (c) { return isObj(c) && safeCatUrl(c.url); });
    if (cats.length) out.cats = cats;
    return clone(out);
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  // ---------- previews ----------
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    var f = /^[=+\-@\t\r]/.test(s);
    return /[",\r\n]/.test(s) || f ? '"' + (f ? "'" : "") + s.replace(/"/g, '""') + '"' : s;
  }
  function previews(state, lang) {
    var el = lang === "el", s = isObj(state) ? state : {};
    var books = (Array.isArray(s.books) ? s.books : []).slice().sort(function (a, b) {
      var x = String(a.title || "").toLowerCase(), y = String(b.title || "").toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    var marks = Array.isArray(s.marks) ? s.marks : [];
    var count = {};
    marks.forEach(function (k) {
      var c = count[k.b] || (count[k.b] = { hl: 0, bm: 0, n: 0 });
      if (k.k === "hl") c.hl++; else c.bm++;
      if (k.n) c.n++;
    });
    var csv = [["title", "author", "format", "year", "pages", "progress %", "finished", "tags", "highlights", "bookmarks", "notes"].join(",")];
    var md = [];
    books.forEach(function (b) {
      var c = count[b.id] || { hl: 0, bm: 0, n: 0 };
      var pct = C.progressOf(s, b.id);
      csv.push([b.title, b.by || "", C.fmtLabel(b), b.year || "", b.pages || "", pct ? Math.floor(pct / 10) : 0,
                b.fin || "", (b.tags || []).join("; "), c.hl, c.bm, c.n].map(csvCell).join(","));
      if (c.hl + c.bm) md.push(C.exportMarkdown(b, marks, el ? "el" : "en", null, null));
    });
    var out = { "books.csv": csv.join("\r\n") + "\r\n" };
    if (md.length) out["notes.md"] = md.join("\n---\n\n");
    return out;
  }

  // What an id names in a state.
  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    function has(list) { return (Array.isArray(list) ? list : []).some(function (x) { return x && x.id === id; }); }
    if (has(s.books)) return "book";
    if (has(s.marks)) return "mark";
    if (has(s.cats)) return "cat";
    return "";
  }

  var DESC = {
    app: "library", title: "Library", slice: "library", ext: ".oroslibrary", mime: "application/x-oros-library",
    colls: {
      books: { shape: "array", id: "id", stamp: "m" },
      pos: { shape: "map", stamp: "m" },
      marks: { shape: "array", id: "id", stamp: "m" },
      cats: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, kindOf: kindOf, safeCatUrl: safeCatUrl };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosLibraryPackage = api;
})(typeof window !== "undefined" ? window : this);
