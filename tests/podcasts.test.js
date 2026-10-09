// Pure logic of the Podcasts app (podcasts/core.js): ids, the
// itunes:/podcast: parts of a feed, durations, timestamps, chapters,
// catalog results, the merge of the sync slice "podcasts", the
// mutations, the queue and the position-sync throttle.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "podcasts/core.js")).OrosPodcastsCore;

// ---------- A tiny XML → tree parser for the tests ----------
// The browser uses DOMParser + C.fromDom; this builds the same
// shape ({ns, ln, p, a, c, t}) so the parser can be tested in Node.
function xmlTree(src) {
  src = src.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  const ent = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const stack = [{ c: [], t: "", nsmap: { "": "" } }];
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.t += m[1]; continue; }
    if (m[6] !== undefined) { top.t += ent(m[6]); continue; }
    if (m[2] === "/") { const n = stack.pop(); delete n.nsmap; continue; }
    const attrs = {}, nsmap = Object.assign({}, top.nsmap);
    (m[4] || "").replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (x, k, v1, v2) => {
      const v = ent(v1 !== undefined ? v1 : v2);
      if (k === "xmlns") nsmap[""] = v; else if (k.startsWith("xmlns:")) nsmap[k.slice(6)] = v; else attrs[k.includes(":") ? k.split(":")[1] : k] = v;
    });
    const q = m[3], i = q.indexOf(":"), p = i > 0 ? q.slice(0, i) : "", ln = i > 0 ? q.slice(i + 1) : q;
    const node = { ns: (nsmap[p] || "").toLowerCase(), ln, a: attrs, c: [], t: "", nsmap };
    if (p) node.p = p.toLowerCase();
    top.c.push(node);
    if (m[5] !== "/") stack.push(node); else delete node.nsmap;
  }
  return stack[0].c[0];
}

const FEED_URL = "https://feeds.example.gr/show.xml";
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Ιστορίες &amp; Αφηγήσεις</title>
  <link>https://example.gr/</link>
  <language>EL</language>
  <itunes:author>Μαρία Π.</itunes:author>
  <itunes:image href="https://cdn.example.gr/cover.jpg"/>
  <itunes:category text="History"><itunes:category text="Greek History"/></itunes:category>
  <itunes:explicit>false</itunes:explicit>
  <itunes:type>serial</itunes:type>
  <description><![CDATA[<p>Μια εκπομπή.</p>]]></description>
  <podcast:funding url="https://ko-fi.com/x">Στήριξε</podcast:funding>
  <item>
    <title>Επεισόδιο 2</title>
    <guid isPermaLink="false">ep-2</guid>
    <pubDate>Tue, 06 Oct 2026 08:00:00 +0300</pubDate>
    <enclosure url="https://cdn.example.gr/ep2.mp3" length="12345678" type="audio/mpeg"/>
    <itunes:duration>1:02:03</itunes:duration>
    <itunes:season>1</itunes:season>
    <itunes:episode>2</itunes:episode>
    <content:encoded><![CDATA[<p>Στο 12:34 μιλάμε για Βυζάντιο, στο 1:01:00 κλείνουμε. <script>alert(1)</script></p>]]></content:encoded>
    <podcast:chapters url="https://cdn.example.gr/ep2.json" type="application/json+chapters"/>
    <podcast:transcript url="https://cdn.example.gr/ep2.vtt" type="text/vtt" language="el"/>
  </item>
  <item>
    <title>Επεισόδιο 1</title>
    <guid>ep-1</guid>
    <pubDate>Τρι, 29 Sep 2026 08:00:00 GMT</pubDate>
    <enclosure url="/media/ep1.m4a" length="0" type="audio/x-m4a"/>
    <itunes:duration>2710</itunes:duration>
    <itunes:image href="https://cdn.example.gr/ep1.jpg"/>
    <itunes:episodeType>trailer</itunes:episodeType>
  </item>
  <item>
    <title>Χωρίς ήχο</title>
    <guid>text-only</guid>
  </item>
  <item>
    <title>Διπλό</title>
    <guid>ep-1</guid>
    <enclosure url="https://cdn.example.gr/dup.mp3" type="audio/mpeg"/>
  </item>
  <item>
    <title>Κακό URL</title>
    <enclosure url="javascript:alert(1)" type="audio/mpeg"/>
  </item>
