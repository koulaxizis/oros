// Radio "Import stations" (radio/import.js): M3U / M3U8 (EXTINF with
// tvg-logo), RadioDroid's M3U (#RADIOBROWSERUUID), PLS, XSPF, CSV with
// and without a header; https only (http skipped with its reason, or
// tried over https on request), dedupe by URL inside the file and
// against the favourites, stable ids, caps.
// Fixtures: tests/fixtures/radio/
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const I = require(path.join(__dirname, "..", "radio/import.js"));
const FX = path.join(__dirname, "fixtures", "radio");
const fx = (n) => fs.readFileSync(path.join(FX, n), "utf8");

test("M3U: names, logos, comma in a name, bare URL lines", () => {
  const r = I.parseText(fx("stations.m3u"), "stations.m3u");
  assert.equal(r.source, "m3u");
  assert.equal(r.stations.length, 7);
  assert.deepEqual(r.stations[0], { name: "FIP", url: "https://icecast.radiofrance.fr/fip-hifi.aac", logo: "https://img.example.org/fip.png", uuid: "" });
  assert.equal(r.stations[1].name, "Old Station, with comma");
  assert.equal(r.stations[6].name, "");
  assert.equal(r.stations[6].url, "https://bare.example.org/radio.mp3");
});

test("M3U plan: https only, http skipped with reason, dup / playlist / bad listed", () => {
  const r = I.parseText(fx("stations.m3u"), "stations.m3u");
  const p = I.plan(r, { favorites: [] });
  assert.deepEqual(p.add.map((s) => s.name), ["FIP", "<img src=x onerror=alert(1)>", "bare.example.org"]);
  assert.equal(p.add[0].favicon, "https://img.example.org/fip.png");
  assert.ok(/^imp-[0-9a-z]+$/.test(p.add[0].stationuuid));
  const why = Object.fromEntries(p.skip.map((s) => [s.name, s.why]));
  assert.equal(why["Old Station, with comma"], "http");
  assert.equal(why["Duplicate FIP"], "dup");            // trailing "/" = same stream
  assert.equal(why["A playlist link"], "playlist");
  assert.equal(why["Broken"], "bad");
  assert.deepEqual(p.stats, { found: 7, add: 3, http: 1, have: 0, dup: 1, bad: 2, up: 0 });
});

test("upgrade: an http station is tried over https (the app's RX-HTTPS rule), no http logo", () => {
  const r = I.parseText(fx("stations.m3u"), "stations.m3u");
  const p = I.plan(r, { favorites: [] }, { upgrade: true });
  const old = p.add.find((s) => s.name === "Old Station, with comma");
  assert.equal(old.url_resolved, "https://stream.example.com:8000/live");
  assert.equal(old.up, true);
  assert.equal(old.favicon, undefined);
  assert.equal(p.stats.up, 1);
  assert.equal(p.stats.http, 0);
});

test("RadioDroid export keeps the radio-browser uuid", () => {
  const r = I.parseText(fx("radiodroid.m3u"), "favourites.m3u");
  assert.equal(r.source, "radiodroid");
  assert.equal(r.stations[0].uuid, "96062a7b-0601-11e8-ae97-52543be04c81");
  const p = I.plan(r, { favorites: [] });
  assert.equal(p.add.length, 1);
  assert.equal(p.add[0].stationuuid, "96062a7b-0601-11e8-ae97-52543be04c81");
  assert.equal(p.skip[0].why, "http");
  // a favourite with that uuid already → "have"
  const p2 = I.plan(r, { favorites: [{ stationuuid: "96062a7b-0601-11e8-ae97-52543be04c81", url_resolved: "https://x.example/other" }] });
  assert.equal(p2.add.length, 0);
  assert.equal(p2.stats.have, 1);
});

test("PLS: FileN / TitleN in order, CRLF", () => {
  const r = I.parseText(fx("somafm.pls"), "somafm.pls");
  assert.equal(r.source, "pls");
  assert.deepEqual(r.stations.map((s) => s.name), ["SomaFM: Groove Salad", "SomaFM: Drone Zone"]);
  const p = I.plan(r, { favorites: [] });
  assert.equal(p.add.length, 1);
  assert.equal(p.stats.http, 1);
});

test("XSPF: location, title, image, entities and CDATA", () => {
  const r = I.parseText(fx("list.xspf"), "list.xspf");
  assert.equal(r.source, "xspf");
  assert.equal(r.stations[0].url, "https://radio.example.gr/live?x=1&y=2");
  assert.equal(r.stations[0].name, "Ράδιο Αθήνα & Φίλοι");
  assert.equal(r.stations[0].logo, "https://radio.example.gr/logo.png");
  assert.equal(r.stations[1].name, "Jazz <FM>");
});

test("CSV with a header, and without one (semicolons)", () => {
  const r = I.parseText(fx("stations.csv"), "stations.csv");
  assert.equal(r.source, "csv");
  assert.deepEqual(r.stations.map((s) => s.name), ["Kosmos", "Café, Paris", "Plain"]);
  const n = I.parseText(fx("noheader.csv"), "my.csv");
  assert.equal(n.source, "csv");
  assert.deepEqual(n.stations.map((s) => [s.name, s.url]), [
    ["Kosmos", "https://kosmos.example.gr/stream"], ["Other", "https://other.example.gr/s"]]);
});

test("dedupe against the favourites by URL; same file twice adds nothing", () => {
  const r = I.parseText(fx("stations.csv"), "stations.csv");
  const p = I.plan(r, { favorites: [{ stationuuid: "abc", url_resolved: "https://KOSMOS.example.gr/stream/" }] });
  assert.deepEqual(p.add.map((s) => s.name), ["Café, Paris"]);
  assert.equal(p.stats.have, 1);
  const again = I.plan(r, { favorites: [{ stationuuid: "abc", url_resolved: "https://kosmos.example.gr/stream" }].concat(p.add) });
  assert.equal(again.add.length, 0);
  // ids are stable from the URL
  assert.equal(I.plan(r, { favorites: [] }).add[1].stationuuid, I.plan(r, { favorites: [] }).add[1].stationuuid);
});

test("errors and caps", () => {
  assert.equal(I.parseText("", "x.m3u").error, "empty");
  assert.equal(I.parseText("#EXTM3U\n# nothing\n", "x.m3u").error, "empty");
  assert.equal(I.parseText("just some words\nand more", "x.txt").error, "bad");
  let big = "#EXTM3U\n";
  for (let i = 0; i < I.MAX_STATIONS + 50; i++) big += "#EXTINF:-1,S" + i + "\nhttps://s" + i + ".example.com/live\n";
  assert.equal(I.parseText(big, "big.m3u").stations.length, I.MAX_STATIONS);
  assert.equal(I.parseText("x".repeat(I.MAX_FILE + 1), "x.m3u").error, "big");
  return I.readBytes(new TextEncoder().encode(fx("somafm.pls")), "somafm.pls").then((r) => assert.equal(r.stations.length, 2));
});
