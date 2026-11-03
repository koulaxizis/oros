// Assistant: change_item in Wiki, Reader, Podcasts and Stock
// ("Assistant everywhere" wave 5a, AS-EDIT4, assistant/edits3.js).
// Each change is written through the app's own core, so the stored copy
// is already what the app's merge makes of it; texts longer than the
// app keeps are refused; Undo only takes back what nobody changed since.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("crypto");
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const E = require("../assistant/edits.js");
const E3 = require("../assistant/edits3.js");
const WK = require("../wiki/core.js");
const FD = require("../feeds/core.js");
const PC = require("../podcasts/core.js").OrosPodcastsCore;
const SK = require("../stock/core.js");

const NOW = 1790000000000;      // 2026-09-21
const T0 = NOW - 5 * 86400000;
const J = (x) => JSON.stringify(x);
function ok(args) { const r = E.normArgs(Object.assign({ ref: "r1" }, args)); assert.equal(r.ok, true, r.err); return r; }
function run(app, data, target, args, now) {
  const ch = ok(args);
  const p = E.plan(app, data, target, ch, now || NOW);
  if (!p.ok) return p;
  const a = E.apply(app, data, target, ch, now || NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return Object.assign(a, { plan: p });
}
function rows(r) { const o = {}; r.rows.forEach((x) => { o[x.f] = [x.b, x.a]; }); return o; }

test("wave 5a apps are registered, with edits3.js and their cores", () => {
  ["wiki", "feeds", "podcasts", "stock"].forEach((id) => {
    assert.ok(E.APP_IDS.includes(id), id);
    assert.ok(E.LAZY_IDS.includes(id), id);
  });
  assert.equal(E.storageKey("wiki"), "oros-wiki-data");
  assert.equal(E.storageKey("feeds"), "oros-feeds-data");
  assert.equal(E.storageKey("podcasts"), "oros-podcasts-data");
  assert.equal(E.storageKey("stock"), "oros-stock-data");
  assert.deepEqual(E.actionsFor("wiki"), ["update"]);
  assert.deepEqual(E.actionsFor("feeds"), ["complete", "reopen", "update"]);
  assert.deepEqual(E.actionsFor("podcasts"), ["complete", "reopen", "update"]);
  assert.deepEqual(E.actionsFor("stock"), ["update"]);
  assert.equal(E.normArgs({ ref: "r1", action: "update", queue: "later" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", queue: "next" }).set.queue, "next");
});

// ---------- Wiki ----------
function wiki() {
  return WK.merge({ ver: 1, wikis: [{ id: "wabcdef1", m: T0, n: "Home", main: "aabcdef1" }],
    arts: [{ id: "aabcdef1", m: T0, w: "wabcdef1", t: "Garden", x: "Tomatoes like sun.", r: "rabcdef1", anc: [], alt: [], c: T0 }], tombs: {} }, null);
}
test("wiki: text_add is a new revision, a descendant of the old one, plus its history file", () => {
  const d = wiki();
  const r = run("wiki", d, { a: "aabcdef1" }, { action: "update", text_add: "Water in the morning." });
  const a = r.data.arts[0];
  assert.equal(a.x, "Tomatoes like sun.\n\nWater in the morning.");
  assert.notEqual(a.r, "rabcdef1");
  assert.deepEqual(a.anc, ["rabcdef1"]);
  assert.ok(a.m > T0 && a.m >= NOW);
  assert.equal(J(WK.merge(r.data, null)), J(r.data), "canonical");
  // another device that still has the old copy: the merge keeps the new text, no parallel edit
  const m = WK.merge(r.data, d);
  assert.equal(m.arts[0].x, a.x);
  assert.deepEqual(m.arts[0].alt, []);
  assert.ok(r.disk && r.disk.path === WK.revPath(a.id, a.m, a.r));
  const f = JSON.parse(r.disk.text);
  assert.equal(f.p, "rabcdef1");
  assert.equal(f.x, a.x);
  assert.equal(r.plan.title, "Garden");
});
test("wiki: refusals and undo", () => {
  const d = wiki();
  assert.match(run("wiki", d, { a: "aabcdef1" }, { action: "update", text: "Tomatoes like sun." }).err, /Nothing would change/);
  assert.match(run("wiki", d, { a: "azzzzzz1" }, { action: "update", text: "x" }).err, /no longer in Wiki/);
  assert.match(run("wiki", d, { a: "aabcdef1" }, { action: "update", title: "New" }).err, /has no title/);
  const r = run("wiki", d, { a: "aabcdef1" }, { action: "update", text: "All new." });
  const u = E.undo("wiki", r.data, r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.arts[0].x, "Tomatoes like sun.");
  assert.equal(u.data.arts[0].anc[0], r.data.arts[0].r);
  // edited again since: refused
  const r2 = run("wiki", r.data, { a: "aabcdef1" }, { action: "update", text_add: "More." }, NOW + 500);
  assert.equal(E.undo("wiki", r2.data, r.undo, NOW + 1000).ok, false);
});

// ---------- Reader ----------
const FURL = "https://example.com/feed.xml";
const FID = FD.feedId(FURL);
const IID = FD.itemId(FID, "post-1"), IID2 = FD.itemId(FID, "post-2");
function feeds() {
  return FD.merge({ ver: 1, feeds: [{ id: FID, url: FURL, title: "Example", m: T0 }], folders: [], items: [],
    tags: [{ id: "tabcdef1", name: "Work", m: T0 }, { id: "tabcdef2", name: "Ιδέες", m: T0 }], rules: [], set: {},
    read: { old: 0, cut: {}, ids: {} }, tombs: {} }, null);
}
function heads() {
  E3.setCache("feeds", {
    [IID]: { id: IID, feed: FID, title: "First post", link: "https://example.com/1", date: NOW - 86400000, author: "Ann", snip: "Hello" },
    [IID2]: { id: IID2, feed: FID, title: "Second", link: "https://example.com/2", date: NOW - 3600000, author: "", snip: "" }
  });
}
test("feeds: mark read / unread through Reader's own marks", () => {
  heads();
  const d = feeds();
  const r = run("feeds", d, { item: IID, feed: FID }, { action: "complete" });
  assert.equal(FD.isRead(r.data, { id: IID, feed: FID, date: NOW - 86400000 }), true);
  assert.deepEqual(rows(r).read, [false, true]);
  assert.equal(J(FD.merge(r.data, r.data)), J(r.data), "canonical");
  assert.match(run("feeds", r.data, { item: IID, feed: FID }, { action: "complete" }).err, /already read/);
  const r2 = run("feeds", r.data, { item: IID, feed: FID }, { action: "reopen" }, NOW + 10);
  assert.equal(FD.isRead(r2.data, { id: IID, feed: FID, date: NOW - 86400000 }), false);
  const u = E.undo("feeds", r.data, r.undo, NOW + 20);
  assert.equal(u.ok, true, u.err);
  assert.equal(FD.isRead(u.data, { id: IID, feed: FID, date: NOW - 86400000 }), false);
  assert.match(run("feeds", d, { item: "izzzzzzzz", feed: FID }, { action: "complete" }).err, /no longer stored/);
  assert.match(run("feeds", d, { feed: FID }, { action: "complete" }).err, /Only an article/);
});
test("feeds: a tag saves the article as Reader does; taking the last one off removes it with a tombstone", () => {
  heads();
  const d = feeds();
  const r = run("feeds", d, { item: IID, feed: FID }, { action: "update", label: "ιδεες" });
  assert.equal(r.data.items.length, 1);
  const sv = r.data.items[0];
  assert.deepEqual(sv.tags, ["tabcdef2"]);
  assert.equal(sv.title, "First post");
  assert.equal(sv.sum, "Hello");
  assert.deepEqual(rows(r).labels, ["", "Ιδέες"]);
  assert.match(run("feeds", d, { item: IID, feed: FID }, { action: "update", label: "Fun" }).err, /no tag named "Fun".*Work/);
  const r2 = run("feeds", r.data, { item: IID, feed: FID }, { action: "update", labels: [] }, NOW + 10);
  assert.equal(r2.data.items.length, 0);
  assert.ok(r2.data.tombs["i:" + IID] >= NOW + 10);
  // undo of the first: the saved record goes again (tombstone newer than it)
  const u = E.undo("feeds", r.data, r.undo, NOW + 20);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.items.length, 0);
  assert.ok(u.data.tombs["i:" + IID] > sv.m);
  // undo of the second brings the record back, newer than its tombstone
  const u2 = E.undo("feeds", r2.data, r2.undo, NOW + 30);
  assert.equal(u2.ok, true, u2.err);
  assert.deepEqual(u2.data.items[0].tags, ["tabcdef2"]);
  assert.equal(E.undo("feeds", r2.data, r.undo, NOW + 30).ok, false, "changed since");
});

// ---------- Podcasts ----------
const SURL = "https://pod.example.com/rss";
const SID = PC.showId(SURL);
const EID = PC.episodeId(SID, { guid: "g1" }), EID2 = PC.episodeId(SID, { guid: "g2" });
function pods() {
  E3.setCache("podcasts", { [SID]: [{ id: EID, title: "Episode one", pub: T0 }, { id: EID2, title: "Episode two", pub: T0 + 1000 }] });
  return PC.mergePodcasts({ ver: 1, shows: [{ id: SID, m: T0, url: SURL, title: "The show" }], eps: [{ id: EID, m: T0, s: SID, p: 600, d: 1800, x: 0, pd: T0 }],
    floors: {}, queue: { m: T0, ids: [EID2], sh: { [EID2]: SID } }, prefs: {}, tombs: {} }, {});
}
test("podcasts: played and unplayed through setProgress, undo puts the position back", () => {
  const d = pods();
  const r = run("podcasts", d, { show: SID, ep: EID }, { action: "complete" });
  const row = r.data.eps.find((e) => e.id === EID);
  assert.equal(row.x, 1);
  assert.equal(row.p, 0);
  assert.equal(r.plan.title, "Episode one");
  assert.equal(J(PC.mergePodcasts(r.data, r.data)), J(r.data), "canonical");
  assert.match(run("podcasts", r.data, { show: SID, ep: EID }, { action: "complete" }).err, /already played/);
  const u = E.undo("podcasts", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  const back = u.data.eps.find((e) => e.id === EID);
  assert.equal(back.x, 0);
  assert.equal(back.p, 600);
  assert.match(run("podcasts", d, { show: SID }, { action: "complete" }).err, /Only an episode/);
});
test("podcasts: the queue, first or last or out, and undo to the old place", () => {
  const d = pods();
  const r = run("podcasts", d, { show: SID, ep: EID }, { action: "update", queue: "next" });
  assert.deepEqual(r.data.queue.ids, [EID, EID2]);
  assert.deepEqual(rows(r).queue, ["", "1 / 2"]);
  const r2 = run("podcasts", d, { show: SID, ep: EID2 }, { action: "update", queue: "off" });
  assert.deepEqual(r2.data.queue.ids, []);
  assert.match(run("podcasts", r2.data, { show: SID, ep: EID2 }, { action: "update", queue: "off" }, NOW + 5).err, /not in the queue/);
  const u = E.undo("podcasts", r2.data, r2.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.queue.ids, [EID2]);
  const u1 = E.undo("podcasts", r.data, r.undo, NOW + 10);
  assert.deepEqual(u1.data.queue.ids, [EID2]);
});

// ---------- Stock ----------
function stock() {
  return SK.merge({ items: [{ id: "item000001", m: T0, name: "Notebook A5", price: 350, cost: 120, loc: "Shelf 1", note: "" },
    { id: "item000002", m: T0, name: "Old pen", arch: 1 }],
    sups: [{ id: "supp000001", m: T0, name: "Paper Co", tel: "2101234567", email: "a@b.gr" }], tombs: {} }, {}, NOW);
}
test("stock: a product's name, price, location and note; a supplier's phone and e-mail", () => {
  const d = stock();
  const r = run("stock", d, { item: "item000001" }, { action: "update", amount: 4.2, location: "Shelf 2" });
  const it = r.data.items.find((x) => x.id === "item000001");
  assert.equal(it.price, 420);
  assert.equal(it.loc, "Shelf 2");
  assert.equal(it.cost, 120);
  assert.deepEqual(rows(r).price, ["3.50", "4.20"]);
  assert.equal(J(SK.merge(r.data, r.data, NOW)), J(r.data), "canonical");
  const s = run("stock", d, { sup: "supp000001" }, { action: "update", phone: "2109999999" });
  assert.equal(s.data.sups[0].tel, "2109999999");
  assert.match(run("stock", d, { item: "item000001" }, { action: "update", title: "x".repeat(81) }).err, /keeps 80/);
  assert.match(run("stock", d, { item: "item000002" }, { action: "update", title: "Pen" }).err, /archived/);
  assert.match(run("stock", d, { item: "item000001" }, { action: "update", phone: "210" }).err, /has no phone/);
  const u = E.undo("stock", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.items.find((x) => x.id === "item000001").price, 350);
  const r2 = run("stock", r.data, { item: "item000001" }, { action: "update", note: "new" }, NOW + 5);
  assert.equal(E.undo("stock", r2.data, r.undo, NOW + 10).ok, false);
});