</channel>
</rss>`;

test("ids: same feed on two devices = same id, scoped episode ids", () => {
  const a = C.showId("https://www.Example.gr/feed/"), b = C.showId("http://example.gr/feed");
  assert.equal(a, b);
  assert.match(a, /^s[0-9a-z]{13}$/);
  assert.equal(C.showId("feed://example.gr/feed"), a);
  assert.equal(C.showId("javascript:alert(1)"), "");
  assert.equal(C.showId("https://user:pw@example.gr/feed"), "");
  assert.notEqual(C.showId("https://example.gr/feed?x=1"), a);
  const e1 = C.episodeId(a, { guid: "g" }), e2 = C.episodeId(C.showId("https://other.gr/f"), { guid: "g" });
  assert.match(e1, /^e[0-9a-z]{13}$/);
  assert.notEqual(e1, e2);
  assert.equal(C.episodeId(a, { audio: "https://x/a.mp3" }), C.episodeId(a, { audio: "https://x/a.mp3" }));
});

test("Apple Podcasts links → lookup URL", () => {
  assert.equal(C.appleId("https://podcasts.apple.com/gr/podcast/some-name/id1234567890"), "1234567890");
  assert.equal(C.appleId("https://podcasts.apple.com/us/podcast/x/id42?i=1000"), "");
  assert.equal(C.appleId("https://podcasts.apple.com/us/podcast/x/id4242?i=1000"), "4242");
  assert.equal(C.appleId("https://itunes.apple.com/podcast/id5555"), "5555");
  assert.equal(C.appleId("https://evil.com/podcasts.apple.com/id5555"), "");
  assert.equal(C.appleLookupUrl("5555"), "https://itunes.apple.com/lookup?entity=podcast&id=5555");
  assert.equal(C.appleLookupUrl("55&x=1"), "");
});

test("feed: show and episodes from an RSS document", () => {
  const f = C.parseFeed(xmlTree(RSS), FEED_URL);
  assert.equal(f.show.title, "Ιστορίες & Αφηγήσεις");
  assert.equal(f.show.by, "Μαρία Π.");
  assert.equal(f.show.img, "https://cdn.example.gr/cover.jpg");
  assert.equal(f.show.lang, "el");
  assert.deepEqual(f.show.cats, ["History", "Greek History"]);
  assert.equal(f.show.serial, true);
  assert.equal(f.show.explicit, false);
  assert.equal(f.show.funding[0].url, "https://ko-fi.com/x");
  assert.equal(f.show.id, C.showId(FEED_URL));
  assert.equal(f.eps.length, 2, "no audio, duplicate guid and javascript: enclosure are dropped");
  const [e2, e1] = f.eps;
  assert.equal(e2.title, "Επεισόδιο 2");
  assert.equal(e2.dur, 3723);
  assert.equal(e2.size, 12345678);
  assert.equal(e2.season, 1);
  assert.equal(e2.num, 2);
  assert.equal(e2.pub, Date.UTC(2026, 9, 6, 5, 0, 0));
  assert.equal(e2.img, "https://cdn.example.gr/cover.jpg", "falls back to the show cover");
  assert.equal(e2.chapters, "https://cdn.example.gr/ep2.json");
  assert.deepEqual(e2.transcripts, [{ url: "https://cdn.example.gr/ep2.vtt", type: "text/vtt", lang: "el" }]);
  assert.ok(e2.notes.includes("<script>"), "notes stay raw: the sanitizer runs at display time");
  assert.equal(e1.audio, "https://feeds.example.gr/media/ep1.m4a", "relative enclosure resolved against the feed");
  assert.equal(e1.pub, Date.UTC(2026, 8, 29, 8, 0, 0), "Greek day name still parses");
  assert.equal(e1.kind, "trailer");
  assert.equal(e1.img, "https://cdn.example.gr/ep1.jpg");
  assert.equal(e1.id, C.episodeId(f.show.id, { guid: "ep-1" }));
});

test("feed: undeclared or misspelt itunes namespace, new-feed-url, Atom", () => {
  const bad = `<rss><channel><title>T</title><itunes:author>A</itunes:author>
    <itunes:new-feed-url>https://new.example.com/feed</itunes:new-feed-url>
    <item><title>x</title><enclosure url="https://h/x.mp3"/><itunes:duration>45:10</itunes:duration></item></channel></rss>`;
  const f = C.parseFeed(xmlTree(bad), "https://old.example.com/feed");
  assert.equal(f.show.by, "A");
  assert.equal(f.show.newUrl, "https://new.example.com/feed");
  assert.equal(f.eps[0].dur, 2710);
  assert.equal(f.eps[0].type, "");
  const same = C.parseFeed(xmlTree(bad), "https://new.example.com/feed/");
  assert.equal(same.show.newUrl, "", "pointing to itself is not a move");
  const caps = `<rss xmlns:itunes="http://www.itunes.com/DTDs/Podcast-1.0.dtd" xmlns:i2="http://www.itunes.com/DTDs/Podcast-1.0.dtd"><channel><title>T</title><i2:author>B</i2:author></channel></rss>`;
  assert.equal(C.parseFeed(xmlTree(caps), FEED_URL).show.by, "B");
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom show</title>
    <entry><title>E</title><id>urn:1</id><published>2026-10-01T10:00:00Z</published>
    <link rel="enclosure" href="https://h/e.mp3" type="audio/mpeg" length="10"/></entry></feed>`;
  const a = C.parseFeed(xmlTree(atom), FEED_URL);
  assert.equal(a.show.title, "Atom show");
  assert.equal(a.eps.length, 1);
  assert.equal(a.eps[0].audio, "https://h/e.mp3");
  assert.equal(a.eps[0].pub, Date.UTC(2026, 9, 1, 10));
  assert.equal(C.parseFeed(xmlTree("<html><body/></html>"), FEED_URL), null);
});

