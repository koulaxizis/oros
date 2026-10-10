// Pure logic of the One-Minute Museum (museum/core.js): reading
// Wikipedia's REST answers into exhibits (stubs, disambiguation pages
// and missing pictures skipped), the day's featured feed and "On this
// day", the fixed-host links, and the collection merge (slice "museum").
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "museum/core.js"));

const LONG = "The quick brown fox jumps over the lazy dog. ".repeat(6);
const summary = (pageid, extra) => Object.assign({
  type: "standard", pageid, title: "Page " + pageid, description: "a test page",
  extract: LONG,
  thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/320px-X.jpg" }
}, extra || {});
const empty = () => ({ ver: 1, items: [], tombs: {} });
const item = (pid, m, extra) => Object.assign(C.toItem(C.parseSummary(summary(pid), "en"), m), extra || {});

test("parseSummary: a normal article becomes an exhibit on fixed hosts", () => {
  const x = C.parseSummary(summary(42, { title: "Ada Lovelace", extract: "<b>Ada</b> &amp; " + LONG }), "en");
  assert.equal(x.id, "en42");
  assert.equal(x.kind, "article");
  assert.equal(x.title, "Ada Lovelace");
  assert.ok(x.extract.startsWith("Ada & The quick"));
  assert.equal(x.url, "https://en.wikipedia.org/wiki/Ada_Lovelace");
  assert.equal(x.hist, "https://en.wikipedia.org/w/index.php?title=Ada_Lovelace&action=history");
  assert.ok(x.thumb.startsWith("https://upload.wikimedia.org/"));
  assert.equal(C.safeLink(x.url), x.url);
  const g = C.parseSummary(summary(7, { title: "Αθήνα" }), "el");
  assert.equal(g.id, "el7");
  assert.equal(g.url, "https://el.wikipedia.org/wiki/" + encodeURIComponent("Αθήνα"));
  assert.equal(C.parseSummary(summary(7), "fr").lang, "en");
});

test("parseSummary: disambiguation, stubs, no picture and bad answers are skipped", () => {
  assert.equal(C.parseSummary(summary(1, { type: "disambiguation" }), "en").skip, "disambiguation");
  assert.equal(C.parseSummary(summary(1, { extract: "Too short." }), "en").skip, "stub");
  assert.ok(!C.parseSummary(summary(1, { extract: "Too short." }), "en", { anyLength: true }).skip);
  assert.equal(C.parseSummary(summary(1, { thumbnail: null }), "en", { needImage: true }).skip, "noimage");
  assert.equal(C.parseSummary(summary(1, { thumbnail: { source: "https://evil.example/x.jpg" } }), "en", { needImage: true }).skip, "noimage");
  assert.equal(C.parseSummary(summary(1, { thumbnail: { source: "javascript:alert(1)" } }), "en").thumb, "");
  [null, "x", 5, summary(0), summary(-3), summary(1.5), summary("12"), summary(1, { title: "" })]
    .forEach((j) => assert.equal(C.parseSummary(j, "en").skip, "bad"));
});

test("parsePicture: picture of the day with credit, stable id", () => {
  const img = {
    title: "File:Blue_Marble_2002.png",
    thumbnail: { source: "https://upload.wikimedia.org/a/b/640px-Blue.png" },
    description: { text: "The <i>Earth</i> from space" },
    artist: { text: "NASA" }, license: { type: "Public domain" }
  };
  const p = C.parsePicture(img, "en");
  assert.equal(p.kind, "picture");
  assert.match(p.id, /^pf[a-z0-9]{6,20}$/);
  assert.ok(C.ID_RE.test(p.id));
  assert.equal(p.id, C.parsePicture(img, "el").id);
  assert.equal(p.title, "Blue Marble 2002");
  assert.equal(p.extract, "The Earth from space");
  assert.equal(p.credit, "NASA · Public domain");
  assert.equal(p.url, "https://commons.wikimedia.org/wiki/File%3ABlue_Marble_2002.png");
  assert.equal(C.parsePicture({ title: "File:X.png" }, "en").skip, "bad");
  assert.equal(C.parsePicture(null, "en").skip, "bad");
});

