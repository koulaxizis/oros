// Media Shelf 1.5.0: covers and details for films and series
// (Wikidata + Commons, TMDB with the user's own key), the new cover
// fields through normalization and merge, pages per day and the
// yearly goal plan.
// Run: node --test tests/
//
// Same cut as tests/shelf.test.js: the app is a browser IIFE, so the
// constants and sections 2–4 are evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

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
  "\nreturn { normItem, mergeShelf, wdSearchUrl, parseWdSearch, wdEntitiesUrl, parseWdEntities, parseWdLabels," +
  " commonsUrl, parseCommons, tmdbKeyOk, tmdbReq, tmdbSearchReq, tmdbDetailsReq, parseTmdbSearch, parseTmdbDetails," +
  " coverSource, pagesByDay, readingSummary, avgBookPages, goalPlan, goalState };")(webcrypto);

const I1 = "item000001", I2 = "item000002", I3 = "item000003";
function item(id, m, over) {
  return Object.assign({ id, m, a: m, type: "book", title: "Title " + id, by: "", year: 0, size: 0,
    fmt: "p", plat: "", st: "want", prio: 0, rate: 0, fav: 0, tags: [], rev: "", src: "", col: 0 }, over || {});
}
function sess(id, m, it, k, d, v) {
  const s = { id, m, it, k, d };
  if (k === "p") s.v = v;
  return s;
}
function data(items, ss) { return { ver: 1, items: items || [], sess: ss || [], goals: {}, tombs: {} }; }

const COV = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Poster.jpg/320px-Poster.jpg";
const PAGE = "https://commons.wikimedia.org/wiki/File:Poster.jpg";

test("cover fields: only https on the two image hosts, credit clipped, ids checked", () => {
  const x = S.normItem(item(I1, 5, { type: "film", cov: COV, cvby: "  Jane <b>Doe</b> ", cvlc: "CC BY-SA 4.0",
    cvpg: PAGE, wd: "Q42", tmdb: "movie/603" }));
  assert.equal(x.cov, COV);
  assert.equal(x.cvby, "Jane <b>Doe</b>");        // plain text, drawn with textContent
  assert.equal(x.cvlc, "CC BY-SA 4.0");
  assert.equal(x.cvpg, PAGE);
  assert.equal(x.wd, "Q42");
  assert.equal(x.tmdb, "movie/603");
  assert.equal(S.coverSource(x), "commons");
  assert.equal(S.coverSource(S.normItem(item(I1, 5, { cov: "https://image.tmdb.org/t/p/w342/abc.jpg" }))), "tmdb");
  for (const bad of ["http://upload.wikimedia.org/x.jpg", "https://evil.example/x.jpg", "javascript:alert(1)",
                     "https://upload.wikimedia.org/x\".jpg", "https://image.tmdb.org.evil.example/x.jpg"]) {
    const y = S.normItem(item(I1, 5, { cov: bad, cvby: "x", cvpg: PAGE }));
    assert.equal(y.cov, undefined, bad);
    assert.equal(y.cvby, undefined);              // no credit without a cover
    assert.equal(y.cvpg, undefined);
  }
  const z = S.normItem(item(I1, 5, { wd: "Q0", tmdb: "person/1", cvpg: "https://evil.example/" }));
  assert.equal(z.wd, undefined);
  assert.equal(z.tmdb, undefined);
  // absent fields stay absent: old items keep their bytes
  assert.deepEqual(Object.keys(S.normItem(item(I2, 1))).filter((k) => /^(cov|cv|wd|tmdb)/.test(k)), []);
});

test("cover fields survive the merge and an older device's copy (extra fields ride along)", () => {
  const a = data([item(I1, 10, { type: "film", cov: COV, cvby: "Jane", cvlc: "CC0", cvpg: PAGE, wd: "Q1" })]);
  const b = data([item(I1, 9, { type: "film", title: "Older" })]);
  const m = S.mergeShelf(a, b);
  assert.equal(m.items[0].cov, COV);
  assert.equal(m.items[0].wd, "Q1");
  assert.deepEqual(S.mergeShelf(b, a), m);
  assert.deepEqual(S.mergeShelf(m, m), m);
  // removing the cover is an edit with a newer m: the fields go away
  const gone = data([item(I1, 11, { type: "film" })]);
  assert.equal(S.mergeShelf(m, gone).items[0].cov, undefined);
});