test("video enclosure: audio preferred when both exist", () => {
  const x = `<rss><channel><title>T</title><item><title>v</title>
    <enclosure url="https://h/v.mp4" type="video/mp4"/><enclosure url="https://h/a.mp3" type="audio/mpeg"/></item>
    <item><title>w</title><enclosure url="https://h/w.mp4" type="video/mp4"/></item></channel></rss>`;
  const f = C.parseFeed(xmlTree(x), FEED_URL);
  const byTitle = Object.fromEntries(f.eps.map((e) => [e.title, e]));
  assert.equal(byTitle.v.audio, "https://h/a.mp3");
  assert.equal(byTitle.w.video, true);
});

test("durations, time format, timestamps in notes", () => {
  assert.equal(C.parseDuration("3723"), 3723);
  assert.equal(C.parseDuration("3723.6"), 3724);
  assert.equal(C.parseDuration("62:03"), 3723);
  assert.equal(C.parseDuration("01:02:03"), 3723);
  assert.equal(C.parseDuration("1:02:03.5"), 3724);
  assert.equal(C.parseDuration("1h 2m 3s"), 3723);
  assert.equal(C.parseDuration("45 min"), 2700);
  assert.equal(C.parseDuration(""), 0);
  assert.equal(C.parseDuration("soon"), 0);
  assert.equal(C.parseDuration("1:99:00"), 0);
  assert.equal(C.fmtTime(3723), "1:02:03");
  assert.equal(C.fmtTime(65), "1:05");
  assert.equal(C.fmtTime(-3), "0:00");
  const st = C.noteStamps("Intro 0:00, guest at 12:34 and 1:01:00; again 12:34; time 10:30am is 10:30; v1.2:33 no; 2:00:00", 3723);
  assert.deepEqual(st.map((s) => s.at), [0, 754, 3660, 630]);
});

