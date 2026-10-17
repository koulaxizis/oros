// Music wave 5b: listening stats (core.js), smart mixes, the yearly
// recap, Spotify export import and matching, MusicBrainz pick
// (music/mixes.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;
const M = require(path.join(__dirname, "..", "music/mixes.js")).OrosMusicMixes;
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 17, 12);

const song = (i, a, g) => ({ k: "l:" + String(i).padStart(6, "0"), t: "Song " + i, a: a || "Artist " + (i % 5), g: g || "", d: 200 });

test("stats: a counted play per year, month, song and artist; capped; hostile input", () => {
  let st = C.normStats(null);
  st = C.addStat(st, { k: "l:aaaaaa", t: "Ένα", a: "Χορωδία", p: "/internal/Music/x.mp3" }, 180, Date.UTC(2026, 0, 5));
  st = C.addStat(st, { k: "l:aaaaaa", t: "Ένα", a: "Χορωδία" }, 180, Date.UTC(2026, 0, 6));
  st = C.addStat(st, { k: "jm:1532770", t: "Two", a: "χορωδια", s: "jm", u: "https://x.example/a.mp3" }, 99999, Date.UTC(2026, 4, 1));
  const Y = st.y["2026"];
  assert.equal(Y.n, 3); assert.equal(Y.s, 180 + 180 + 3600);
  assert.equal(Y.m[0], 2); assert.equal(Y.m[4], 1);
  assert.equal(Y.k["l:aaaaaa"], 2);
  assert.equal(Y.i["l:aaaaaa"].p, undefined, "refs never keep paths");
  assert.equal(Y.i["jm:1532770"].u, "https://x.example/a.mp3");
  assert.deepEqual(Object.keys(Y.a), ["χορωδια"]);
  assert.equal(Y.a["χορωδια"][1], 3);
  assert.equal(st.last, Date.UTC(2026, 4, 1));
  // Round trip through normStats keeps it
  assert.deepEqual(C.normStats(JSON.parse(JSON.stringify(st))), st);
  // Cap: 600 songs per year
  for (let i = 0; i < 700; i++) st = C.addStat(st, song(i), 100, Date.UTC(2025, 1, 1));
  assert.equal(Object.keys(st.y["2025"].k).length, C.STAT.songs);
  assert.equal(Object.keys(st.y["2025"].i).length, C.STAT.songs);
  // Five years kept
  for (let y = 2018; y < 2025; y++) st = C.addStat(st, song(1), 100, Date.UTC(y, 1, 1));
  assert.deepEqual(Object.keys(st.y).sort(), ["2022", "2023", "2024", "2025", "2026"]);
  // Hostile
  const bad = C.normStats({ last: "x", y: { "20x6": {}, "2026": { n: -5, m: [1], k: { "l:zzzzzz": 3 }, i: { "l:zzzzzz": { k: "other" } }, a: { x: "no" } } } });
  assert.deepEqual(bad, { last: 0, y: { "2026": { n: 0, s: 0, m: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], k: {}, i: {}, a: {} } } });
});

test("recap: top songs, artists, months, minutes", () => {
  let st = C.normStats(null);
  const a = song(1, "Band"), b = song(2, "Band"), c = song(3, "Solo");
  for (let i = 0; i < 5; i++) st = C.addStat(st, a, 240, Date.UTC(2026, 6, 1 + i));
  for (let i = 0; i < 2; i++) st = C.addStat(st, b, 120, Date.UTC(2026, 2, 1 + i));
  st = C.addStat(st, c, 60, Date.UTC(2026, 2, 9));
  const r = M.recap(st, 2026);
  assert.equal(r.plays, 8); assert.equal(r.minutes, Math.round((5 * 240 + 2 * 120 + 60) / 60));
  assert.deepEqual(r.songs.map((x) => [x.ref.t, x.n]), [["Song 1", 5], ["Song 2", 2], ["Song 3", 1]]);
  assert.deepEqual(r.artists, [{ name: "Band", n: 7 }, { name: "Solo", n: 1 }]);
  assert.equal(r.topMonth, 6); assert.equal(r.distinct, 3);
  assert.equal(M.recap(st, 2019), null);
  assert.deepEqual(M.years(st), ["2026"]);
});

