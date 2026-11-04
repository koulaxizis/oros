// Artists worldwide in Music (music/artists.js, wave 6a): request
// addresses, the parsers for MusicBrainz, Wikidata and Wikipedia
// answers (shapes copied from their public APIs), which songs count
// as the artist's, track matching, and followed artists in the sync
// slice "music" (core.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;
const A = require(path.join(__dirname, "..", "music/artists.js"));
const O = require(path.join(__dirname, "..", "music/open.js"));

const BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";
const LENNON = "4d5447d7-c61c-4120-ba1b-d7f471d385b9";
const RG = "f4a31f0a-51dd-4fa7-986d-3095c40c5ed9";

test("search address and answer", () => {
  assert.equal(A.searchUrl('AC/DC "live"'), "https://musicbrainz.org/ws/2/artist?query=AC%20DC%20live&limit=15&fmt=json");
  assert.equal(A.searchUrl("  "), "");
  const j = { artists: [
    { id: BEATLES, name: "The Beatles", type: "Group", country: "GB", score: 100, disambiguation: "", "life-span": { begin: "1960", end: "1970-04-10", ended: true } },
    { id: "9a3b6a4c-9d0e-4ae4-9d0d-7c4dbf9c8ca1", name: "Μάνος Χατζιδάκις", type: "Person", country: "GR", score: 90,
      aliases: [{ name: "Manos Hadjidakis", locale: "en", primary: true }, { name: "Μάνος Χατζιδάκις", locale: "el", primary: true }] },
    { id: "bad", name: "x", score: 100 },
    { id: "5c3a1d6e-3a7f-4b1d-9a43-4b2c7f1e2a90", name: "Beatles Revival", score: 40 }
  ] };
  const en = A.parseSearch(j, "en");
  assert.equal(en.length, 2);
  assert.deepEqual(en[0], { id: BEATLES, n: "The Beatles", ty: "Group", cc: "GB", dis: "", b: 1960, e: 1970, sc: 100 });
  assert.equal(en[1].ln, "Manos Hadjidakis", "the primary alias of the app language");
  const el = A.parseSearch({ artists: [Object.assign({}, j.artists[1], { name: "Manos Hadjidakis" })] }, "el");
  assert.equal(el[0].ln, "Μάνος Χατζιδάκις");
});

test("artist: links without Google, members, Wikidata id, genres", () => {
  assert.equal(A.artistUrl("nope"), "");
  assert.match(A.artistUrl(BEATLES), /artist\/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d\?inc=url-rels%2Bartist-rels%2Bgenres%2Baliases&fmt=json$/);
  const j = {
    id: BEATLES, name: "The Beatles", type: "Group", country: "GB", area: { name: "United Kingdom" }, "life-span": { begin: "1960", end: "1970", ended: true },
    genres: [{ name: "pop", count: 3 }, { name: "rock", count: 9 }],
    relations: [
      { type: "official homepage", "target-type": "url", url: { resource: "http://www.thebeatles.com/" } },
      { type: "youtube", "target-type": "url", url: { resource: "https://www.youtube.com/user/TheBeatles" } },
      { type: "free streaming", "target-type": "url", url: { resource: "https://open.spotify.com/artist/3WrFJ7ztbogyGnTHbHJFl2" } },
      { type: "purchase for download", "target-type": "url", url: { resource: "https://thebeatles.bandcamp.com/" } },
      { type: "discogs", "target-type": "url", url: { resource: "https://www.discogs.com/artist/82730" } },
      { type: "streaming", "target-type": "url", url: { resource: "https://music.youtube.com/channel/x" } },
      { type: "other databases", "target-type": "url", url: { resource: "javascript:alert(1)" } },
      { type: "wikidata", "target-type": "url", url: { resource: "https://www.wikidata.org/wiki/Q1299" } },
      { type: "member of band", "target-type": "artist", direction: "backward", begin: "1960", end: "1970", ended: true, artist: { id: LENNON, name: "John Lennon" } },
      { type: "member of band", "target-type": "artist", direction: "backward", artist: { id: LENNON, name: "John Lennon" } }
    ]
  };
  const a = A.parseArtist(j, "en");
  assert.equal(a.wd, "Q1299");
  assert.equal(a.area, "United Kingdom");
  assert.deepEqual(a.g, ["rock", "pop"]);
  assert.deepEqual(a.links.map((l) => l.k + " " + l.n), ["home thebeatles.com", "listen Spotify", "buy Bandcamp", "info Discogs"]);
  assert.equal(a.links[0].u, "https://www.thebeatles.com/");
  assert.ok(!a.links.some((l) => /youtube/.test(l.u)));
  assert.equal(a.mem.length, 1);
  assert.deepEqual(a.mem[0], { id: LENNON, n: "John Lennon", b: 1960, e: 1970, past: 1 });
  assert.equal(A.parseArtist({ name: "x" }, "en"), null);
});