test("chapters (Podcasting 2.0 JSON)", () => {
  const ch = C.normChapters({ version: "1.2.0", chapters: [
    { startTime: 120.5, title: "Two", url: "https://x.gr/2", img: "javascript:x" },
    { startTime: 0, title: "" },
    { startTime: -1, title: "bad" },
    { startTime: 300, title: "hidden", toc: false },
    "junk"
  ] }, "https://x.gr/c.json");
  assert.deepEqual(ch, [
    { at: 0, title: "0:00", img: "", url: "" },
    { at: 120, title: "Two", img: "", url: "https://x.gr/2" }
  ]);
  assert.equal(C.chapterAt(ch, 119).title, "0:00");
  assert.equal(C.chapterAt(ch, 500).title, "Two");
  assert.equal(C.chapterAt([], 5), null);
  assert.deepEqual(C.normChapters(null), []);
});

test("catalog: Apple and fyyd results, one row per feed", () => {
  assert.match(C.appleSearchUrl("ιστορία", "gr"), /term=%CE%B9/);
  assert.equal(C.appleSearchUrl("  "), "");
  assert.ok(C.appleSearchUrl("x", "gr&a=1").indexOf("country") < 0);
  const ap = C.parseAppleResults({ results: [
    { collectionName: "A", artistName: "X", feedUrl: "https://a.gr/feed", artworkUrl600: "https://a.gr/a.jpg", primaryGenreName: "History", trackCount: 12 },
    { collectionName: "No feed" },
    { collectionName: "Bad", feedUrl: "javascript:1" }
  ] });
  assert.equal(ap.length, 1);
  assert.equal(ap[0].id, C.showId("https://a.gr/feed"));
  assert.equal(ap[0].count, 12);
  const fy = C.parseFyydResults({ data: [{ title: "A again", xmlURL: "http://www.a.gr/feed/", imgURL: "https://i" },
    { title: "B", author: "Y", xmlURL: "https://b.gr/rss", episode_count: 3 }] });
  const all = C.mergeResults([ap, fy]);
  assert.deepEqual(all.map((h) => h.title), ["A", "B"]);
  assert.deepEqual(C.parseAppleResults("nope"), []);
});

test("plain text of notes: tags and scripts out, entities decoded", () => {
  assert.equal(C.plain("<p>Γεια &amp; χαρά<script>x()</script></p><p>δύο&nbsp;&#8230;</p>"), "Γεια & χαρά\nδύο …");
  assert.equal(C.plain("<b>" + "x".repeat(50) + "</b>", 10), "xxxxxxxxxx…");
  assert.equal(C.decodeEntities("&#x1F600;&#0;&bogus;"), "😀&bogus;");
});

// ---------- Data model + merge ----------
const S1 = C.showId("https://a.gr/feed"), S2 = C.showId("https://b.gr/feed");
const E1 = C.episodeId(S1, { guid: "1" }), E2 = C.episodeId(S1, { guid: "2" }), E3 = C.episodeId(S2, { guid: "3" });
function show(id, url, m, over) { return Object.assign({ id, m, url, title: "T " + url, by: "", img: "", at: m }, over || {}); }
function ep(id, s, m, p, d, x, pd) { return { id, m, s, p, d, x, pd }; }
function data(shows, eps, over) { return Object.assign(C.emptyData(), { shows: shows || [], eps: eps || [] }, over || {}); }
const J = JSON.stringify;