test("parseFeatured: featured article, picture, most read; no repeats", () => {
  const f = {
    tfa: summary(1, { extract: "Short but featured." }),
    image: { title: "File:A.jpg", image: { source: "https://upload.wikimedia.org/A.jpg" } },
    mostread: { articles: [summary(1), summary(2), summary(3, { type: "disambiguation" }), summary(4, { extract: "stub" }), summary(5)] }
  };
  const list = C.parseFeatured(f, "en");
  assert.deepEqual(list.map((x) => x.id.slice(0, 2) === "pf" ? "pf" : x.id), ["en1", "pf", "en2", "en5"]);
  assert.deepEqual(C.parseFeatured(null, "en"), []);
  assert.deepEqual(C.parseFeatured({}, "en"), []);
});

test("parseFeatured: on this day takes the first good page of each event", () => {
  const f = {
    onthisday: [
      { year: 1969, text: "Apollo 11 <b>lands</b> on the Moon.", pages: [summary(9, { type: "disambiguation" }), summary(10, { extract: "x" })] },
      { year: 1492, text: "Columbus sails.", pages: [summary(10)] },
      { text: "No pages.", pages: [] },
      { year: 2000, text: "Bad", pages: "nope" }
    ]
  };
  const list = C.parseFeatured(f, "en", true);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "en10");
  assert.equal(list[0].event, "1969: Apollo 11 lands on the Moon.");
});

test("safeLink / safeImg: only Wikimedia hosts over https", () => {
  ["https://en.wikipedia.org/wiki/X", "https://el.wikipedia.org/wiki/Y", "https://commons.wikimedia.org/wiki/File:Z"]
    .forEach((u) => assert.equal(C.safeLink(u), u));
  ["http://en.wikipedia.org/wiki/X", "https://fr.wikipedia.org/wiki/X", "https://en.wikipedia.org.evil.com/x",
   "javascript:alert(1)", "https://en.wikipedia.org/wiki/\"onmouseover", null, 5]
    .forEach((u) => assert.equal(C.safeLink(u), ""));
  assert.equal(C.safeImg("https://upload.wikimedia.org/a.jpg"), "https://upload.wikimedia.org/a.jpg");
  ["http://upload.wikimedia.org/a.jpg", "https://upload.wikimedia.org.evil/a.jpg", "https://upload.wikimedia.org/a(1).jpg", ""]
    .forEach((u) => assert.equal(C.safeImg(u), ""));
  assert.match(C.featuredUrl("el", new Date(Date.UTC(2026, 0, 5, 23))), /^https:\/\/el\.wikipedia\.org\/api\/rest_v1\/feed\/featured\/2026\/01\/05$/);
  assert.equal(C.randomUrl("xx"), "https://en.wikipedia.org/api/rest_v1/page/random/summary");
});

test("merge: commutative, associative, idempotent; canonical order", () => {
  const A = C.mergeMuseum({ items: [item(1, 10), item(2, 5)], tombs: { en3: 4 } }, empty());
  const B = C.mergeMuseum({ items: [item(2, 7, { title: "Newer" }), item(3, 3)], tombs: {} }, empty());
  const D = C.mergeMuseum({ items: [item(4, 1)], tombs: { en1: 9 } }, empty());
  const j = (x) => JSON.stringify(x);
  assert.equal(j(C.mergeMuseum(A, B)), j(C.mergeMuseum(B, A)));
  assert.equal(j(C.mergeMuseum(C.mergeMuseum(A, B), D)), j(C.mergeMuseum(A, C.mergeMuseum(B, D))));
  assert.equal(j(C.mergeMuseum(A, A)), j(A));
  const M = C.mergeMuseum(A, B);
  assert.deepEqual(M.items.map((x) => x.id), ["en1", "en2"]);
  assert.equal(C.findItem(M, "en2").title, "Newer");
  assert.equal(C.findItem(M, "en3"), null);       // tomb 4 ≥ m 3
});

