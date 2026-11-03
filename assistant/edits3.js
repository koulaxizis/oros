// ============================================================
// orOS Assistant — edits3.js ("Assistant everywhere" wave 5a, AS-EDIT4)
// change_item in four apps the Assistant could only read: Wiki (an
// article's text), Reader (an article read or unread, its tags),
// Podcasts (an episode played or not, in the queue or not) and Stock
// (a product's or a supplier's details). Loaded by assistant.js the
// first time one of their items is changed, with the app's own
// core.js, and registered into assistant/edits.js (extend), whose
// plan / apply / undo / diff and card stay the same for every app.
// Every change is written the way the app writes it, through the
// app's own core (its stamps, its merge), so the stored copy is
// already in the app's canonical form. A text longer than the app
// keeps is refused, never cut. Nothing is deleted here.
// Reader's stored articles and Podcasts' episode titles live in the
// apps' IndexedDB: assistant.js reads them (read-only) before a
// change and hands them over with setCache; nothing here opens a
// database. A Wiki change also returns `after` = the revision file
// to write to the orOS disk (Wiki's history), as Wiki does.
// change(d, target, ch, now) works on d IN PLACE (a copy of the
// stored JSON) → { ok, title, before, after, del, undo, disk? } | { ok:false, err }
// undo(d, u, now) → { ok } | { ok:false, err }, also in place.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var E = root.OrosAssistEdits || (NODE ? require("./edits.js") : null);
  if (!E) return;
  var H = E.helpers;
  var has = H.has, isObj = H.isObj, clone = H.clone, bad = H.bad, stampAfter = H.stampAfter;

  var CORES = {
    wiki: ["WikiCore", "../wiki/core.js"], feeds: ["orosFeedsCore", "../feeds/core.js"],
    podcasts: ["OrosPodcastsCore", "../podcasts/core.js"], stock: ["OrosStockCore", "../stock/core.js"]
  };
  function core(app) {
    var c = CORES[app];
    if (root[c[0]]) return root[c[0]];
    if (NODE) { try { var m = require(c[1]); return m[c[0]] || m; } catch (e) { return null; } }
    return null;
  }
  // Reader's stored articles { id: head } and Podcasts' episodes
  // { showId: [{ id, title, pub }] }, read by assistant.js.
  var CACHE = { feeds: {}, podcasts: {} };
  function setCache(app, v) { if (has(CACHE, app) && isObj(v)) CACHE[app] = v; }

  function adopt(d, nd) {
    Object.keys(d).forEach(function (k) { delete d[k]; });
    Object.keys(nd).forEach(function (k) { d[k] = nd[k]; });
  }
  function find(list, id) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (isObj(list[i]) && list[i].id === id) return { x: list[i], i: i };
    return null;
  }
  function tooLong(what, v, max, where) {
    return typeof v === "string" && v.length > max ? bad(what + " is " + v.length + " characters; " + where + " keeps " + max + ".") : null;
  }
  function only(ch, keys, what) {
    var no = Object.keys(ch.set).filter(function (k) { return keys.indexOf(k) < 0; });
    return no.length ? bad(what + " has no " + no.join(", ") + " here (it takes " + keys.join(", ") + ").") : null;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function nothing(what) { return bad("Nothing would change: the " + what + " already looks like that."); }
  function preview(s, n) { s = String(s || ""); return s.length > n ? "…" + s.slice(s.length - n) : s; }
  function money(c) { var s = String(Math.abs(c)); while (s.length < 3) s = "0" + s; return s.slice(0, -2) + "." + s.slice(-2); }

  // ---------- 1. Wiki: an article's text (wiki/core.js, wiki.js saveRevision) ----------
  // A change is a new revision: r = a new revision id, the old one goes
  // first into anc (so every device sees a descendant, not a parallel
  // edit), m moves on. Parallel edits kept in alt stay as they are.
  // The title is not changed here (Wiki's Rename also makes a redirect).
  function wkView(a) { return { title: a.t, text: preview(a.x, 400) }; }
  function wkRev(C, cur, x, now) {
    return C.normArt({ id: cur.id, m: stampAfter(now, cur.m), w: cur.w, t: cur.t, x: x, r: C.uid("r"),
                       anc: [cur.r].concat(cur.anc), alt: cur.alt, s: "", c: cur.c });
  }
  function wkFind(C, d, id) {
    var a = typeof id === "string" ? C.byId(d, id) : null;
    return a && C.wikiById(d, a.w) ? a : null;
  }
  function wikiChange(d, target, ch, now) {
    var C = core("wiki");
    if (!C) return bad("Wiki is not available.");
    if (!isObj(target) || typeof target.a !== "string") return bad("Only an article can be changed here.");
    adopt(d, C.normData(d));
    var cur = wkFind(C, d, target.a);
    if (!cur) return bad("That article is no longer in Wiki.");
    var e = only(ch, ["text", "text_add"], "A Wiki article");
    if (e) return e;
    var s = ch.set, x;
    if (has(s, "text")) x = s.text;
    else if (has(s, "text_add")) x = cur.x.replace(/\s+$/, "") + (cur.x.trim() ? "\n\n" : "") + s.text_add;
    else return bad("Give text (the article's whole new text) or text_add (a paragraph at the end).");
    x = x.replace(/\r\n?/g, "\n");
    if ((e = tooLong("The text", x, C.MAX_TEXT, "a Wiki article"))) return e;
    if (x === cur.x) return nothing("article");
    var next = wkRev(C, cur, x, now);
    d.arts = d.arts.map(function (a) { return a.id === cur.id ? next : a; });
    adopt(d, C.merge(d, null));
    var stored = C.byId(d, next.id);
    return { ok: true, title: cur.t, before: wkView(cur), after: wkView(stored), del: false,
             disk: { path: C.revPath(stored.id, stored.m, stored.r), text: JSON.stringify(C.revFile(stored, cur.r, "")) },
             undo: { t: "set", app: "wiki", id: cur.id, r: stored.r, x: cur.x } };
  }
  function wikiUndo(d, u, now) {
    var C = core("wiki");
    if (!C || typeof u.id !== "string" || typeof u.r !== "string" || typeof u.x !== "string") return bad("bad undo");
    adopt(d, C.normData(d));
    var cur = wkFind(C, d, u.id);
    if (!cur) return bad("That article is no longer in Wiki.");
    if (cur.r !== u.r) return bad("The article changed since; nothing was undone.");
    var back = wkRev(C, cur, u.x, now);
    d.arts = d.arts.map(function (a) { return a.id === cur.id ? back : a; });
    adopt(d, C.merge(d, null));
    return { ok: true };
  }

  // ---------- 2. Reader: an article (feeds/core.js, feeds.js updateSaved) ----------
  // Read = an explicit mark (markItems: the stamp moves past the feed's
  // cut). Tags live on the saved record (synced), which is made from
  // the stored article when it gets its first tag and goes (with a
  // tombstone "i:<id>") when nothing is left on it, as in Reader.
  function fdItem(d, target) {
    var sv = find(d.items, target.item), h = CACHE.feeds[target.item];
    if (sv) return { id: sv.x.id, feed: sv.x.feed, date: sv.x.date, title: sv.x.title, sv: sv.x };
    if (isObj(h) && h.feed === target.feed) return { id: target.item, feed: h.feed, date: +h.date || 0, title: String(h.title || ""), h: h };
    return null;
  }
  function fdTagNames(d, ids) {
    var by = {};
    (d.tags || []).forEach(function (t) { by[t.id] = t.name; });
    return (ids || []).map(function (id) { return by[id]; }).filter(Boolean).sort();
  }
  function fdView(C, d, it) {
    var sv = find(d.items, it.id);
    return { title: it.title, read: C.isRead(d, it), labels: fdTagNames(d, sv ? sv.x.tags : []).join(", ") };
  }
  function fdState(d, id) {
    var sv = find(d.items, id), mk = d.read.ids[id];
    return { sv: sv ? clone(sv.x) : null, mk: mk ? clone(mk) : null };
  }
  function feedsChange(d, target, ch, now) {
    var C = core("feeds");
    if (!C) return bad("Reader is not available.");
    if (!isObj(target) || typeof target.item !== "string") return bad("Only an article can be changed here (a feed is changed in Reader).");
    adopt(d, C.merge(d, d));
    var it = fdItem(d, target);
    if (!it) return bad("That article is no longer stored in Reader.");
    if (!C.feedById(d, it.feed)) return bad("That article's feed is no longer in Reader.");
    var before = fdView(C, d, it), prev = fdState(d, it.id), e;
    if (ch.action === "complete" || ch.action === "reopen") {
      var st = ch.action === "complete" ? 1 : 0;
      if (before.read === (st === 1)) return bad(st ? "That article is already read." : "That article is not read.");
      C.markItems(d, [it], st, now);
      if (C.isRead(d, it) !== (st === 1)) return bad("Reader counts articles older than " + C.KEEP_DAYS + " days as read.");
    } else {
      if ((e = only(ch, ["label", "labels"], "An article"))) return e;
      var tags = (d.tags || []), want = [], miss = [];
      var names = has(ch.set, "labels") ? ch.set.labels : ch.set.label === "" ? [] : fdTagNames(d, it.sv ? it.sv.tags : []).concat([ch.set.label]);
      names.forEach(function (n) {
        var hit = null;
        tags.forEach(function (t) { if (!hit && H.foldName(t.name) === H.foldName(n)) hit = t; });
        if (!hit) miss.push(n); else if (want.indexOf(hit.id) < 0) want.push(hit.id);
      });
      if (miss.length) return bad("Reader has no tag named \"" + miss.join("\", \"") + "\". " +
        (tags.length ? "Its tags: " + tags.map(function (t) { return t.name; }).join(", ") + "." : "It has none.") + " New tags are made in Reader.");
      if (want.length > C.MAX_ITEM_TAGS) return bad("An article keeps " + C.MAX_ITEM_TAGS + " tags.");
      var tomb = d.tombs["i:" + it.id] || 0;
      if (it.sv) {
        var sv = find(d.items, it.id).x;
        sv.tags = want;
        sv.m = stampAfter(now, Math.max(sv.m, tomb));
        if (!sv.star && !sv.later && !sv.tags.length) {
          d.items = d.items.filter(function (x) { return x.id !== it.id; });
          d.tombs["i:" + it.id] = sv.m;
        }
      } else if (want.length) {
        var h = it.h;
        d.items.push({ id: it.id, feed: h.feed, title: String(h.title || ""), link: String(h.link || ""), date: +h.date || 0,
                       author: String(h.author || ""), sum: String(h.snip || h.sum || ""), star: 0, later: 0, tags: want,
                       m: stampAfter(now, tomb) });
      }
    }
    adopt(d, C.merge(d, d));
    var after = fdView(C, d, it);
    if (same(after, before)) return nothing("article");
    return { ok: true, title: it.title, before: before, after: after, del: false,
             undo: { t: "set", app: "feeds", it: { id: it.id, feed: it.feed, date: it.date, title: it.title }, read: before.read,
                     prev: prev, next: fdState(d, it.id) } };
  }
  function feedsUndo(d, u, now) {
    var C = core("feeds");
    if (!C || !isObj(u.it) || typeof u.it.id !== "string" || !isObj(u.prev) || !isObj(u.next)) return bad("bad undo");
    adopt(d, C.merge(d, d));
    var it = u.it;
    if (!same(fdState(d, it.id), u.next)) return bad("The article changed since; nothing was undone.");
    if (C.isRead(d, it) !== u.read) C.markItems(d, [it], u.read ? 1 : 0, now);
    if (!same(u.prev.sv, u.next.sv)) {
      var tomb = d.tombs["i:" + it.id] || 0, cur = find(d.items, it.id);
      var m = stampAfter(now, Math.max(tomb, cur ? cur.x.m : 0));
      d.items = d.items.filter(function (x) { return x.id !== it.id; });
      if (u.prev.sv) d.items.push(Object.assign(clone(u.prev.sv), { m: m }));
      else d.tombs["i:" + it.id] = m;
    }
    adopt(d, C.merge(d, d));
    return { ok: true };
  }

  // ---------- 3. Podcasts: an episode (podcasts/core.js setProgress, queue*) ----------
  // Played = the episode's progress row with x = 1 (from the start next
  // time), as "Mark as played" writes it; the queue (Up next) is one
  // list with its own stamp. queue: "next" (first), "end" (last) or
  // "off" (out of the queue).
  function pcEp(C, d, target) {
    if (!isObj(target) || typeof target.ep !== "string" || typeof target.show !== "string") return null;
    if (!C.findShow(d, target.show)) return null;
    var list = Array.isArray(CACHE.podcasts[target.show]) ? CACHE.podcasts[target.show] : [], info = null;
    list.forEach(function (e) { if (isObj(e) && e.id === target.ep) info = e; });
    var row = find(d.eps, target.ep);
    if (!info && !row) return null;
    var pd = row ? row.x.pd : +(info && info.pub) || 0;
    return { id: target.ep, s: target.show, pd: pd > 0 ? pd : 0, title: info && info.title ? String(info.title) : "" };
  }
  function pcView(C, d, ep) {
    var q = d.queue.ids.indexOf(ep.id);
    return { title: ep.title, played: C.stateOf(d, ep).x === 1, queue: q < 0 ? "" : (q + 1) + " / " + d.queue.ids.length };
  }
  function pcState(d, id) {
    var row = find(d.eps, id);
    return { row: row ? clone(row.x) : null, q: d.queue.ids.indexOf(id) };
  }
  function podcastsChange(d, target, ch, now) {
    var C = core("podcasts");
    if (!C) return bad("Podcasts is not available.");
    adopt(d, C.mergePodcasts(d, d));
    var ep = pcEp(C, d, target);
    if (!ep) return bad(isObj(target) && target.ep ? "That episode is no longer in Podcasts." : "Only an episode can be changed here (a show is changed in Podcasts).");
    var before = pcView(C, d, ep), prev = pcState(d, ep.id), nd = d, e;
    if (ch.action === "complete" || ch.action === "reopen") {
      var x = ch.action === "complete" ? 1 : 0;
      if (before.played === (x === 1)) return bad(x ? "That episode is already played." : "That episode is not played.");
      nd = C.setProgress(d, ep, 0, 0, x, now);
    } else {
      if ((e = only(ch, ["queue"], "An episode"))) return e;
      var w = ch.set.queue, inQ = prev.q >= 0;
      if (w === "off") { if (!inQ) return bad("That episode is not in the queue."); nd = C.queueRemove(d, ep.id, now); }
      else {
        if (!inQ && d.queue.ids.length >= C.LIM.queue) return bad("The queue holds " + C.LIM.queue + " episodes.");
        nd = C.queueAdd(d, { id: ep.id, s: ep.s }, w === "next" ? "next" : "end", now);
      }
    }
    adopt(d, nd);
    var after = pcView(C, d, ep);
    if (same(after, before)) return nothing("episode");
    return { ok: true, title: ep.title || before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "podcasts", ep: { id: ep.id, s: ep.s, pd: ep.pd }, prev: prev, next: pcState(d, ep.id) } };
  }
  function podcastsUndo(d, u, now) {
    var C = core("podcasts");
    if (!C || !isObj(u.ep) || !isObj(u.prev) || !isObj(u.next)) return bad("bad undo");
    adopt(d, C.mergePodcasts(d, d));
    if (!same(pcState(d, u.ep.id), u.next)) return bad("The episode changed since; nothing was undone.");
    var nd = d, p = u.prev.row;
    if (!same(u.prev.row, u.next.row)) nd = C.setProgress(nd, u.ep, p ? p.p : 0, p ? p.d : 0, p ? p.x : 0, now);
    if (u.prev.q !== u.next.q) {
      if (u.prev.q < 0) nd = C.queueRemove(nd, u.ep.id, now);
      else {
        nd = C.queueAdd(nd, { id: u.ep.id, s: u.ep.s }, "end", now);
        nd = C.queueMove(nd, u.ep.id, u.prev.q, now);
      }
    }
    adopt(d, nd);
    return { ok: true };
  }

  // ---------- 4. Stock: a product or a supplier (stock/core.js) ----------
  // Whole-record LWW on m, through Stock's merge. A product: title =
  // its name, note, location, amount = the selling price. A supplier:
  // title, note, phone, email (each replaces). Quantities change only
  // through movements, in Stock.
  var SK = { name: 80, note: 500, loc: 60, tel: 40 };
  function skGone(d, x) { var t = d.tombs && d.tombs[x.id]; return typeof t === "number" && t >= x.m; }
  function skView(x, sup) {
    return sup ? { title: x.name, phone: x.tel || "", email: x.email || "", note: x.note || "" }
               : { title: x.name, location: x.loc || "", price: money(x.price || 0), note: x.note || "" };
  }
  function stockChange(d, target, ch, now) {
    var C = core("stock");
    if (!C) return bad("Stock is not available.");
    var sup = isObj(target) && typeof target.sup === "string", id = isObj(target) ? (sup ? target.sup : target.item) : null;
    if (typeof id !== "string") return bad("Only a product or a supplier can be changed here.");
    adopt(d, C.merge(d, d, now));
    var list = sup ? d.sups : d.items, h = find(list, id);
    if (!h || skGone(d, h.x)) return bad(sup ? "That supplier is no longer in Stock." : "That product is no longer in Stock.");
    if (!sup && h.x.arch === 1) return bad("That product is archived; bring it back in Stock first.");
    var e = sup ? only(ch, ["title", "note", "phone", "email"], "A supplier") : only(ch, ["title", "note", "location", "amount"], "A product");
    if (e) return e;
    var s = ch.set, x = clone(h.x), before = skView(h.x, sup);
    if (has(s, "title")) { if ((e = tooLong("The name", s.title, SK.name, "Stock"))) return e; x.name = s.title; }
    if (has(s, "note")) { if ((e = tooLong("The note", s.note, SK.note, "Stock"))) return e; x.note = s.note; }
    if (has(s, "location")) { if ((e = tooLong("The location", s.location, SK.loc, "Stock"))) return e; x.loc = s.location; }
    if (has(s, "phone")) { if ((e = tooLong("The phone", s.phone, SK.tel, "Stock"))) return e; x.tel = s.phone; }
    if (has(s, "email")) x.email = s.email;
    if (has(s, "amount")) x.price = s.amount;
    x.m = stampAfter(now, Math.max(h.x.m, (d.tombs && d.tombs[id]) || 0));
    list[h.i] = x;
    adopt(d, C.merge(d, d, now));
    var nx = find(sup ? d.sups : d.items, id);
    if (!nx) return bad("Stock did not keep that change.");
    var after = skView(nx.x, sup);
    if (same(after, before)) return nothing(sup ? "supplier" : "product");
    return { ok: true, title: before.title, before: before, after: after, del: false,
             undo: { t: "set", app: "stock", sup: sup, prev: clone(h.x), next: clone(nx.x) } };
  }
  function stockUndo(d, u, now) {
    var C = core("stock");
    if (!C || !isObj(u.prev) || !isObj(u.next)) return bad("bad undo");
    adopt(d, C.merge(d, d, now));
    var list = u.sup ? d.sups : d.items, h = find(list, u.next.id);
    if (!h || !same(h.x, u.next)) return bad("It changed since; nothing was undone.");
    var x = clone(u.prev);
    x.m = stampAfter(now, h.x.m);
    list[h.i] = x;
    adopt(d, C.merge(d, d, now));
    return { ok: true };
  }

  var MODS = {
    wiki:     { settable: { text: 1, text_add: 1 }, change: wikiChange, undo: wikiUndo },
    feeds:    { settable: { label: 1, labels: 1 }, change: feedsChange, undo: feedsUndo },
    podcasts: { settable: { queue: 1 }, change: podcastsChange, undo: podcastsUndo },
    stock:    { settable: { title: 1, note: 1, location: 1, amount: 1, phone: 1, email: 1 }, change: stockChange, undo: stockUndo }
  };
  E.extend(MODS);
  var api = { MODS: MODS, setCache: setCache };
  if (NODE) module.exports = api;
  else root.OrosAssistEdits3 = api;
})(typeof window !== "undefined" ? window : this);
