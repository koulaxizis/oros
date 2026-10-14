// Podcasts wave 42: gpodder API v2 sync logic (podcasts/gpodder.js):
// config + addresses, wire formats, the subscriptions plan and the
// episode actions both ways.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "podcasts/core.js")).OrosPodcastsCore;
globalThis.OrosPodcastsCore = C;
const G = require(path.join(__dirname, "..", "podcasts/gpodder.js"));

test("config: servers, kinds, device names, defaults", () => {
  assert.equal(G.normServer("gpodder.net"), "https://gpodder.net");
  assert.equal(G.normServer("https://cloud.example.com/nextcloud/"), "https://cloud.example.com/nextcloud");
  assert.equal(G.normServer("https://cloud.example.com/index.php"), "https://cloud.example.com");
  assert.equal(G.normServer("http://cloud.example.com"), "", "plain http only for this machine");
  assert.equal(G.normServer("http://localhost:8080"), "http://localhost:8080");
  assert.equal(G.normServer("https://u:p@x.example"), "", "no credentials in the address");
  assert.equal(G.normServer("javascript:alert(1)"), "");
  const c = G.normConfig({ kind: "x", user: "  anna ", device: "My Laptop!", known: ["https://a.example/f", "bad", "https://a.example/f"] });
  assert.equal(c.kind, "gpodder");
  assert.equal(c.server, "https://gpodder.net");
  assert.equal(c.user, "anna");
  assert.equal(c.device, "mylaptop");
  assert.deepEqual(c.known, ["https://a.example/f"]);
  assert.equal(G.normConfig({ kind: "nextcloud" }).server, "", "Nextcloud has no default server");
  assert.equal(G.ready(c), true);
  assert.equal(G.ready(G.normConfig({ kind: "nextcloud", user: "a" })), false);
});

test("addresses: gpodder.net API v2 and Nextcloud GPodder Sync", () => {
  const g = G.urls(G.normConfig({ user: "anna maria", device: "oros-1" }));
  assert.equal(g.subsGet(12), "https://gpodder.net/api/2/subscriptions/anna%20maria/oros-1.json?since=12");
  assert.equal(g.subsPost, "https://gpodder.net/api/2/subscriptions/anna%20maria/oros-1.json");
  assert.equal(g.actGet(0), "https://gpodder.net/api/2/episodes/anna%20maria.json?since=0");
  assert.equal(g.actPost, "https://gpodder.net/api/2/episodes/anna%20maria.json");
  assert.equal(g.device, "https://gpodder.net/api/2/devices/anna%20maria/oros-1.json");
  const n = G.urls(G.normConfig({ kind: "nextcloud", server: "https://c.example/nc", user: "a" }));
  assert.equal(n.subsGet(5), "https://c.example/nc/index.php/apps/gpoddersync/subscriptions?since=5");
  assert.equal(n.subsPost, "https://c.example/nc/index.php/apps/gpoddersync/subscription_change/create");
  assert.equal(n.actGet(5), "https://c.example/nc/index.php/apps/gpoddersync/episode_action?since=5");
  assert.equal(n.actPost, "https://c.example/nc/index.php/apps/gpoddersync/episode_action/create");
  assert.equal(n.device, "");
});

test("basic auth is UTF-8", () => {
  assert.equal(G.basicAuth("user", "pass"), "Basic " + Buffer.from("user:pass").toString("base64"));
  assert.equal(G.basicAuth("άννα", "κωδικός€😀"), "Basic " + Buffer.from("άννα:κωδικός€😀", "utf8").toString("base64"));
  assert.equal(G.basicAuth("a", ""), "Basic " + Buffer.from("a:").toString("base64"));
});

test("timestamps: gpodder's zone-less UTC both ways", () => {
  const ms = Date.UTC(2026, 9, 14, 8, 30, 5, 999);
  assert.equal(G.isoTime(ms), "2026-10-14T08:30:05");
  assert.equal(G.parseTime("2026-10-14T08:30:05"), Date.UTC(2026, 9, 14, 8, 30, 5));
  assert.equal(G.parseTime("2026-10-14T10:30:05+02:00"), Date.UTC(2026, 9, 14, 8, 30, 5));
  assert.equal(G.parseTime("2026-10-14T08:30"), Date.UTC(2026, 9, 14, 8, 30));
  assert.equal(G.parseTime(1760430605), 1760430605000, "seconds");
  assert.equal(G.parseTime("yesterday"), 0);
});

