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
  " initials, inkFor, COLORS, hasProgress, unitKey, parseCsv, csvKind, planImport, lookupUrl, parseLookup };")(webcrypto);

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

// ---------- CSV import (Goodreads, Letterboxd) ----------
const GR_HEAD = "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies";
const GR = [GR_HEAD,
  '1,"Dune (Dune, #1)",Frank Herbert,"Herbert, Frank",,"=""0441013597""","=""9780441013593""",5,4.27,Ace,Paperback,604,2005,1965,2024/03/02,2024/01/15,"sci-fi, read, classics","sci-fi (#3)",read,"Great.<br/>Spice &amp; ""sand""",,,1,0',
  '2,Middlemarch,George Eliot,"Eliot, George",,,,0,3.99,Penguin,Kindle Edition,880,2003,1871,,2024/05/01,currently-reading,,currently-reading,,,,0,0',
  '3,The Hobbit,J.R.R. Tolkien,"Tolkien, J.R.R.",,,,0,4.28,,Audible Audio,,2012,1937,,2023/11/11,to-read,,to-read,,,,0,0',
  '4,Ulysses,James Joyce,"Joyce, James",,,,2,3.7,,Hardcover,730,1990,1922,,2022/02/02,"did-not-finish, modernism",,did-not-finish,,,,0,0'
].join("\r\n") + "\r\n";
const LB_WL = "Date,Name,Year,Letterboxd URI\n2024-02-01,Arrival,2016,https://boxd.it/a1\n2024-02-02,Heat,1995,https://boxd.it/h1\n";
const LB_WATCHED = "Date,Name,Year,Letterboxd URI\n2024-03-05,Heat,1995,https://boxd.it/h1\n2024-04-01,Alien,1979,https://boxd.it/al\n";
const LB_RATINGS = "Date,Name,Year,Letterboxd URI,Rating\n2024-03-05,Heat,1995,https://boxd.it/h1,4.5\n";
const LB_DIARY = "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-03-06,Heat,1995,https://boxd.it/h1d,4.5,,\"crime, la\",2024-03-05\n2024-06-06,Heat,1995,https://boxd.it/h1e,5,Yes,,2024-06-01\n";
const LB_REVIEWS = "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-03-06,Heat,1995,https://boxd.it/h1d,4.5,,\"Best <i>heist</i>.\",,2024-03-05\n";
const OPTS = { now: 1700000000000, today: "2026-10-10" };
const EMPTY = { ver: 1, items: [], sess: [], goals: {}, tombs: {} };
const byTitle = (plan, title) => plan.items.find((x) => x.title === title);
const sessFor = (plan, it) => plan.sess.filter((s) => s.it === it.id).map((s) => s.k + ":" + s.d + (s.v !== undefined ? ":" + s.v : ""));

test("parseCsv: quotes, escaped quotes, commas and newlines inside, CRLF, BOM, blank lines", () => {
  assert.deepEqual(S.parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n,last'),
    [["a", "b"], ["x, y", 'say "hi"\nthere'], ["", "last"]]);
  assert.deepEqual(S.parseCsv(""), []);
});

test("csvKind: Goodreads library and each Letterboxd file", () => {
  const head = (txt) => S.parseCsv(txt)[0];
  assert.equal(S.csvKind(head(GR), "x.csv"), "gr");
  assert.equal(S.csvKind(head(LB_WL), "watchlist.csv"), "lb-watchlist");
  assert.equal(S.csvKind(head(LB_WATCHED), "watched.csv"), "lb-watched");
  assert.equal(S.csvKind(head(LB_RATINGS), "ratings.csv"), "lb-ratings");
  assert.equal(S.csvKind(head(LB_DIARY), "diary.csv"), "lb-diary");
  assert.equal(S.csvKind(head(LB_REVIEWS), "reviews.csv"), "lb-reviews");
  assert.equal(S.csvKind(["Name", "Phone"], "contacts.csv"), null);
});

