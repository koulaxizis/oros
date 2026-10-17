// Flashcards wave 5: stats (stats.js), the .oroscards file and CSV
// (package.js), the Converter (convert.js) and the wiring.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../flashcards/core.js");
const F = require("../flashcards/fsrs.js");
const S = require("../flashcards/stats.js");
const P = require("../flashcards/package.js");
const K = require("../flashcards/convert.js");
const B = require("../bundle.js");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const DAY = 86400000;
const NOW = new Date(2026, 9, 17, 12).getTime();

function world() {
  let slice = C.addDeck(C.empty(), "Words", NOW - 1e9, { id: "d1" });
  slice = C.addDeck(slice, "Verbs", NOW - 1e9, { id: "d2", par: "d1" });
  slice = C.addDeck(slice, "Maths", NOW - 1e9, { id: "d3" });
  const pic = "a".repeat(64) + ".jpg";
  const notes = C.foldNotes({}, [
    { id: "n1", m: 1, k: "basic", dk: "d1", f: { q: "hola", a: "hello" }, tg: ["es"], md: { q: [pic] } },
    { id: "n2", m: 1, k: "rev", dk: "d2", f: { q: "ser", a: "to be" } },
    { id: "n3", m: 1, k: "cloze", dk: "d3", f: { x: "{{c1::2}} + 2 = 4", e: "=SUM(A1)" } },
    { id: "n4", m: 1, k: "basic", dk: "d1", f: { q: "gone", a: "x" } },
    { id: "n4", m: 2, del: 1 }
  ]);
  const reviews = C.mergeReviews([
    { i: "r1", c: "n1.0", t: NOW - 40 * DAY, g: 3, ms: 4000 },
    { i: "r2", c: "n1.0", t: NOW - 39 * DAY, g: 3 },
    { i: "r3", c: "n1.0", t: NOW - 20 * DAY, g: 3 },
    { i: "r4", c: "n1.0", t: NOW - 2 * DAY, g: 1, ms: 2000 },
    { i: "r5", c: "n2.0", t: NOW - DAY, g: 4 },
    { i: "r6", c: "n2.0", t: NOW - 1000, g: 3, ms: 6000 },
    { i: "r7", c: "n3.1", t: NOW - 500, g: 2 },
    { i: "r8", u: "r7", t: NOW - 400 },
    { i: "r9", c: "n2.1", t: NOW - 300, f: "s" }
  ], []);
  return { slice, notes, reviews, pic };
}

// ---------- stats.js ----------
test("stats: today, streak, retention, card counts, forecast, spreads", () => {
  const w = world();
  const r = S.compute(C, F, w.slice, w.notes, w.reviews, { now: NOW });
  assert.deepEqual(r.today, { n: 1, cards: 1, again: 0, ms: 6000 }, "the undone answer does not count");
  assert.equal(r.total, 6);
  assert.equal(r.streak, 3, "yesterday, the day before and today");
  assert.equal(r.heat.length, 365);
  assert.equal(r.heat[364].day, C.ymdOf(C.dayStart(NOW, 4)));
  assert.equal(r.perDay.length, 30);
  assert.equal(r.forecast.length, 30);
  // n1 was in review at r3 (ok) and r4 (Again); n2 at r6 (ok)
  assert.deepEqual(r.retention.all, { n: 3, ok: 2 });
  assert.deepEqual(r.retention.d30, { n: 3, ok: 2 }, "r3 is 20 days ago");
  assert.equal(S.pct(r.retention.all), 66.7);
  assert.equal(S.pct({ n: 0, ok: 0 }), null);
  assert.deepEqual(r.counts, { fresh: 1, learn: 1, young: 1, mature: 0, sus: 1 });
  assert.equal(r.forecast.reduce((s, d) => s + d.n, 0), 2, "the two cards that have a due date, the suspended one left out");
  assert.equal(r.intervals.reduce((s, b) => s + b.n, 0), 1);
  assert.equal(r.difficulty.reduce((s, b) => s + b.n, 0), 2);
  assert.equal(r.avgMs, 4000);
});

test("stats: one deck counts the decks inside it, and nothing else", () => {
  const w = world();
  const words = S.compute(C, F, w.slice, w.notes, w.reviews, { now: NOW, deckId: "d1" });
  assert.equal(words.total, 6, "n1 in Words + n2 in Verbs inside it");
  const maths = S.compute(C, F, w.slice, w.notes, w.reviews, { now: NOW, deckId: "d3" });
  assert.equal(maths.total, 0);
  assert.deepEqual(maths.counts, { fresh: 1, learn: 0, young: 0, mature: 0, sus: 0 });
  assert.equal(maths.streak, 0);
});

