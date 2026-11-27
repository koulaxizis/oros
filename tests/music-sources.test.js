// Music: sources that answered nothing on a phone (MU-RELAY, MU-MB503)
// and search that finds the songs you already listen to (MU-FIND2).
// - open.js getJSON gives feeds/fetch.js the default relay when Mail has
//   none (ccMixter and Kevin MacLeod's list send no CORS header);
// - a 503 / 429 is "busy", and MusicBrainz asks again twice;
// - search lists liked / playlist / recently played songs of the free
//   catalogues and their artists.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
globalThis.OrosMusicCore = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;
const O = require(path.join(__dirname, "..", "music/open.js"));

function fakeFF(answer) {
  const seen = [];
  globalThis.orosFeedsFetch = {
    relayUrl: () => "",
    fetchOne: (url, opts) => { seen.push({ url, relay: typeof opts.relay === "function" ? opts.relay() : opts.relay }); return answer(url); }
  };
  return seen;
}

test("a source with no CORS header still has a relay on a device with no Mail relay", async () => {
  const seen = fakeFF(() => Promise.resolve({ status: 200, text: '{"ok":1}' }));
  const j = await O.getJSON("https://ccmixter.org/api/query?f=json&test=relay1");
  assert.deepEqual(j, { ok: 1 });
  assert.equal(seen[0].relay, "https://oros-mail-relay.koulaxizis.workers.dev");
  // Mail's own relay wins when there is one.
  globalThis.orosFeedsFetch.relayUrl = () => "https://my-relay.example.workers.dev";
  await O.getJSON("https://ccmixter.org/api/query?f=json&test=relay2");
  assert.equal(seen[1].relay, "https://my-relay.example.workers.dev");
  delete globalThis.orosFeedsFetch;
});

test("503 and 429 answers are 'busy', other errors 'http'", async () => {
  for (const [st, code] of [[503, "busy"], [429, "busy"], [500, "http"], [404, "http"]]) {
    fakeFF(() => Promise.resolve({ status: st, text: "" }));
    await assert.rejects(O.getJSON("https://musicbrainz.org/ws/2/artist?st=" + st), (e) => e.code === code);
  }
  delete globalThis.orosFeedsFetch;
});

test("MusicBrainz: a refusal is asked again twice, 3 s and 6 s later", () => {
  const a = read("music/artists.js");
  assert.match(a, /var MB_RETRY = \[3000, 6000\];/);
  assert.match(a, /e\.code === "busy"\) \|\| n >= MB_RETRY\.length\) throw e;/);
  const A = require(path.join(__dirname, "..", "music/artists.js"));
  assert.deepEqual(A.MB_RETRY, [3000, 6000]);
});

test("search: liked, playlist and recent songs of the free catalogues, with their artists", () => {
  const m = read("music/music.js");
  assert.match(m, /function mineMatches\(w, have\)/);
  assert.match(m, /C\.likedList\(D\(\)\)\.forEach\(function \(l\) \{ if \(l\.on !== 0\) add\(l\); \}\);/);
  assert.match(m, /D\(\)\.pls\.forEach\(function \(p\) \{ p\.it\.forEach\(add\); \}\);/);
  assert.match(m, /H\.history\(\)/);
  assert.match(m, /if \(mine\.length\) mineSection\(box, mine, q\);/);
  // the words are matched like the library search
  const C = globalThis.OrosMusicCore;
  assert.equal(C.matches({ t: "Este Quarto", a: "Door213" }, C.words("door213")), true);
  assert.equal(C.matches({ t: "Este Quarto", a: "Door213" }, C.words("quarto door")), true);
  assert.equal(C.matches({ t: "Este Quarto", a: "Door213" }, C.words("rapcore")), false);
  for (const f of ["music/music.js"]) assert.equal((read(f).match(/"sec\.mine":/g) || []).length, 2);
  assert.match(read("i18n/de/music.js"), /"sec\.mine":/);
});

test("a MusicBrainz album page keeps the release's own cover from the card", () => {
  const m = read("music/music.js");
  assert.match(m, /openView\(\{ kind: "mbr", id: r\.id, n: r\.n, a: r\.a, ai: r\.ai, art: r\.art \|\| "" \}\)/);
  assert.match(m, /coverartarchive\\\.org\\\/release\\\/\[0-9a-f-\]\{36\}\\\/front-250\$/);
});