test("discography shelves and track lists", () => {
  const g = A.parseGroups({ "release-group-count": 3, "release-groups": [
    { id: RG, title: "Abbey Road", "primary-type": "Album", "first-release-date": "1969-09-26" },
    { id: "11111111-2222-4333-8444-555555555555", title: "Live at the BBC", "primary-type": "Album", "secondary-types": ["Live"], "first-release-date": "1994" },
    { id: "21111111-2222-4333-8444-555555555555", title: "Help!", "primary-type": "Single", "first-release-date": "1965" },
    { id: "x", title: "bad" }
  ] });
  assert.equal(g.list.length, 3);
  assert.deepEqual(A.shelves(g.list).map((s) => s.k + ":" + s.list.length), ["album:1", "single:1", "live:1"]);
  assert.equal(A.caa(RG), "https://coverartarchive.org/release-group/" + RG + "/front-250");
  assert.equal(A.caa("x"), "");
  const rel = (id, date, n) => ({ id, title: "Abbey Road", date, country: "GB", "artist-credit": [{ name: "The Beatles", joinphrase: "" }],
    media: [{ tracks: Array.from({ length: n }, (_, i) => ({ position: i + 1, title: "T" + (i + 1), length: 180000 + i, recording: { id: "a0000000-0000-4000-8000-00000000000" + (i % 10) } })) }] });
  const r = A.parseRelease({ releases: [rel("b0000000-0000-4000-8000-000000000001", "1969-09-26", 20), rel("b0000000-0000-4000-8000-000000000002", "1969-09-26", 17), rel("b0000000-0000-4000-8000-000000000003", "", 3)] }, RG);
  assert.equal(r.rel, "b0000000-0000-4000-8000-000000000002");
  assert.equal(r.tracks.length, 17);
  assert.equal(r.y, 1969);
  assert.deepEqual(r.tracks[0], { k: "mb:" + C.hash("a0000000-0000-4000-8000-000000000000"), t: "T1", a: "The Beatles", n: 1, rid: "a0000000-0000-4000-8000-000000000000", d: 180 });
  assert.ok(C.normRef(r.tracks[0]), "a track key is a valid ref key");
  assert.equal(A.parseRelease({ releases: [] }, RG), null);
});

