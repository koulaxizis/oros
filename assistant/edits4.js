// ============================================================
// orOS Assistant — edits4.js ("Assistant everywhere" wave 5b, AS-EDIT5)
// change_item in Music (a playlist renamed; a song or a whole album
// added to a playlist, a song taken out of one), Flashcards (a deck
// renamed; a note's front, back and tags, or the note to another deck)
// and Publishing (PB-CHG: a title's fields, people, editions and
// royalty terms).
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

  var CORES = { music: ["OrosMusicCore", "../music/core.js"], flashcards: ["FlashcardsCore", "../flashcards/core.js"],
                publish: ["OrosPublishCore", "../publish/core.js"] };
  function core(app) {
    var c = CORES[app];
    if (root[c[0]]) return root[c[0]];
    if (NODE) { try { var m = require(c[1]); return m[c[0]] || m; } catch (e) { return null; } }
    return null;
  }
  // Music's index { key: track row }, read by assistant.js.
  // PB-CHG: woo = the WooCommerce shops of Connected services
  // [{ id, name, site }], for an edition's product link (wc_id).
  var CACHE = { music: {}, woo: [] };
  function setCache(app, v) { if (app === "woo") { if (Array.isArray(v)) CACHE.woo = v; } else if (has(CACHE, app) && isObj(v)) CACHE[app] = v; }

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

  // ---------- 3. Publishing (publish/core.js put, PB-CHG) ----------
  // A title is one record (LWW on m, tombstones by id): a change
  // rewrites it through C.put (cleanTitle, a newer stamp), as the
  // title's own form does. Only the fields given change: people per
  // role (the names given replace that role's, a CRM link stays on a
  // name that stays), editions matched by ISBN, else by kind (added
  // when none matches; none is ever removed), royalty terms as a whole
  // list. An ISBN on another title is refused, never moved.
  var PB_ST = { idea: "idea", production: "prod", released: "out", out_of_print: "oop" };
  var PB_FMT = { paperback: "pb", hardback: "hb", ebook: "eb", audiobook: "ab", other: "ot" };
  var PB_ROLE = [["by", "a"], ["translator", "t"], ["illustrator", "i"], ["editor", "e"], ["cover_designer", "c"], ["narrator", "n"], ["other", "o"]];
  var PB_TEXT = [["title", "t", 200, 1], ["subtitle", "sub", 200, 1], ["series", "ser", 120, 1], ["series_no", "sn", 12, 1], ["language", "lang", 40, 1],
                 ["keywords", "kw", 400, 1], ["blurb", "blurb", 4000, 0], ["bio", "bio", 3000, 0], ["note", "notes", 4000, 0]];
  var PB_KEYS = ["title", "subtitle", "series", "series_no", "language", "keywords", "blurb", "bio", "note", "status", "date",
                 "by", "translator", "illustrator", "editor", "cover_designer", "narrator", "other", "formats", "royalties"];
  var FMT_NUM = [["price", "price", 0, 1e6, 2], ["pages", "pages", 0, 100000, 0], ["width", "w", 0, 2000, 1], ["height", "h", 0, 2000, 1],
                 ["spine", "sp", 0, 500, 1], ["weight", "wt", 0, 100000, 0], ["duration", "dur", 0, 100000, 0]];
  var FMT_TXT = [["binding", "bind", 60], ["paper", "paper", 80], ["note", "note", 200]];
  var FMT_KEYS = ["format", "isbn", "wc_id", "shop"].concat(FMT_NUM.map(function (x) { return x[0]; }), FMT_TXT.map(function (x) { return x[0]; }));
  function pbKind(k) { var o = ""; Object.keys(PB_FMT).forEach(function (n) { if (PB_FMT[n] === k) o = n; }); return o; }
  function pbStName(st) { var o = ""; Object.keys(PB_ST).forEach(function (n) { if (PB_ST[n] === st) o = n; }); return o; }
  function pbNum(v) { return typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN; }
  function pbFmtLine(f) {
    var b = [pbKind(f.k)];
    if (f.isbn) b.push(f.isbn);
    if (f.price) b.push(f.price.toFixed(2));
    if (f.pages) b.push(f.pages + " p.");
    if (f.w || f.h) b.push((f.w || "?") + "×" + (f.h || "?") + " mm");
    if (f.sp) b.push("spine " + f.sp + " mm");
    if (f.wt) b.push(f.wt + " g");
    if (f.bind) b.push(f.bind);
    if (f.paper) b.push(f.paper);
    if (f.dur) b.push(f.dur + " min");
    if (f.wp) b.push("product " + f.wp.id);
    if (f.note) b.push(f.note);
    return b.join(" · ");
  }
  function pbView(t) {
    function who(r) { return t.ppl.filter(function (p) { return p.r === r; }).map(function (p) { return p.n; }).join(", "); }
    var others = t.ppl.filter(function (p) { return "aite".indexOf(p.r) < 0; }).map(function (p) { return p.n + " (" + ({ c: "cover", n: "narrator", o: "other" })[p.r] + ")"; });
    return { title: t.t, sub: t.sub, by: who("a"), translator: who("t"), illustrator: who("i"), editor: who("e"), credits: others.join(", "),
             series: t.ser + (t.sn ? " #" + t.sn : ""), status: pbStName(t.st), release: t.rel, lang: t.lang,
             format: t.fmts.map(pbFmtLine).join("\n"),
             royalty: (t.roy || []).map(function (r) { return r.n + " " + r.pct + "% " + r.base + (r.k ? " " + pbKind(r.k) : "") + (r.adv ? " advance " + r.adv.toFixed(2) : ""); }).join("\n"),
             kw: t.kw, blurb: t.blurb, bio: t.bio, note: t.notes };
  }
  function pbWoo(f, w) {
    var list = CACHE.woo.filter(function (a) { return isObj(a) && typeof a.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(a.id); });
    if (!list.length) return { err: w + "wc_id needs a WooCommerce shop in Settings › Connected services, and there is none on this device. Leave wc_id out, or ask the owner to connect the shop first." };
    var names = list.map(function (a) { return a.name || a.site || a.id; });
    if (f.shop == null || f.shop === "") return list.length === 1 ? { v: list[0].id } : { err: w + "wc_id: the owner has several shops (" + names.join(", ") + "); give shop." };
    var q = H.foldName(String(f.shop)).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    var hit = list.filter(function (a) {
      return H.foldName(String(a.name || "")) === q || H.foldName(String(a.site || "")).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "") === q;
    });
    return hit.length === 1 ? { v: hit[0].id } : { err: w + "shop " + String(f.shop).slice(0, 80) + " is not one of the owner's shops: " + names.join(", ") + "." };
  }
  function pbFormats(C, d, t, list) {
    if (list.length > C.MAX_FMTS) return { err: "formats: a title keeps " + C.MAX_FMTS + " editions in Publishing." };
    var fmts = clone(t.fmts), used = C.used(d), seen = {};
    for (var i = 0; i < list.length; i++) {
      var x = list[i], w = "formats[" + i + "].";
      if (!isObj(x)) return { err: "formats[" + i + "] must be an object." };
      var no = Object.keys(x).filter(function (k) { return FMT_KEYS.indexOf(k) < 0; });
      if (no.length) return { err: w + " has no " + no.join(", ") + " (an edition takes " + FMT_KEYS.join(", ") + ")." };
      var kind = "";
      if (x.format != null && x.format !== "") {
        if (!has(PB_FMT, String(x.format))) return { err: w + "format must be paperback, hardback, ebook, audiobook or other." };
        kind = PB_FMT[String(x.format)];
      }
      var isbn = "";
      if (x.isbn != null && x.isbn !== "") {
        var pi = C.parseIsbn(String(x.isbn));
        if (!pi.ok) return { err: w + "isbn " + String(x.isbn).slice(0, 30) + " is not a valid ISBN" + (pi.why === "check" ? " (its check digit is wrong)" : "") + ". Leave it out when unsure; never make one up." };
        isbn = pi.isbn;
        if (seen[isbn]) return { err: w + "isbn " + isbn + " is given twice." };
        seen[isbn] = 1;
        var u = used[isbn] ? used[isbn][0] : null;
        if (u && (u.x || u.title !== t.id)) {
          var on = u.x ? null : C.find(d, "titles", u.title);
          return { err: w + "isbn " + isbn + " is already " + (on ? "on “" + on.t + "”" : "marked as used outside Publishing") + ". Check the number; nothing was changed." };
        }
      }
      // which edition: its ISBN, else the only one of that kind
      var at = -1;
      if (isbn) fmts.forEach(function (f, j) { if (f.isbn === isbn) at = j; });
      if (at < 0 && kind) {
        var same = [];
        fmts.forEach(function (f, j) { if (f.k === kind && (!isbn || !f.isbn)) same.push(j); });
        if (same.length > 1) return { err: w + "the title has " + same.length + " " + pbKind(kind) + " editions; give isbn to say which." };
        if (same.length === 1) at = same[0];
      }
      if (at < 0 && !kind && !isbn) {
        if (fmts.length !== 1) return { err: w + "give format or isbn to say which edition (the title has " + fmts.length + ")." };
        at = 0;
      }
      var f;
      if (at < 0) {
        if (fmts.length >= C.MAX_FMTS) return { err: w + "a title keeps " + C.MAX_FMTS + " editions; this would be one more." };
        f = { id: C.uid(), k: kind || "pb", isbn: "", price: 0, pages: 0 };
        fmts.push(f);
      } else f = fmts[at];
      if (kind) f.k = kind;
      if (isbn) f.isbn = isbn;
      for (var n = 0; n < FMT_NUM.length; n++) {
        var a = FMT_NUM[n];
        if (x[a[0]] == null || x[a[0]] === "") continue;
        var v = pbNum(x[a[0]]);
        if (!isFinite(v) || v < a[2] || v > a[3]) return { err: w + a[0] + " must be a number from " + a[2] + " to " + a[3] + "." };
        if (!a[4] && Math.round(v) !== v) return { err: w + a[0] + " must be a whole number." };
        f[a[1]] = Math.round(v * Math.pow(10, a[4])) / Math.pow(10, a[4]);
      }
      for (n = 0; n < FMT_TXT.length; n++) {
        var b = FMT_TXT[n];
        if (x[b[0]] == null) continue;
        if (typeof x[b[0]] !== "string") return { err: w + b[0] + " must be text." };
        var tv = H.line(x[b[0]], 100000);
        if (tv.length > b[2]) return { err: w + b[0] + " has " + tv.length + " characters; Publishing keeps " + b[2] + "." };
        f[b[1]] = tv;
      }
      if (x.wc_id != null && x.wc_id !== "") {
        var id = pbNum(x.wc_id);
        if (!(id >= 1 && id <= 1e12) || Math.round(id) !== id) return { err: w + "wc_id must be the shop product's number." };
        var ac = pbWoo(x, w);
        if (ac.err) return ac;
        var clash = null;
        d.titles.forEach(function (o) { o.fmts.forEach(function (g) { if (o.id !== t.id && g.wp && g.wp.a === ac.v && g.wp.id === id) clash = o; }); });
        if (clash) return { err: w + "shop product " + id + " is already linked to “" + clash.t + "” in Publishing. Check the number; nothing was changed." };
        f.wp = { a: ac.v, id: id };
      }
    }
    var wps = {};
    for (var k = 0; k < fmts.length; k++) {
      if (!fmts[k].wp) continue;
      var kk = fmts[k].wp.a + "|" + fmts[k].wp.id;
      if (wps[kk]) return { err: "formats: shop product " + fmts[k].wp.id + " would be on two editions; each edition has its own." };
      wps[kk] = 1;
    }
    return { v: fmts };
  }
  function pbRoyalties(C, list) {
    if (list.length > C.MAX_ROY) return { err: "royalties: a title keeps " + C.MAX_ROY + " royalty terms." };
    var out = [], keys = {};
    for (var i = 0; i < list.length; i++) {
      var x = list[i], w = "royalties[" + i + "].";
      if (!isObj(x)) return { err: "royalties[" + i + "] must be an object { name, percent, base, format, advance }." };
      var no = Object.keys(x).filter(function (k) { return ["name", "percent", "base", "format", "advance"].indexOf(k) < 0; });
      if (no.length) return { err: w + " has no " + no.join(", ") + " (a term takes name, percent, base, format, advance)." };
      var n = H.line(typeof x.name === "string" ? x.name : "", 1000);
      if (!n) return { err: w + "name is required (the person paid)." };
      if (n.length > 120) return { err: w + "name has " + n.length + " characters; Publishing keeps 120." };
      var pct = pbNum(x.percent);
      if (!(pct >= 0 && pct <= 100)) return { err: w + "percent must be a number from 0 to 100." };
      var base = x.base == null || x.base === "" ? "list" : String(x.base);
      if (C.ROY_BASES.indexOf(base) < 0) return { err: w + "base must be list (the list price) or net (what the publisher receives)." };
      var k = "";
      if (x.format != null && x.format !== "" && x.format !== "all") {
        if (!has(PB_FMT, String(x.format))) return { err: w + "format must be all, paperback, hardback, ebook, audiobook or other." };
        k = PB_FMT[String(x.format)];
      }
      var adv = x.advance == null || x.advance === "" ? 0 : pbNum(x.advance);
      if (!(adv >= 0 && adv <= 1e7)) return { err: w + "advance must be an amount from 0." };
      var key = H.foldName(n) + "|" + k;
      if (keys[key]) return { err: w + n + " has two terms for the same format." };
      keys[key] = 1;
      out.push({ n: n, pct: Math.round(pct * 100) / 100, base: base, k: k, adv: Math.round(adv * 100) / 100 });
    }
    return { v: out };
  }
  function publishChange(d, target, ch, now) {
    var C = core("publish");
    if (!C) return bad("Publishing is not available.");
    if (!isObj(d) || !isObj(target) || typeof target.title !== "string") return bad("Only a Publishing title can be changed here.");
    if (ch.action !== "update") return bad("A Publishing title takes update (deleting a title is done in Publishing).");
    var e;
    if ((e = only(ch, PB_KEYS, "A Publishing title"))) return e;
    var nd = C.normalize(d);
    var t = C.find(nd, "titles", target.title);
    if (!t || nd.tombs[t.id] >= t.m) return bad("That title is no longer in Publishing.");
    var s = ch.set, v = clone(t);
    for (var i = 0; i < PB_TEXT.length; i++) {
      var a = PB_TEXT[i];
      if (!has(s, a[0])) continue;
      var tv = a[3] ? H.line(String(s[a[0]]), 100000) : H.para(String(s[a[0]]), 100000);
      if ((e = tooLong(a[0], tv, a[2], "Publishing"))) return e;
      if (a[0] === "title" && !tv) return bad("title must not be empty.");
      v[a[1]] = tv;
    }
    if (has(s, "status")) {
      if (!has(PB_ST, s.status)) return bad("A Publishing title's status is idea, production, released or out_of_print.");
      v.st = PB_ST[s.status];
    }
    if (has(s, "date")) v.rel = s.date;
    var ppl = v.ppl;
    for (i = 0; i < PB_ROLE.length; i++) {
      var rk = PB_ROLE[i][0], r = PB_ROLE[i][1];
      if (!has(s, rk)) continue;
      var names = [];
      String(s[rk]).split(/[,;]/).forEach(function (x) {
        var n = H.line(x, 1000);
        if (n && !names.some(function (y) { return H.foldName(y) === H.foldName(n); })) names.push(n);
      });
      for (var j = 0; j < names.length; j++) if ((e = tooLong("A name in " + rk, names[j], 120, "Publishing"))) return e;
      var old = ppl.filter(function (p) { return p.r === r; });
      var keep = ppl.filter(function (p) { return p.r !== r; });
      ppl = keep.concat(names.map(function (n) {
        var was = old.filter(function (p) { return H.foldName(p.n) === H.foldName(n); })[0];
        return was && was.crm ? { r: r, n: n, crm: was.crm } : { r: r, n: n };
      }));
    }
    if (ppl.length > C.MAX_PPL) return bad("A title keeps " + C.MAX_PPL + " people in Publishing; this would be " + ppl.length + ".");
    v.ppl = ppl;
    if (has(s, "formats")) {
      var fr = pbFormats(C, nd, t, s.formats);
      if (fr.err) return bad(fr.err);
      v.fmts = fr.v;
    }
    if (has(s, "royalties")) {
      var rr = pbRoyalties(C, s.royalties);
      if (rr.err) return bad(rr.err);
      // a term that stays keeps its id (a statement already issued names it)
      var prevRoy = t.roy || [];
      v.roy = rr.v.map(function (x) {
        var was = prevRoy.filter(function (p) { return H.foldName(p.n) === H.foldName(x.n) && p.k === x.k; })[0];
        return Object.assign({ id: was ? was.id : C.uid() }, x);
      });
      if (!v.roy.length) delete v.roy;
    }
    var before = pbView(t);
    var out = C.put(nd, "titles", v, now);
    var next = C.find(out, "titles", t.id);
    if (!next) return bad("Publishing would not keep that title.");
    var after = pbView(next);
    if (same(after, before)) return nothing("title");
    adopt(d, out);
    return { ok: true, title: t.t, before: before, after: after, del: false,
             undo: { t: "set", app: "publish", prev: clone(t), next: clone(next) } };
  }
  function publishUndo(d, u, now) {
    var C = core("publish");
    if (!C || !isObj(d) || !isObj(u.prev) || !isObj(u.next)) return bad("bad undo");
    var nd = C.normalize(d), cur = C.find(nd, "titles", u.next.id);
    if (!cur || !same(cur, u.next)) return bad("The title changed since; nothing was undone.");
    adopt(d, C.put(nd, "titles", clone(u.prev), now));
    return { ok: true };
  }

  var MODS = {
    music:      { settable: { title: 1, playlist: 1, from_playlist: 1 }, change: musicChange, undo: musicUndo },
    flashcards: { settable: { title: 1, front: 1, back: 1, label: 1, labels: 1, deck: 1 }, change: flashcardsChange, undo: flashcardsUndo },
    publish:    { settable: PB_KEYS.reduce(function (o, k) { o[k] = 1; return o; }, {}), change: publishChange, undo: publishUndo }
  };
  E.extend(MODS);
  var api = { MODS: MODS, setCache: setCache };
  if (NODE) module.exports = api;
  else root.OrosAssistEdits4 = api;
})(typeof window !== "undefined" ? window : this);