test("Wikidata: search URL, hits, entities filtered by class, date / runtime / episodes / picture", () => {
  const u = S.wdSearchUrl("  The Matrix ", "el");
  assert.ok(u.startsWith("https://www.wikidata.org/w/api.php?"));
  assert.ok(/origin=\*/.test(u));
  assert.ok(/language=el&uselang=el/.test(u));
  assert.ok(u.endsWith("search=The%20Matrix"));
  assert.equal(S.wdSearchUrl("   ", "en"), "");
  const hits = S.parseWdSearch({ search: [
    { id: "Q83495", label: "The Matrix", description: "1999 film by the Wachowskis" },
    { id: "Q83495", label: "dup" }, { id: "P31", label: "bad id" }, null,
    { id: "Q2", label: "Matrix TV", description: "television series" },
    { id: "Q3", label: "Matrix (maths)" }
  ] });
  assert.deepEqual(hits.map((h) => h.id), ["Q83495", "Q2", "Q3"]);
  const ent = S.wdEntitiesUrl(hits.map((h) => h.id).concat(["bad"]), "el");
  assert.ok(/ids=Q83495%7CQ2%7CQ3$/.test(ent));
  assert.ok(/languages=el%7Cen/.test(ent));
  function snak(value, rank) { return { rank: rank || "normal", mainsnak: { snaktype: "value", datavalue: { value } } }; }
  const json = { entities: {
    Q83495: {
      labels: { en: { value: "The Matrix" }, el: { value: "Μάτριξ" } },
      claims: {
        P31: [snak({ id: "Q11424" })],
        P577: [snak({ time: "+1999-06-24T00:00:00Z", precision: 11 }), snak({ time: "+1999-03-31T00:00:00Z", precision: 11 }),
               snak({ time: "+1990-01-01T00:00:00Z", precision: 11 }, "deprecated")],
        P2047: [snak({ amount: "+136", unit: "http://www.wikidata.org/entity/Q7727" })],
        P57: [snak({ id: "Q9545711" }), snak({ id: "Q9544977" })],
        P18: [snak("Matrix poster.jpg")]
      }
    },
    Q2: { labels: { en: { value: "Matrix" } }, claims: {
      P31: [snak({ id: "Q5398426" })], P577: [snak({ time: "+1993-00-00T00:00:00Z", precision: 9 })],
      P1113: [snak({ amount: "+21", unit: "1" })], P170: [snak({ id: "Q77" })] } },
    Q3: { labels: { en: { value: "Matrix" } }, claims: { P31: [snak({ id: "Q44337" })] } }
  } };
  const films = S.parseWdEntities("film", json, hits, "el");
  assert.equal(films.length, 1);
  assert.deepEqual(films[0], { title: "Μάτριξ", by: "", byIds: ["Q9545711", "Q9544977"], year: 1999, rel: "1999-03-31",
    size: 136, wd: "Q83495", img: "Matrix poster.jpg", desc: "1999 film by the Wachowskis" });
  const series = S.parseWdEntities("series", json, hits, "en");
  assert.equal(series.length, 1);
  assert.equal(series[0].year, 1993);
  assert.equal(series[0].rel, "");                 // year precision only: no day
  assert.equal(series[0].size, 21);
  assert.deepEqual(series[0].byIds, ["Q77"]);
  // seconds and hours become minutes; a picture name with a slash is refused
  const sec = S.parseWdEntities("film", { entities: { Q9: { claims: { P31: [snak({ id: "Q24869" })],
    P2047: [snak({ amount: "+5400", unit: "http://www.wikidata.org/entity/Q11574" })], P18: [snak("../x.jpg")] } } } },
    [{ id: "Q9", label: "Nine", desc: "" }], "en");
  assert.equal(sec[0].size, 90);
  assert.equal(sec[0].img, "");
  assert.equal(sec[0].title, "Nine");              // falls back to the search label
  assert.deepEqual(S.parseWdLabels({ entities: { Q77: { labels: { en: { value: "Ann Creator" } } }, bad: {} } }, "el"), { Q77: "Ann Creator" });
  assert.deepEqual(S.parseWdEntities("film", null, hits, "en"), []);
});

test("Commons: thumbnail with its author and licence, page link checked", () => {
  assert.ok(S.commonsUrl("A b.jpg").endsWith("titles=File%3AA%20b.jpg"));
  assert.equal(S.commonsUrl(""), "");
  const j = { query: { pages: { "-1": { imageinfo: [{ thumburl: COV, descriptionurl: PAGE,
    extmetadata: { Artist: { value: "<a href=\"//commons.wikimedia.org/wiki/User:Jane\">Jane &amp; Co</a>" },
                   LicenseShortName: { value: "CC BY-SA 4.0" } } }] } } } };
  assert.deepEqual(S.parseCommons(j), { cov: COV, cvby: "Jane & Co", cvlc: "CC BY-SA 4.0", cvpg: PAGE });
  assert.equal(S.parseCommons({ query: { pages: { 1: { imageinfo: [{ thumburl: "https://evil.example/a.jpg" }] } } } }), null);
  assert.equal(S.parseCommons({}), null);
});

