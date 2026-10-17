// ============================================================
// orOS Flashcards — sharing decks as files (FlashcardsPackage)
//   - .oroscards: an orOS bundle (bundle.js, OBF 1.0) whose
//     content.json is { kind "oros-flashcards-package", ver 1, decks,
//     notes, reviews } and whose media/ holds the pictures and sounds
//     by their own names (<sha256>.<ext>). All decks or one deck and
//     the decks inside it; the answers (history) only when asked.
//   - opening one ADDS only: decks missing here (by id), notes missing
//     here (by id; a note deleted here comes back as a new version),
//     answers missing here (by id). Nothing here is ever changed or
//     removed, so opening the same file twice adds nothing.
//   - a CSV copy (front, back, tags, deck, type) for other programs;
//     pictures and sounds stay out of it.
// The app re-prepares every media file before it is used (media.js:
// pictures redrawn, never SVG), so `mediaMap` names come from there.
// Pure: no DOM, no storage. window.FlashcardsPackage / module.exports.
// ============================================================
(function (root) {
  "use strict";
  var KIND = "oros-flashcards-package", VER = 1;
  var EXT = ".oroscards", MIME = "application/x-oros-cards";
  var AHEAD = 5 * 60000;                          // stamps from the future are clamped to now + 5 min
  var CAP = { decks: 500, notes: 100000, reviews: 2000000 };

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }

  // ---------- 1. Export ----------
  // → { content, media: [names the notes use] }
  // opts = { deckId (one deck and its sub-decks; "" all), history (bool), now }
  function build(C, slice, notesMap, reviews, opts) {
    opts = opts || {};
    var d = C.normalize(slice), byId = {};
    d.decks.forEach(function (x) { byId[x.id] = x; });
    var ids = opts.deckId ? C.subtree(d, opts.deckId) : null;
    var decks = d.decks.filter(function (x) { return !ids || ids[x.id]; }).map(function (x) {
      var y = JSON.parse(JSON.stringify(x));
      if (y.par && ids && !ids[y.par]) delete y.par;   // the chosen deck becomes a top-level deck
      return y;
    });
    var keep = {}, list = [];
    C.liveNotes(notesMap || {}).forEach(function (n) {
      var dk = byId[n.dk] ? n.dk : C.DEFAULT_DECK;
      if (ids && !ids[dk]) return;
      keep[n.id] = 1;
      list.push(n);
    });
    var rows = [];
    if (opts.history) {
      var inRow = {};
      (reviews || []).forEach(function (r) {
        if (r.u) return;
        var k = C.parseKey(r.c);
        if (k && keep[k.n]) { rows.push(r); inRow[r.i] = 1; }
      });
      (reviews || []).forEach(function (r) { if (r.u && inRow[r.u]) rows.push(r); });
      rows = C.mergeReviews(rows, []);
    }
    var map = {};
    list.forEach(function (n) { map[n.id] = n; });
    // Copies: the caller may change the content without touching the app's own notes.
    return {
      content: { kind: KIND, ver: VER, at: opts.now || Date.now(), decks: decks, notes: JSON.parse(JSON.stringify(list)), reviews: JSON.parse(JSON.stringify(rows)) },
      media: Object.keys(C.mediaInUse(map)).sort()
    };
  }

  // ---------- 2. Open ----------
  // content.json (anything) → { decks, notes, reviews, media: [names] } | null
  function read(C, x) {
    if (!isObj(x) || x.kind !== KIND || !(x.ver >= 1)) return null;
    if (x.ver > VER) return null;
    var decks = C.normalize({ decks: Array.isArray(x.decks) ? x.decks.slice(0, CAP.decks) : [] }).decks;
    var notes = C.liveNotes(C.foldNotes({}, Array.isArray(x.notes) ? x.notes.slice(0, CAP.notes) : []));
    var reviews = C.mergeReviews(Array.isArray(x.reviews) ? x.reviews.slice(0, CAP.reviews) : [], []);
    var map = {};
    notes.forEach(function (n) { map[n.id] = n; });
    return { decks: decks, notes: notes, reviews: reviews, media: Object.keys(C.mediaInUse(map)).sort() };
  }

  // What opening `pkg` adds here.
  // opts = { slice, notes (map), reviews, now, history (bool), mediaMap { name in file → our name } }
  // → { slice (next, or null when no deck is new), decks, notes: [versions], rows, cards, skipped, answers }
  function plan(C, pkg, opts) {
    var now = opts.now, limit = now + AHEAD;
    var notes = [], cards = 0, skipped = 0, mm = opts.mediaMap || null;
    var local = opts.notes || {};
    pkg.notes.forEach(function (n) {
      var cur = local[n.id];
      if (cur && !cur.del) { skipped++; return; }
      var v = JSON.parse(JSON.stringify(n));
      v.m = cur ? Math.max(now, cur.m + 1) : Math.min(v.m, limit);
      if (v.md) {
        var md = {};
        Object.keys(v.md).forEach(function (k) {
          var l = v.md[k].map(function (x) { return mm ? mm[x] : x; }).filter(Boolean);
          if (l.length) md[k] = l;
        });
        if (Object.keys(md).length) v.md = md; else delete v.md;
      }
      v = C.normNote(v);
      if (!v) return;
      notes.push(v);
      cards += C.ords(v).length;
    });
    // Decks missing here: added when they (or a deck inside them) get a
    // new note, or when the file holds no note in them at all (an empty
    // deck shared on purpose). A file opened twice adds no empty decks.
    var here = C.normalize(opts.slice), have = {}, next = null, inPkg = {};
    here.decks.forEach(function (x) { have[x.id] = 1; });
    pkg.decks.forEach(function (x) { inPkg[x.id] = x; });
    function up(id, mark) {
      for (var seen = {}; id && inPkg[id] && !seen[id]; id = inPkg[id].par) { seen[id] = 1; mark[id] = 1; }
    }
    var gets = {}, holds = {};
    pkg.notes.forEach(function (n) { up(n.dk, holds); });
    notes.forEach(function (n) { up(n.dk, gets); });
    var newDecks = pkg.decks.filter(function (x) { return !have[x.id] && (gets[x.id] || !holds[x.id]); });
    newDecks = newDecks.slice(0, Math.max(0, C.LIMITS.decks - here.decks.length));
    if (newDecks.length) {
      var adding = {};
      newDecks.forEach(function (x) { adding[x.id] = 1; });
      next = C.normalize({
        decks: here.decks.concat(newDecks.map(function (x) {
          var y = JSON.parse(JSON.stringify(x));
          y.m = Math.max(now, (here.tombs[x.id] || 0) + 1);   // a deck deleted here comes back
          if (y.par && !adding[y.par] && !have[y.par]) delete y.par;
          return y;
        })),
        tombs: here.tombs,
        set: here.set
      });
    }
    var rows = [], answers = 0;
    if (opts.history !== false) {
      var seen = {};
      (opts.reviews || []).forEach(function (r) { seen[r.i] = 1; });
      pkg.reviews.forEach(function (r) {
        if (seen[r.i] || r.t > limit) return;
        rows.push(r);
        if (!r.u && !r.f) answers++;
      });
    }
    return { slice: next, decks: newDecks.length, notes: notes, rows: rows, cards: cards, skipped: skipped, answers: answers };
  }

  // ---------- 3. CSV ----------
  // One line per note: front, back, tags (space between), deck ("A::B"), type.
  // Cells that start with = + @ get a leading ' so a spreadsheet does
  // not run them as formulas.
  function cell(s) {
    s = String(s == null ? "" : s);
    if (/^[=+@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }
  function deckPath(C, d, id) {
    var by = {}, out = [], seen = {};
    d.decks.forEach(function (x) { by[x.id] = x; });
    for (var cur = id; cur && by[cur] && !seen[cur]; cur = by[cur].par) { seen[cur] = 1; out.unshift(by[cur].n); }
    return out.join("::");
  }
  function csv(C, content, slice) {
    var d = C.normalize({ decks: content.decks.concat(C.normalize(slice).decks) });
    var lines = [["front", "back", "tags", "deck", "type"].join(",")];
    content.notes.forEach(function (n) {
      var front = n.k === "cloze" ? n.f.x : n.f.q, back = n.k === "cloze" ? n.f.e : n.f.a;
      lines.push([front, back, (n.tg || []).join(" "), deckPath(C, d, n.dk), n.k].map(cell).join(","));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // A file name from a title: no path marks, no control characters.
  function fileName(title, ext) {
    var s = String(title || "").replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return (s || "Flashcards") + ext;
  }

  var API = { KIND: KIND, VER: VER, EXT: EXT, MIME: MIME, build: build, read: read, plan: plan, csv: csv, fileName: fileName };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && typeof window !== "undefined") root.FlashcardsPackage = API;
})(typeof window !== "undefined" ? window : globalThis);