test("Goodreads: shelves → status, binding → format, rating, dates, tags, review as text", () => {
  const plan = S.planImport([{ name: "goodreads_library_export.csv", text: GR }], EMPTY, OPTS);
  assert.equal(plan.items.length, 4);
  assert.deepEqual(plan.counts.book, { want: 1, now: 1, done: 1, drop: 1 });
  const dune = byTitle(plan, "Dune (Dune, #1)");
  assert.equal(dune.st, "done");
  assert.equal(dune.rate, 10);
  assert.equal(dune.year, 1965);                                  // original publication year
  assert.equal(dune.size, 604);
  assert.equal(dune.fmt, "p");
  assert.deepEqual(dune.tags, ["sci-fi", "classics"]);            // exclusive shelves dropped
  assert.equal(dune.rev, 'Great.\nSpice & "sand"');
  assert.deepEqual(sessFor(plan, dune), ["d:2024-03-02"]);
  const mm = byTitle(plan, "Middlemarch");
  assert.equal(mm.fmt, "e");
  assert.deepEqual(sessFor(plan, mm), ["s:2024-05-01"]);
  assert.equal(byTitle(plan, "The Hobbit").fmt, "a");
  assert.deepEqual(sessFor(plan, byTitle(plan, "The Hobbit")), []);
  const u = byTitle(plan, "Ulysses");
  assert.equal(u.st, "drop");
  assert.deepEqual(u.tags, ["modernism"]);
  // Everything it returns is already valid shelf data.
  const merged = S.mergeShelf({ ...EMPTY, items: plan.items, sess: plan.sess }, EMPTY);
  assert.equal(merged.items.length, 4);
  assert.equal(merged.sess.length, plan.sess.length);
});

test("Letterboxd: files combine per film; diary dates count each watch; watchlist only if never watched", () => {
  const files = [
    { name: "reviews.csv", text: LB_REVIEWS }, { name: "diary.csv", text: LB_DIARY },
    { name: "ratings.csv", text: LB_RATINGS }, { name: "watched.csv", text: LB_WATCHED },
    { name: "watchlist.csv", text: LB_WL }, { name: "profile.csv", text: "Username,Bio\nx,y\n" }
  ];
  const plan = S.planImport(files, EMPTY, OPTS);
  assert.deepEqual(plan.unknown, ["profile.csv"]);
  assert.deepEqual(plan.items.map((x) => x.title).sort(), ["Alien", "Arrival", "Heat"]);
  const heat = byTitle(plan, "Heat");
  assert.equal(heat.st, "done");
  assert.equal(heat.rate, 9);                                     // ratings.csv (4.5) beats a log's 5
  assert.equal(heat.year, 1995);
  assert.deepEqual(heat.tags, ["crime", "la"]);
  assert.equal(heat.rev, "Best heist.");
  assert.deepEqual(sessFor(plan, heat), ["d:2024-03-05", "d:2024-06-01"]);
  assert.equal(byTitle(plan, "Arrival").st, "want");
  assert.deepEqual(sessFor(plan, byTitle(plan, "Alien")), ["d:2024-04-01"]);
  assert.deepEqual(plan.counts.film, { want: 1, now: 0, done: 2, drop: 0 });
  // Same input, same plan (apart from new ids): order of files does not matter.
  const again = S.planImport(files.slice().reverse(), EMPTY, OPTS);
  assert.deepEqual(again.items.map((x) => [x.title, x.st, x.rate]).sort(), plan.items.map((x) => [x.title, x.st, x.rate]).sort());
});

test("import skips titles already on the shelf and repeats inside the files", () => {
  const have = S.mergeShelf({ ...EMPTY, items: [item(I1, 1, { title: "dune (dune, #1)", by: "FRANK HERBERT" }),
    item(I2, 1, { type: "film", title: "Heat", year: 1995 })] }, EMPTY);
  const plan = S.planImport([{ name: "a.csv", text: GR }, { name: "b.csv", text: GR },
    { name: "watchlist.csv", text: LB_WL }], have, OPTS);
  assert.equal(plan.dup, 2);                                      // Dune and Heat
  assert.equal(plan.found, 6);
  assert.deepEqual(plan.items.map((x) => x.title).sort(), ["Arrival", "Middlemarch", "The Hobbit", "Ulysses"]);
  assert.equal(S.planImport([{ name: "x.csv", text: "" }], have, OPTS).items.length, 0);
  // Without ratings.csv the newest log's rating is used.
  const logOnly = S.planImport([{ name: "diary.csv", text: LB_DIARY }], EMPTY, OPTS);
  assert.equal(logOnly.items[0].rate, 10);
  assert.equal(logOnly.items.length, 1);
});