test("wire formats: subscriptions and actions are cleaned", () => {
  assert.deepEqual(G.parseSubs({ add: ["https://a.example/f", "javascript:x", 5], remove: [" https://b.example/f "], timestamp: 17 }),
    { add: ["https://a.example/f"], remove: ["https://b.example/f"], ts: 17 });
  assert.equal(G.parseSubs([1]), null);
  const r = G.parseActions({ timestamp: 9, actions: [
    { podcast: "https://a.example/f", episode: "https://a.example/1.mp3", action: "PLAY", timestamp: "2026-10-14T08:00:00", started: 0, position: 120, total: 600, guid: "g1" },
    { podcast: "https://a.example/f", episode: "https://a.example/2.mp3", action: "play" },
    { podcast: "https://a.example/f", episode: "https://a.example/3.mp3", action: "dance" },
    { podcast: "ftp://a.example/f", episode: "https://a.example/4.mp3", action: "new" },
    { podcast: "https://a.example/f", episode: "https://a.example/5.mp3", action: "new", timestamp: "2026-10-14T09:00:00" }
  ] });
  assert.equal(r.ts, 9);
  assert.deepEqual(r.actions.map((a) => a.action), ["play", "new"]);
  assert.deepEqual(r.actions[0], { podcast: "https://a.example/f", episode: "https://a.example/1.mp3", guid: "g1", action: "play",
    t: Date.UTC(2026, 9, 14, 8), pos: 120, total: 600, started: 0 });
  assert.deepEqual(G.parseActions([]).actions, [], "a bare array (an exported file)");
  assert.equal(G.parseActions({}), null);
});

const show = (url, m) => ({ id: C.showId(url), m: m || 1, url, title: url });

test("subscriptions plan: first sync is a union", () => {
  const p = G.subsPlan([show("https://a.example/f"), show("https://b.example/f")], [],
    { add: ["https://b.example/f", "https://c.example/f"], remove: [], ts: 5 });
  assert.deepEqual(p.sub, ["https://c.example/f"]);
  assert.deepEqual(p.unsub, []);
  assert.deepEqual(p.upAdd, ["https://a.example/f"]);
  assert.deepEqual(p.upRemove, []);
  assert.deepEqual(p.known.sort(), ["https://a.example/f", "https://b.example/f", "https://c.example/f"]);
});

test("subscriptions plan: later syncs send local changes and take remote ones", () => {
  const known = ["https://a.example/f", "https://b.example/f", "https://c.example/f"];
  // Here: c removed, d added. There: b removed, e added.
  const local = [show("https://a.example/f"), show("https://b.example/f"), show("https://d.example/f")];
  const p = G.subsPlan(local, known, { add: ["https://e.example/f"], remove: ["https://b.example/f"], ts: 9 });
  assert.deepEqual(p.sub, ["https://e.example/f"]);
  assert.deepEqual(p.unsub, [C.showId("https://b.example/f")]);
  assert.deepEqual(p.upAdd, ["https://d.example/f"]);
  assert.deepEqual(p.upRemove, ["https://c.example/f"]);
  assert.deepEqual(p.known.sort(), ["https://a.example/f", "https://d.example/f", "https://e.example/f"]);
});

test("subscriptions plan: adding wins; http/https and www count as the same feed", () => {
  // Added here since the last sync, removed there: kept, sent as an add.
  const p = G.subsPlan([show("https://new.example/f")], [], { add: [], remove: ["https://new.example/f"], ts: 1 });
  assert.deepEqual(p.unsub, []);
  assert.deepEqual(p.upAdd, ["https://new.example/f"]);
  // Removed here, added again there: subscribed again, nothing sent.
  const q = G.subsPlan([], ["https://x.example/f"], { add: ["https://x.example/f"], remove: [], ts: 1 });
  assert.deepEqual(q.sub, ["https://x.example/f"]);
  assert.deepEqual(q.upRemove, []);
  // The same feed spelt differently is not a change.
  const r = G.subsPlan([show("https://www.same.example/f/")], ["http://same.example/f"], { add: ["http://same.example/f"], remove: [], ts: 1 });
  assert.deepEqual([r.sub, r.unsub, r.upAdd, r.upRemove], [[], [], [], []]);
});

const FEED = "https://a.example/feed";
const SID = C.showId(FEED);
const eps = [
  { id: C.episodeId(SID, { guid: "g1" }), guid: "g1", audio: "https://a.example/1.mp3", pub: 1000, dur: 600 },
  { id: C.episodeId(SID, { audio: "https://a.example/2.mp3" }), guid: "", audio: "https://a.example/2.mp3", pub: 2000, dur: 0 }
];
const find = (a) => {
  if (C.showId(a.podcast) !== SID) return null;
  const e = G.matchEpisode(SID, a, eps);
  return e ? { id: e.id, s: SID, pd: e.pub, dur: e.dur } : null;
};
const base = () => C.subscribe(C.emptyData(), { url: FEED, title: "A" }, 1);