test("merge: symmetric, canonical, idempotent (R5, R26)", () => {
  const A = data([show(S1, "https://a.gr/feed", 10), show(S2, "https://b.gr/feed", 5)],
    [ep(E1, S1, 20, 100, 3600, 0, 1000), ep(E3, S2, 7, 50, 0, 0, 0)],
    { prefs: { spd: [1.5, 3], back: [10, 9] }, queue: { m: 4, ids: [E1, E3], sh: { [E1]: S1, [E3]: S2 } } });
  const B = data([show(S1, "https://a.gr/feed", 11, { spd: 1.25 })],
    [ep(E1, S1, 25, 200, 3600, 0, 1000), ep(E2, S1, 3, 0, 0, 1, 900)],
    { prefs: { spd: [2, 4] }, queue: { m: 6, ids: [E2], sh: { [E2]: S1 } }, floors: { [S1]: 500 } });
  const ab = C.mergePodcasts(A, B), ba = C.mergePodcasts(B, A);
  assert.equal(J(ab), J(ba));
  assert.equal(J(C.mergePodcasts(ab, ab)), J(ab));
  assert.equal(J(C.mergePodcasts(ab, A)), J(ab), "merging an older copy changes nothing");
  assert.equal(ab.shows.find((s) => s.id === S1).spd, 1.25);
  assert.equal(ab.eps.find((e) => e.id === E1).p, 200);
  assert.deepEqual(ab.prefs, { back: [10, 9], spd: [2, 4] });
  assert.deepEqual(ab.queue.ids, [E2]);
  assert.deepEqual(ab.shows.map((s) => s.id), [S1, S2].sort());
  // Equal mtimes: the larger JSON wins, whichever side it is on.
  const X = data([show(S1, "https://a.gr/feed", 10, { title: "aaa" })]), Y = data([show(S1, "https://a.gr/feed", 10, { title: "zzz" })]);
  assert.equal(J(C.mergePodcasts(X, Y)), J(C.mergePodcasts(Y, X)));
  assert.equal(C.mergePodcasts(X, Y).shows[0].title, "zzz");
});

test("merge: junk is dropped, ids must match the URL", () => {
  const m = C.mergePodcasts({ shows: [show(S1, "https://other.gr/feed", 1), { id: "x" }, null, show(S2, "javascript:1", 1)],
    eps: [ep("bad", S1, 1, 0, 0, 0, 0), ep(E1, "s0", 1, 0, 0, 0, 0)], tombs: { junk: 5, [S1]: -1 }, floors: { [S1]: "x" },
    queue: { m: 1, ids: ["bad", E1, E1] }, prefs: { spd: [9, 1], back: [3, 1], search: ["none", 2], zzz: [1, 1] } }, null);
  assert.equal(J(m), J(Object.assign(C.emptyData(), { queue: { m: 1, ids: [E1], sh: {} }, prefs: { search: ["none", 2] } })));
});

test("merge: unsubscribe tombstones, delete wins ties, newer resubscribe resurrects (R17)", () => {
  const base = data([show(S1, "https://a.gr/feed", 10)], [ep(E1, S1, 12, 30, 0, 0, 0)],
    { queue: { m: 12, ids: [E1, E3], sh: { [E1]: S1, [E3]: S2 } } });
  const del = data([], [], { tombs: { [S1]: 10 } });
  const m = C.mergePodcasts(base, del);
  assert.equal(m.shows.length, 0);
  assert.equal(m.eps.length, 0, "progress of a removed show goes with it");
  assert.deepEqual(m.queue.ids, [], "queue entries of a removed (or never subscribed) show go too");
  const re = data([show(S1, "https://a.gr/feed", 11)]);
  assert.equal(C.mergePodcasts(del, re).shows.length, 1);
  assert.equal(J(C.mergePodcasts(del, re)), J(C.mergePodcasts(re, del)));
});

test("merge: played rows under the floor are implied", () => {
  const d = data([show(S1, "https://a.gr/feed", 1)],
    [ep(E1, S1, 5, 0, 100, 1, 900), ep(E2, S1, 6, 40, 100, 0, 900), ep(E3, S2, 1, 0, 0, 0, 0)], { floors: { [S1]: 1000, [S2]: 3 } });
  const m = C.mergePodcasts(d, d);
  assert.deepEqual(m.eps.map((e) => e.id), [E2], "played under floor implied; partial kept; orphan show dropped");
  assert.deepEqual(m.floors, { [S1]: 1000 });
  assert.equal(C.stateOf(m, { id: E1, s: S1, pd: 900 }).x, 1);
  assert.equal(C.stateOf(m, { id: E2, s: S1, pd: 900 }).p, 40);
  assert.equal(C.stateOf(m, { id: E3, s: S1, pd: 2000 }).x, 0);
});