// ---------- 1.2: release date, forward compatibility, online lookup ----------

test("release date is kept only when valid and never added to items without one", () => {
  const plain = S.normItem(item(I1, 5));
  assert.equal("rel" in plain, false);                            // 1.1 bytes unchanged
  assert.equal(S.normItem(item(I1, 5, { rel: "2027-03-14" })).rel, "2027-03-14");
  assert.equal("rel" in S.normItem(item(I1, 5, { rel: "2027-02-30" })), false);
  assert.equal("rel" in S.normItem(item(I1, 5, { rel: "soon" })), false);
});

test("fields from a newer version ride along, sorted and bounded", () => {
  const x = S.normItem(item(I1, 5, { zeta: "z", isbn: "9780441013593", hot: true, n2: 3,
    Bad: 1, obj: { a: 1 }, big: "x".repeat(501), inf: Infinity }));
  assert.deepEqual(Object.keys(x).slice(-4), ["hot", "isbn", "n2", "zeta"]);
  assert.equal("Bad" in x || "obj" in x || "big" in x || "inf" in x, false);
  const many = {};
  for (let i = 0; i < 30; i++) many["f" + String(i).padStart(2, "0")] = i;
  assert.equal(Object.keys(S.normItem(item(I1, 5, many))).filter((k) => /^f\d\d$/.test(k)).length, 16);
  // Merge keeps them and stays canonical.
  const a = S.mergeShelf(data([item(I1, 5, { isbn: "1" })]), data([item(I1, 5, { isbn: "1" })]));
  assert.equal(a.items[0].isbn, "1");
  assert.deepEqual(S.mergeShelf(a, a), a);
});

test("lookup URLs send only the typed title and creator", () => {
  assert.equal(S.lookupUrl("film", "Heat", ""), "");
  assert.equal(S.lookupUrl("book", "  ", "x"), "");
  const b = new URL(S.lookupUrl("book", "Dune & Co", "Frank Herbert"));
  assert.equal(b.origin, "https://openlibrary.org");
  assert.equal(b.searchParams.get("title"), "Dune & Co");
  assert.equal(b.searchParams.get("author"), "Frank Herbert");
  const m = new URL(S.lookupUrl("album", 'Say "Hi" \\ now', ""));
  assert.equal(m.origin, "https://musicbrainz.org");
  assert.equal(m.searchParams.get("query"), 'release:"Say \\"Hi\\" \\\\ now"');
  assert.equal(new URL(S.lookupUrl("album", "OK Computer", "Radiohead")).searchParams.get("query"),
    'release:"OK Computer" AND artist:"Radiohead"');
});

test("lookup answers are parsed defensively and de-duplicated", () => {
  const ol = S.parseLookup("book", { docs: [
    { title: "Dune", author_name: ["Frank Herbert"], first_publish_year: 1965, number_of_pages_median: 604 },
    { title: "Dune", author_name: ["Frank Herbert"], first_publish_year: 1965, number_of_pages_median: 604 },
    { title: "<img src=x onerror=alert(1)>\n", author_name: [1, "A", null], number_of_pages_median: -3 },
    { title: "" }, null, "x"
  ] });
  assert.deepEqual(ol[0], { title: "Dune", by: "Frank Herbert", year: 1965, size: 604, rel: "" });
  assert.equal(ol.length, 2);
  assert.deepEqual(ol[1], { title: "<img src=x onerror=alert(1)>", by: "A", year: 0, size: 0, rel: "" });
  const mb = S.parseLookup("album", { releases: [
    { title: "In Rainbows", date: "2007-10-10", "track-count": 10,
      "artist-credit": [{ name: "Radiohead", joinphrase: "" }] },
    { title: "Duet", date: "2026", "artist-credit": [{ name: "A", joinphrase: " & " }, { name: "B" }] },
    { title: "Bad date", date: "2026-13-01", "track-count": "12" }
  ] });
  assert.deepEqual(mb[0], { title: "In Rainbows", by: "Radiohead", year: 2007, size: 10, rel: "2007-10-10" });
  assert.deepEqual(mb[1], { title: "Duet", by: "A & B", year: 2026, size: 0, rel: "" });
  assert.equal(mb[2].rel, "");
  assert.deepEqual(S.parseLookup("book", null), []);
  assert.deepEqual(S.parseLookup("album", { docs: [{ title: "x" }] }), []);
  const lots = { docs: Array.from({ length: 20 }, (_, i) => ({ title: "T" + i })) };
  assert.equal(S.parseLookup("book", lots).length, 8);
});

