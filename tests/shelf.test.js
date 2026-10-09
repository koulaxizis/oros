// Pure logic of the Media Shelf: item / session normalization, the
// merge (sync slice "shelf"), progress from sessions, pace, goals,
// yearly statistics and the list view.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–4 are cut out of the source and evaluated on their own.

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
  "\nreturn { TYPES, MAX_TAGS, TITLE_LEN, REV_LEN, isYmd, dayNum, fold, normItem, normSess, normTags, parseTags," +
  " mergeShelf, sessOf, currentRun, progressOf, completions, paceOf, goalState, yearStats, viewList, matches," +
  " initials, inkFor, COLORS, hasProgress, unitKey };")(webcrypto);

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
function data(items, ss, goals, tombs) {
  return { ver: 1, items: items || [], sess: ss || [], goals: goals || {}, tombs: tombs || {} };
}

test("dates: valid local days only, DST-safe day numbers", () => {
  assert.ok(S.isYmd("2026-02-28"));
  assert.ok(S.isYmd("2028-02-29"));
  assert.ok(!S.isYmd("2026-02-29"));
  assert.ok(!S.isYmd("2026-13-01"));
  assert.ok(!S.isYmd("26-01-01"));
  assert.equal(S.dayNum("2026-03-30") - S.dayNum("2026-03-28"), 2);    // across the EU DST change
  assert.equal(S.dayNum("2026-10-26") - S.dayNum("2026-10-24"), 2);
});

test("normItem: drops bad items, clips text, fixes per-type fields", () => {
  assert.equal(S.normItem(item("short", 1)), null);
  assert.equal(S.normItem(item(I1, 1, { title: "  " })), null);
  assert.equal(S.normItem(item(I1, 1, { type: "vinyl" })), null);
  assert.equal(S.normItem(item(I1, 1.5)), null);
  const x = S.normItem(item(I1, 5, { title: " A\u0000  long\n title " + "x".repeat(300), rate: 11, st: "lost",
    year: -3, size: 2.5, fmt: "zz", plat: "PS5", col: 99, prio: true, fav: 1,
    tags: ["Sci-Fi", "sci-fi", " Space ", "", 7, "a,b"], rev: "line\r\n\n\n\nnext\u0007" }));
  assert.equal(x.title.length, S.TITLE_LEN);
  assert.ok(x.title.startsWith("A long title "));
  assert.equal(x.rate, 0);
  assert.equal(x.st, "want");
  assert.equal(x.year, 0);
  assert.equal(x.size, 0);
  assert.equal(x.fmt, "p");                          // books default to print
  assert.equal(x.plat, "");                          // platform only for games
  assert.equal(x.col, 0);
  assert.equal(x.prio, 0);
  assert.equal(x.fav, 1);
  assert.deepEqual(x.tags, ["Sci-Fi", "Space", "ab"]);
  assert.equal(x.rev, "line\n\nnext");
  const g = S.normItem(item(I2, 5, { type: "game", fmt: "a", plat: " Switch " }));
  assert.equal(g.fmt, "");
  assert.equal(g.plat, "Switch");
  assert.equal(S.normTags(Array.from({ length: 20 }, (_, i) => "t" + i)).length, S.MAX_TAGS);
  assert.deepEqual(S.parseTags("a, b ,, A"), ["a", "b"]);
});

test("normSess: kinds, dates, progress values", () => {
  assert.deepEqual(S.normSess(sess("sess000001", 1, I1, "p", "2026-01-02", 40)),
    { id: "sess000001", m: 1, it: I1, k: "p", d: "2026-01-02", v: 40 });
  assert.deepEqual(S.normSess(Object.assign(sess("sess000001", 1, I1, "d", "2026-01-02"), { v: 9 })),
    { id: "sess000001", m: 1, it: I1, k: "d", d: "2026-01-02" });              // v only on progress
  assert.equal(S.normSess(sess("sess000001", 1, I1, "p", "2026-01-02", -1)), null);
  assert.equal(S.normSess(sess("sess000001", 1, I1, "p", "2026-01-02")), null);
  assert.equal(S.normSess(sess("sess000001", 1, I1, "q", "2026-01-02")), null);
  assert.equal(S.normSess(sess("sess000001", 1, I1, "s", "2026-02-30")), null);
  assert.equal(S.normSess(sess("sess000001", 1, "BAD", "s", "2026-02-03")), null);
});