test("mixes: On repeat, Repeat rewind, Daily mix (stable for the day), Song radio", () => {
  const pool = [];
  for (let i = 0; i < 60; i++) pool.push(song(i, "Artist " + (i % 6), i % 2 ? "Rock" : "Jazz"));
  const hist = { c: {}, l: {} };
  pool.slice(0, 5).forEach((x, i) => { hist.c[x.k] = 10 - i; hist.l[x.k] = NOW - DAY; });           // recent favourites
  pool.slice(5, 8).forEach((x) => { hist.c[x.k] = 6; hist.l[x.k] = NOW - 90 * DAY; });              // old favourites
  hist.c["l:gone00"] = 50; hist.l["l:gone00"] = NOW;                                                  // not playable here
  const rep = M.onRepeat(pool, hist, NOW);
  assert.deepEqual(rep.map((x) => x.t), ["Song 0", "Song 1", "Song 2", "Song 3", "Song 4"]);
  assert.deepEqual(M.rewind(pool, hist, NOW).map((x) => x.t).sort(), ["Song 5", "Song 6", "Song 7"]);
  const liked = {}; liked[pool[20].k] = 1;
  const d1 = M.daily(pool, hist, liked, NOW, 30), d2 = M.daily(pool, hist, liked, NOW + 3600000, 30), d3 = M.daily(pool, hist, liked, NOW + 2 * DAY, 30);
  assert.equal(d1.length, 30);
  assert.equal(new Set(d1.map((x) => x.k)).size, 30, "no song twice");
  assert.deepEqual(d1.map((x) => x.k), d2.map((x) => x.k), "same all day");
  assert.notDeepEqual(d1.map((x) => x.k), d3.map((x) => x.k), "new each day");
  assert.ok(d1.some((x) => x.k === pool[20].k), "a liked song not played lately is in");
  assert.ok(rep.slice(0, 3).every((x) => d1.some((y) => y.k === x.k)) || rep.filter((x) => d1.some((y) => y.k === x.k)).length >= 3);
  // Radio
  const pls = [{ it: [pool[0], pool[1], pool[7]] }];                      // Artist 0 shares a list with Artist 1 and Artist 1(7%6=1)
  const r = M.radio(pool[0], pool, pls, hist, liked, NOW, 20);
  assert.equal(r[0].k, pool[0].k);
  assert.equal(r.length, 20);
  assert.equal(new Set(r.map((x) => x.k)).size, 20);
  assert.ok(r.some((x) => x.a === "Artist 0" && x.k !== pool[0].k));
  assert.ok(r.some((x) => x.a === "Artist 1"));
  assert.ok(r.every((x) => x.a === "Artist 0" || x.a === "Artist 1" || x.g === pool[0].g));
  assert.deepEqual(M.radio(null, pool, [], hist, {}, NOW), []);
  assert.deepEqual(M.daily([], hist, {}, NOW), []);
});

test("Spotify export: Playlist JSON, YourLibrary JSON, CSV (Exportify and others)", () => {
  const pl = JSON.stringify({ playlists: [
    { name: "Καλοκαίρι", lastModifiedDate: "2024-01-01", items: [
      { track: { trackName: "Σαββατοβράδο", artistName: "Τρύπες", albumName: "Δίσκος", trackUri: "spotify:track:1" } },
      { track: null, episode: { episodeName: "x" } },
      { track: { trackName: "", artistName: "x" } }] },
    "junk"] });
  const r = M.parseExport("Playlist1.json", pl);
  assert.deepEqual(r.lists, [{ n: "Καλοκαίρι", it: [{ t: "Σαββατοβράδο", a: "Τρύπες", al: "Δίσκος" }] }]);
  const lib = M.parseExport("YourLibrary.json", JSON.stringify({ tracks: [{ artist: "A; B", album: "Al", track: "T", uri: "x" }], albums: [] }));
  assert.deepEqual(lib.liked, [{ t: "T", a: "A", al: "Al" }]);
  const csv = '﻿"Track URI","Track Name","Artist Name(s)","Album Name","Duration (ms)"\r\n' +
    '"spotify:track:1","Song, with comma","Artist A, Artist B","Album ""Q""",215000\r\n"x","","n","",1\n';
  const c = M.parseExport("Road trip.csv", csv);
  assert.deepEqual(c.lists, [{ n: "Road trip", it: [{ t: "Song, with comma", a: "Artist A", al: 'Album "Q"', d: 215 }] }]);
  const semi = M.parseExport("x.csv", "Title;Artist\nOne;Two\n");
  assert.deepEqual(semi.lists[0].it, [{ t: "One", a: "Two" }]);
  assert.equal(M.parseExport("x.csv", "no,header,here\n1,2,3"), null);
  assert.equal(M.parseExport("x.json", "{broken"), null);
  assert.equal(M.parseExport("x.json", JSON.stringify({ other: 1 })), null);
});

