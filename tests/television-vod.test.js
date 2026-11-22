// Television, Films & shows (television/vod.js, TV-VOD): Internet
// Archive search and item parsing (the rights rule: age or Prelinger,
// never the uploader's licence mark), Wikidata catalogue TSV (roles,
// trailers, excluded genres, series titles), Commons transcode choice,
// filters, and the synced watchlist / resume points (old data unchanged,
// merge symmetric / idempotent / associative, removals stay removed).
// Fixture rows are cut from real API answers (2026-11-21).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const V = require(path.join(__dirname, "..", "television/vod.js"));

const NOW = Date.UTC(2026, 10, 21);   // age limit 1930

/* ---------- Internet Archive ---------- */

const IA_SEARCH = {
  response: {
    numFound: 29634,
    docs: [
      // Uploader says "public domain mark", the film is 1915: free by age.
      { identifier: "HisNewJobCharlesChaplin-1915", title: "His New Job (1915)", year: "1915", runtime: "20:33",
        collection: ["feature_films", "moviesandfilms"], downloads: 4557983, sound: "sound", color: "color",
        licenseurl: "http://creativecommons.org/publicdomain/mark/1.0/" },
      // 1980 with a PD mark: not confirmed (shown only with "all").
      { identifier: "virus-1980", title: "Virus", year: "1980", runtime: "1:48:00",
        collection: ["SciFi_Horror"], downloads: 120000, licenseurl: "http://creativecommons.org/publicdomain/mark/1.0/",
        subject: ["Science Fiction", "Horror"], language: ["English", "Japanese"] },
      // Prelinger: free whatever the year.
      { identifier: "DuckandC1951", title: "Duck and Cover", year: "1951", runtime: "9:15",
        collection: ["prelinger", "ephemera"], downloads: 900000, subject: ["Civil defense"] },
      // The unsorted uploads are never shown.
      { identifier: "some-upload", title: "Upload", year: "1920", collection: ["feature_films_unsorted"] },
      // Not an id we accept.
      { identifier: "../etc", title: "Bad" },
      { identifier: "superman-1941", title: "Superman: The Mad Scientist", year: "1941",
        collection: ["classic_cartoons"], downloads: 50000 },
      { identifier: "dragnet-ep1", title: "Dragnet: The Big Cast", year: "1928",
        collection: ["classic_tv"], downloads: 1000, sound: "silent", language: "English" }
    ]
  }
};

test("IA search address: curated collections, unsorted uploads excluded, age rule unless all", () => {
  const u = new URL(V.iaSearchUrl({ q: "chaplin", f: {}, page: 2, now: NOW }));
  assert.equal(u.origin, "https://archive.org");
  const q = u.searchParams.get("q");
  assert.match(q, /mediatype:\(movies\)/);
  assert.match(q, /-collection:\(feature_films_unsorted OR opensource_movies\)/);
  assert.match(q, /year:\[1880 TO 1930\] OR collection:\(prelinger\)/);
  assert.match(q, /chaplin/);
  assert.equal(u.searchParams.get("page"), "2");
  const all = new URL(V.iaSearchUrl({ q: "", f: { all: 1, ty: "series", dec: 1950 }, page: 1, now: NOW })).searchParams.get("q");
  assert.doesNotMatch(all, /TO 1930/);
  assert.match(all, /collection:\(classic_tv\)/);
  assert.match(all, /year:\[1950 TO 1959\]/);
});