// ---------- Calendar feed (shelf/feed.js) ----------

const F = require(path.join(__dirname, "..", "shelf/feed.js"));

test("calendar feed: finishes on their day, wishlist release dates, tombstones respected", () => {
  const d = data([
    item(I1, 5, { title: "Dune", st: "done" }),
    item(I2, 5, { title: "Album X", type: "album", st: "want", rel: "2026-11-20" }),
    item(I3, 5, { title: "Gone", st: "done" }),
    item("item000004", 5, { title: "Read already", st: "done", rel: "2026-11-20" })
  ], [
    sess("sess000001", 5, I1, "d", "2026-10-01"),
    sess("sess000002", 6, I1, "d", "2026-10-01"),        // same day twice → one row
    sess("sess000003", 7, I1, "d", "2026-10-05"),        // reread
    sess("sess000004", 5, I1, "s", "2026-09-20"),        // a start is not shown
    sess("sess000005", 5, I3, "d", "2026-10-01"),
    sess("sess000006", 5, "item000009", "d", "2026-10-01") // unknown item
  ], {}, { [I3]: 9 });
  const days = F.byDay(d);
  assert.deepEqual(Object.keys(days).sort(), ["2026-10-01", "2026-10-05", "2026-11-20"]);
  assert.deepEqual(days["2026-10-01"], [{ item: I1, k: "d", title: "Dune" }]);
  assert.deepEqual(days["2026-11-20"], [{ item: I2, k: "r", title: "Album X" }]);
  assert.equal(F.label("d", "Dune", "en"), "Finished: Dune");
  assert.equal(F.label("r", "Dune", "el"), "Κυκλοφορία: Dune");
  assert.equal(F.label("r", "Dune", "xx"), "Release: Dune");
  assert.deepEqual(F.byDay(null), {});
  assert.deepEqual(F.byDay({ items: "x", sess: 3 }), {});
});

test("calendar feed: Calendar loads feed.js and opens the title in Media Shelf", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "calendar/index.html"), "utf8");
  const i = html.indexOf("../shelf/feed.js"), j = html.indexOf('src="calendar.js');
  assert.ok(i > 0 && j > i);
  const cal = fs.readFileSync(path.join(root, "calendar/calendar.js"), "utf8");
  assert.equal((cal.match(/"lbl\.feed\.shelf":/g) || []).length, 2, "EN + EL label");
  assert.ok(cal.includes('{ id: "lbl-feed-shelf"'));
  assert.ok(cal.includes(".concat(shelfFeedOn(dateStr))"));
  assert.ok(cal.includes('_openAt: { app: "shelf", target: { item: r.item } }'));
  // The feed's id rule is the app's.
  assert.ok(src.includes("var ID_RE = /^[a-z0-9]{6,40}$/;"));
  assert.ok(fs.readFileSync(path.join(root, "shelf/feed.js"), "utf8").includes("var ID_RE = /^[a-z0-9]{6,40}$/;"));
});

// ---------- 1.3: reading reminder (shelf/feed.js rule, shell engine) ----------