test("merge: delete wins ties, a newer save resurrects (Undo, R17)", () => {
  const saved = C.mergeMuseum({ items: [item(1, 10)] }, empty());
  const del = C.mergeMuseum({ items: [], tombs: { en1: 10 } }, empty());
  assert.equal(C.mergeMuseum(saved, del).items.length, 0);
  const undo = C.mergeMuseum({ items: [item(1, 11)] }, empty());
  const back = C.mergeMuseum(C.mergeMuseum(saved, del), undo);
  assert.equal(back.items.length, 1);
  assert.equal(back.tombs.en1, 10);
  const tie1 = C.mergeMuseum({ items: [item(1, 5, { title: "A" })] }, empty());
  const tie2 = C.mergeMuseum({ items: [item(1, 5, { title: "B" })] }, empty());
  assert.equal(JSON.stringify(C.mergeMuseum(tie1, tie2)), JSON.stringify(C.mergeMuseum(tie2, tie1)));
});

test("merge: junk is dropped, fields are clipped and re-checked", () => {
  const good = item(1, 1);
  const junk = [
    null, 5, "x", {}, Object.assign({}, good, { id: "fr1" }), Object.assign({}, good, { m: -1 }),
    Object.assign({}, good, { m: 1.5 }), Object.assign({}, good, { url: "https://evil.example/" }),
    Object.assign({}, good, { title: "  " }), Object.assign({}, good, { kind: "picture" }),
    Object.assign({}, good, { id: "pfabcdefg" })
  ];
  const M = C.mergeMuseum({ items: junk.concat([Object.assign({}, good, {
    id: "en2", title: "T".repeat(999), thumb: "https://evil.example/x.jpg", hist: "javascript:x", lang: "de"
  })]), tombs: { "bad id": 5, en9: -1, en8: "3", en7: 2 } }, { items: "nope", tombs: [] });
  assert.equal(M.items.length, 1);
  const x = M.items[0];
  assert.equal(x.title.length, C.MAX_TITLE);
  assert.equal(x.thumb, "");
  assert.equal(x.hist, "");
  assert.equal(x.lang, "en");
  assert.deepEqual(M.tombs, { en7: 2 });
  assert.deepEqual(C.mergeMuseum(null, undefined), empty());
});

test("toItem, newestFirst, shuffle", () => {
  const x = C.parseSummary(summary(5), "en");
  const it = C.toItem(x, 123);
  assert.equal(it.m, 123);
  assert.equal(it.id, "en5");
  assert.equal(C.toItem(Object.assign({}, x, { url: "https://evil/" }), 1), null);
  const list = [item(1, 1), item(2, 3), item(3, 3)];
  assert.deepEqual(C.newestFirst(list).map((i) => i.id), ["en2", "en3", "en1"]);
  let s = 1;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const a = [1, 2, 3, 4, 5, 6, 7, 8];
  const sh = C.shuffle(a, r);
  assert.deepEqual(sh.slice().sort(), a);
  assert.deepEqual(a, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(C.shuffle([], r), []);
});

test("app: strings match in both languages, every data-i18n key exists", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "museum/museum.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "museum/index.html"), "utf8");
  const S = new Function(js.slice(js.indexOf("  var STRINGS"), js.indexOf("  function t(")) + "\nreturn STRINGS;")();
  assert.deepEqual(Object.keys(S.el).sort(), Object.keys(S.en).sort());
  [...html.matchAll(/data-i18n="([^"]+)"/g)].forEach((m) => assert.ok(m[1] in S.en, m[1]));
  [...html.matchAll(/id="([^"]+)"/g)].forEach((m, i, all) =>
    assert.equal(all.filter((n) => n[1] === m[1]).length, 1, "duplicate id " + m[1]));
  [...js.matchAll(/\$\("([a-z-]+)"\)/g)].forEach((m) => assert.ok(html.includes('id="' + m[1] + '"'), "missing #" + m[1]));
  assert.match(js, /inheritPalette/);
  assert.match(js, /watchPalette/);
});