test("schedule onAnswer sees each answer once, with the card as it was before", () => {
  const w = world(), seen = [];
  const plain = C.schedule(w.slice, w.notes, w.reviews, F);
  const hooked = C.schedule(w.slice, w.notes, w.reviews, F, { onAnswer: (r, before) => seen.push([r.i, before.st]) });
  assert.deepEqual(JSON.stringify(hooked), JSON.stringify(plain), "the hook changes nothing");
  assert.deepEqual(seen, [["r1", 0], ["r2", 1], ["r3", 2], ["r4", 2], ["r5", 0], ["r6", 2]]);
});

// ---------- package.js ----------
test("package: one deck with the decks inside it; history only when asked", () => {
  const w = world();
  const b = P.build(C, w.slice, w.notes, w.reviews, { deckId: "d1", history: true, now: NOW });
  assert.equal(b.content.kind, "oros-flashcards-package");
  assert.deepEqual(b.content.decks.map((d) => [d.id, d.par || ""]), [["d1", ""], ["d2", "d1"]]);
  assert.deepEqual(b.content.notes.map((n) => n.id), ["n1", "n2"], "deleted and other-deck notes stay out");
  assert.deepEqual(b.content.reviews.map((r) => r.i), ["r1", "r2", "r3", "r4", "r5", "r6", "r9"]);
  assert.deepEqual(b.media, [w.pic]);
  const sub = P.build(C, w.slice, w.notes, w.reviews, { deckId: "d2", history: false, now: NOW });
  assert.deepEqual(sub.content.decks.map((d) => [d.id, d.par || ""]), [["d2", ""]], "the chosen deck becomes top level");
  assert.deepEqual(sub.content.reviews, []);
  const all = P.build(C, w.slice, w.notes, w.reviews, { history: true, now: NOW });
  assert.equal(all.content.notes.length, 3);
  assert.ok(all.content.reviews.some((r) => r.u === "r7"), "an undo row comes with its answer");
});

test("package: opening adds only what is missing; twice adds nothing; nothing here changes", () => {
  const w = world();
  const pkg = P.read(C, JSON.parse(JSON.stringify(P.build(C, w.slice, w.notes, w.reviews, { history: true, now: NOW }).content)));
  // An empty device.
  const p1 = P.plan(C, pkg, { slice: C.empty(), notes: {}, reviews: [], now: NOW + 1000 });
  assert.equal(p1.decks, 3);
  assert.equal(p1.notes.length, 3);
  assert.equal(p1.cards, 4);
  assert.equal(p1.rows.length, w.reviews.length);
  assert.equal(p1.answers, 7);
  const slice2 = p1.slice, notes2 = C.foldNotes({}, p1.notes), revs2 = C.mergeReviews(p1.rows, []);
  assert.equal(JSON.stringify(C.schedule(slice2, notes2, revs2, F)), JSON.stringify(C.schedule(w.slice, w.notes, w.reviews, F)),
    "same cards, same schedule on the other device");
  const p2 = P.plan(C, pkg, { slice: slice2, notes: notes2, reviews: revs2, now: NOW + 2000 });
  assert.deepEqual([p2.slice, p2.decks, p2.notes.length, p2.rows.length, p2.skipped], [null, 0, 0, 0, 3]);
  // The device that made it: an edited note stays as it is here.
  const edited = C.foldNotes(JSON.parse(JSON.stringify(w.notes)), [{ id: "n1", m: 9, k: "basic", dk: "d1", f: { q: "hola!", a: "hi" } }]);
  const p3 = P.plan(C, pkg, { slice: w.slice, notes: edited, reviews: w.reviews, now: NOW + 3000 });
  assert.equal(p3.notes.length, 0);
  assert.equal(p3.slice, null);
  // History off: no answer rows.
  assert.equal(P.plan(C, pkg, { slice: C.empty(), notes: {}, reviews: [], now: NOW, history: false }).rows.length, 0);
});