test("mutations: subscribe, edit, progress only move m on a real change (R27)", () => {
  let d = C.subscribe(C.emptyData(), { url: "https://a.gr/feed", title: "A", img: "https://a.gr/i.jpg" }, 100);
  assert.equal(d.shows.length, 1);
  assert.equal(C.subscribe(d, { url: "http://www.a.gr/feed/" }, 200), d, "already subscribed");
  assert.equal(C.editShow(d, S1, { title: "A" }, 300), d, "no change, same object");
  d = C.editShow(d, S1, { title: "A2", spd: 1.5, url: "https://evil.gr/feed" }, 300);
  assert.equal(d.shows[0].m, 300);
  assert.equal(d.shows[0].url, "https://a.gr/feed", "URL never changes through editShow");
  const e = { id: E1, s: S1, pd: 1000 };
  d = C.setProgress(d, e, 120.7, 3600, undefined, 400);
  assert.deepEqual(C.stateOf(d, e), { p: 120, d: 3600, x: 0 });
  assert.equal(C.setProgress(d, e, 120.2, 0, undefined, 500), d, "same second, unknown duration: nothing changes");
  d = C.setProgress(d, e, 3500, 0, undefined, 600);
  assert.equal(C.stateOf(d, e).x, 1, "95% counts as played");
  d = C.setProgress(d, e, 3500, 0, 1, 650);
  assert.equal(C.stateOf(d, e).p, 0, "explicitly finished starts over");
  d = C.setProgress(d, e, 0, 0, 0, 700);
  assert.equal(C.stateOf(d, e).x, 0, "mark unplayed");
  assert.equal(J(C.mergePodcasts(d, d)), J(d));
});

test("mutations: unsubscribe, mark all played, compaction", () => {
  const now = Date.UTC(2026, 9, 9);
  let d = C.subscribe(C.emptyData(), { url: "https://a.gr/feed" }, 1);
  const feed = [1, 2, 3, 4].map((i) => ({ id: C.episodeId(S1, { guid: String(i) }), s: S1, pd: now - (100 - i * 20) * 86400000 }));
  // feed[0..3] published 80, 60, 40, 20 days ago.
  d = C.setProgress(d, feed[0], 10, 100, 1, 2);
  d = C.setProgress(d, feed[1], 10, 100, 1, 3);
  d = C.setProgress(d, feed[2], 50, 100, undefined, 4);
  d = C.setProgress(d, feed[3], 10, 100, 1, 5);
  const c = C.compactShow(d, S1, feed, now);
  assert.equal(c.floors[S1], feed[1].pd, "floor stops at the first unfinished episode");
  assert.deepEqual(c.eps.map((e) => e.id).sort(), [feed[2].id, feed[3].id].sort());
  assert.equal(C.compactShow(c, S1, feed, now), c, "nothing more to do");
  const all = C.markAllPlayed(c, S1, feed, 6);
  assert.equal(all.floors[S1], feed[3].pd);
  assert.equal(all.eps.length, 0);
  feed.forEach((e) => assert.equal(C.stateOf(all, e).x, 1));
  const gone = C.unsubscribe(all, S1, 7);
  assert.deepEqual(gone.shows, []);
  assert.deepEqual(gone.floors, {});
  assert.equal(gone.tombs[S1], 7);
  assert.equal(C.unsubscribe(gone, S1, 8), gone);
});

test("moveShow (itunes:new-feed-url): progress and queue follow the new id", () => {
  const NEW = "https://new.gr/feed", N1 = C.showId(NEW);
  let d = C.subscribe(C.emptyData(), { url: "https://a.gr/feed", title: "A" }, 1);
  const e = { id: E1, s: S1, pd: 10 };
  d = C.setProgress(d, e, 300, 1000, undefined, 2);
  d = C.queueAdd(d, e, "end", 3);
  const NE1 = C.episodeId(N1, { guid: "1" });
  const m = C.moveShow(d, S1, NEW, { [E1]: NE1 }, 4);
  assert.deepEqual(m.shows.map((s) => s.id), [N1]);
  assert.equal(m.shows[0].title, "A");
  assert.equal(C.stateOf(m, { id: NE1, s: N1, pd: 10 }).p, 300);
  assert.deepEqual(m.queue.ids, [NE1]);
  assert.equal(m.queue.sh[NE1], N1);
  assert.equal(m.tombs[S1], 4);
  assert.equal(C.moveShow(d, S1, "https://a.gr/feed/", {}, 5), d, "same feed is not a move");
});