test("Wikidata + Wikipedia: language order, summary, photo", () => {
  assert.match(A.wdUrl("Q1299"), /ids=Q1299&props=sitelinks&sitefilter=elwiki%7Cenwiki%7Cdewiki&format=json&origin=\*/);
  assert.equal(A.wdUrl("1299"), "");
  const sl = A.parseSitelinks({ entities: { Q1299: { sitelinks: { enwiki: { title: "The Beatles" }, elwiki: { title: "Μπιτλς" }, frwiki: { title: "Les Beatles" } } } } }, "Q1299");
  assert.deepEqual(sl, { el: "Μπιτλς", en: "The Beatles" });
  assert.deepEqual(A.wikiPick(sl, "el"), ["el", "Μπιτλς"]);
  assert.deepEqual(A.wikiPick(sl, "de"), ["en", "The Beatles"]);
  assert.equal(A.wikiPick({}, "en"), null);
  assert.equal(A.summaryUrl("en", "The Beatles"), "https://en.wikipedia.org/api/rest_v1/page/summary/The_Beatles");
  assert.equal(A.summaryUrl("fr", "x"), "");
  const s = A.parseSummary({ type: "standard", extract: "The Beatles were an English rock band.", thumbnail: { source: "https://upload.wikimedia.org/x.jpg" },
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/The_Beatles" } } }, "en");
  assert.deepEqual(s, { x: "The Beatles were an English rock band.", l: "en", pg: "https://en.wikipedia.org/wiki/The_Beatles", im: "https://upload.wikimedia.org/x.jpg" });
  assert.equal(A.parseSummary({ type: "disambiguation", extract: "x" }, "en"), null);
  assert.equal(A.parseSummary({ type: "standard", extract: "x", thumbnail: { source: "https://evil.example/x.jpg" } }, "en").im, "");
  assert.equal(A.parseP18({ claims: { P18: [{ mainsnak: { datavalue: { value: "Beatles ad 1965.JPG" } } }] } }),
    "https://commons.wikimedia.org/wiki/Special:FilePath/Beatles_ad_1965.JPG?width=500");
  assert.equal(A.parseP18({ claims: { P18: [{ mainsnak: { datavalue: { value: "../x<y>.jpg" } } }] } }), "");
});

test("same artist and title keys", () => {
  assert.ok(A.sameArtist("Beatles", "The Beatles"));
  assert.ok(A.sameArtist("Simon & Garfunkel", "Simon and Garfunkel"));
  assert.ok(A.sameArtist("ΜΆΝΟΣ ΧΑΤΖΙΔΆΚΙΣ", "Μάνος Χατζιδάκις"));
  assert.ok(A.sameArtist("Paul McCartney feat. Wings", "Paul McCartney"));
  assert.ok(!A.sameArtist("Manos", "Manos Hadjidakis"));
  assert.ok(!A.sameArtist("", ""));
  assert.equal(A.titleKey("Let It Be (Remastered 2009)"), "let it be");
  assert.equal(A.titleKey("Hey Jude - 2015 Remaster"), "hey jude");
  assert.equal(A.titleKey("Something [Live]"), "something");
  assert.equal(A.titleKey("(I Can't Get No) Satisfaction"), "i can t get no satisfaction");
});

test("matching: only the same artist and title play", () => {
  const mb = [{ k: "mb:aaaaaa1", t: "Dark Star", a: "Grateful Dead", n: 1, d: 1400 }, { k: "mb:aaaaaa2", t: "Ripple", a: "Grateful Dead", n: 2 }];
  const pool = [
    { k: "ia:bbbbbb1", t: "Dark Star (Live)", a: "Grateful Dead", s: "ia", u: "https://archive.org/download/x/1.mp3" },
    { k: "jm:bbbbbb2", t: "Ripple", a: "Ripple Dead Band", s: "jm", u: "https://x.jamendo.com/2.mp3" }
  ];
  const rows = A.matchTracks(mb, pool);
  assert.equal(rows[0].k, "ia:bbbbbb1");
  assert.equal(rows[0].n, 1);
  assert.equal(rows[1]._mb, 1);
  assert.deepEqual(A.byArtist(pool, ["The Grateful Dead"]).map((r) => r.k), ["ia:bbbbbb1"]);
});

test("Openverse: Commons recordings by source", () => {
  const u = O.ovUrl({ q: "Beethoven", source: "wikimedia_audio" });
  assert.match(u, /source=wikimedia_audio/);
  assert.doesNotMatch(u, /category=/);
  assert.match(O.ovUrl({ q: "x", source: "<bad>" }), /category=music/);
});

test("followed artists: merge, unfollow, old data unchanged", () => {
  const base = C.canon({ likes: [], pls: [] });
  assert.equal("fa" in base, false, "no follows = the old form");
  const d1 = C.setFollow(base, { id: BEATLES, n: "The Beatles", im: "https://upload.wikimedia.org/a.jpg" }, true, 1000);
  assert.ok(C.isFollowed(d1, BEATLES));
  assert.deepEqual(C.followed(d1, "en").map((f) => f.n), ["The Beatles"]);
  const d2 = C.setFollow(base, { id: LENNON, n: "John Lennon", im: "https://evil.example/x.jpg" }, true, 1100);
  assert.equal(d2.fa[0].im, undefined, "only Wikimedia / CAA pictures");
  const m = C.mergeMusic(d1, d2);
  assert.deepEqual(m.fa.map((f) => f.k).sort(), [LENNON, BEATLES].sort());
  // An older device drops "fa" on its save: the union keeps every follow.
  const old = JSON.parse(JSON.stringify(m)); delete old.fa;
  assert.deepEqual(C.mergeMusic(m, old), m);
  assert.deepEqual(C.mergeMusic(old, m), m);
  // Unfollow is newer and wins; unfollows older than a year are dropped.
  const d3 = C.setFollow(m, { id: BEATLES, n: "The Beatles" }, false, 2000);
  assert.ok(!C.isFollowed(C.mergeMusic(m, d3), BEATLES));
  const later = C.setLike(d3, { k: "ia:cccccc1", t: "x", a: "y", s: "ia", u: "https://archive.org/download/a/b.mp3" }, true, 2000 + 366 * 86400000);
  assert.equal(later.fa.some((f) => f.k === BEATLES), false);
  assert.equal(C.setFollow(base, { id: "nope", n: "x" }, true, 5).fa, undefined);
  assert.deepEqual(C.canon(m), m, "canonical");
});