test("TMDB: own key in the URL (v3) or the header (v4), search and details parsed", () => {
  assert.ok(!S.tmdbKeyOk("short"));
  assert.ok(!S.tmdbKeyOk("0123456789abcdef0123456789abcdef&x=1"));
  const v3 = "0123456789abcdef0123456789abcdef";
  const r = S.tmdbSearchReq("film", "Alien", v3, "el");
  assert.equal(r.url, "https://api.themoviedb.org/3/search/movie?include_adult=false&language=el-GR&query=Alien&api_key=" + v3);
  assert.equal(r.headers.Authorization, undefined);
  const v4 = "eyJhbGciOiJIUzI1NiJ9." + "a".repeat(60) + ".sig_part-1";
  const r4 = S.tmdbSearchReq("series", "Dark", v4, "en");
  assert.ok(r4.url.startsWith("https://api.themoviedb.org/3/search/tv?"));
  assert.ok(!/api_key/.test(r4.url));
  assert.equal(r4.headers.Authorization, "Bearer " + v4);
  assert.equal(S.tmdbSearchReq("book", "x", v3, "en"), null);
  assert.equal(S.tmdbSearchReq("film", "x", "", "en"), null);
  assert.ok(S.tmdbDetailsReq("film", "movie/348", v3, "en").url.includes("movie/348?append_to_response=credits&language=en-US"));
  assert.equal(S.tmdbDetailsReq("film", "../x", v3, "en"), null);
  const list = S.parseTmdbSearch("film", { results: [
    { id: 348, title: "Alien", release_date: "1979-05-25", poster_path: "/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg", overview: "In space…" },
    { id: 2, title: "No date", release_date: "", poster_path: "javascript:x" },
    { id: -1, title: "bad" }, { id: 3, title: "" }
  ] });
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { title: "Alien", by: "", year: 1979, rel: "1979-05-25", size: 0, tmdb: "movie/348",
    desc: "In space…", cov: "https://image.tmdb.org/t/p/w342/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg" });
  assert.equal(list[1].cov, undefined);
  assert.equal(list[1].year, 0);
  assert.equal(S.normItem(item(I1, 1, Object.assign({ type: "film" }, list[0]))).cov, list[0].cov);
  assert.deepEqual(S.parseTmdbDetails("film", { runtime: 117, credits: { crew: [{ job: "Director", name: "Ridley Scott" }, { job: "Writer", name: "Dan" }] } }),
    { by: "Ridley Scott", size: 117 });
  assert.deepEqual(S.parseTmdbDetails("series", { number_of_episodes: 26, created_by: [{ name: "Baran bo Odar" }, { name: "Jantje Friese" }] }),
    { by: "Baran bo Odar, Jantje Friese", size: 26 });
  assert.deepEqual(S.parseTmdbDetails("film", null), { by: "", size: 0 });
});

test("pages per day: progress steps, finishes, re-reads; audiobooks and other types left out", () => {
  const D = S.mergeShelf(data([
    item(I1, 1, { size: 300, st: "done" }),
    item(I2, 1, { size: 200, st: "done" }),
    item(I3, 1, { size: 500, fmt: "a", st: "now" }),
    item("item000004", 1, { type: "series", size: 10, st: "now" })
  ], [
    sess("s000000001", 1, I1, "s", "2026-01-02"),
    sess("s000000002", 2, I1, "p", "2026-01-02", 40),
    sess("s000000003", 3, I1, "p", "2026-01-03", 100),
    sess("s000000004", 4, I1, "p", "2026-01-03", 90),       // lower: no negative pages
    sess("s000000005", 5, I1, "d", "2026-01-05"),           // the 200 left count on the finish day
    sess("s000000006", 6, I1, "s", "2026-02-01"),           // a re-read starts from 0
    sess("s000000007", 7, I1, "p", "2026-02-01", 50),
    sess("s000000008", 8, I2, "d", "2025-12-31"),           // imported finish: the whole book
    sess("s000000009", 9, I3, "p", "2026-01-03", 120),      // audiobook minutes are not pages
    sess("s000000010", 10, "item000004", "p", "2026-01-03", 3)
  ]), null);
  assert.deepEqual(S.pagesByDay(D), { "2025-12-31": 200, "2026-01-02": 40, "2026-01-03": 60, "2026-01-05": 200, "2026-02-01": 50 });
});