test("reading reminder: off by default, settings clamped", () => {
  assert.deepEqual(F.readRem(null), { on: 0, h: 20 });
  assert.deepEqual(F.readRem({ on: 1, h: 7 }), { on: 1, h: 7 });
  assert.deepEqual(F.readRem({ on: true, h: 24 }), { on: 0, h: 20 });
  assert.equal(F.REM_KEY, "oros-shelf-rem");
});

test("reading reminder: once a day, after the hour, only with something in Now and nothing logged today", () => {
  const ON = { on: 1, h: 20 };
  const at = (h, d) => new Date(2026, 9, d || 10, h, 5);
  const base = (over) => data([
    item(I1, 5, { title: "Dune", st: "now", size: 604 }),
    item(I2, 9, { title: "Old", st: "now", type: "series" }),
    item(I3, 5, { title: "Wish", st: "want" })
  ], [
    sess("sess000001", 1, I1, "s", "2026-10-01"),
    sess("sess000002", 2, I1, "p", "2026-10-03", 300),
    sess("sess000003", 3, I1, "s", "2026-10-05"),          // a restart begins a new run
    sess("sess000004", 4, I1, "p", "2026-10-08", 212),
    sess("sess000005", 4, I2, "p", "2026-09-01", 4)
  ].concat(over || []));
  assert.equal(F.reminderDue(base(), { on: 0, h: 20 }, at(21)), null);    // off
  assert.equal(F.reminderDue(base(), ON, at(19)), null);                   // before the hour
  const due = F.reminderDue(base(), ON, at(21));
  assert.deepEqual(due, { key: "read-2026-10-10", item: I1, title: "Dune", type: "book", fmt: "", v: 212, size: 604 });
  assert.deepEqual(F.reminderText(due, "en"), { title: "Time to read", body: "Dune · page 212 of 604" });
  assert.deepEqual(F.reminderText(due, "el"), { title: "Ώρα για διάβασμα", body: "Dune · σελίδα 212 από 604" });
  assert.equal(F.reminderDue(base(), ON, at(21, 11)).key, "read-2026-10-11");
  // Anything logged today (any title) → nothing.
  assert.equal(F.reminderDue(base([sess("sess000009", 9, I3, "d", "2026-10-10")]), ON, at(21)), null);
  // Nothing in Now → nothing; a deleted title does not count.
  assert.equal(F.reminderDue(data([item(I3, 5, { st: "want" })]), ON, at(21)), null);
  assert.equal(F.reminderDue(data([item(I1, 5, { st: "now" })], [], {}, { [I1]: 5 }), ON, at(21)), null);
  // No progress yet: a nudge without a number; other types and audiobooks use their unit.
  const plain = F.reminderDue(data([item(I1, 5, { title: "Heat", type: "film", st: "now" })]), ON, at(21));
  assert.equal(F.reminderText(plain, "en").body, "Heat · pick up where you left off");
  assert.equal(F.reminderText(plain, "en").title, "Time to watch");
  const audio = F.reminderDue(data([item(I1, 5, { title: "A $& B", fmt: "a", st: "now" })],
    [sess("sess000001", 1, I1, "p", "2026-10-09", 1500)]), ON, at(21));
  assert.equal(F.reminderText(audio, "en").body, "A $& B · minute 1,500");
  assert.equal(F.reminderDue(null, ON, at(21)), null);
});

test("reading reminder: the shell loads feed.js, runs the engine and routes the deep link", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const i = html.indexOf('src="shelf/feed.js'), j = html.indexOf('src="shell.js');
  assert.ok(i > 0 && j > i);
  const shell = fs.readFileSync(path.join(root, "shell.js"), "utf8");
  assert.ok(shell.includes('tickSafe("shelfCheckTick", shelfCheckTickThrottled)'));
  assert.ok(shell.includes('deepLink: "shelf:item:" + due.item'));
  const notifs = fs.readFileSync(path.join(root, "notifications.js"), "utf8");
  assert.ok(/KNOWN_APPS = \[[^\]]*'shelf'/.test(notifs));
  assert.ok(notifs.includes("window.__orosOpenAt('shelf', { item: id })"));
  assert.ok(src.includes('var REM_KEY = "oros-shelf-rem";'));
});