test("IA search address: words are quoted, never Lucene syntax", () => {
  const q = new URL(V.iaSearchUrl({ q: 'a) OR collection:(x" *', f: {}, page: 1, now: NOW })).searchParams.get("q");
  assert.doesNotMatch(q, /collection:\(x/);
});

test("IA rights: age or Prelinger only; the uploader's licence mark counts for nothing", () => {
  const r = V.iaParseSearch(IA_SEARCH, { f: {}, page: 1, now: NOW });
  const ids = r.items.map((x) => x.k);
  assert.deepEqual(ids, ["ia:HisNewJobCharlesChaplin-1915", "ia:DuckandC1951", "ia:dragnet-ep1"]);
  const job = r.items[0];
  assert.equal(job.why, "age"); assert.equal(job.ok, 1); assert.equal(job.ty, "short"); assert.equal(job.d, 21);
  assert.equal(r.items[1].why, "prelinger"); assert.equal(r.items[1].ty, "doc");
  assert.equal(r.items[2].ty, "series"); assert.equal(r.items[2].snd, "silent"); assert.deepEqual(r.items[2].l, ["en"]);
  assert.equal(r.more, false);   // fewer docs than a page

  const all = V.iaParseSearch(IA_SEARCH, { f: { all: 1 }, page: 1, now: NOW }).items;
  const virus = all.find((x) => x.k === "ia:virus-1980");
  assert.equal(virus.ok, 0); assert.equal(virus.why, "listed");
  assert.deepEqual(virus.g.sort(), ["horror", "scifi"]);
  assert.deepEqual(virus.l, ["en", "ja"]);
  assert.equal(all.find((x) => x.k === "ia:superman-1941").ty, "anim");
  assert.ok(!all.some((x) => x.k === "ia:some-upload"));
  assert.ok(!all.some((x) => /etc/.test(x.k)));
});

test("IA search: type and length filters also apply to the answer", () => {
  const f = { all: 1, len: "long" };
  const ks = V.iaParseSearch(IA_SEARCH, { f, page: 1, now: NOW }).items.map((x) => x.k);
  assert.deepEqual(ks, ["ia:virus-1980"]);
  const sh = V.iaParseSearch(IA_SEARCH, { f: { ty: "short" }, page: 1, now: NOW }).items.map((x) => x.k);
  assert.deepEqual(sh, ["ia:HisNewJobCharlesChaplin-1915"]);
  assert.equal(V.filterSupport("ia", { c: "fr" }), false);
  assert.equal(V.filterSupport("wd", { c: "fr" }), true);
});

const IA_META = {
  metadata: {
    identifier: "charlie_chaplin_film_fest", title: "Charlie Chaplin Festival",
    description: "Four Chaplin shorts from 1917.<br>See <a href=\"http://imdb.com/title/tt0284688/\">IMDb</a> &amp; more.",
    licenseurl: "http://creativecommons.org/licenses/publicdomain/"
  },
  files: [
    { name: "__ia_thumb.jpg", format: "JPEG Thumb" },
    { name: "charlie_chaplin_film_fest.gif", format: "Animated GIF", original: "charlie_chaplin_film_fest.mpeg" },
    { name: "charlie_chaplin_film_fest.mp4", format: "h.264", original: "charlie_chaplin_film_fest.mpeg", length: "4646.42" },
    { name: "charlie_chaplin_film_fest.mpeg", format: "MPEG2", length: "4646.35" },
    { name: "charlie_chaplin_film_fest.ogv", format: "Ogg Video", original: "charlie_chaplin_film_fest.mpeg", length: "4646.38" },
    { name: "charlie_chaplin_film_fest_512kb.mp4", format: "512Kb MPEG4", original: "charlie_chaplin_film_fest.mpeg", length: "4646.38" },
    { name: "part 2/ep 2.ogv", format: "Ogg Video", original: "part 2/ep 2.avi", length: "12:30" }
  ]
};

test("IA item: one part per original, the best browser format, description as text", () => {
  const m = V.iaParseMeta(IA_META, "charlie_chaplin_film_fest");
  assert.equal(m.closed, 0);
  assert.equal(m.parts.length, 2);
  assert.equal(m.parts[0].url, "https://archive.org/download/charlie_chaplin_film_fest/charlie_chaplin_film_fest.mp4");
  assert.equal(m.parts[0].ogg, 0);
  assert.equal(m.parts[0].min, 77);
  assert.equal(m.parts[1].url, "https://archive.org/download/charlie_chaplin_film_fest/part%202/ep%202.ogv");
  assert.equal(m.parts[1].ogg, 1);
  assert.equal(m.parts[1].min, 13);
  assert.doesNotMatch(m.desc, /</);
  assert.match(m.desc, /IMDb & more/);
});

test("IA item: dark or empty items are closed", () => {
  assert.equal(V.iaParseMeta({ is_dark: true }, "night_of_the_living_dead").closed, 1);
  assert.equal(V.iaParseMeta({ metadata: {}, files: [{ name: "a.mp3", format: "MP3" }] }, "x").closed, 1);
  assert.equal(V.iaParseMeta({}, "../x"), null);
});

/* ---------- Wikidata catalogue ---------- */

const E = (q) => "<http://www.wikidata.org/entity/" + q + ">";
const FP = (f) => "<http://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(f) + ">";
const DATE = (y) => '"' + y + '-02-17T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>';
const row = (a) => a.join("\t");
const MAIN = [
  "?item\t?t\t?video\t?r\t?pd\t?d\t?im\t?ser\t?sl",
  row([E("Q151895"), E("Q11424"), FP("Nosferatu (1922).webm"), E("Q89347362"), DATE(1922), "94.0", FP("Wismar Markt.jpg"), "", "60"]),
  row([E("Q151895"), E("Q11424"), FP("Nosferatu (1922).webm"), E("Q89347362"), DATE(1921), "94.0", "", "", "60"]),
  // A trailer statement without a role: not the film.
  row([E("Q151895"), E("Q11424"), FP("Nosferatu trailer.webm"), "", "", "", "", "", "60"]),
  // A trailer by role.
  row([E("Q109116"), E("Q11424"), FP("The Great Dictator (1940) trailer.webm"), E("Q622550"), DATE(1940), "", "", "", "90"]),
  // An episode needs the explicit role.
  row([E("Q900001"), E("Q21191270"), FP("Episode 1.webm"), "", DATE(1955), "25", "", E("Q900000"), "2"]),
  row([E("Q900002"), E("Q21191270"), FP("Episode 2.webm"), E("Q89347362"), DATE(1955), "25", "", E("Q900000"), "3"]),
  // Excluded by genre.
  row([E("Q777"), E("Q11424"), FP("X.webm"), E("Q89347362"), DATE(1920), "", "", "", "1"]),
  // A short documentary, length in seconds.
  row([E("Q60202926"), E("Q11424"), FP("All Creatures Welcome.webm"), "", DATE(2018), "1500", "", "", "1"])
].join("\n");
const FACETS = [
  "?item\t?p\t?o",
  row([E("Q151895"), "<http://www.wikidata.org/prop/direct/P136>", E("Q200092")]),
  row([E("Q151895"), "<http://www.wikidata.org/prop/direct/P136>", E("Q226730")]),
  row([E("Q151895"), "<http://www.wikidata.org/prop/direct/P495>", E("Q183")]),
  row([E("Q151895"), "<http://www.wikidata.org/prop/direct/P364>", E("Q22282914")]),
  row([E("Q777"), "<http://www.wikidata.org/prop/direct/P136>", E("Q185529")]),
  row([E("Q60202926"), "<http://www.wikidata.org/prop/direct/P136>", E("Q93204")])
].join("\n");
const DIRS = ["?item\t?n", row([E("Q151895"), '"F. W. Murnau"@en'])].join("\n");
const LABELS = [
  "?item\t?l",
  row([E("Q151895"), '"Nosferatu"@en']),
  row([E("Q151895"), '"Νοσφεράτου"@el']),
  row([E("Q151895"), '"Nosferatu – Eine Symphonie des Grauens"@de']),
  row([E("Q151895"), '"Nosferatu"@fr']),
  row([E("Q900000"), '"Old Show"@en']),
  row([E("Q900000"), '"Η παλιά σειρά"@el'])
].join("\n");

test("Wikidata TSV cells: URIs, language tags, escapes", () => {
  const r = V.parseTsv('?a\t?b\n<http://x/y>\t"say \\"hi\\"\\tok"@EL\n');
  assert.deepEqual(r[0].a, { v: "http://x/y", uri: 1 });
  assert.deepEqual(r[0].b, { v: 'say "hi"\tok', lang: "el" });
});

test("Wikidata catalogue: full works only, trailers / roleless episodes / excluded genres out", () => {
  const items = V.wdBuild({ main: MAIN, facets: FACETS, dirs: DIRS, labels: LABELS });
  const ks = items.map((x) => x.k);
  assert.deepEqual(ks, ["wd:Q151895", "wd:Q900002", "wd:Q60202926"]);
  const n = items[0];
  assert.deepEqual(n.v, ["Nosferatu (1922).webm"]);
  assert.equal(n.y, 1921);
  assert.equal(n.d, 94);
  assert.deepEqual(n.tl, { en: "Nosferatu", el: "Νοσφεράτου", de: "Nosferatu – Eine Symphonie des Grauens" });
  assert.deepEqual(n.g, ["horror"]);
  assert.deepEqual(n.c, ["de"]);
  assert.equal(n.snd, "silent");
  assert.equal(n.dir, "F. W. Murnau");
  assert.equal(n.ok, 1); assert.equal(n.why, "commons");
  assert.equal(n.im, "https://commons.wikimedia.org/wiki/Special:FilePath/Wismar_Markt.jpg?width=320");
  const ep = items[1];
  assert.equal(ep.ty, "series");
  assert.deepEqual(ep.st, { en: "Old Show", el: "Η παλιά σειρά" });
  const doc = items[2];
  assert.equal(doc.ty, "doc");
  assert.equal(doc.d, 25);
  assert.equal(V.titleIn(n, "el"), "Νοσφεράτου");
  assert.equal(V.titleIn(doc, "el"), "Q60202926");
});

test("Catalogue search: words in any title language, filters, sort, pages", () => {
  const items = V.wdBuild({ main: MAIN, facets: FACETS, dirs: DIRS, labels: LABELS });
  assert.deepEqual(V.wdFilter(items, { q: "νοσφερατου" }).items.map((x) => x.k), ["wd:Q151895"]);
  assert.deepEqual(V.wdFilter(items, { q: "murnau" }).items.map((x) => x.k), ["wd:Q151895"]);
  assert.deepEqual(V.wdFilter(items, { q: "παλια" }).items.map((x) => x.k), ["wd:Q900002"]);
  assert.deepEqual(V.wdFilter(items, { f: { c: "de" } }).items.map((x) => x.k), ["wd:Q151895"]);
  assert.deepEqual(V.wdFilter(items, { f: { dec: 1950 } }).items.map((x) => x.k), ["wd:Q900002"]);
  assert.deepEqual(V.wdFilter(items, { f: { len: "short" } }).items.map((x) => x.k), ["wd:Q900002", "wd:Q60202926"]);
  assert.deepEqual(V.wdFilter(items, { f: { sort: "new" } }).items.map((x) => x.y), [2018, 1955, 1921]);
  const many = [];
  for (let i = 0; i < 30; i++) many.push(V.item({ k: "wd:Q" + (i + 1), t: "T" + i, ty: "film", ok: 1 }));
  const p1 = V.wdFilter(many, { page: 1 }), p2 = V.wdFilter(many, { page: 2 });
  assert.equal(p1.items.length, V.PAGE); assert.equal(p1.more, true);
  assert.equal(p2.items.length, 30 - V.PAGE); assert.equal(p2.more, false);
});

/* ---------- Commons playback ---------- */

const COMMONS = {
  query: { pages: [{ title: "File:Nosferatu (1922).webm", videoinfo: [{
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a1/Nosferatu_%281922%29.webm", mime: "video/webm", height: 1080,
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Nosferatu_(1922).webm",
    derivatives: [
      { src: "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a1/N.webm/N.webm.360p.vp9.webm", type: 'video/webm; codecs="vp9, opus"', height: 360 },
      { src: "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a1/N.webm/N.webm.720p.vp9.webm", type: 'video/webm; codecs="vp9, opus"', height: 720 },
      { src: "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a1/N.webm/N.webm.360p.mpeg4.mov", type: "video/mp4", height: 360 },
      { src: "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a1/N.webm/N.webm.m3u8", type: "application/vnd.apple.mpegurl" },
      { src: "http://upload.wikimedia.org/wikipedia/commons/transcoded/a/a1/N.webm/N.webm.480p.vp9.webm", type: "video/webm", height: 480 }
    ],
    extmetadata: { LicenseShortName: { value: "Public domain" }, Artist: { value: "<a href=\"x\">F. W. Murnau</a>" } }
  }] }] }
};

test("Commons: closest to 720 lines that this browser plays; Safari gets the mp4", () => {
  const all = V.commonsPick(COMMONS, () => "maybe");
  assert.match(all.url, /720p\.vp9\.webm$/);
  assert.equal(all.lic, "Public domain");
  assert.equal(all.artist, "F. W. Murnau");
  const safari = V.commonsPick(COMMONS, (m) => (/mp4/.test(m) ? "maybe" : ""));
  assert.match(safari.url, /360p\.mpeg4\.mov$/);
  assert.equal(V.commonsPick(COMMONS, () => ""), null);
  assert.equal(V.commonsPick({ query: { pages: [{ missing: true }] } }, () => "maybe"), null);
});

test("Commons info address is the API with an anonymous origin", () => {
  const u = new URL(V.commonsInfoUrl("Nosferatu (1922).webm"));
  assert.equal(u.host, "commons.wikimedia.org");
  assert.equal(u.searchParams.get("origin"), "*");
  assert.equal(u.searchParams.get("titles"), "File:Nosferatu (1922).webm");
});

/* ---------- items ---------- */

test("item(): ids, links and text are checked", () => {
  assert.equal(V.item({ k: "wd:Q1 OR 1" }), null);
  assert.equal(V.item({ k: "ia:../x" }), null);
  const it = V.item({ k: "ia:abc", t: "  A\u0000title  ", im: "javascript:alert(1)", y: 1500, ty: "bogus", g: ["horror", "nope"], v: ["a<b.webm", "ok.webm"] });
  assert.equal(it.t, "A title");
  assert.equal(it.im, undefined);
  assert.equal(it.y, undefined);
  assert.equal(it.ty, "film");
  assert.deepEqual(it.g, ["horror"]);
  assert.deepEqual(it.v, ["ok.webm"]);
  assert.equal(it.ok, 0);
});

/* ---------- synced watchlist and resume points ---------- */

const A = V.item({ k: "wd:Q151895", t: "Nosferatu", y: 1922, ty: "film", ok: 1, why: "commons", im: "https://commons.wikimedia.org/wiki/Special:FilePath/N.jpg?width=320" });
const B = V.item({ k: "ia:DuckandC1951", t: "Duck and Cover", y: 1951, ty: "doc", ok: 1, why: "prelinger" });

test("old data loads unchanged; empty lists are not written", () => {
  const old = { favs: ["x"], urls: [] };
  const copy = JSON.parse(JSON.stringify(old));
  V.normVod(old);
  assert.deepEqual(old, copy);
  assert.deepEqual(V.mergeVod({}, {}, {}), {});
});

test("watchlist: add, remove (kept as a removal), stamps only on a real change", () => {
  const o = {};
  assert.equal(V.setWatch(o, A, true, 1000), true);
  assert.equal(V.setWatch(o, A, true, 2000), false);
  assert.equal(o.wl["wd:Q151895"].m, 1000);
  assert.equal(V.watchOn(o, A.k), true);
  assert.equal(V.setWatch(o, B, true, 1500), true);
  assert.equal(o.wl["ia:DuckandC1951"].w, "prelinger");
  assert.deepEqual(V.watchList(o).map((x) => x.k), ["ia:DuckandC1951", "wd:Q151895"]);
  assert.equal(V.watchList(o)[0].why, "prelinger");
  assert.equal(V.setWatch(o, A, false, 900), true);   // clock behind: still newer
  assert.deepEqual(o.wl["wd:Q151895"], { m: 1001, x: 1 });
  assert.equal(V.watchOn(o, A.k), false);
});

test("resume: from 30 seconds, parts, finished near the end, removal", () => {
  const o = {};
  assert.equal(V.setResume(o, A, 12, 5640, 1000), false);          // too early to remember
  assert.equal(V.setResume(o, A, 600, 5640, 2000), true);
  assert.equal(V.setResume(o, A, 600, 5640, 3000), false);         // nothing changed
  assert.equal(V.resumeOf(o, A.k).p, 600);
  assert.equal(V.setResume(o, B, 5, 600, 4000, 1, 3), true);       // second part, start
  assert.equal(V.resumeOf(o, B.k).n, 1);
  assert.deepEqual(V.continueList(o).map((x) => x.k), ["ia:DuckandC1951", "wd:Q151895"]);
  assert.equal(V.setResume(o, B, 590, 600, 5000, 1, 3), true);     // not the last part: not finished
  assert.equal(V.resumeOf(o, B.k).f, undefined);
  assert.equal(V.setResume(o, A, 5500, 5640, 6000), true);         // last 3 minutes: finished
  assert.equal(o.rp[A.k].f, 1);
  assert.equal(o.rp[A.k].p, 5640);
  assert.equal(V.resumeOf(o, A.k), null);
  assert.equal(V.dropResume(o, B.k, 7000), true);
  assert.equal(V.dropResume(o, B.k, 8000), false);
  assert.deepEqual(V.continueList(o), []);
});

function sorted(x) { return JSON.stringify(x); }

test("merge is symmetric, idempotent and associative; removals win when newer", () => {
  const a = {}, b = {}, c = {};
  V.setWatch(a, A, true, 1000);
  V.setResume(a, A, 120, 5640, 1100);
  V.setWatch(b, A, true, 1000); V.setWatch(b, A, false, 2000);
  V.setWatch(b, B, true, 1500);
  V.setResume(c, A, 900, 5640, 3000);
  V.setWatch(c, B, true, 1500);
  const ab = V.mergeVod(a, b, {}), ba = V.mergeVod(b, a, {});
  assert.equal(sorted(ab), sorted(ba));
  assert.equal(V.watchOn(ab, A.k), false);
  assert.equal(V.watchOn(ab, B.k), true);
  assert.equal(sorted(V.mergeVod(ab, ab, {})), sorted(ab));
  const l = V.mergeVod(V.mergeVod(a, b, {}), c, {}), r = V.mergeVod(a, V.mergeVod(b, c, {}), {});
  assert.equal(sorted(l), sorted(r));
  assert.equal(l.rp[A.k].p, 900);
});

test("same stamp, different entries: one fixed winner on both devices", () => {
  const x = { wl: { "wd:Q1": { t: "One", ty: "film", m: 5 } } };
  const y = { wl: { "wd:Q1": { x: 1, m: 5 } } };
  assert.equal(sorted(V.mergeVod(x, y, {})), sorted(V.mergeVod(y, x, {})));
});

test("bad entries are dropped and the lists are capped", () => {
  const o = { wl: { "wd:Q1": { t: "ok", ty: "film", m: 1 }, "javascript:x": { t: "bad", m: 2 }, "wd:Q2": { t: "no stamp" } } };
  V.normVod(o);
  assert.deepEqual(Object.keys(o.wl), ["wd:Q1"]);
  const big = { rp: {} };
  for (let i = 1; i <= 260; i++) big.rp["wd:Q" + i] = { t: "T", ty: "film", p: 60, d: 600, m: i };
  V.normVod(big);
  const ks = Object.keys(big.rp);
  assert.equal(ks.length, 200);
  assert.ok(!("wd:Q1" in big.rp));    // the oldest go first
  assert.ok("wd:Q260" in big.rp);
});

// ---------- TV-VOD2: NASA, Europeana / Open Images, PeerTube, subtitles, saved searches ----------
// Fixtures: real answers of each API (2026-11-22), trimmed to a few items.
const FX = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "fixtures", "television-vod2.json"), "utf8"));