test("reading summary: total, pages a day, days, best day, streak, last 30 days", () => {
  const by = { "2025-12-31": 200, "2026-01-01": 10, "2026-01-02": 30, "2026-03-09": 5, "2026-03-10": 15 };
  const R = S.readingSummary(by, 2026, "2026-03-10");
  assert.equal(R.total, 60);
  assert.equal(R.days, 4);
  assert.equal(R.span, 69);                        // 31 + 28 + 10
  assert.ok(Math.abs(R.perDay - 60 / 69) < 1e-9);
  assert.deepEqual(R.best, { d: "2026-01-02", n: 30 });
  assert.equal(R.streak, 2);
  assert.equal(R.last.length, 30);
  assert.deepEqual(R.last[29], { d: "2026-03-10", n: 15 });
  assert.deepEqual(R.last[0], { d: "2026-02-09", n: 0 });
  // today not read yet: the streak still counts up to yesterday
  assert.equal(S.readingSummary(by, 2026, "2026-03-11").streak, 2);
  assert.equal(S.readingSummary(by, 2026, "2026-03-12").streak, 0);
  // a past year spans the whole year; across the new year the streak goes on
  assert.equal(S.readingSummary(by, 2025, "2026-03-10").span, 365);
  assert.equal(S.readingSummary(by, 2026, "2026-01-02").streak, 3);
  // across the EU DST change the days stay whole
  assert.equal(S.readingSummary({ "2026-03-28": 1, "2026-03-29": 1, "2026-03-30": 1 }, 2026, "2026-03-30").streak, 3);
  assert.equal(S.readingSummary({}, 2027, "2026-03-10").span, 0);
});

test("goal plan: what is left, per week / month, projection, pages a day", () => {
  // 24 books, 6 done on 1 April 2026 (day 91 of 365): 275 days left including today
  const p = S.goalPlan(24, 6, 2026, "2026-04-01", 300);
  assert.equal(p.left, 18);
  assert.equal(p.daysLeft, 275);
  assert.ok(Math.abs(p.perWeek - 18 * 7 / 275) < 1e-9);
  assert.ok(Math.abs(p.perMonth - 18 * 365 / 12 / 275) < 1e-9);
  assert.equal(p.projected, Math.round(6 * 365 / 91));
  assert.equal(p.pagesPerDay, Math.ceil(18 * 300 / 275));
  // last day of the year: one day left
  assert.equal(S.goalPlan(10, 9, 2026, "2026-12-31", 0).daysLeft, 1);
  assert.equal(S.goalPlan(10, 9, 2026, "2026-12-31", 0).pagesPerDay, 0);
  // leap year has 366 days
  assert.equal(S.goalPlan(10, 0, 2028, "2028-01-01", 0).daysLeft, 366);
  // reached: nothing left; past year: nothing left to plan; next year: all of it
  assert.equal(S.goalPlan(5, 7, 2026, "2026-06-01", 300).left, 0);
  assert.equal(S.goalPlan(5, 7, 2026, "2026-06-01", 300).perWeek, 0);
  assert.equal(S.goalPlan(5, 2, 2025, "2026-06-01", 300).daysLeft, 0);
  assert.equal(S.goalPlan(5, 2, 2025, "2026-06-01", 300).projected, 2);
  const nx = S.goalPlan(12, 0, 2027, "2026-06-01", 0);
  assert.equal(nx.daysLeft, 365);
  assert.equal(nx.projected, 0);
  assert.ok(Math.abs(nx.perMonth - 1) < 1e-9);
});

test("average pages of a book: this year's finished books, else every book with pages", () => {
  const D = S.mergeShelf(data([
    item(I1, 1, { size: 300, st: "done" }), item(I2, 1, { size: 100, st: "done" }),
    item(I3, 1, { size: 900, fmt: "a", st: "done" })
  ], [
    sess("s000000001", 1, I1, "d", "2026-02-01"), sess("s000000002", 2, I1, "d", "2026-05-01"),
    sess("s000000003", 3, I3, "d", "2026-02-01"), sess("s000000004", 4, I2, "d", "2025-02-01")
  ]), null);
  assert.equal(S.avgBookPages(D, 2026), 300);      // one book, counted once; audiobook left out
  assert.equal(S.avgBookPages(D, 2024), 200);      // nothing finished: every book with pages
  assert.equal(S.avgBookPages(data([]), 2026), 0);
});