test("package: deleted here comes back newer; deck tombstones lose; future stamps clamped; media renamed", () => {
  const w = world();
  const content = P.build(C, w.slice, w.notes, [], { deckId: "d3", now: NOW }).content;
  content.notes[0].m = NOW + 365 * DAY;
  assert.equal(w.notes.n3.m, 1, "the content is a copy");
  content.reviews = [{ i: "rx", c: "n3.1", t: NOW + 365 * DAY, g: 3 }, { i: "ry", c: "n3.1", t: NOW - 10, g: 3 }];
  const pkg = P.read(C, content);
  const later = NOW + 1000;
  const p = P.plan(C, pkg, { slice: C.empty(), notes: {}, reviews: [], now: later });
  assert.ok(p.notes[0].m <= later + 5 * 60000);
  assert.deepEqual(p.rows.map((r) => r.i), ["ry"], "an answer from the future is left out");
  // Here the deck was deleted and the note too.
  const here = C.removeDeck(w.slice, "d3", NOW + 500);
  const delNotes = C.foldNotes(JSON.parse(JSON.stringify(w.notes)), [{ id: "n3", m: NOW + 600, del: 1 }]);
  const q = P.plan(C, pkg, { slice: here, notes: delNotes, reviews: [], now: later });
  assert.ok(q.slice.decks.some((d) => d.id === "d3"), "the deck comes back");
  assert.ok(q.notes[0].m > NOW + 600, "the note comes back as a newer version");
  assert.equal(C.foldNotes(delNotes, q.notes).n3.del, undefined);
  // A deck the file holds cards in, but none of them new: not added.
  const dupe = P.plan(C, pkg, { slice: C.empty(), notes: w.notes, reviews: [], now: later });
  assert.equal(dupe.slice, null);
  // Media: the names the app gave after redrawing; unknown names dropped.
  const mpkg = P.read(C, P.build(C, w.slice, w.notes, [], { deckId: "d1", now: NOW }).content);
  const ours = "b".repeat(64) + ".jpg";
  const m1 = P.plan(C, mpkg, { slice: C.empty(), notes: {}, reviews: [], now: later, mediaMap: { [w.pic]: ours } });
  assert.deepEqual(m1.notes.find((n) => n.id === "n1").md, { q: [ours] });
  const m2 = P.plan(C, mpkg, { slice: C.empty(), notes: {}, reviews: [], now: later, mediaMap: {} });
  assert.equal(m2.notes.find((n) => n.id === "n1").md, undefined);
});

test("package: hostile content is normalised; wrong kind or newer version refused", () => {
  assert.equal(P.read(C, null), null);
  assert.equal(P.read(C, { kind: "oros-layout-package", ver: 1 }), null);
  assert.equal(P.read(C, { kind: P.KIND, ver: 2 }), null, "a newer file asks for a newer orOS");
  const r = P.read(C, { kind: P.KIND, ver: 1,
    decks: [{ id: "../x", n: "bad" }, { id: "d9", n: "<img onerror=x>", m: 1, par: "d9" }, "junk"],
    notes: [{ id: "n1", m: 1, k: "script", f: { q: "a".repeat(30000), a: 1 }, md: { q: ["../../etc/passwd", "c".repeat(64) + ".svg"] } }, { id: "bad id", m: 1 }],
    reviews: [{ i: "r1", c: "n1.0", t: 5, g: 9 }, { i: "r2", c: "n1.0", t: 5, g: 2 }, { i: "r3", c: "../n", t: 5, g: 2 }] });
  assert.deepEqual(r.decks.map((d) => [d.id, d.par]), [["d9", undefined]], "no loop, bad ids out");
  assert.equal(r.decks[0].n, "<img onerror=x>", "kept as text: the app only ever sets textContent");
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].k, "basic");
  assert.equal(r.notes[0].f.q.length, 20000);
  assert.equal(r.notes[0].md, undefined, "no paths, no SVG");
  assert.deepEqual(r.reviews.map((x) => x.i), ["r2"]);
});

test("CSV: header, quoting, formulas defused, deck paths, BOM", () => {
  const w = world();
  const b = P.build(C, w.slice, w.notes, [], { now: NOW });
  const text = P.csv(C, b.content, w.slice);
  assert.ok(text.startsWith("﻿front,back,tags,deck,type\r\n"));
  const lines = text.slice(1).trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[1], "hola,hello,es,Words,basic");
  assert.equal(lines[2], "ser,to be,,Words::Verbs,rev");
  assert.equal(lines[3], "{{c1::2}} + 2 = 4,'=SUM(A1),,Maths,cloze");
  const q = P.csv(C, { decks: [], notes: [{ id: "n1", k: "basic", dk: "d0", f: { q: "a, \"b\"\nc", a: "@x" }, tg: [] }] }, C.empty());
  assert.ok(q.includes("\"a, \"\"b\"\"\nc\",'@x,,,basic"));
  assert.equal(P.fileName("My/deck: \"1\"", ".oroscards"), "My deck 1.oroscards");
  assert.equal(P.fileName("", ".csv"), "Flashcards.csv");
});

