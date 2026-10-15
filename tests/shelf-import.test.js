// Media Shelf "Import from another app" (shelf/import.js) and its road
// through the Shelf's own planImport (kind "ext"): StoryGraph, IMDb,
// Trakt (JSON and ZIP), TV Time, MyAnimeList (XML and .gz), Discogs,
// BoardGameGeek. Fixtures follow the documented export shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { webcrypto } = require("crypto");

const I = require("../shelf/import.js");
const Z = require("../atelier/zip.js");

// planImport and the merge, cut out of shelf.js as tests/shelf.test.js does
const src = fs.readFileSync(path.join(__dirname, "..", "shelf/shelf.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const S = new Function("crypto",
  "var LANG = 'en';\n" +
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  // BOOT MARKER") +
  block("  // ---------- 2. Model", "  // ---------- 5. Storage") +
  "\nreturn { normItem, mergeShelf, planImport };")(webcrypto);

const OPTS = { now: 1700000000000, today: "2026-10-10" };
const IOPTS = { today: "2026-10-10", board: "Board game" };
const EMPTY = { ver: 1, items: [], sess: [], goals: {}, tombs: {} };
const enc = (s) => new TextEncoder().encode(s);
const rows = (res) => (res.files.find((f) => f.kind === "ext") || { list: [] }).list;
const byTitle = (list, t) => list.find((x) => x.title === t);
const sk = (r) => r.sess.map((s) => s.k + ":" + s.d + (s.v !== undefined ? ":" + s.v : ""));
const plan = (res, D) => S.planImport(res.files, D || EMPTY, OPTS);

// ---------- fixtures ----------
const SG = [
  "Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?",
  'Piranesi,Susanna Clarke,,9781635575996,hardcover,read,2023/01/02,2024/05/10,"2023/01/05-2023/01/20, 2024/05/01-2024/05/10",2,mysterious,medium,4.75,"Lovely <b>house</b>",,,"fantasy, reread",Yes',
  "Project Hail Mary,Andy Weir,Ray Porter,B08FHBV4ZX,audio,currently-reading,2024/06/01,,2024/06/03-,0,,,,,,,,No",
  "Middlemarch,George Eliot,,9780141439549,digital,to-read,2024/02/02,,,0,,,,,,,,No",
  "Ulysses,James Joyce,,9780679722762,paperback,did-not-finish,2022/02/02,2022/03/03,,0,,,1.25,,,,,No"
].join("\n");

const IMDB_R = [
  "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors",
  "tt0113277,9,2024-03-05,Heat,Heat,https://www.imdb.com/title/tt0113277/,Movie,8.3,170,1995,\"Action, Crime\",700000,1995-12-15,Michael Mann",
  "tt0903747,10,2023-01-01,Breaking Bad,Breaking Bad,https://www.imdb.com/title/tt0903747/,TV Series,9.5,49,2008,Drama,2000000,2008-01-20,",
  "tt0959621,10,2023-01-02,Pilot,Pilot,https://www.imdb.com/title/tt0959621/,TV Episode,9.0,58,2008,Drama,40000,2008-01-20,Vince Gilligan",
  "tt2140553,8,2022-05-05,The Last of Us,The Last of Us,https://www.imdb.com/title/tt2140553/,Video Game,9.7,,2013,Action,80000,2013-06-14,"
].join("\n");
const IMDB_W = [
  "Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated",
  "1,tt2543164,2024-02-01,2024-02-01,,Arrival,Arrival,https://www.imdb.com/title/tt2543164/,movie,7.9,116,2016,Drama,800000,2016-11-11,Denis Villeneuve,,",
  "2,tt0113277,2023-12-01,2023-12-01,,Heat,Heat,https://www.imdb.com/title/tt0113277/,movie,8.3,170,1995,Crime,700000,1995-12-15,Michael Mann,9,2024-03-05",
  "3,tt7366338,2024-03-01,2024-03-01,,Chernobyl,Chernobyl,https://www.imdb.com/title/tt7366338/,tvMiniSeries,9.3,330,2019,Drama,900000,2019-05-06,,,"
].join("\n");

const TRAKT_WM = JSON.stringify([
  { plays: 2, last_watched_at: "2024-03-05T20:00:00.000Z", movie: { title: "Heat", year: 1995, ids: { trakt: 1, imdb: "tt0113277", tmdb: 949 } } },
  { plays: 1, last_watched_at: "2024-04-01T20:00:00.000Z", movie: { title: "Alien", year: 1979, ids: { trakt: 2, imdb: "tt0078748", tmdb: 348 } } }
]);
const TRAKT_WS = JSON.stringify([
  { plays: 3, last_watched_at: "2024-05-03T21:00:00.000Z", show: { title: "Severance", year: 2022, ids: { trakt: 10, imdb: "tt11280740" } },
    seasons: [{ number: 1, episodes: [{ number: 1, plays: 1, last_watched_at: "2024-05-01T21:00:00.000Z" },
      { number: 2, plays: 1, last_watched_at: "2024-05-02T21:00:00.000Z" }, { number: 3, plays: 1, last_watched_at: "2024-05-03T21:00:00.000Z" }] }] },
  { plays: 2, last_watched_at: "2023-08-08T21:00:00.000Z", show: { title: "Mini", year: 2020, aired_episodes: 2, ids: { trakt: 11 } },
    seasons: [{ number: 1, episodes: [{ number: 1, last_watched_at: "2023-08-07T21:00:00.000Z" }, { number: 2, last_watched_at: "2023-08-08T21:00:00.000Z" }] }] }
]);
const TRAKT_RM = JSON.stringify([
  { rated_at: "2024-03-06T10:00:00.000Z", rating: 8, type: "movie", movie: { title: "Heat", year: 1995, ids: { trakt: 1, imdb: "tt0113277" } } },
  { rated_at: "2024-01-01T10:00:00.000Z", rating: 7, type: "episode", episode: { season: 1, number: 1 }, show: { title: "X", ids: { trakt: 5 } } }
]);
const TRAKT_WL = JSON.stringify([
  { rank: 1, listed_at: "2024-07-07T10:00:00.000Z", type: "movie", movie: { title: "Dune: Part Two", year: 2024, ids: { trakt: 3, imdb: "tt15239678" } } },
  { rank: 2, listed_at: "2024-07-08T10:00:00.000Z", type: "season", season: { number: 2 }, show: { title: "Y", ids: { trakt: 6 } } }
]);

const TVT_FOLLOW = "tv_show_id,tv_show_name,created_at,is_favorite\n81189,Breaking Bad,2019-02-01 10:00:00,1\n121361,Game of Thrones,2019-02-02 10:00:00,0\n";
const TVT_SEEN = "tv_show_name,episode_season_number,episode_number,created_at,tv_show_id\n" +
  "Breaking Bad,1,1,2019-03-01 20:00:00,81189\nBreaking Bad,1,2,2019-03-02 20:00:00,81189\nBreaking Bad,1,2,2019-03-03 20:00:00,81189\n";
const TVT_MOVIES = "movie_name,type,created_at\nInception,watch,2020-01-01 20:00:00\nTenet,follow,2020-02-02 20:00:00\n";

const MAL_ANIME = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo><user_id>1</user_id><user_export_type>1</user_export_type></myinfo>
  <anime>
    <series_animedb_id>1</series_animedb_id><series_title><![CDATA[Cowboy Bebop]]></series_title>
    <series_type>TV</series_type><series_episodes>26</series_episodes><my_watched_episodes>26</my_watched_episodes>
    <my_start_date>2020-01-01</my_start_date><my_finish_date>2020-02-01</my_finish_date><my_score>9</my_score>
    <my_status>Completed</my_status><my_tags><![CDATA[space, jazz]]></my_tags>
  </anime>
  <anime>
    <series_animedb_id>199</series_animedb_id><series_title><![CDATA[Sen to Chihiro no Kamikakushi]]></series_title>
    <series_type>Movie</series_type><series_episodes>1</series_episodes><my_watched_episodes>0</my_watched_episodes>
    <my_start_date>0000-00-00</my_start_date><my_finish_date>0000-00-00</my_finish_date><my_score>0</my_score>
    <my_status>Plan to Watch</my_status><my_tags></my_tags>
  </anime>
  <anime>
    <series_animedb_id>21</series_animedb_id><series_title>One Piece &amp; Friends</series_title>
    <series_type>TV</series_type><series_episodes>0</series_episodes><my_watched_episodes>120</my_watched_episodes>
    <my_start_date>2021-05-05</my_start_date><my_finish_date>0000-00-00</my_finish_date><my_score>8</my_score>
    <my_status>On-Hold</my_status>
  </anime>
  <anime>
    <series_animedb_id>30</series_animedb_id><series_title>Dropped Show</series_title><series_type>TV</series_type>
    <my_start_date>2022-01-01</my_start_date><my_finish_date>0000-00-00</my_finish_date><my_status>Dropped</my_status>
  </anime>
</myanimelist>`;
const MAL_MANGA = `<myanimelist><manga><manga_mangadb_id>2</manga_mangadb_id><manga_title><![CDATA[Berserk]]></manga_title>
  <my_read_chapters>100</my_read_chapters><my_status>Reading</my_status><my_score>10</my_score>
  <my_start_date>2023-03-03</my_start_date></manga></myanimelist>`;

const DISCOGS = [
  "Catalog#,Artist,Title,Label,Format,Rating,Released,release_id,CollectionFolder,Date Added,Collection Media Condition,Collection Sleeve Condition,Collection Notes",
  'BLUE 4003,Art Blakey & The Jazz Messengers,Moanin\',Blue Note,"Vinyl, LP, Album, Reissue",5,1959,1234567,Uncategorized,2021-06-01 12:00:00,Mint (M),,',
  "PRINCE 1,Prince (2),Purple Rain,Warner Bros.,CD,0,1984-06-25,7654321,Uncategorized,2022-07-07 09:00:00,,,"
].join("\n");
const BGG = [
  "objectname,objectid,rating,numplays,weight,own,fortrade,want,wanttobuy,wanttoplay,prevowned,preordered,wishlist,wishlistpriority,wishlistcomment,comment,yearpublished,acquisitiondate",
  "Catan,13,7.5,12,,1,0,0,0,0,0,0,0,,,Classic,1995,2019-12-24",
  "Gloomhaven,174430,N/A,0,,0,0,0,0,0,0,0,1,2,,,2017,",
  "Old Thing,99,N/A,0,,0,0,0,0,0,1,0,0,,,,1980,"
].join("\n");

// ---------- per source ----------
test("StoryGraph: statuses, dates read per read, quarter stars, formats, tags", () => {
  const res = I.parseText(SG, "storygraph.csv", IOPTS);
  assert.deepEqual(res.sources, ["storygraph"]);
  const L = rows(res);
  assert.equal(L.length, 4);
  const p = byTitle(L, "Piranesi");
  assert.equal(p.st, "done");
  assert.equal(p.rate, 10);                                    // 4.75 → 9.5 → 10 half stars
  assert.equal(p.fmt, "p");
  assert.deepEqual(p.tags, ["fantasy", "reread"]);
  assert.deepEqual(sk(p), ["s:2023-01-05", "d:2023-01-20", "s:2024-05-01", "d:2024-05-10"]);
  const h = byTitle(L, "Project Hail Mary");
  assert.equal(h.st, "now");
  assert.equal(h.fmt, "a");
  assert.deepEqual(sk(h), ["s:2024-06-03"]);
  assert.equal(byTitle(L, "Middlemarch").fmt, "e");
  assert.equal(byTitle(L, "Middlemarch").st, "want");
  const u = byTitle(L, "Ulysses");
  assert.equal(u.st, "drop");
  assert.equal(u.rate, 3);
  assert.deepEqual(sk(u), ["x:2022-03-03"]);
  const pl = plan(res);
  assert.deepEqual(pl.counts.book, { want: 1, now: 1, done: 1, drop: 1 });
});

test("IMDb: ratings + watchlist merge by const; types map; episodes skipped; 1-10 → half stars", () => {
  const res = I.parseText(IMDB_R, "ratings.csv", IOPTS);
  const w = I.parseText(IMDB_W, "watchlist.csv", IOPTS);
  assert.deepEqual(res.sources, ["imdb"]);
  assert.equal(res.skipped, 1);                                // the TV episode
  const L = rows(res);
  const heat = byTitle(L, "Heat");
  assert.equal(heat.type, "film");
  assert.equal(heat.by, "Michael Mann");
  assert.equal(heat.size, 170);
  assert.equal(heat.rate, 9);
  assert.equal(heat.rel, "1995-12-15");
  assert.deepEqual(sk(heat), ["d:2024-03-05"]);
  assert.equal(byTitle(L, "Breaking Bad").type, "series");
  assert.equal(byTitle(L, "The Last of Us").type, "game");
  const W = rows(w);
  assert.equal(byTitle(W, "Arrival").st, "want");
  assert.equal(byTitle(W, "Heat").st, "done");                  // rated on the watchlist
  assert.equal(byTitle(W, "Chernobyl").type, "series");
  assert.equal(byTitle(W, "Heat").id, heat.id);                  // stable id from the const
  assert.match(heat.id, /^imp[a-z0-9]+$/);
});

test("Trakt: watched, shows with episodes, ratings, watchlist; same imdb id as IMDb", async () => {
  const res = await I.parse([
    { name: "watched-movies.json", bytes: enc(TRAKT_WM) }, { name: "watched-shows.json", bytes: enc(TRAKT_WS) },
    { name: "ratings-movies.json", bytes: enc(TRAKT_RM) }, { name: "watchlist-movies.json", bytes: enc(TRAKT_WL) }
  ], IOPTS);
  assert.deepEqual(res.sources, ["trakt"]);
  assert.equal(res.skipped, 2);                                 // an episode rating, a season on the watchlist
  const L = rows(res);
  const heat = byTitle(L, "Heat");
  assert.equal(heat.st, "done");
  assert.equal(heat.rate, 8);
  assert.deepEqual(sk(heat), ["d:2024-03-05"]);                 // the rating date does not add a second watch
  assert.equal(heat.id, rows(I.parseText(IMDB_R, "ratings.csv", IOPTS)).find((x) => x.title === "Heat").id);
  const sev = byTitle(L, "Severance");
  assert.equal(sev.st, "now");
  assert.deepEqual(sk(sev), ["s:2024-05-01", "p:2024-05-03:3"]);
  const mini = byTitle(L, "Mini");
  assert.equal(mini.st, "done");
  assert.equal(mini.size, 2);
  assert.deepEqual(sk(mini), ["d:2023-08-08"]);
  const dune = byTitle(L, "Dune: Part Two");
  assert.equal(dune.st, "want");
  assert.equal(dune.added, "2024-07-07");
  // the same files in a ZIP give the same rows
  const zip = Z.write([{ name: "trakt/watched-movies.json", data: TRAKT_WM }, { name: "trakt/watched-shows.json", data: TRAKT_WS },
    { name: "trakt/ratings-movies.json", data: TRAKT_RM }, { name: "trakt/watchlist-movies.json", data: TRAKT_WL },
    { name: "trakt/user-profile.json", data: "{\"username\":\"x\"}" }, { name: "trakt/lists.json", data: "[]" }]);
  const zres = await I.parse([{ name: "trakt.zip", bytes: zip }], IOPTS);
  assert.deepEqual(zres.unknown, []);
  assert.deepEqual(rows(zres), L);
  // and IMDb + Trakt together: one Heat
  const both = await I.parse([{ name: "ratings.csv", bytes: enc(IMDB_R) }, { name: "watched-movies.json", bytes: enc(TRAKT_WM) }], IOPTS);
  assert.equal(rows(both).filter((x) => x.title === "Heat").length, 1);
  assert.deepEqual(both.sources, ["imdb", "trakt"]);
});

test("TV Time: followed shows, seen episodes counted once, films", async () => {
  const res = await I.parse([{ name: "followed_tv_show.csv", bytes: enc(TVT_FOLLOW) },
    { name: "seen_episode.csv", bytes: enc(TVT_SEEN) }, { name: "tracking-prod-records.csv", bytes: enc(TVT_MOVIES) }], IOPTS);
  assert.deepEqual(res.sources, ["tvtime"]);
  const L = rows(res);
  const bb = byTitle(L, "Breaking Bad");
  assert.equal(bb.st, "now");
  assert.equal(bb.fav, 1);
  assert.deepEqual(sk(bb), ["s:2019-03-01", "p:2019-03-03:2"]);
  assert.equal(byTitle(L, "Game of Thrones").st, "want");
  assert.equal(byTitle(L, "Inception").st, "done");
  assert.deepEqual(sk(byTitle(L, "Inception")), ["d:2020-01-01"]);
  assert.equal(byTitle(L, "Tenet").st, "want");
});

test("MyAnimeList: anime and manga lists, statuses, scores, episodes, .gz", async () => {
  const res = I.parseText(MAL_ANIME, "animelist.xml", IOPTS);
  assert.deepEqual(res.sources, ["mal"]);
  const L = rows(res);
  const cb = byTitle(L, "Cowboy Bebop");
  assert.equal(cb.type, "series");
  assert.equal(cb.st, "done");
  assert.equal(cb.size, 26);
  assert.equal(cb.rate, 9);
  assert.deepEqual(cb.tags, ["anime", "space", "jazz"]);
  assert.deepEqual(sk(cb), ["s:2020-01-01", "d:2020-02-01"]);
  const sp = byTitle(L, "Sen to Chihiro no Kamikakushi");
  assert.equal(sp.type, "film");
  assert.equal(sp.st, "want");
  assert.deepEqual(sk(sp), []);
  const op = byTitle(L, "One Piece & Friends");
  assert.equal(op.st, "now");
  assert.deepEqual(sk(op), ["s:2021-05-05", "p:2021-05-05:120"]);
  assert.deepEqual(sk(byTitle(L, "Dropped Show")), ["s:2022-01-01", "x:2022-01-01"]);
  const gz = await I.parse([{ name: "mangalist.xml.gz", bytes: new Uint8Array(zlib.gzipSync(MAL_MANGA)) }], IOPTS);
  const b = rows(gz)[0];
  assert.equal(b.type, "book");
  assert.equal(b.st, "now");
  assert.equal(b.rate, 10);
  assert.deepEqual(b.tags, ["manga"]);
});

test("Discogs: collection → music listened on Date Added; artist suffix dropped; format tag", () => {
  const L = rows(I.parseText(DISCOGS, "collection.csv", IOPTS));
  const m = byTitle(L, "Moanin'");
  assert.equal(m.type, "album");
  assert.equal(m.st, "done");
  assert.equal(m.rate, 10);
  assert.equal(m.year, 1959);
  assert.deepEqual(m.tags, ["Vinyl"]);
  assert.deepEqual(sk(m), ["d:2021-06-01"]);
  const p = byTitle(L, "Purple Rain");
  assert.equal(p.by, "Prince");
  assert.equal(p.year, 1984);
  const want = rows(I.parseText(DISCOGS.replace("CollectionFolder", "Notes"), "wantlist.csv", IOPTS));
  assert.ok(want.every((x) => x.st === "want"));
});

test("BoardGameGeek: played → finished, wishlist → want, nothing → skipped", () => {
  const res = I.parseText(BGG, "collection.csv", IOPTS);
  assert.equal(res.skipped, 1);
  const L = rows(res);
  const c = byTitle(L, "Catan");
  assert.equal(c.type, "game");
  assert.equal(c.plat, "Board game");
  assert.equal(c.st, "done");
  assert.equal(c.rate, 8);
  assert.equal(c.rev, "Classic");
  assert.deepEqual(sk(c), ["d:2019-12-24"]);
  assert.equal(byTitle(L, "Gloomhaven").st, "want");
  const pl = plan(res);
  assert.equal(pl.items.find((x) => x.title === "Catan").plat, "Board game");
});

// ---------- the road through planImport ----------
test("planImport: valid shelf data, stable ids, re-import adds nothing, the user's titles win", async () => {
  const res = await I.parse([{ name: "ratings.csv", bytes: enc(IMDB_R) }, { name: "storygraph.csv", bytes: enc(SG) },
    { name: "collection.csv", bytes: enc(BGG) }], IOPTS);
  const p1 = plan(res);
  assert.equal(p1.items.length, 3 + 4 + 2);
  const D = S.mergeShelf({ ...EMPTY, items: p1.items, sess: p1.sess }, EMPTY);
  assert.equal(D.items.length, p1.items.length);
  assert.equal(D.sess.length, p1.sess.length);
  // a second import of the same files: everything is already there
  const p2 = plan(res, D);
  assert.equal(p2.items.length, 0);
  assert.equal(p2.dup, p1.items.length);
  // same ids for items and their history every time
  const p3 = plan(await I.parse([{ name: "ratings.csv", bytes: enc(IMDB_R) }, { name: "storygraph.csv", bytes: enc(SG) },
    { name: "collection.csv", bytes: enc(BGG) }], IOPTS));
  assert.deepEqual(p3.items.map((x) => x.id).sort(), p1.items.map((x) => x.id).sort());
  assert.deepEqual(p3.sess.map((x) => x.id).sort(), p1.sess.map((x) => x.id).sort());
  // the user's own film with a director typed differently is the same title (title + year)
  const mine = { id: "item000001", m: 5, a: 5, type: "film", title: "heat", by: "M. Mann", year: 1995, size: 0, fmt: "",
    plat: "", st: "want", prio: 0, rate: 0, fav: 0, tags: [], rev: "", src: "", col: 0 };
  const p4 = plan(I.parseText(IMDB_R, "ratings.csv", IOPTS), { ...EMPTY, items: [mine] });
  assert.equal(p4.dup, 1);
  assert.ok(!p4.items.some((x) => x.title === "Heat"));
  // an imported title edited later (renamed) is still recognised by its id
  const renamed = D.items.map((x) => (x.title === "Heat" ? { ...x, title: "Heat (1995)" } : x));
  assert.equal(plan(I.parseText(IMDB_R, "ratings.csv", IOPTS), { ...D, items: renamed }).items.length, 0);
});

test("Goodreads / Letterboxd CSVs pass through; unknown files are named; a zip of Letterboxd works", async () => {
  const LB = "Date,Name,Year,Letterboxd URI\n2024-02-01,Arrival,2016,https://boxd.it/a1\n";
  const res = await I.parse([{ name: "watchlist.csv", bytes: enc(LB) }, { name: "notes.json", bytes: enc("{\"a\":1}") },
    { name: "random.csv", bytes: enc("Name,Phone\nx,1\n") }], IOPTS);
  const p = plan(res);
  assert.deepEqual(p.items.map((x) => x.title), ["Arrival"]);
  assert.deepEqual(res.unknown, ["notes.json"]);
  assert.deepEqual(p.unknown, ["random.csv"]);
  const zip = Z.write([{ name: "watchlist.csv", data: LB }, { name: "profile.csv", data: "Username,Bio\nx,y\n" }]);
  const zres = await I.parse([{ name: "letterboxd.zip", bytes: zip }], IOPTS);
  const zp = plan(zres);
  assert.deepEqual(zp.items.map((x) => x.title), ["Arrival"]);
  assert.deepEqual(zp.unknown, []);
  const empty = await I.parse([{ name: "x.zip", bytes: Z.write([{ name: "a.txt", data: "hi" }]) }], IOPTS);
  assert.deepEqual(empty.unknown, ["x.zip"]);
});

test("hostile input: markup stays text, sizes are clipped, nonsense is ignored", () => {
  const evil = "Title,Authors,Read Status,Tags,Review\n\"<img src=x onerror=alert(1)>" + "A".repeat(500) + "\",\"<script>\",read,\"" +
    Array.from({ length: 40 }, (_, i) => "t" + i).join(",") + "\",\"" + "R".repeat(9000) + "\"\n";
  const r = rows(I.parseText(evil, "sg.csv", IOPTS))[0];
  assert.ok(r.title.length <= 200);
  assert.ok(r.tags.length <= 10);
  assert.ok(r.rev.length <= 4000);
  const p = plan(I.parseText(evil, "sg.csv", IOPTS));
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].title.slice(0, 5), "<img ");           // kept as plain text; the app renders with textContent
  assert.deepEqual(rows(I.parseText("[1,2,{\"x\":1}]", "a.json", IOPTS)), []);
  assert.deepEqual(I.parseText("<html></html>", "a.xml", IOPTS).unknown, ["a.xml"]);
  assert.deepEqual(rows(I.parseText("<myanimelist><anime><series_title></series_title></anime></myanimelist>", "m.xml", IOPTS)), []);
});
