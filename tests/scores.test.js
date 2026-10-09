// Pure logic of the Score Keeper: normalization, ready templates,
// the merge of the sync slice "scores" (matches, rounds, templates,
// players: LWW + tombstones), totals and winners, stats, score entry
// parsing and the CSV export (no formula injection).
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–4 are cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "scores/scores.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
function build(lang) {
  return new Function(
    "var LANG = " + JSON.stringify(lang) + ";\n" +
    block("  var STORAGE_KEY", "  // ---------- 1.") +
    block("  var STRINGS", "  function $(") +
    block("  function cmpStr(", "  function newId(") +
    block("  // ---------- 2. Model", "  // ---------- 5. Storage") +
    "\nreturn { MAX_SEATS, MAX_SCORE, READY_IDS, STRINGS, t, normMatch, normRound, normTpl, normPlayer," +
    " allTemplates, mergeScores, emptyData, roundsOf, totalsOf, standing, statsOf, gamesPlayed," +
    " parsePts, csvCell, matchCsv, historyCsv, nameKey };")();
}
const S = build("en");
const SEL = build("el");

const G = "match0001";
function match(over) {
  return Object.assign({ id: G, m: 10, c: 10, name: "Xeri", tpl: "xeri", seats: ["Anna", "Bob"],
                         target: 51, low: 0, quick: [10, 20], done: 0 }, over || {});
}
function round(id, c, s, over) { return Object.assign({ id, m: c, g: G, c, s }, over || {}); }
function data(over) { return Object.assign(S.emptyData(), over || {}); }
function canon(x) { return JSON.stringify(x); }

test("strings: every key exists in both languages", () => {
  const en = Object.keys(S.STRINGS.en).sort(), el = Object.keys(S.STRINGS.el).sort();
  assert.deepEqual(el, en);
  S.READY_IDS.forEach((id) => assert.ok(S.STRINGS.en["tpl." + id] && S.STRINGS.el["tpl." + id], id));
  assert.equal(SEL.t("tpl.tavli"), "Τάβλι");
});

test("match: names trimmed, 2–8 seats, empty seat rejected, bad fields cleaned", () => {
  const m = S.normMatch(match({ name: "  Big   game ", seats: [" A ", "B"], target: -3, low: 7, quick: [0, 5, 5, 2.5, 7, 8, 9, 10], done: -1 }));
  assert.equal(m.name, "Big game");
  assert.deepEqual(m.seats, ["A", "B"]);
  assert.equal(m.target, 0);
  assert.equal(m.low, 0);
  assert.deepEqual(m.quick, [5, 7, 8, 9]);
  assert.equal(m.done, 0);
  assert.equal(S.normMatch(match({ seats: ["A"] })), null);
  assert.equal(S.normMatch(match({ seats: ["A", "  "] })), null);
  assert.equal(S.normMatch(match({ name: "" })), null);
  assert.equal(S.normMatch(match({ id: "BAD ID" })), null);
  assert.equal(S.normMatch(match({ seats: Array.from({ length: 12 }, (_, i) => "p" + i) })).seats.length, S.MAX_SEATS);
});

test("round: scores are integers within range, others become 0", () => {
  const r = S.normRound(round("r0000001", 5, [3, -2, 1.5, "x", 2e9]));
  assert.deepEqual(r.s, [3, -2, 0, 0, 0]);
  assert.equal(S.normRound(round("r0000001", 5, [])), null);
  assert.equal(S.normRound(round("r0000001", 5, [1], { g: "no way" })), null);
});

test("templates: ready ones listed, a saved copy with base replaces its ready one", () => {
  let list = S.allTemplates(data());
  assert.deepEqual(list.map((x) => x.id), S.READY_IDS);
  assert.equal(list[0].name, "Backgammon");
  assert.equal(list[0].target, 5);
  const mine = { id: "tpl00001", m: 1, name: "Golf", target: 100, low: 1, quick: [], seats: 4, base: "" };
  const over = { id: "tpl00002", m: 1, name: "Xeri", target: 101, low: 0, quick: [10], seats: 2, base: "xeri" };
  list = S.allTemplates(S.mergeScores(data({ tpls: [mine, over] }), data()));
  assert.equal(list.length, S.READY_IDS.length + 1);
  assert.equal(list[2].id, "tpl00002");
  assert.equal(list[2].target, 101);
  assert.equal(list[list.length - 1].name, "Golf");
  assert.equal(S.normTpl(Object.assign({}, over, { base: "chess" })).base, "");
});

