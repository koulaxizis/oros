// Radio RX-MORE (2026-11-21): more stations from radio-browser.info
// (pages, Languages, Discover lists) and one row per station.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const T = require(path.join(__dirname, "..", "radio/tools.js"));
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "radio/radio.js"), "utf8");
const html = fs.readFileSync(path.join(root, "radio/index.html"), "utf8");
const de = fs.readFileSync(path.join(root, "i18n/de/radio.js"), "utf8");

test("stream key: scheme, www, default port, trailing slash or ; and tracking params do not count", () => {
  const k = T.streamKey("https://stream.skai.gr/live/");
  assert.equal(k, "stream.skai.gr/live");
  assert.equal(T.streamKey("http://www.stream.skai.gr:80/live;"), k);
  assert.equal(T.streamKey("HTTPS://Stream.Skai.gr:443/live?utm_source=app"), k);
  assert.equal(T.streamKey("https://stream.skai.gr/live?listening-from-radio-garden=1"), k);
  assert.notEqual(T.streamKey("https://stream.skai.gr/live?sid=2"), k, "a real query (Shoutcast sid) counts");
  assert.equal(T.streamKey("https://a.b/x?b=2&a=1"), T.streamKey("https://a.b/x?a=1&b=2"), "query order does not count");
  assert.notEqual(T.streamKey("https://stream.skai.gr:8000/live"), k, "another port is another stream");
  assert.equal(T.streamKey("ftp://x"), "");
  assert.equal(T.streamKey(null), "");
});

test("name key: homepage host + folded name, both needed", () => {
  assert.equal(T.nameKey("Χρώμα 105,8", "https://www.xroma.gr/"), T.nameKey("ΧΡΩΜΑ  105.8", "http://xroma.gr/live"));
  assert.notEqual(T.nameKey("Χρώμα 105,8", "https://xroma.gr/"), T.nameKey("Χρώμα 105,8", "https://other.gr/"));
  assert.equal(T.nameKey("Χρώμα", ""), "");
  assert.equal(T.nameKey("", "https://xroma.gr"), "");
});

test("dedupe: one row per station; within a page the one with more votes stays, in place", () => {
  const rows = [
    { stationuuid: "a", name: "Skai 100.3", url_resolved: "http://skai.gr/s", votes: 3 },
    { stationuuid: "c", name: "Other", url_resolved: "https://other.gr/s", votes: 2 },
    { stationuuid: "b", name: "SKAI 100.3 FM", url_resolved: "https://www.skai.gr/s/", votes: 9 },
    { stationuuid: "d", name: "Off Radio", homepage: "https://offradio.gr", url_resolved: "https://s1.off/1", votes: 5 },
    { stationuuid: "e", name: "OFF radio", homepage: "http://www.offradio.gr/", url_resolved: "https://s2.off/2", votes: 1 }
  ];
  assert.deepEqual(T.dedupe(rows).map((r) => r.stationuuid), ["b", "c", "d"]);
});

test("dedupe across pages: a station of an earlier page never shows again", () => {
  const seen = { s: {}, n: {} };
  const p0 = T.dedupe([{ stationuuid: "a", url_resolved: "https://x.gr/s", votes: 9 }], seen);
  const p1 = T.dedupe([{ stationuuid: "b", url_resolved: "https://x.gr/s/", votes: 1 },
                       { stationuuid: "c", url_resolved: "https://y.gr/s", votes: 1 }], seen);
  assert.deepEqual(p0.map((r) => r.stationuuid), ["a"]);
  assert.deepEqual(p1.map((r) => r.stationuuid), ["c"]);
  assert.deepEqual(T.dedupe(null), []);
});

test("favourites: the same stream under another id is the same favourite (one heart)", () => {
  const fav = { stationuuid: "a", url_resolved: "https://x.gr/s" };
  assert.ok(T.sameStation(fav, { stationuuid: "a" }));
  assert.ok(T.sameStation(fav, { stationuuid: "b", url_resolved: "http://www.x.gr/s/" }));
  assert.ok(!T.sameStation(fav, { stationuuid: "b", url_resolved: "https://y.gr/s" }));
  assert.ok(!T.sameStation({ stationuuid: "a" }, { stationuuid: "b" }), "no stream on either side: ids decide");
  // radio.js finds and removes that favourite, never adds a second
  const fn = src.slice(src.indexOf("function favoriteToggle("), src.indexOf("function favoriteToggle(") + 900);
  assert.match(fn, /findFavorite\(payload\.favorites, station\)/);
  assert.match(fn, /payload\.deleted\[existing\.stationuuid\]/);
});

test("list paths: country by its code, pages of 100, sorted by the directory", () => {
  assert.equal(T.PAGE, 100);
  assert.equal(T.listPath("country", "GR", 0),
    "/json/stations/bycountrycodeexact/GR?order=votes&reverse=true&hidebroken=true&limit=100&offset=0");
  assert.match(T.listPath("country", "GR", 2), /&offset=200$/);
  assert.match(T.listPath("language", "greek", 1), /^\/json\/stations\/bylanguageexact\/greek\?order=votes.*&offset=100$/);
  assert.match(T.listPath("tag", "jazz & blues", 0), /^\/json\/stations\/bytag\/jazz%20%26%20blues\?/);
  assert.match(T.listPath("trend", "", 0), /order=clicktrend&reverse=true/);
  assert.match(T.listPath("fresh", "", 0), /order=changetimestamp&reverse=true/);
  assert.match(T.listPath("random", "", 5), /order=random&hidebroken=true&limit=100$/);
  assert.match(T.listPath("search", "a&b", 0), /name=a%26b&/);
  assert.equal(T.listPath("nope", "", 0), "");
  assert.doesNotMatch(src, /bycountryexact/, "the country NAME endpoint matched no code: lists were empty");
});

test("language names follow the interface language", () => {
  assert.equal(T.langLabel({ name: "greek", iso_639: "el" }, "en"), "Greek");
  assert.equal(T.langLabel({ name: "greek", iso_639: "el" }, "el"), "Ελληνικά");
  assert.equal(T.langLabel({ name: "greek", iso_639: "el" }, "de"), "Griechisch");
  assert.equal(T.langLabel({ name: "klingon", iso_639: "" }, "en"), "Klingon");
  assert.equal(T.langLabel(null, "en"), "");
});

test("the app: Languages tab, Discover chips, More button; EN, EL and DE strings", () => {
  assert.match(html, /id="rx-tab-languages"/);
  assert.match(src, /"rx-tab-languages": "tab\.languages"/);
  assert.match(src, /var DISCOVER_KINDS = \["top", "trend", "fresh", "random"\]/);
  assert.match(src, /RT\.dedupe\(data, seen\)/);
  const keys = ["tab.languages", "view.languages", "disc.label", "disc.top", "disc.trend", "disc.fresh", "disc.random",
    "view.trend", "view.fresh", "view.random", "more.stations", "more.random", "more.loading"];
  const en = src.slice(src.indexOf("  en: {"), src.indexOf("  el: {"));
  const el = src.slice(src.indexOf("  el: {"));
  for (const k of keys) {
    const re = new RegExp('"' + k.replace(".", "\\.") + '":');
    assert.match(en, re, "en " + k);
    assert.match(el, re, "el " + k);
    assert.match(de, re, "de " + k);
  }
});