test(".oroscards through bundle.js: write, read back, same package", async () => {
  const w = world();
  const b = P.build(C, w.slice, w.notes, w.reviews, { history: true, now: NOW });
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const key = (await B.sha256(png)) + ".png";
  b.content.notes[0].md = { q: [key] };
  const bytes = await B.write({ mime: P.MIME, app: "flashcards", content: b.content, media: { [key]: png },
    preview: [{ name: "cards.csv", data: P.csv(C, b.content, w.slice) }] });
  assert.equal(B.sniff(bytes.subarray(0, 128)), P.MIME);
  const res = await B.read(bytes, { mime: P.MIME });
  assert.deepEqual(Object.keys(res.media), [key]);
  const pkg = P.read(C, res.content);
  assert.equal(pkg.notes.length, 3);
  assert.deepEqual(pkg.media, [key]);
  assert.deepEqual(B.TYPES[P.EXT], { app: "flashcards", mime: P.MIME });
});

// ---------- convert.js ----------
for (const name of ["legacy.apkg", "modern.apkg"]) {
  test("Converter: Anki " + name + " → .oroscards, the same twice, opening twice adds nothing", async () => {
    const buf = fs.readFileSync(path.join(ROOT, "tests/fixtures/flashcards-anki", name));
    const r1 = await K.convert(new File([buf], "Spanish words.apkg"), { lang: "en" });
    const r2 = await K.convert(new File([buf], "Spanish words.apkg"), { lang: "el" });
    assert.equal(r1.name, "Spanish words.oroscards");
    assert.deepEqual(r1.warnings, []);
    const read = async (r) => B.read(new Uint8Array(await r.blob.arrayBuffer()), { mime: P.MIME });
    const a = await read(r1), b = await read(r2);
    const pa = P.read(C, a.content), pb = P.read(C, b.content);
    assert.deepEqual(pa.decks.map((d) => d.id), pb.decks.map((d) => d.id), "deck ids from the deck path");
    assert.deepEqual(pa.decks.map((d) => d.n), ["Languages", "Spanish"]);
    assert.ok(pa.notes.length > 200);
    assert.ok(pa.reviews.length > 0, "the Anki study history comes along");
    assert.equal(pa.media.length, 2);
    pa.media.forEach((k) => assert.ok(a.media[k], "every picture and sound is in the file: " + k));
    const p1 = P.plan(C, pa, { slice: C.empty(), notes: {}, reviews: [], now: Date.now() });
    const p2 = P.plan(C, pb, { slice: p1.slice, notes: C.foldNotes({}, p1.notes), reviews: C.mergeReviews(p1.rows, []), now: Date.now() });
    assert.deepEqual([p2.decks, p2.notes.length, p2.rows.length], [0, 0, 0]);
  });
}

test("Converter: refuses other files with its own words", async () => {
  await assert.rejects(K.convert(new File(["x"], "a.txt"), { lang: "el" }), { code: "unsupported" });
  await assert.rejects(K.convert(new File(["not a zip"], "a.apkg"), { lang: "en" }), { code: "bad" });
  assert.match(K._deckIdFor(["A", "B"]), C.DECK_ID || /^d[0-9a-z]{1,24}$/);
  assert.notEqual(K._deckIdFor(["A", "B"]), K._deckIdFor(["A", "C"]));
});

// ---------- wiring ----------
test("wiring: page, precache, file handlers, Converter, help, strings", () => {
  const html = src("flashcards/index.html");
  ["stats.js", "package.js"].forEach((f) => assert.ok(html.indexOf(f) > 0 && html.indexOf(f) < html.indexOf("app.js?"), f + " before app.js"));
  ["id=\"stats\"", "id=\"st-scope\"", "id=\"deck-stats-btn\"", "id=\"deck-export-btn\""].forEach((x) => assert.ok(html.includes(x), x));
  const sw = src("sw.js");
  ["flashcards/stats.js", "flashcards/package.js", "flashcards/convert.js"].forEach((f) => assert.ok(sw.includes("\"" + f + "\""), f));
  const Fo = require("../fileopen.js");
  assert.deepEqual(Fo.appsFor(".oroscards"), ["flashcards"]);
  const R = require("../converter/registry.js");
  assert.equal(R.forName("deck.apkg").app, "flashcards");
  assert.equal(R.forName("all.colpkg").to, ".oroscards");
  const js = src("flashcards/app.js");
  ["openFile", "__orosTakeFile(", "OrosBundle.sniff", "FlashcardsStats", "FlashcardsPackage", "M.prepare(new File([item.bytes]"].forEach((x) => assert.ok(js.includes(x), x));
  assert.ok(!/innerHTML/.test(js), "DOM nodes and textContent only");
  ["help.en.txt", "help.el.txt"].forEach((h) => {
    const t = src("flashcards/" + h);
    assert.ok(t.includes(".oroscards"), h);
  });
  assert.ok(src("flashcards/help.en.txt").includes("## Stats"));
  assert.ok(src("flashcards/help.el.txt").includes("## Στατιστικά"));
});