test("mergeShelf: symmetric, associative, idempotent, canonical, inputs untouched", () => {
  const A = data([item(I1, 10), item(I2, 20, { rate: 8 })],
    [sess("sessaaaa01", 10, I1, "s", "2026-01-01"), sess("sessaaaa02", 11, I1, "p", "2026-01-02", 30)],
    { "2026-book": { m: 5, n: 20 } });
  const B = data([item(I1, 15, { title: "Renamed" }), item(I3, 5)],
    [sess("sessbbbb01", 12, I1, "p", "2026-01-03", 55)],
    { "2026-book": { m: 9, n: 12 }, "2026-film": { m: 1, n: 30 } }, { [I2]: 19 });
  const C = data([], [sess("sesscccc01", 3, I3, "s", "2026-02-01")], { "bad-key": { m: 1, n: 1 } }, { sessaaaa02: 11 });
  const snapA = JSON.stringify(A), snapB = JSON.stringify(B);
  const ab = S.mergeShelf(A, B);
  assert.deepEqual(ab, S.mergeShelf(B, A));
  assert.deepEqual(S.mergeShelf(S.mergeShelf(A, B), C), S.mergeShelf(A, S.mergeShelf(B, C)));
  assert.deepEqual(S.mergeShelf(ab, ab), ab);
  assert.equal(JSON.stringify(A), snapA);
  assert.equal(JSON.stringify(B), snapB);
  assert.deepEqual(ab.items.map((x) => x.id), [I1, I2, I3]);    // I2 edited at 20 > tomb 19: survives
  assert.equal(ab.items[0].title, "Renamed");
  assert.deepEqual(ab.sess.map((s) => s.id), ["sessaaaa01", "sessaaaa02", "sessbbbb01"]);
  assert.deepEqual(ab.goals, { "2026-book": { m: 9, n: 12 }, "2026-film": { m: 1, n: 30 } });
  const abc = S.mergeShelf(ab, C);
  assert.deepEqual(abc.sess.map((s) => s.id), ["sessaaaa01", "sessbbbb01", "sesscccc01"]);
  assert.ok(!("bad-key" in abc.goals));
});

test("mergeShelf: tombstones win ties, a newer edit resurrects, equal mtime agrees, junk is dropped", () => {
  const live = data([item(I1, 100)]);
  assert.deepEqual(S.mergeShelf(live, data([], [], {}, { [I1]: 100 })).items, []);
  assert.equal(S.mergeShelf(live, data([], [], {}, { [I1]: 99 })).items.length, 1);
  const A = data([item(I1, 10, { title: "Alpha" })]), B = data([item(I1, 10, { title: "Beta" })]);
  assert.deepEqual(S.mergeShelf(A, B), S.mergeShelf(B, A));
  const gA = data([], [], { "2026-game": { m: 4, n: 3 } }), gB = data([], [], { "2026-game": { m: 4, n: 7 } });
  assert.deepEqual(S.mergeShelf(gA, gB), S.mergeShelf(gB, gA));
  assert.deepEqual(S.mergeShelf({ items: [null, 3, { id: I1 }], sess: "x", goals: [1], tombs: { "BAD ID": 1, [I1]: -2 } }, undefined),
    { ver: 1, items: [], sess: [], goals: {}, tombs: {} });
});

test("progress = highest value since the last start; two devices never conflict", () => {
  // Phone logs page 80, laptop logs page 95: both converge to 95.
  const phone = data([item(I1, 1, { st: "now", size: 300 })],
    [sess("sesss00001", 1, I1, "s", "2026-03-01"), sess("sessp00001", 2, I1, "p", "2026-03-02", 80)]);
  const laptop = data([item(I1, 1, { st: "now", size: 300 })],
    [sess("sesss00001", 1, I1, "s", "2026-03-01"), sess("sessl00001", 3, I1, "p", "2026-03-02", 95)]);
  const m = S.mergeShelf(phone, laptop);
  assert.equal(S.progressOf(S.sessOf(m, I1)), 95);
  // A re-read starts from zero; the first read still counts as a completion.
  const reread = S.mergeShelf(m, data([], [sess("sessd00001", 4, I1, "d", "2026-03-10"),
    sess("sesss00002", 5, I1, "s", "2027-01-05")]));
  const list = S.sessOf(reread, I1);
  assert.equal(S.progressOf(list), 0);
  assert.equal(S.completions(list).length, 1);
  assert.equal(S.currentRun(list)[0].id, "sesss00002");
  assert.equal(S.progressOf([]), 0);
});

test("pace and estimate from the run's first day", () => {
  const it = S.normItem(item(I1, 1, { st: "now", size: 300 }));
  const list = [sess("sesss00001", 1, I1, "s", "2026-03-01"), sess("sessp00001", 2, I1, "p", "2026-03-10", 100)];
  const p = S.paceOf(it, list, "2026-03-10");                      // 100 pages over 10 days
  assert.equal(p.rate, 10);
  assert.equal(p.days, 20);
  assert.equal(S.paceOf(it, [sess("sesss00001", 1, I1, "s", "2026-03-01")], "2026-03-10"), null);
  const noSize = S.normItem(item(I2, 1, { st: "now" }));
  assert.equal(S.paceOf(noSize, list.map((s) => Object.assign({}, s, { it: I2 })), "2026-03-10").days, 0);
  assert.equal(S.paceOf(it, list, "2026-02-27").rate, 100);        // clock behind the start: at least a day
});