test("filterMissing: a source that cannot apply a filter is named, never asked", () => {
  assert.deepEqual(V.filterMissing("wd", { c: "gr", g: "drama", l: "el" }), []);
  assert.deepEqual(V.filterMissing("na", { dec: 1960, ty: "doc" }), []);
  assert.ok(V.filterMissing("na", { c: "gr" }).length > 0);
  assert.ok(V.filterMissing("eu", { g: "comedy" }).length > 0);
  assert.deepEqual(V.filterMissing("eu", { c: "de", dec: 1910, l: "de" }), []);
  assert.ok(V.filterMissing("pt", { dec: 1950 }).length > 0);
  assert.deepEqual(V.filterMissing("pt", { len: "long", l: "fr" }), []);
});

test("NASA: search and asset parse; public domain, medium file first, subtitles", () => {
  const url = V.naSearchUrl({ q: "apollo", f: { dec: 1960 }, page: 1 });
  assert.match(url, /^https:\/\/images-api\.nasa\.gov\/search\?/);
  assert.match(url, /media_type=video/);
  assert.match(url, /year_start=1960/);
  const r = V.naParseSearch(FX.nasa, { page: 1 });
  assert.ok(r.items.length > 0);
  r.items.forEach((it) => {
    assert.equal(it.s, "na"); assert.equal(it.ok, 1); assert.equal(it.why, "nasa"); assert.equal(it.ty, "doc");
    assert.match(it.pg, /^https:\/\/images\.nasa\.gov\/details\//);
    if (it.im) assert.match(it.im, /^https:\/\//);
  });
  const a = V.naParseAsset(FX.nasaAsset);
  assert.match(a.url, /^https:\/\/images-assets\.nasa\.gov\/.+\.mp4$/);
  assert.ok(Array.isArray(a.subs));
  a.subs.forEach((s) => assert.match(s.url, /^https:\/\/.+\.(srt|vtt)$/));
  assert.equal(V.naParseAsset({ collection: { items: [{ href: "javascript:alert(1)" }] } }), null);
});

test("Europeana: own key in the URL, open licences, playable files only, Open Images apart", () => {
  const u = V.euSearchUrl({ q: "paris", f: { c: "fr", dec: 1920 }, page: 2, key: "abc123", src: "eu" });
  assert.match(u, /^https:\/\/api\.europeana\.eu\/record\/v2\/search\.json\?wskey=abc123&/);
  assert.match(u, /reusability=open/);
  assert.match(u, /NOT%20DATA_PROVIDER/);
  assert.match(u, /COUNTRY%3A%22France%22/);
  assert.match(u, /start=25&/);
  const o = V.euSearchUrl({ q: "", f: {}, page: 1, key: "abc123", src: "oi" });
  assert.ok(!/NOT%20DATA_PROVIDER/.test(o));
  assert.match(o, /DATA_PROVIDER%3A%22Netherlands/);
  const r = V.euParseSearch(FX.eu, { src: "eu", page: 1 });
  assert.ok(r.items.length > 0);
  r.items.forEach((it) => {
    assert.equal(it.s, "eu"); assert.equal(it.ok, 1); assert.equal(it.why, "open");
    assert.match(it.u, /^https:\/\/.+\.(mp4|m4v|ogv|ogg|webm)(\?|$)/i);
    assert.ok(it.lic);
    assert.match(it.pg, /^https:\/\/www\.europeana\.eu\/item\//);
  });
  assert.ok(r.items.some((it) => (it.c || []).indexOf("de") >= 0));
  const oi = V.euParseSearch(FX.oi, { src: "oi", page: 1 });
  assert.ok(oi.items.length > 0 && oi.items.every((it) => it.s === "oi" && /^https:\/\/www\.openbeelden\.nl\//.test(it.u)));
  assert.deepEqual(V.euParseSearch({ success: false, error: "Invalid API key" }, {}).error, "key");
  assert.equal(V.euKeyOk("ab cd"), false);
  assert.equal(V.euKeyOk("abcdef12"), true);
  assert.equal(V.euLic("http://creativecommons.org/licenses/by-sa/4.0/"), "CC BY-SA 4.0");
  assert.equal(V.euLic("http://rightsstatements.org/vocab/InC/1.0/"), "");
  const rec = V.euParseRecord({ object: { aggregations: [{ edmIsShownBy: "http://example.org/a.mp4" }] } });
  assert.equal(rec.url, "https://example.org/a.mp4");
  assert.equal(V.euParseRecord({ object: { aggregations: [{ edmIsShownBy: "https://example.org/page.html" }] } }), null);
});

test("PeerTube: CC only; checked only on own-work servers, the rest behind the switch", () => {
  const u = V.ptSearchUrl({ q: "", f: { len: "long", l: "fr", ty: "film" }, page: 1 });
  assert.match(u, /^https:\/\/sepiasearch\.org\/api\/v1\/search\/videos\?/);
  assert.match(u, /nsfw=false/); assert.match(u, /durationMin=2400/); assert.match(u, /categoryOneOf=2/);
  assert.equal(V.ptParseSearch(FX.pt, { f: {} }).items.length, 0);       // none of these is checked
  const all = V.ptParseSearch(FX.pt, { f: { all: 1 } }).items;
  assert.ok(all.length > 0 && all.every((it) => it.ok === 0 && it.why === "listed"));
  const own = V.ptParseSearch(FX.ptb, { f: {} }).items;
  assert.ok(own.length > 0 && own.every((it) => it.ok === 1 && it.why === "pt" && /^pt:video\.blender\.org\//.test(it.k)));
  own.forEach((it) => assert.ok(it.d >= 1));
  const k = "pt:" + FX.ptVideoHost + "/" + FX.ptVideoUuid;
  assert.equal(V.ptVideoUrl(k), "https://video.blender.org/api/v1/videos/" + FX.ptVideoUuid);
  assert.equal(V.ptVideoUrl("pt:evil.example/../x"), "");
  const v = V.ptParseVideo(FX.ptVideo, k, () => "maybe");
  assert.match(v.url, /^https:\/\/video\.blender\.org\//);
  const h = V.ptParseVideo(FX.ptVideo, k, () => "");
  assert.ok(!h || (h.hls === 1 && /\.m3u8/.test(h.url)));
  const caps = V.ptParseCaptions({ data: [{ language: { id: "fr", label: "French" }, captionPath: "/lazy-static/video-captions/x-fr.vtt" }, { language: { id: "en" }, captionPath: "javascript:x" }] }, k);
  assert.deepEqual(caps.map((c) => c.url), ["https://video.blender.org/lazy-static/video-captions/x-fr.vtt"]);
});

test("subtitles: Commons TimedText list, SubRip to WebVTT, file-name languages", () => {
  const s = V.commonsParseSubs(FX.commonsSubs, "Nosferatu (1922).webm");
  assert.ok(s.length >= 3);
  assert.ok(s.some((x) => x.l === "en"));
  assert.equal(s.filter((x) => x.l === "en").length, 1);
  s.forEach((x) => { assert.match(x.url, /^https:\/\/commons\.wikimedia\.org\/w\/api\.php\?/); assert.match(x.url, /trackformat=vtt/); });
  assert.match(V.commonsSubsUrl("Nosferatu (1922).webm"), /apprefix=Nosferatu_\(1922\)\.webm&/);
  const vtt = V.srtToVtt("﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Hello</i>\r\n");
  assert.equal(vtt, "WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\n<i>Hello</i>\n");
  assert.equal(V.srtToVtt("WEBVTT\n\nx"), "WEBVTT\n\nx");
  assert.equal(V.subLang("film.el.srt"), "el");
  assert.equal(V.subLang("Film_greek.srt"), "el");
  assert.equal(V.subLang("film.asr.srt"), "");
  assert.equal(V.subLang("film.srt"), "");
});

test("saved searches: synced, no duplicates, removal wins when newer, merge symmetric", () => {
  const a = {}, b = {};
  const id = V.saveSearch(a, { n: "noir", q: "noir", f: { dec: 1940 } }, 1000, "aaaa1111");
  assert.equal(id, "aaaa1111");
  assert.equal(V.saveSearch(a, { n: "again", q: "NOIR", f: { dec: 1940 } }, 1100), "");
  assert.equal(V.saveSearch(a, { n: "", q: "", f: {} }, 1200), "");
  V.saveSearch(b, { n: "nasa", q: "", f: { src: "na" } }, 1500, "bbbb2222");
  const ab = V.mergeVod(a, b, {}), ba = V.mergeVod(b, a, {});
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.deepEqual(V.savedList(ab).map((x) => x.id), ["bbbb2222", "aaaa1111"]);
  const c = JSON.parse(JSON.stringify(ab));
  assert.ok(V.dropSearch(c, "aaaa1111", 2000));
  const m = V.mergeVod(ab, c, {});
  assert.deepEqual(V.savedList(m).map((x) => x.id), ["bbbb2222"]);
  const bad = { ss: { "BAD id": { n: "x", m: 1 }, okid1234: { n: "<b>", q: "a", m: 2 } } };
  V.normVod(bad);
  assert.deepEqual(Object.keys(bad.ss), ["okid1234"]);
});

test("newer-source keys survive normalisation; Commons / Archive keys stay strict", () => {
  assert.ok(V.item({ k: "na:as11-apollo-11-launch", t: "x" }));
  assert.ok(V.item({ k: "eu:/08604/_filmportal_de_node_1224912", t: "x" }));
  assert.ok(V.item({ k: "pt:video.blender.org/0b7c4a1e-1111-2222-3333-444455556666", t: "x" }));
  assert.equal(V.item({ k: "wd:Q1 OR 1", t: "x" }), null);
  assert.equal(V.item({ k: "xx:<script>", t: "x" }), null);
});