test("matching: enclosure address, else guid", () => {
  assert.equal(G.matchEpisode(SID, { episode: "https://a.example/2.mp3" }, eps), eps[1]);
  assert.equal(G.matchEpisode(SID, { episode: "https://cdn.example/moved.mp3", guid: "g1" }, eps), eps[0]);
  assert.equal(G.matchEpisode(SID, { episode: "https://cdn.example/x.mp3", guid: "nope" }, eps), null);
});

test("remote actions: newest per episode, only when newer, take the action's time", () => {
  const t1 = Date.UTC(2026, 9, 1), t2 = Date.UTC(2026, 9, 2), now = Date.UTC(2026, 9, 14);
  const acts = G.parseActions({ actions: [
    { podcast: FEED, episode: "https://a.example/1.mp3", action: "play", position: 100, total: 600, started: 0, timestamp: G.isoTime(t1) },
    { podcast: FEED, episode: "https://a.example/1.mp3", action: "play", position: 590, total: 600, started: 0, timestamp: G.isoTime(t2) },
    { podcast: FEED, episode: "https://a.example/2.mp3", action: "play", position: 42, timestamp: G.isoTime(t2) },
    { podcast: "https://other.example/f", episode: "https://other.example/1.mp3", action: "play", position: 5, timestamp: G.isoTime(t2) },
    { podcast: FEED, episode: "https://a.example/1.mp3", action: "download", timestamp: G.isoTime(now) }
  ] }).actions;
  const r = G.applyActions(base(), acts, find, now);
  assert.equal(r.n, 2);
  const e1 = r.data.eps.find((e) => e.id === eps[0].id), e2 = r.data.eps.find((e) => e.id === eps[1].id);
  assert.deepEqual([e1.x, e1.p, e1.d, e1.m], [1, 0, 600, t2], "98% heard = played");
  assert.deepEqual([e2.x, e2.p, e2.m], [0, 42, t2]);
  // Again: nothing newer, nothing changes.
  assert.equal(G.applyActions(r.data, acts, find, now).n, 0);
  // A local row newer than the action wins.
  let d = C.setProgress(base(), { id: eps[1].id, s: SID, pd: 2000 }, 300, 0, undefined, t2 + 1);
  assert.equal(G.applyActions(d, acts, find, now).data.eps.find((e) => e.id === eps[1].id).p, 300);
  // "new" marks unplayed; a future time is clamped to now.
  d = C.setProgress(base(), { id: eps[0].id, s: SID, pd: 1000 }, 0, 600, 1, t1);
  const nw = G.parseActions([{ podcast: FEED, episode: "https://a.example/1.mp3", action: "new", timestamp: G.isoTime(now + 86400000) }]).actions;
  const r2 = G.applyActions(d, nw, find, now);
  const row = r2.data.eps.find((e) => e.id === eps[0].id);
  assert.deepEqual([row.x, row.p, row.m], [0, 0, now]);
});

test("outgoing actions: rows changed after the mark, gpodder's play/new shape", () => {
  const t0 = Date.UTC(2026, 9, 1), t1 = Date.UTC(2026, 9, 3);
  let d = base();
  d = C.setProgress(d, { id: eps[0].id, s: SID, pd: 1000 }, 0, 600, 1, t1);       // played
  d = C.setProgress(d, { id: eps[1].id, s: SID, pd: 2000 }, 75, 0, undefined, t1);   // in progress, length unknown
  const ghost = "e" + "z".repeat(12);
  d = C.setProgress(d, { id: ghost, s: SID, pd: 1 }, 5, 10, undefined, t1);         // not in the cache
  const info = (id) => { const e = eps.find((x) => x.id === id); return e ? { feed: FEED, audio: e.audio, guid: e.guid, dur: e.dur } : null; };
  const up = G.actionsUp(d, info, t0, "oros-1", null);
  assert.deepEqual(up, [
    { podcast: FEED, episode: "https://a.example/1.mp3", action: "play", timestamp: G.isoTime(t1), device: "oros-1", guid: "g1", started: 0, position: 600, total: 600 },
    { podcast: FEED, episode: "https://a.example/2.mp3", action: "play", timestamp: G.isoTime(t1), device: "oros-1", position: 75 }
  ]);
  assert.deepEqual(G.actionsUp(d, info, t1, "", null), [], "nothing after the mark");
  assert.equal(G.actionsUp(d, info, t0, "", { [eps[0].id]: 1 }).length, 1, "skipped: the other side was newer");
  d = C.setProgress(d, { id: eps[1].id, s: SID, pd: 2000 }, 0, 0, 0, t1 + 1);
  assert.equal(G.actionsUp(d, info, t1, "", null)[0].action, "new");
  // Sent actions read back as the same state (round trip).
  const back = G.parseActions(up).actions;
  const r = G.applyActions(base(), back, find, Date.UTC(2026, 9, 14));
  assert.equal(r.n, 2);
  assert.deepEqual(G.chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
