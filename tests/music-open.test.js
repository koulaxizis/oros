// Open catalogues of the Music app (music/open.js): request addresses,
// the parsers for Internet Archive, Openverse and ccMixter answers
// (shapes copied from their public APIs), licences, credit lines, and
// how songs from them travel in the sync slice "music" (core.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;
const O = require(path.join(__dirname, "..", "music/open.js"));

test("licences from addresses and codes", () => {
  assert.equal(O.licFromUrl("http://creativecommons.org/licenses/by-nc-sa/3.0/"), "by-nc-sa 3.0");
  assert.equal(O.licFromUrl("https://creativecommons.org/licenses/by/4.0/deed.el"), "by 4.0");
  assert.equal(O.licFromUrl("http://creativecommons.org/publicdomain/zero/1.0/"), "cc0");
  assert.equal(O.licFromUrl("http://creativecommons.org/publicdomain/mark/1.0/"), "pdm");
  assert.equal(O.licFromUrl("http://creativecommons.org/licenses/sampling+/1.0/"), "sampling+ 1.0");
  assert.equal(O.licFromUrl("https://example.com/all-rights-reserved"), "");
  assert.equal(O.licFromUrl(""), "");
  assert.equal(O.licFromCode("by-sa", "4.0"), "by-sa 4.0");
  assert.equal(O.licFromCode("cc0", "1.0"), "cc0");
  assert.equal(O.licFromCode("by", "x"), "by");
  assert.equal(O.licFromCode("proprietary", "1.0"), "");
  assert.equal(O.licLabel("by-nc-sa 3.0", "en"), "CC BY-NC-SA 3.0");
  assert.equal(O.licLabel("pdm", "el"), "Κοινό κτήμα");
  assert.equal(O.licShort("by-sa 4.0"), "CC BY-SA");
  assert.equal(O.licShort("lma"), "LMA");
  assert.equal(O.licUrl("by 4.0"), "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(O.licUrl("by-nc"), "https://creativecommons.org/licenses/by-nc/4.0/");
  assert.equal(O.licUrl("cc0"), "https://creativecommons.org/publicdomain/zero/1.0/");
});

test("small helpers: lengths, https, archive.org query words", () => {
  assert.equal(O.secs("245.36"), 245);
  assert.equal(O.secs("4:05"), 245);
  assert.equal(O.secs("1:02:03"), 3723);
  assert.equal(O.secs("abc"), 0);
  assert.equal(O.https("http://ccmixter.org/content/x/a.mp3"), "https://ccmixter.org/content/x/a.mp3");
  assert.equal(O.https("http://evil.example/a.mp3"), "");
  assert.equal(O.https("javascript:alert(1)"), "");
  assert.equal(O.https('https://a.org/"><img>'), "");
  assert.equal(O.iaWords('rock AND (collection:x) "q" -y*'), "rock AND collection x q y");
});

test("Internet Archive search: address keeps 78rpm out and asks for open licences", () => {
  const u = O.iaSearchUrl({ q: "Ρεμπέτικο", page: 2 });
  assert.match(u, /^https:\/\/archive\.org\/advancedsearch\.php\?q=/);
  const q = decodeURIComponent(u.split("q=")[1].split("&")[0]);
  assert.match(q, /^\(Ρεμπέτικο\) AND /);
  assert.match(q, /-collection:\(78rpm OR georgeblood/);
  assert.match(q, /collection:\(etree\) OR licenseurl/);
  assert.match(u, /&rows=24&page=2&output=json$/);
  assert.match(u, /fl%5B%5D=licenseurl/);
  const c = decodeURIComponent(O.iaSearchUrl({ coll: "etree", sort: "publicdate desc" }));
  assert.match(c, /collection:\(etree\) AND mediatype/);
  assert.match(c, /sort\[\]=publicdate desc/);
});

test("Internet Archive search answer -> album cards, closed items dropped", () => {
  const j = { responseHeader: { status: 0 }, response: { numFound: 30, start: 0, docs: [
    { identifier: "gd1977-05-08", title: "Grateful Dead Live at Barton Hall", creator: "Grateful Dead", date: "1977-05-08T00:00:00Z", collection: ["GratefulDead", "etree"], downloads: 9 },
    { identifier: "netlabel_x01", title: "Night Lines", creator: ["Aria Kosta"], year: "2014", licenseurl: "http://creativecommons.org/licenses/by-nc-sa/3.0/", collection: ["netlabels"] },
    { identifier: "someones_cd_rip", title: "Hits 1999", collection: ["opensource_audio"] },
    { identifier: "bad id with spaces", title: "x", licenseurl: "http://creativecommons.org/licenses/by/3.0/" }
  ] } };
  const r = O.iaParseSearch(j, 1);
  assert.equal(r.albums.length, 2);
  assert.equal(r.more, true);
  assert.deepEqual(r.albums[0], { s: "ia", id: "gd1977-05-08", n: "Grateful Dead Live at Barton Hall", a: "Grateful Dead", y: "1977",
    li: "lma", art: "https://archive.org/services/img/gd1977-05-08", pg: "https://archive.org/details/gd1977-05-08" });
  assert.equal(r.albums[1].li, "by-nc-sa 3.0");
  assert.equal(r.albums[1].a, "Aria Kosta");
  assert.equal(O.iaParseSearch({ response: { numFound: 24, docs: [] } }, 1).more, false);
  assert.deepEqual(O.iaParseSearch(null).albums, []);
});

const IA_META = {
  metadata: { identifier: "netlabel_x01", title: "Night Lines", creator: "Aria Kosta", date: "2014-03-01",
    licenseurl: "http://creativecommons.org/licenses/by-nc-sa/3.0/", collection: ["netlabels"] },
  files: [
    { name: "02 Harbour.flac", source: "original", format: "Flac", length: "185.2", track: "2", title: "Harbour" },
    { name: "02 Harbour.mp3", source: "derivative", format: "VBR MP3", length: "185.21", original: "02 Harbour.flac", title: "Harbour" },
    { name: "02 Harbour.ogg", source: "derivative", format: "Ogg Vorbis", original: "02 Harbour.flac" },
    { name: "01 Λιμάνι νύχτα.flac", source: "original", format: "Flac", length: "3:20", track: "1/2", title: "Λιμάνι νύχτα", creator: "Aria Kosta feat. Nikos" },
    { name: "01 Λιμάνι νύχτα_64kb.mp3", source: "derivative", format: "64Kbps MP3", original: "01 Λιμάνι νύχτα.flac" },
    { name: "cover.jpg", source: "original", format: "JPEG" },
    { name: "hidden.mp3", source: "original", format: "VBR MP3", private: "true" },
    { name: "netlabel_x01_spectrogram.png", source: "derivative", format: "PNG", original: "02 Harbour.flac" }
  ]
};

test("Internet Archive item -> one track per original file, best format, in track order", () => {
  const r = O.iaParseMeta(IA_META, "netlabel_x01");
  assert.equal(r.album.n, "Night Lines");
  assert.equal(r.album.off, 1);
  assert.equal(r.tracks.length, 2);
  const [a, b] = r.tracks;
  assert.equal(a.t, "Λιμάνι νύχτα");
  assert.equal(a.n, 1);
  assert.equal(a.a, "Aria Kosta feat. Nikos");
  assert.equal(a.d, 200);
  assert.equal(a.u, "https://archive.org/download/netlabel_x01/01%20%CE%9B%CE%B9%CE%BC%CE%AC%CE%BD%CE%B9%20%CE%BD%CF%8D%CF%87%CF%84%CE%B1_64kb.mp3");
  assert.equal(b.t, "Harbour");
  assert.equal(b.u, "https://archive.org/download/netlabel_x01/02%20Harbour.mp3");
  assert.equal(b.d, 185);
  assert.equal(b.li, "by-nc-sa 3.0");
  assert.equal(b.s, "ia");
  assert.equal(b.off, 1);
  assert.equal(b.al, "Night Lines");
  assert.match(b.k, /^ia:[0-9a-z]+$/);
  // Same key whatever format wins (the key follows the original file).
  const again = O.iaParseMeta({ metadata: IA_META.metadata, files: IA_META.files.filter((f) => f.format !== "VBR MP3") }, "netlabel_x01");
  assert.equal(again.tracks[1].k, b.k);
  assert.match(again.tracks[1].u, /\.ogg$/);
  assert.equal(O.iaIdFromPage(b.pg), "netlabel_x01");
});

test("Internet Archive item without an open licence, restricted or empty -> nothing", () => {
  assert.equal(O.iaParseMeta({ metadata: { title: "x", collection: ["opensource_audio"] }, files: IA_META.files }, "x"), null);
  assert.equal(O.iaParseMeta({ metadata: Object.assign({}, IA_META.metadata, { "access-restricted-item": "true" }), files: IA_META.files }, "y"), null);
  assert.equal(O.iaParseMeta({}, "z"), null);
  const lma = O.iaParseMeta({ metadata: { title: "Live", collection: ["etree"], stream_only: "true" }, files: IA_META.files }, "live1");
  assert.equal(lma.album.li, "lma");
  assert.equal(lma.album.off, 0);
  assert.equal(lma.tracks[0].off, undefined);
});

test("Openverse answer -> songs; Jamendo ones stream only; closed ones dropped", () => {
  assert.equal(O.ovUrl({ q: "jazz", page: 3 }), "https://api.openverse.org/v1/audio/?page_size=20&page=3&category=music&mature=false&q=jazz");
  assert.match(O.ovUrl({ creator: "Kevin", q: "ignored" }), /&creator=Kevin$/);
  const j = { result_count: 60, page_count: 3, page_size: 20, page: 1, results: [
    { id: "1b2c3d4e-0000-4000-8000-000000000001", title: "Blue Smoke", creator: "Trio Δ", license: "by", license_version: "4.0",
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Blue_Smoke.ogg", foreign_landing_url: "https://commons.wikimedia.org/w/index.php?curid=1",
      thumbnail: "https://api.openverse.org/v1/audio/1b2c3d4e-0000-4000-8000-000000000001/thumb/", source: "wikimedia_audio", duration: 183500,
      audio_set: { title: "Sessions" } },
    { id: "1b2c3d4e-0000-4000-8000-000000000002", title: "Sunday", creator: "Jam Band", license: "by-nc-sa", license_version: "3.0",
      url: "https://prod-1.storage.jamendo.com/?trackid=1&format=mp31", foreign_landing_url: "https://www.jamendo.com/track/1", source: "jamendo", duration: 200000, thumbnail: null },
    { id: "x3", title: "Closed", license: "unknown", url: "https://a.org/x.mp3" },
    { id: "x4", title: "No https", license: "cc0", url: "http://a.example/x.mp3" }
  ] };
  const r = O.ovParse(j, 1);
  assert.equal(r.more, true);
  assert.equal(r.tracks.length, 2);
  const [a, b] = r.tracks;
  assert.equal(a.t, "Blue Smoke"); assert.equal(a.a, "Trio Δ"); assert.equal(a.d, 184); assert.equal(a.al, "Sessions");
  assert.equal(a.li, "by 4.0"); assert.equal(a.vi, "wikimedia_audio"); assert.equal(a.off, 1); assert.equal(a.s, "ov");
  assert.match(a.art, /\/thumb\/$/);
  assert.equal(b.vi, "jamendo"); assert.equal(b.off, undefined); assert.equal(b.art, undefined);
  assert.equal(O.sourceName(b), "Openverse (Jamendo)");
  assert.equal(O.ovParse(j, 3).more, false);
});

test("ccMixter answer -> songs over https, user from the page", () => {
  const u = O.ccUrl({ tags: "remix", page: 2 });
  assert.equal(u, "https://ccmixter.org/api/query?f=json&limit=20&offset=20&sort=rank&ord=desc&tags=remix");
  assert.match(O.ccUrl({ q: "piano", user: "spinmeister<x>" }), /&search=piano&search_type=all&user=spinmeisterx$/);
  const j = [
    { upload_id: 61234, upload_name: "Morning Remix", user_name: "spinmeister", user_real_name: "Spin Meister",
      file_page_url: "http://ccmixter.org/files/spinmeister/61234", license_url: "http://creativecommons.org/licenses/by-nc/3.0/",
      files: [{ file_name: "spin_-_Morning.zip", download_url: "http://ccmixter.org/content/spinmeister/spin_-_Morning.zip", file_format_info: { "mime_type": "application/zip" } },
        { file_name: "spin_-_Morning.mp3", download_url: "http://ccmixter.org/content/spinmeister/spin_-_Morning.mp3", file_format_info: { "mime_type": "audio/mpeg", ps: "3:41" } }] },
    { upload_id: 2, upload_name: "No licence", license_url: "", files: [] }
  ];
  const r = O.ccParse(j);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.more, false);
  const a = r.tracks[0];
  assert.equal(a.u, "https://ccmixter.org/content/spinmeister/spin_-_Morning.mp3");
  assert.equal(a.pg, "https://ccmixter.org/files/spinmeister/61234");
  assert.equal(a.d, 221); assert.equal(a.a, "Spin Meister"); assert.equal(a.li, "by-nc 3.0"); assert.equal(a.off, 1);
  assert.equal(O.ccUserFromPage(a.pg), "spinmeister");
});

test("credit lines in English and Greek", () => {
  const r = { s: "ia", t: "Harbour", a: "Aria Kosta", li: "by-nc-sa 3.0", pg: "https://archive.org/details/netlabel_x01" };
  assert.equal(O.credit(r, "en"), "“Harbour” by Aria Kosta, CC BY-NC-SA 3.0 (https://creativecommons.org/licenses/by-nc-sa/3.0/), from Internet Archive: https://archive.org/details/netlabel_x01");
  assert.equal(O.credit(r, "el"), "«Harbour», καλλιτέχνης: Aria Kosta, CC BY-NC-SA 3.0 (https://creativecommons.org/licenses/by-nc-sa/3.0/), από Internet Archive: https://archive.org/details/netlabel_x01");
  assert.equal(O.credit({ s: "ov", vi: "freesound", t: "x" }, "en"), "“x”, from Openverse (Freesound)");
  assert.equal(O.credit({ t: "local" }, "en"), "");
});

test("browse shelves and genres are complete in both languages", () => {
  O.BROWSE.forEach((b) => { assert.ok(b.en && b.el && O.SOURCES[b.src] && b[b.src], b.id); });
  O.OPEN_GENRES.forEach((g) => assert.equal(g.length, 3));
  assert.equal(O.browseOf("live").src, "ia");
  assert.equal(O.genreOf("jazz").el, "Τζαζ");
  assert.equal(O.genreOf("nope"), null);
});

test("songs from open catalogues travel in likes and playlists with where they play from", () => {
  const ov = O.ovParse({ page_count: 1, results: [{ id: "u1", title: "Blue", creator: "T", license: "by", license_version: "4.0",
    url: "https://upload.wikimedia.org/a.ogg", foreign_landing_url: "https://commons.wikimedia.org/x", source: "wikimedia_audio", duration: 1000 }] }).tracks[0];
  let d = C.emptyData();
  d = C.setLike(d, ov, true, 1000);
  const like = d.likes[0];
  assert.deepEqual(Object.keys(like), ["k", "m", "on", "t", "a", "d", "s", "u", "pg", "li", "vi", "off"]);
  assert.equal(like.u, "https://upload.wikimedia.org/a.ogg");
  const r = C.addPl(d, "Mix", [ov, { k: "l:abcdef1", t: "Local", a: "Me" }], 2000, () => 0.5);
  const pl = C.findPl(r.data, r.id);
  assert.equal(pl.it[0].s, "ov");
  assert.equal(pl.it[1].s, undefined);
  // Canonical and stable through a merge both ways.
  assert.deepEqual(C.mergeMusic(r.data, C.canon(JSON.parse(JSON.stringify(r.data)))), r.data);
  // Bad fields are dropped, the song itself stays.
  const bad = C.normRef({ k: "ov:abcdef12", t: "x", s: "ov", u: "https://ok.org/a.mp3", pg: "javascript:x", art: "http://x/y.jpg", li: "evil", vi: "BAD!", off: 2 });
  assert.deepEqual(bad, { k: "ov:abcdef12", t: "x", a: "", s: "ov", u: "https://ok.org/a.mp3" });
  // A source that does not match the key, or no https address: a plain ref.
  assert.deepEqual(C.normRef({ k: "l:abcdef12", t: "x", s: "ov", u: "https://ok.org/a.mp3" }), { k: "l:abcdef12", t: "x", a: "" });
  assert.deepEqual(C.normRef({ k: "ia:abcdef12", t: "x", s: "ia", u: "http://archive.org/a.mp3" }), { k: "ia:abcdef12", t: "x", a: "" });
  assert.equal(C.isRemote(ov), true);
  assert.equal(C.isRemote({ k: "l:1", p: "/internal/Music/a.mp3" }), false);
  // refOf / itemOf keep the source; history keeps it too.
  assert.equal(C.itemOf(ov).u, ov.u);
  const h = C.addPlay(null, C.itemOf(ov), 5);
  assert.equal(h.r[0].s, "ov");
});

// ---------- Jamendo (wave 3) ----------
const JM_TRACK = { id: "1532771", name: "Ταξίδι στη θάλασσα", duration: 213, artist_id: "7907", artist_name: "Nikos Sea", album_name: "Blue",
  album_id: "198765", album_image: "https://usercontent.jamendo.com?type=album&id=198765&width=300", position: 2,
  audio: "https://prod-1.storage.jamendo.com/?trackid=1532771&format=mp32", license_ccurl: "http://creativecommons.org/licenses/by-nc-nd/3.0/",
  shareurl: "https://www.jamendo.com/track/1532771", audiodownload_allowed: true };

test("Jamendo addresses carry orOS's public client id and clean parameters", () => {
  assert.equal(O.JM_CLIENT, "e04c6e83");
  assert.equal(O.jmTracksUrl({ q: "piano & <b>", page: 2 }),
    "https://api.jamendo.com/v3.0/tracks/?client_id=e04c6e83&format=json&limit=20&offset=20&audioformat=mp32&imagesize=300&search=piano%20b");
  assert.match(O.jmTracksUrl({ tags: "rock" }), /&tags=rock&order=popularity_total$/);
  assert.match(O.jmTracksUrl({ mood: "happy", order: "popularity_week; drop" }), /&fuzzytags=happy&order=popularity_weekdrop$/);
  assert.match(O.jmTracksUrl({ artist: "7907" }), /&artist_id=7907/);
  assert.doesNotMatch(O.jmTracksUrl({ artist: "7907&x=1" }), /artist_id/);
  assert.match(O.jmAlbumsUrl({ order: "releasedate_desc" }), /\/albums\/\?client_id=e04c6e83&format=json&limit=20&offset=0&imagesize=300&order=releasedate_desc$/);
  assert.equal(O.jmAlbumTracksUrl("198765"), "https://api.jamendo.com/v3.0/albums/tracks/?client_id=e04c6e83&format=json&id=198765&audioformat=mp32&imagesize=300");
  assert.equal(O.jmRadioStreamUrl("3"), "https://api.jamendo.com/v3.0/radios/stream/?client_id=e04c6e83&format=json&id=3");
});

test("Jamendo tracks: stream only, link back, album and artist ids", () => {
  const r = O.jmParseTracks({ headers: { status: "success", code: 0, results_count: 2 }, results: [JM_TRACK, { id: "x", name: "bad" }] });
  assert.equal(r.tracks.length, 1);
  assert.equal(r.more, false);
  const a = r.tracks[0];
  assert.equal(a.s, "jm"); assert.match(a.k, /^jm:[0-9a-z]+$/);
  assert.equal(a.t, "Ταξίδι στη θάλασσα"); assert.equal(a.a, "Nikos Sea"); assert.equal(a.al, "Blue"); assert.equal(a.d, 213);
  assert.equal(a.li, "by-nc-nd 3.0"); assert.equal(a.pg, "https://www.jamendo.com/track/1532771");
  assert.equal(a.ai, "198765"); assert.equal(a.ri, "7907");
  assert.equal(a.off, undefined);   // Jamendo: never offline
  assert.equal(O.sourceName(a), "Jamendo");
  assert.match(O.credit(a, "en"), /, from Jamendo: https:\/\/www\.jamendo\.com\/track\/1532771$/);
  assert.throws(() => O.jmParseTracks({ headers: { status: "failed", code: 5 }, results: [] }), (e) => e.code === "busy");
  assert.throws(() => O.jmParseTracks({}), (e) => e.code === "http");
});

test("Jamendo album, albums and radios", () => {
  const alb = O.jmParseAlbum({ headers: { status: "success" }, results: [{ id: "198765", name: "Blue", artist_id: "7907", artist_name: "Nikos Sea",
    releasedate: "2021-05-04", image: "https://usercontent.jamendo.com?type=album&id=198765", shareurl: "https://www.jamendo.com/album/198765",
    tracks: [Object.assign({}, JM_TRACK, { artist_name: undefined, album_name: undefined, album_id: undefined, artist_id: undefined, album_image: undefined }),
      { id: "1532770", name: "Πρώτο", position: "1", duration: 100, audio: "https://prod-1.storage.jamendo.com/?trackid=1532770&format=mp32", license_ccurl: "http://creativecommons.org/licenses/by/3.0/" }] }] });
  assert.equal(alb.album.n, "Blue"); assert.equal(alb.album.y, "2021"); assert.equal(alb.album.ri, "7907");
  assert.deepEqual(alb.tracks.map((x) => x.t), ["Πρώτο", "Ταξίδι στη θάλασσα"]);
  assert.equal(alb.tracks[1].a, "Nikos Sea"); assert.equal(alb.tracks[1].ai, "198765"); assert.equal(alb.tracks[0].pg, "https://www.jamendo.com/track/1532770");
  assert.match(alb.tracks[0].art, /usercontent\.jamendo\.com/);
  const al = O.jmParseAlbums({ headers: { status: "success" }, results: Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), name: "A" + i })) });
  assert.equal(al.albums.length, 20); assert.equal(al.more, true); assert.equal(al.albums[0].s, "jm");
  const ra = O.jmParseRadios({ headers: { status: "success" }, results: [{ id: 3, name: "jampop", dispname: "Pop", image: "https://imgjam.com/radios/pop.png" }, { id: "x" }] });
  assert.deepEqual(ra.radios, [{ s: "jm", id: "3", n: "Pop", art: "https://imgjam.com/radios/pop.png" }]);
  const it = O.jmRadioItem({ headers: { status: "success" }, results: [{ id: 3, dispname: "Pop", stream: "https://streaming.jamendo.com/JamPop" }] }, ra.radios[0]);
  assert.equal(it.u, "https://streaming.jamendo.com/JamPop"); assert.equal(it.s, "jm"); assert.equal(it.a, "Jamendo Radio"); assert.equal(it.off, undefined);
  assert.equal(O.moodOf("happy").el, "Χαρούμενη");
});

test("Jamendo songs keep their album and artist ids through the sync slice", () => {
  const a = O.jmParseTracks({ headers: { status: "success" }, results: [JM_TRACK] }).tracks[0];
  let d = C.setLike(C.emptyData(), a, true, 10);
  assert.equal(d.likes[0].ai, "198765");
  assert.equal(d.likes[0].ri, "7907");
  assert.equal(C.normRef(Object.assign({}, a, { ai: "../x", ri: "a b" })).ai, undefined);
  assert.deepEqual(C.mergeMusic(d, C.canon(JSON.parse(JSON.stringify(d)))), d);
});