test("queue: add next/last, move, remove, next after the end", () => {
  let d = C.subscribe(C.emptyData(), { url: "https://a.gr/feed" }, 1);
  const a = { id: E1, s: S1 }, b = { id: E2, s: S1 };
  d = C.queueAdd(d, a, "end", 2);
  d = C.queueAdd(d, b, "next", 3);
  assert.deepEqual(d.queue.ids, [E2, E1]);
  assert.equal(d.queue.m, 3);
  d = C.queueMove(d, E2, 5, 4);
  assert.deepEqual(d.queue.ids, [E1, E2]);
  assert.equal(C.queueMove(d, E2, 1, 5), d, "already there");
  assert.equal(C.queueNext(d, E1), E2);
  d = C.queueRemove(d, E1, 6);
  assert.deepEqual(d.queue.ids, [E2]);
  assert.deepEqual(Object.keys(d.queue.sh), [E2]);
  assert.equal(C.queueRemove(d, E1, 7), d);
});

test("prefs: validated, LWW per field, defaults", () => {
  let d = C.emptyData();
  assert.equal(C.prefOf(d, "fwd"), 30);
  d = C.setPref(d, "fwd", 45, 10);
  assert.equal(C.prefOf(d, "fwd"), 45);
  assert.equal(C.setPref(d, "fwd", 45, 11), d);
  assert.equal(C.setPref(d, "fwd", 1000, 12), d);
  assert.equal(C.setPref(d, "search", "evil", 12), d);
  d = C.setPref(d, "search", "none", 13);
  assert.equal(C.prefOf(d, "search"), "none");
});

test("position sync throttle: no endless uploads", () => {
  const last = { p: 100, at: 1000 };
  assert.equal(C.shouldCommit("tick", 150, last, 1100), false, "playing, < 5 min since last commit");
  assert.equal(C.shouldCommit("tick", 400, last, 1300), true);
  assert.equal(C.shouldCommit("tick", 105, last, 5000), false, "barely moved (paused elsewhere)");
  assert.equal(C.shouldCommit("pause", 105, last, 1010), false);
  assert.equal(C.shouldCommit("pause", 130, last, 1010), true);
  assert.equal(C.shouldCommit("close", 130, last, 1010), true);
  assert.equal(C.shouldCommit("seek", 900, last, 1010), false);
  assert.equal(C.shouldCommit("ended", 100, last, 1001), true);
  assert.equal(C.shouldCommit("pause", 5, null, 1), true);
  // An hour of listening with a tick every 5 s → at most 12 commits.
  let n = 0, l = null;
  for (let t = 0; t <= 3600; t += 5) if (C.shouldCommit("tick", t, l, t)) { n++; l = { p: t, at: t }; }
  assert.ok(n <= 13, "commits: " + n);
});

test("views: new episodes, in progress, filters, show search", () => {
  const now = Date.UTC(2026, 9, 9);
  let d = C.subscribe(C.emptyData(), { url: "https://a.gr/feed", title: "Ιστορίες", by: "Μαρία" }, now - 10 * 86400000);
  const cache = { [S1]: [
    { id: E1, pub: now - 1 * 86400000 }, { id: E2, pub: now - 2 * 86400000 },
    { id: C.episodeId(S1, { guid: "old" }), pub: now - 300 * 86400000 }
  ] };
  d = C.setProgress(d, { id: E2, s: S1, pd: cache[S1][1].pub }, 60, 600, undefined, now);
  assert.deepEqual(C.newEpisodes(d, cache, now).map((x) => x.ep.id), [E1]);
  assert.deepEqual(C.inProgress(d).map((e) => e.id), [E2]);
  assert.equal(C.filterEpisodes(d, S1, cache[S1], "unplayed").length, 3);
  assert.equal(C.filterEpisodes(d, S1, cache[S1], "progress").length, 1);
  assert.equal(C.searchShows(d.shows, "ιστοριες").length, 1, "accent-insensitive");
  assert.equal(C.searchShows(d.shows, "μαρια").length, 1);
  assert.equal(C.searchShows(d.shows, "zzz").length, 0);
});