test("merge: rounds added on two devices to one match are all kept", () => {
  const a = data({ matches: [match()], rounds: [round("ra000001", 100, [10, 0])] });
  const b = data({ matches: [match()], rounds: [round("rb000001", 101, [0, 20])] });
  const ab = S.mergeScores(a, b), ba = S.mergeScores(b, a);
  assert.equal(canon(ab), canon(ba));
  assert.equal(ab.rounds.length, 2);
  assert.deepEqual(S.totalsOf(ab.matches[0], S.roundsOf(ab, G)), [10, 20]);
  assert.equal(canon(S.mergeScores(ab, ab)), canon(ab));
});

test("merge: LWW per entity, equal mtime breaks ties by canonical JSON", () => {
  const a = data({ matches: [match({ m: 20, name: "Newer" })] });
  const b = data({ matches: [match({ m: 15, name: "Older" })] });
  assert.equal(S.mergeScores(a, b).matches[0].name, "Newer");
  assert.equal(S.mergeScores(b, a).matches[0].name, "Newer");
  const c = data({ matches: [match({ m: 20, name: "Alpha" })] });
  const d = data({ matches: [match({ m: 20, name: "Zulu" })] });
  assert.equal(canon(S.mergeScores(c, d)), canon(S.mergeScores(d, c)));
});

test("merge: tombstones delete, delete wins ties, a newer edit resurrects", () => {
  const r = round("ra000001", 100, [1, 2]);
  const kept = data({ matches: [match()], rounds: [r] });
  const del = data({ tombs: { ra000001: 100 } });
  assert.equal(S.mergeScores(kept, del).rounds.length, 0);
  assert.equal(S.mergeScores(del, kept).rounds.length, 0);
  const edited = data({ matches: [match()], rounds: [round("ra000001", 100, [5, 5], { m: 101 })] });
  assert.equal(S.mergeScores(edited, del).rounds.length, 1);
  assert.deepEqual(S.mergeScores(del, edited).tombs, { ra000001: 100 });
});

test("merge: rounds of a deleted match go with it; orphans of a live match stay", () => {
  const a = data({ matches: [match()], rounds: [round("ra000001", 100, [1, 2])] });
  const b = data({ tombs: { match0001: 50 }, rounds: [round("rb000001", 120, [3, 3])] });
  // the match edit (m 10) is older than the tomb: gone, and its rounds too
  const ab = S.mergeScores(a, b);
  assert.equal(ab.matches.length, 0);
  assert.equal(ab.rounds.length, 0);
  assert.equal(canon(ab), canon(S.mergeScores(b, a)));
  // a round arriving before its match is kept
  const early = S.mergeScores(data({ rounds: [round("rc000001", 5, [1, 1])] }), data());
  assert.equal(early.rounds.length, 1);
});

test("merge: junk and broken input never throw and are dropped", () => {
  const out = S.mergeScores({ matches: "x", rounds: [null, 5, { id: "x" }], tombs: { "BAD": 3, okokok1: -1, okokok2: 5 } }, null);
  assert.deepEqual(out.matches, []);
  assert.deepEqual(out.rounds, []);
  assert.deepEqual(out.tombs, { okokok2: 5 });
  assert.equal(out.ver, 1);
});

test("standing: leader, target reached, lowest-wins and ties", () => {
  const m = S.normMatch(match());
  const rs = [round("r1000001", 1, [30, 10]), round("r2000001", 2, [25, 10])];
  let st = S.standing(m, rs);
  assert.deepEqual(st.totals, [55, 20]);
  assert.deepEqual(st.best, [0]);
  assert.equal(st.reached, true);
  st = S.standing(S.normMatch(match({ low: 1, target: 100 })), [round("r1000001", 1, [40, 60])]);
  assert.deepEqual(st.best, [0]);
  assert.equal(st.reached, false);
  st = S.standing(m, [round("r1000001", 1, [7, 7])]);
  assert.deepEqual(st.best, [0, 1]);
  assert.deepEqual(S.standing(m, []).best, []);
  st = S.standing(S.normMatch(match({ target: 0 })), [round("r1000001", 1, [500, 7])]);
  assert.equal(st.reached, false);
});

