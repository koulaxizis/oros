// RX-NET (2026-11-03): the station directory behind a VPN. Chris saw
// "Couldn't reach the station directory" with Tailscale on his phone
// while favourites played: each mirror was cut off after 3 s. These
// checks keep the robust request path in place. The behaviour itself
// (slow first mirror, all mirrors down, stale cache, banner only in
// directory views) was checked in Chromium with routed requests.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "radio", "radio.js"), "utf8");

test("the mirror list ends with the round-robin name and has spares", () => {
  const m = /var RB_MIRRORS\s*=\s*\[([\s\S]*?)\];/.exec(src);
  assert.ok(m, "RB_MIRRORS found");
  const hosts = m[1].match(/https:\/\/[a-z0-9.-]+/g);
  assert.ok(hosts.length >= 5, "at least five mirrors");
  assert.equal(hosts[hosts.length - 1], "https://all.api.radio-browser.info");
});

test("no 3 s ceiling: a slow mirror gets company, each request has a generous ceiling", () => {
  const stagger = Number(/var RB_STAGGER_MS\s*=\s*(\d+)/.exec(src)[1]);
  const ceiling = Number(/var RB_CEILING_MS\s*=\s*(\d+)/.exec(src)[1]);
  assert.ok(stagger >= 1500 && stagger <= 4000, "stagger " + stagger);
  assert.ok(ceiling >= 10000, "ceiling " + ceiling);
  const fn = src.slice(src.indexOf("function rbRequest("), src.indexOf("function fetchCountries("));
  assert.doesNotMatch(fn, /\b3000\b/);
  assert.match(fn, /setTimeout\(launch, RB_STAGGER_MS\)/);
});

test("every directory fetch falls back to a stale copy before raising the banner", () => {
  const n = (src.match(/return staleOrEmpty\(/g) || []).length;
  assert.equal(n, 6, "countries, genres, by country, by tag, search, top voted");
  assert.doesNotMatch(src, /\.catch\(function\(err\)\{\n\s*console\.warn\("\[radio\][^\n]*\n\s*return \[\];/);
  const stale = Number(/var CACHE_STALE_MS\s*=\s*([\d\s*]+);/.exec(src)[1].split("*").reduce((a, b) => a * Number(b), 1));
  assert.equal(stale, 7 * 24 * 60 * 60 * 1000);
});

test("the directory banner never speaks in Favorites or Recent", () => {
  const fn = src.slice(src.indexOf("function paintCatalogBanner("), src.indexOf("function showCatalogBanner("));
  assert.match(fn, /state\.viewMode !== "favorites" && state\.viewMode !== "recents"/);
  assert.match(fn, /if\(!banner \|\| state\.offline\) return;/);
});
