// ============================================================
// orOS Assistant — edits4.js ("Assistant everywhere" wave 5b, AS-EDIT5)
// change_item in Music (a playlist renamed; a song or a whole album
// added to a playlist, a song taken out of one) and Flashcards (a deck
// renamed; a note's front, back and tags, or the note to another deck).
// Loaded by assistant.js the first time one of their items is changed,
// with the app's own core.js, and registered into assistant/edits.js
// (extend), whose plan / apply / undo / diff and card stay the same.
// Every change is written through the app's own core (its stamps, its
// merge). A text longer than the app keeps is refused, never cut.
// Nothing is deleted here.
// Music's songs live in the device's index (IndexedDB "oros-music" ›
// "tracks"): assistant.js reads it read-only before a change and hands
// it over with setCache. Flashcards' notes are files on the orOS disk
// that only ONE writer ever writes (FLASHCARDS v1): the Assistant
// writes a new version of a note into its OWN file
// (/internal/Flashcards/Notes/<its id>-<yyyymm>.json), never into the
// Flashcards app's; the newest version of a note wins everywhere
// (pickNote). assistant.js reads the files before a change and hands
// this module { slice, notes, own } as the data (store "disk:flashcards").
// change(d, target, ch, now) works on d IN PLACE → { ok, title, before, after, del, undo } | { ok:false, err }
// undo(d, u, now) → { ok } | { ok:false, err }, also in place.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var E = root.OrosAssistEdits || (NODE ? require("./edits.js") : null);
  if (!E) return;
  var H = E.helpers;
  var has = H.has, isObj = H.isObj, clone = H.clone, bad = H.bad, stampAfter = H.stampAfter;

  var CORES = { music: ["OrosMusicCore", "../music/core.js"], flashcards: ["FlashcardsCore", "../flashcards/core.js"] };
  function core(app) {
    var c = CORES[app];
    if (root[c[0]]) return root[c[0]];
    if (NODE) { try { var m = require(c[1]); return m[c[0]] || m; } catch (e) { return null; } }
    return null;
  }
  // Music's index { key: track row }, read by assistant.js.
  var CACHE = { music: {} };
  function setCache(app, v) { if (has(CACHE, app) && isObj(v)) CACHE[app] = v; }

  function adopt(d, nd) {
    Object.keys(d).forEach(function (k) { delete d[k]; });
    Object.keys(nd).forEach(function (k) { d[k] = nd[k]; });
  }
  function only(ch, keys, what) {
    var no = Object.keys(ch.set).filter(function (k) { return keys.indexOf(k) < 0; });
    return no.length ? bad(what + " has no " + no.join(", ") + " here (it takes " + keys.join(", ") + ").") : null;
  }
  function tooLong(what, v, max, where) {
    return typeof v === "string" && v.length > max ? bad(what + " is " + v.length + " characters; " + where + " keeps " + max + ".") : null;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function nothing(what) { return bad("Nothing would change: the " + what + " already looks like that."); }
  function byName(list, name, what, where) {
    var f = H.foldName(name), hit = null;
    list.forEach(function (x) { if (!hit && H.foldName(x.n) === f) hit = x; });
    if (hit) return { x: hit };
    return { err: where + " has no " + what + " named \"" + name + "\". " +
      (list.length ? "Its " + what + "s: " + list.map(function (x) { return x.n; }).join(", ") + "." : "It has none.") };
  }

  // ---------- 1. Music (music/core.js renamePl, addToPl, removeFromPl) ----------
  // A playlist is one record (LWW on m, tombstones by id): a change
  // rewrites it with a new stamp, as Music's own menus do.
  function muLive(C, d) { return C.mergeMusic(d, d).pls; }
  function muView(p) { return { title: p.n, songs: p.it.length }; }
  function muTracks(C, target) {
    var all = CACHE.music, out = [];
    if (typeof target.track === "string") {
      if (isObj(all[target.track])) out.push(all[target.track]);
      return out;
    }
    Object.keys(all).forEach(function (k) { var r = all[k]; if (isObj(r) && C.albumKey(r) === target.album) out.push(r); });
    out.sort(function (x, y) { return ((+x.dn || 0) - (+y.dn || 0)) || ((+x.n || 0) - (+y.n || 0)) || (String(x.t) < String(y.t) ? -1 : 1); });
    return out;
  }
  function musicChange(d, target, ch, now) {
    var C = core("music");
    if (!C) return bad("Music is not available.");
    if (!isObj(target)) return bad("Only a playlist, a song or an album can be changed here.");
    adopt(d, C.mergeMusic(d, d));
    var pls = d.pls, e, p, before, nd;
    if (typeof target.pl === "string") {
      p = C.findPl(d, target.pl);
      if (!p) return bad("That playlist is no longer in Music.");
      if ((e = only(ch, ["title"], "A playlist"))) return e;
      if (!has(ch.set, "title")) return bad("Give title, the playlist's new name.");
      if ((e = tooLong("The name", ch.set.title, C.LIM.plName, "Music"))) return e;
      before = muView(p);
      nd = C.renamePl(d, p.id, ch.set.title, stampAfter(now, p.m));
    } else if (typeof target.track === "string" || typeof target.album === "string") {
      if ((e = only(ch, ["playlist", "from_playlist"], typeof target.track === "string" ? "A song" : "An album"))) return e;
      var name = ch.set.playlist || ch.set.from_playlist;
      if (!name) return bad("Give playlist (the playlist it goes into) or from_playlist (the one it leaves).");
      if (ch.set.playlist && ch.set.from_playlist) return bad("Give playlist or from_playlist, not both.");
      var hit = byName(pls, name, "playlist", "Music");
      if (hit.err) return bad(hit.err + " New playlists are made in Music.");
      p = hit.x;
      before = muView(p);
      if (ch.set.from_playlist) {
        if (typeof target.track !== "string") return bad("Take songs out one at a time (an album is added whole).");
        var idx = -1;
        p.it.forEach(function (r, i) { if (r.k === target.track) idx = i; });
        if (idx < 0) return bad("That song is not in the playlist \"" + p.n + "\".");
        nd = C.removeFromPl(d, p.id, idx, stampAfter(now, p.m));
      } else {
        var rows = muTracks(C, target);
        if (!rows.length) return bad("That " + (typeof target.track === "string" ? "song" : "album") + " is not on this device any more.");
        var refs = rows.map(function (r) { return C.refOf(r); });
        if (typeof target.track === "string" && p.it.some(function (r) { return r.k === target.track; })) return bad("That song is already in the playlist \"" + p.n + "\".");
        if (p.it.length + refs.length > C.LIM.items) return bad("A playlist holds " + C.LIM.items + " songs.");
        nd = C.addToPl(d, p.id, refs, stampAfter(now, p.m));
      }
    } else return bad("Only a playlist, a song or an album can be changed here.");
    adopt(d, nd);
    var np = C.findPl(d, p.id), after = muView(np);
    if (same(after, before)) return nothing("playlist");
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "music", prev: clone(p), next: clone(np) } };
  }
  function musicUndo(d, u, now) {
    var C = core("music");
    if (!C || !isObj(u.prev) || !isObj(u.next)) return bad("bad undo");
    adopt(d, C.mergeMusic(d, d));
    var cur = C.findPl(d, u.next.id);
    if (!cur || !same(cur, u.next)) return bad("The playlist changed since; nothing was undone.");
    d.pls = d.pls.map(function (p) { return p.id === cur.id ? Object.assign(clone(u.prev), { m: stampAfter(now, cur.m) }) : p; });
    adopt(d, C.mergeMusic(d, d));
    return { ok: true };
  }

  // ---------- 2. Flashcards (flashcards/core.js) ----------
  // d = { slice, notes: [newest version of every note], own: { path, items } }.
  // A deck: title = its new name (updateDeck). A note: front / back (a
  // basic or reversed note's question and answer; a cloze note's text
  // and extra), labels = its tags, move with deck = another deck.
  // A new version = the note with m moved on, folded into `own`.
  function fcNote(C, d, id) {
    var hit = null;
    (Array.isArray(d.notes) ? d.notes : []).forEach(function (n) { if (isObj(n) && n.id === id) hit = n; });
    hit = hit ? C.normNote(hit) : null;
    return hit && !hit.del ? hit : null;
  }
  function fcDecks(C, d) { return C.normalize(d.slice).decks; }
  function fcDeckName(C, d, id) {
    var x = fcDecks(C, d).filter(function (k) { return k.id === id; })[0];
    return x ? x.n : id === C.DEFAULT_DECK ? "Default" : "";
  }
  function fcView(C, d, n) {
    var cl = n.k === "cloze";
    return { deck: fcDeckName(C, d, n.dk),
             front: cl ? n.f.x : n.f.q, back: cl ? n.f.e : n.f.a, labels: n.tg.join(", ") };
  }
  function fcPut(C, d, ver) {
    var own = isObj(d.own) ? d.own : { path: "", items: [] };
    own.items = C.mergeNotes(own.items, [ver]);
    d.own = own;
    d.notes = C.mergeNotes(d.notes, [ver]);
  }
  function flashcardsChange(d, target, ch, now) {
    var C = core("flashcards");
    if (!C) return bad("Flashcards is not available.");
    if (!isObj(d) || !isObj(target)) return bad("Only a deck or a note can be changed here.");
    var e;
    if (typeof target.deck === "string") {
      var deck = fcDecks(C, d).filter(function (k) { return k.id === target.deck; })[0];
      if (!deck) return bad("That deck is no longer in Flashcards.");
      if (ch.action !== "update") return bad("A deck can be renamed here (move, delete and settings are in Flashcards).");
      if ((e = only(ch, ["title"], "A deck"))) return e;
      if (!has(ch.set, "title")) return bad("Give title, the deck's new name.");
      if ((e = tooLong("The name", ch.set.title, C.LIMITS.name, "Flashcards"))) return e;
      var prevD = clone(deck);
      d.slice = C.updateDeck(d.slice, deck.id, { n: ch.set.title }, now);
      var nextD = fcDecks(C, d).filter(function (k) { return k.id === deck.id; })[0];
      if (nextD.n === prevD.n) return nothing("deck");
      return { ok: true, title: prevD.n, before: { title: prevD.n }, after: { title: nextD.n }, del: false,
               undo: { t: "set", app: "flashcards", deck: { prev: prevD, next: clone(nextD) } } };
    }
    if (typeof target.note !== "string") return bad("Only a deck or a note can be changed here.");
    if (!isObj(d.own) || typeof d.own.path !== "string" || !d.own.path) return bad("The orOS disk is not reachable; Flashcards' notes can't be changed now.");
    var n = fcNote(C, d, target.note);
    if (!n) return bad("That note is no longer in Flashcards.");
    var before = fcView(C, d, n), v = clone(n), s = ch.set, cl = n.k === "cloze";
    if (ch.action === "move") {
      if ((e = only(ch, ["deck"], "A note"))) return e;
      if (!s.deck) return bad("Give deck, the name of the deck the note goes to.");
      var hit = byName(fcDecks(C, d), s.deck, "deck", "Flashcards");
      if (hit.err) return bad(hit.err + " New decks are made in Flashcards.");
      if (hit.x.id === n.dk) return bad("That note is already in the deck \"" + hit.x.n + "\".");
      v.dk = hit.x.id;
    } else {
      if ((e = only(ch, ["front", "back", "label", "labels"], "A note"))) return e;
      var L = C.LIMITS.field;
      if (has(s, "front")) {
        if ((e = tooLong("The front", s.front, L, "a card side"))) return e;
        if (!s.front.trim()) return bad("The front can't be empty.");
        if (cl) { if (C.clozeNums(s.front).length === 0) return bad("A cloze note's text needs at least one gap, like {{c1::word}}."); v.f.x = s.front; }
        else v.f.q = s.front;
      }
      if (has(s, "back")) { if ((e = tooLong("The back", s.back, L, "a card side"))) return e; if (cl) v.f.e = s.back; else v.f.a = s.back; }
      if (has(s, "labels") || has(s, "label")) {
        var tags = has(s, "labels") ? s.labels : s.label === "" ? [] : n.tg.concat([s.label]);
        for (var i = 0; i < tags.length; i++) if ((e = tooLong("The tag", tags[i].replace(/\s+/g, "_"), C.LIMITS.tag, "a tag"))) return e;
        if (tags.length > C.LIMITS.tags) return bad("A note keeps " + C.LIMITS.tags + " tags.");
        v.tg = C.normTags(tags);
      }
    }
    v.m = stampAfter(now, n.m);
    var ver = C.normNote(v);
    if (!ver) return bad("Flashcards would not keep that note.");
    var after = fcView(C, { slice: d.slice }, ver);
    if (same(after, before)) return nothing("note");
    fcPut(C, d, ver);
    return { ok: true, title: C.noteTitle(n).slice(0, 80) || before.front.slice(0, 80), before: before, after: after, del: false,
             undo: { t: "set", app: "flashcards", note: { prev: n, next: ver } } };
  }
  function flashcardsUndo(d, u, now) {
    var C = core("flashcards");
    if (!C || !isObj(d)) return bad("bad undo");
    if (isObj(u.deck)) {
      var cur = fcDecks(C, d).filter(function (k) { return k.id === u.deck.next.id; })[0];
      if (!cur || !same(cur, u.deck.next)) return bad("The deck changed since; nothing was undone.");
      d.slice = C.updateDeck(d.slice, cur.id, { n: u.deck.prev.n }, now);
      return { ok: true };
    }
    if (!isObj(u.note) || !isObj(u.note.next) || !isObj(u.note.prev)) return bad("bad undo");
    if (!isObj(d.own) || !d.own.path) return bad("The orOS disk is not reachable; nothing was undone.");
    var n = fcNote(C, d, u.note.next.id);
    if (!n || !same(n, C.normNote(u.note.next))) return bad("The note changed since; nothing was undone.");
    var back = C.normNote(Object.assign(clone(u.note.prev), { m: stampAfter(now, n.m) }));
    fcPut(C, d, back);
    return { ok: true };
  }

  var MODS = {
    music:      { settable: { title: 1, playlist: 1, from_playlist: 1 }, change: musicChange, undo: musicUndo },
    flashcards: { settable: { title: 1, front: 1, back: 1, label: 1, labels: 1, deck: 1 }, change: flashcardsChange, undo: flashcardsUndo }
  };
  E.extend(MODS);
  var api = { MODS: MODS, setCache: setCache };
  if (NODE) module.exports = api;
  else root.OrosAssistEdits4 = api;
})(typeof window !== "undefined" ? window : this);