test("matching: same title and artist, small title differences, partial artist", () => {
  const pool = [
    { k: "l:000001", t: "Hey Jude", a: "The Beatles" },
    { k: "l:000002", t: "Σαββατοβράδο", a: "Τρύπες" },
    { k: "jm:9", t: "Night Drive (Radio Edit)", a: "Synth Kid", s: "jm" }
  ];
  const m = M.matcher(pool);
  assert.equal(m({ t: "Hey Jude - Remastered 2015", a: "The Beatles" }).k, "l:000001");
  assert.equal(m({ t: "hey jude", a: "Beatles" }).k, "l:000001");
  assert.equal(m({ t: "ΣΑΒΒΑΤΟΒΡΑΔΟ", a: "Τρυπες" }).k, "l:000002");
  assert.equal(m({ t: "Night Drive", a: "Synth Kid" }).k, "jm:9");
  assert.equal(m({ t: "Hey Jude", a: "Someone Else" }), null);
  assert.equal(m({ t: "Unknown", a: "The Beatles" }), null);
  assert.equal(M.normTitle("Song (feat. X) [Live]"), "song");
});

test("MusicBrainz: best release with a front cover, same title and artist", () => {
  const id = (n) => n + "00000000-0000-0000-0000-000000000000".slice(n.length);
  const json = { releases: [
    { id: id("a"), title: "Blue", score: 100, "artist-credit": [{ name: "Other" }], "cover-art-archive": { front: true } },
    { id: id("b"), title: "Blue", score: 95, "artist-credit": [{ name: "Nikos Sea" }], date: "2021-05-04", "cover-art-archive": { front: false } },
    { id: id("c"), title: "Blue", score: 90, "artist-credit": [{ name: "Nikos Sea" }], date: "2020", "cover-art-archive": { front: true }, status: "Official" },
    { id: "bad", title: "Blue", score: 100, "artist-credit": [{ name: "Nikos Sea" }] },
    { id: id("d"), title: "Blue Two", score: 100, "artist-credit": [{ name: "Nikos Sea" }] }
  ] };
  assert.deepEqual(M.mbPick(json, "Blue", "Nikos Sea"), { id: id("c"), year: 2020 });
  assert.equal(M.mbPick(json, "Red", "Nikos Sea"), null);
  assert.equal(M.mbPick(null, "Blue", ""), null);
  assert.equal(decodeURIComponent(M.mbUrl("Blue", "Nikos Sea").split("query=")[1]), 'release:"Blue" AND artist:"Nikos Sea"');
  assert.equal(M.mbUrl("", "x"), "");
  assert.equal(M.caaUrl(id("c")), "https://coverartarchive.org/release/" + id("c") + "/front-500");
  assert.equal(M.caaUrl("../x"), "");
});

test("Today provider: recap line in December and early January, Daily mix after recent plays", () => {
  const P = require(path.join(__dirname, "..", "music/today.js"));
  const ctx = (today, st, lang) => ({ today, now: Date.parse(today + "T10:00:00Z"), lang: lang || "en", readJSON: () => st });
  const st = { last: Date.parse("2026-12-10T10:00:00Z"), y: { "2026": { n: 40 }, "2025": { n: 25 } } };
  assert.deepEqual(P.collect(ctx("2026-12-11", st)).map((r) => [r.id, r.kind, r.title, JSON.stringify(r.target)]),
    [["recap", "info", "Your 2026 in music is ready", '{"recap":"2026"}']]);
  assert.deepEqual(P.collect(ctx("2027-01-05", st, "el")).map((r) => r.title), ["Το 2026 σου στη μουσική είναι έτοιμο"]);
  assert.deepEqual(P.collect(ctx("2026-12-20", st)).map((r) => r.id), ["recap"]);
  assert.deepEqual(P.collect(ctx("2026-12-20", { last: st.last, y: { "2026": { n: 5 } } })).map((r) => r.id), [], "too few plays");
  assert.deepEqual(P.collect(ctx("2026-11-20", { last: Date.parse("2026-11-15T10:00:00Z"), y: { "2026": { n: 12 } } })).map((r) => [r.id, JSON.stringify(r.target)]),
    [["daily", '{"mix":"daily"}']]);
  assert.deepEqual(P.collect(ctx("2026-11-20", { last: Date.parse("2026-10-01T10:00:00Z"), y: { "2026": { n: 12 } } })), [], "nothing played lately");
  assert.deepEqual(P.collect(ctx("2026-11-20", null)), []);
  assert.deepEqual(P.collect(ctx("bad", st)), []);
});