test("goal: ahead / behind an even pace, past and future years", () => {
  const mid = S.goalState(24, 12, 2026, "2026-07-02");              // day 183 of 365 → expected ≈ 12.03
  assert.equal(mid.diff, 0);
  assert.equal(mid.pct, 50);
  assert.equal(S.goalState(24, 16, 2026, "2026-07-02").diff, 4);
  assert.equal(S.goalState(24, 6, 2026, "2026-07-02").diff, -6);
  assert.equal(S.goalState(10, 7, 2025, "2026-07-02").diff, -3);    // a past year expects the full goal
  assert.equal(S.goalState(10, 0, 2027, "2026-07-02").diff, 0);
  assert.ok(S.goalState(10, 12, 2026, "2026-03-01").reached);
  assert.equal(S.goalState(10, 12, 2026, "2026-03-01").pct, 100);
  assert.equal(S.goalState(0, 3, 2026, "2026-03-01").reached, false);
});

test("yearStats: each finish counts, deleted items do not, pages only for printed books", () => {
  const D = S.mergeShelf(data([
    item(I1, 1, { st: "done", size: 300, rate: 9, by: "Ursula K. Le Guin", tags: ["sci-fi"] }),
    item(I2, 1, { st: "done", size: 600, fmt: "a", rate: 6, by: "ursula k. le guin" }),
    item(I3, 1, { type: "film", st: "now", size: 120, tags: ["Sci-Fi"] })
  ], [
    sess("sessd00001", 1, I1, "d", "2026-02-10"), sess("sessd00002", 2, I1, "d", "2026-08-01"),
    sess("sessd00003", 3, I2, "d", "2026-08-15"), sess("sessd00004", 4, I3, "d", "2026-08-20"),
    sess("sessd00005", 5, I1, "d", "2025-12-31"), sess("sessd00006", 6, "gone000001", "d", "2026-05-05")
  ]));
  const y = S.yearStats(D, 2026);
  assert.equal(y.total, 4);
  assert.equal(y.done.book, 3);
  assert.equal(y.done.film, 1);
  assert.equal(y.pages, 600);                                       // 300 twice; the audiobook adds none
  assert.deepEqual(y.months, [0, 1, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0]);
  assert.equal(y.rated, 2);
  assert.equal(y.avg, 3.75);                                        // (9 + 6) / 2 / 2
  assert.equal(y.topBy[0].n, 3);                                    // case-insensitive author
  assert.equal(y.topTags[0].n, 3);
  assert.equal(y.now, 1);
  assert.equal(S.yearStats(D, 2025).total, 1);
});

test("viewList: tabs, type filter, accent-free search, sorting", () => {
  const D = S.mergeShelf(data([
    item(I1, 1, { title: "Ο Μικρός Πρίγκιπας", by: "Saint-Exupéry", st: "want", prio: 0 }),
    item(I2, 2, { title: "Dune", type: "film", st: "want", prio: 1, year: 2021 }),
    item(I3, 3, { title: "Zelda", type: "game", st: "done", rate: 10, tags: ["Nintendo"] })
  ]));
  assert.deepEqual(S.viewList(D, "want", "all", "", "recent").map((x) => x.id), [I2, I1]);    // priority first
  assert.deepEqual(S.viewList(D, "want", "book", "", "recent").map((x) => x.id), [I1]);
  assert.deepEqual(S.viewList(D, "want", "all", "μικρος", "recent").map((x) => x.id), [I1]);
  assert.deepEqual(S.viewList(D, "want", "all", "exupery", "title").map((x) => x.id), [I1]);
  assert.deepEqual(S.viewList(D, "hist", "all", "nintendo", "recent").map((x) => x.id), [I3]);
  assert.deepEqual(S.viewList(D, "want", "all", "", "title").map((x) => x.id), [I2, I1]);
  assert.deepEqual(S.viewList(D, "now", "all", "", "recent"), []);
});

test("covers: initials skip articles, ink is readable", () => {
  assert.equal(S.initials("The Name of the Wind"), "NO");
  assert.equal(S.initials("ο μικρός πρίγκιπας"), "ΜΠ");
  assert.equal(S.initials("1984"), "1");
  S.COLORS.forEach((c) => assert.match(S.inkFor(c), /^#(1b1b1b|ffffff)$/));
  assert.ok(S.hasProgress({ type: "podcast" }));
  assert.ok(!S.hasProgress({ type: "album" }));
  assert.equal(S.unitKey({ type: "book", fmt: "a" }), "audio");
});