test("rounds are ordered by creation, then id; short rounds count 0 for missing seats", () => {
  const d = S.mergeScores(data({ matches: [match({ seats: ["A", "B", "C"] })],
    rounds: [round("rz000001", 5, [1]), round("ra000001", 5, [2, 2, 2]), round("rm000001", 1, [3, 0, 0])] }), data());
  assert.deepEqual(S.roundsOf(d, G).map((r) => r.id), ["rm000001", "ra000001", "rz000001"]);
  assert.deepEqual(S.totalsOf(d.matches[0], S.roundsOf(d, G)), [6, 2, 2]);
});

test("stats: finished matches only, per game, ties count for everyone in the lead", () => {
  const m1 = match({ id: "match0001", done: 50 });
  const m2 = match({ id: "match0002", done: 60, seats: ["anna", "Chris"] });
  const m3 = match({ id: "match0003", done: 0 });
  const m4 = match({ id: "match0004", done: 70, name: "Tavli", seats: ["Anna", "Bob"] });
  const d = S.mergeScores(data({ matches: [m1, m2, m3, m4], rounds: [
    round("r1000001", 1, [60, 10], { g: "match0001" }),
    round("r2000001", 1, [5, 9], { g: "match0002" }),
    round("r3000001", 1, [99, 0], { g: "match0003" }),
    round("r4000001", 1, [3, 3], { g: "match0004" })] }), data());
  const all = S.statsOf(d, "");
  const anna = all.find((r) => r.name.toLowerCase() === "anna");
  assert.deepEqual([anna.played, anna.wins], [3, 2]);
  const xeri = S.statsOf(d, "xeri");
  assert.deepEqual(xeri.map((r) => [r.name.toLowerCase(), r.played, r.wins]),
    [["chris", 1, 1], ["anna", 2, 1], ["bob", 1, 0]]);
  assert.deepEqual(S.gamesPlayed(d).map((g) => g.key), ["tavli", "xeri"]);
});

test("score entry: whole numbers with sign, unicode minus, blanks are 0", () => {
  assert.equal(S.parsePts(""), 0);
  assert.equal(S.parsePts(" 12 "), 12);
  assert.equal(S.parsePts("+5"), 5);
  assert.equal(S.parsePts("-5"), -5);
  assert.equal(S.parsePts("−7"), -7);
  assert.equal(S.parsePts("1.5"), null);
  assert.equal(S.parsePts("abc"), null);
  assert.equal(S.parsePts("99999999"), null);
  assert.equal(S.parsePts("1000000"), S.MAX_SCORE);
});

test("CSV: text quoted, formula injection neutralized, numbers raw, BOM + CRLF", () => {
  assert.equal(S.csvCell(-5), "-5");
  assert.equal(S.csvCell("=SUM(A1)"), "\"'=SUM(A1)\"");
  assert.equal(S.csvCell("@x"), "\"'@x\"");
  assert.equal(S.csvCell("-3+2"), "\"'-3+2\"");
  assert.equal(S.csvCell('say "hi"'), '"say ""hi"""');
  const m = S.normMatch(match({ seats: ["=Anna", "Bob"] }));
  const csv = S.matchCsv(m, [round("r1000001", 1, [10, -2]), round("r2000001", 2, [0, 5])]);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).trim().split("\r\n");
  assert.deepEqual(lines, ['"Round","\'=Anna","Bob"', "1,10,-2", "2,0,5", '"Total",10,3']);
  const d = S.mergeScores(data({ matches: [match({ done: Date.UTC(2026, 9, 9) })], rounds: [round("r1000001", 1, [60, 1])] }), data());
  const h = S.historyCsv(d, () => "09/10/2026").slice(1).trim().split("\r\n");
  assert.deepEqual(h, ['"Date","Game","Player","Total","Winner"',
    '"09/10/2026","Xeri","Anna",60,"yes"', '"09/10/2026","Xeri","Bob",1,"no"']);
});
