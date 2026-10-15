// Score Keeper "Import from another app" (scores/import.js): BG Stats
// JSON (.bgsplay / .json, also zipped) → finished matches with one
// round, players matched by name (any case) or created, plays left
// out (solo, > 8 players, ignored, broken), stable ids so a second
// import adds nothing, the matches cap, and the planned rows going
// through the app's own normalizers, merge and stats untouched.
// Fixtures are built here from the documented export shape.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const I = require(path.join(__dirname, "..", "scores/import.js"));
const Z = require(path.join(__dirname, "..", "atelier/zip.js"));

// scores.js sections 2–4 (as tests/scores.test.js does)
const src = fs.readFileSync(path.join(__dirname, "..", "scores/scores.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const S = new Function(
  "var LANG = 'en';\n" +
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  var STRINGS", "  function $(") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Model", "  // ---------- 5. Storage") +
  "\nreturn { mergeScores, emptyData, statsOf, standing, roundsOf, STRINGS };")();

const NOW = 1790000000000;
function bgs(over) {
  return Object.assign({
    players: [
      { id: 1, name: "Anna", isAnonymous: false, uuid: "p-1" },
      { id: 2, name: "bob", isAnonymous: false, uuid: "p-2" },
      { id: 3, name: "Chris", isAnonymous: false, uuid: "p-3" },
      { id: 4, name: "Anonymous", isAnonymous: true, uuid: "p-4" }
    ],
    games: [
      { id: 10, name: "Catan", bggId: 13, uuid: "g-10", cooperative: false, highestWins: true },
      { id: 11, name: "Golf", bggId: 1, uuid: "g-11", cooperative: false, highestWins: false },
      { id: 12, name: "Pandemic", bggId: 30549, uuid: "g-12", cooperative: true, highestWins: true }
    ],
    locations: [{ id: 1, name: "Home" }],
    plays: [
      { uuid: "pl-1", gameRefId: 10, playDate: "2026-03-01 20:15:00", durationMin: 75, locationRefId: 1,
        playerScores: [
          { playerRefId: 1, score: "10", winner: true, rank: 1, newPlayer: false, startPlayer: true, team: "", role: "" },
          { playerRefId: 2, score: 8, winner: false, rank: 2 },
          { playerRefId: 3, score: 7.6, winner: false, rank: 3 }
        ], board: "", comments: "<b>fun</b>", ignored: false, manualWinner: false },
      { uuid: "pl-2", gameRefId: 11, playDate: "2026-04-02 18:00:00",
        playerScores: [{ playerRefId: 1, score: 30, winner: false }, { playerRefId: 2, score: 12, winner: true }] },
      { uuid: "pl-3", gameRefId: 12, playDate: "2026-05-05 21:00:00",
        playerScores: [{ playerRefId: 1, score: null, winner: true }, { playerRefId: 3, winner: true },
                       { playerRefId: 4, winner: true }, { playerRefId: 4, winner: true }] },
      { uuid: "pl-solo", gameRefId: 10, playDate: "2026-05-06 10:00:00", playerScores: [{ playerRefId: 1, score: 5 }] },
      { uuid: "pl-ign", gameRefId: 10, playDate: "2026-05-07 10:00:00", ignored: true,
        playerScores: [{ playerRefId: 1, score: 5 }, { playerRefId: 2, score: 4 }] },
      { uuid: "pl-many", gameRefId: 10, playDate: "2026-05-08 10:00:00",
        playerScores: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ playerRefId: 1, score: n })) },
      { uuid: "pl-bad", gameRefId: 99, playDate: "2026-05-09 10:00:00",
        playerScores: [{ playerRefId: 1, score: 1 }, { playerRefId: 2, score: 2 }] },
      { uuid: "pl-baddate", gameRefId: 10, playDate: "yesterday-ish",
        playerScores: [{ playerRefId: 1, score: 1 }, { playerRefId: 2, score: 2 }] },
      { uuid: "pl-rank", gameRefId: 10, playDate: "2026-06-01 12:00:00",
        playerScores: [{ playerRefId: 2, rank: 2 }, { playerRefId: 3, rank: 1 }] }
    ]
  }, over || {});
}
const TEXT = JSON.stringify(bgs());
function local(over) {
  return Object.assign(S.emptyData(), {
    players: [{ id: "own000anna", m: 5, name: "ANNA", col: 3 }]
  }, over || {});
}
function apply(d, pl) {
  return S.mergeScores({ ver: 1, matches: d.matches.concat(pl.matches), rounds: d.rounds.concat(pl.rounds),
    tpls: d.tpls, players: d.players.concat(pl.players), tombs: d.tombs }, {});
}

test("BG Stats: plays → finished matches, one round each; what is left out", () => {
  const r = I.parseText(TEXT, "BGStatsExport.json");
  assert.equal(r.source, "bgstats");
  assert.deepEqual(r.skip, { solo: 1, many: 1, ignored: 1, bad: 2 });
  assert.deepEqual(r.plays.map((p) => p.key), ["pl-1", "pl-2", "pl-3", "pl-rank"]);
  const p1 = r.plays[0];
  assert.equal(p1.game, "Catan");
  assert.equal(p1.day, "2026-03-01");
  assert.equal(p1.at, new Date(2026, 2, 1, 20, 15).getTime());
  assert.deepEqual(p1.seats.map((s) => s.pts), [10, 8, 8]);        // string score read, 7.6 rounded
  assert.equal(r.plays[1].low, 1);                                  // highestWins false
  assert.deepEqual(r.plays[2].seats.map((s) => s.pts), [1, 1, 1, 1]); // no scores: winners 1
  assert.deepEqual(r.plays[3].seats.map((s) => s.pts), [0, 1]);       // rank 1 wins
});

test("plan: matches, rounds, players matched by name (any case) or created", () => {
  const r = I.parseText(TEXT, "x.json");
  const d = local();
  const pl = I.plan(r, d, { now: NOW, anon: "Player {n}" });
  assert.equal(pl.matches.length, 4);
  assert.equal(pl.stats.found, 4);
  assert.equal(pl.stats.from, "2026-03-01");
  assert.equal(pl.stats.to, "2026-06-01");
  assert.equal(pl.stats.games, 3);
  assert.equal(pl.stats.known, 1);                                  // Anna = ANNA
  assert.deepEqual(pl.players.map((p) => p.name).sort(), ["Chris", "bob"]);
  const m1 = pl.matches[0];
  assert.deepEqual(m1.seats, ["ANNA", "bob", "Chris"]);
  assert.equal(m1.done, m1.c);
  assert.equal(m1.name, "Catan");
  assert.equal(m1.target, 0);
  // anonymous players: no saved player, numbered seats, never two alike
  assert.deepEqual(pl.matches[2].seats, ["ANNA", "Chris", "Player 3", "Player 4"]);
  // ids: Score Keeper's [a-z0-9]{6,40}, stable across runs
  pl.matches.concat(pl.rounds, pl.players).forEach((x) => assert.match(x.id, /^[a-z0-9]{6,40}$/));
  assert.deepEqual(I.plan(r, d, { now: NOW + 5 }).matches.map((m) => m.id), pl.matches.map((m) => m.id));
  // colours: least used first (3 is taken by ANNA)
  pl.players.forEach((p) => assert.notEqual(p.col, 3));
});

test("the planned rows survive the app's normalizers, merge and stats", () => {
  const r = I.parseText(TEXT, "x.json");
  const d = local();
  const pl = I.plan(r, d, { now: NOW });
  const out = apply(d, pl);
  assert.equal(out.matches.length, 4);
  assert.equal(out.rounds.length, 4);
  assert.equal(out.players.length, 3);
  const golf = out.matches.find((m) => m.name === "Golf");
  assert.equal(golf.low, 1);
  assert.deepEqual(S.standing(golf, S.roundsOf(out, golf.id)).best, [1]); // bob wins Golf with 12
  const st = S.statsOf(out, "catan");
  assert.deepEqual(st.map((x) => [x.name, x.played, x.wins]),
    [["ANNA", 1, 1], ["Chris", 2, 1], ["bob", 2, 0]]);
});

test("a second import adds nothing; the user's data is never changed", () => {
  const r = I.parseText(TEXT, "x.json");
  const d = local();
  const once = apply(d, I.plan(r, d, { now: NOW }));
  const again = I.plan(r, once, { now: NOW + 1000 });
  assert.equal(again.matches.length, 0);
  assert.equal(again.players.length, 0);
  assert.equal(again.stats.have, 4);
  assert.deepEqual(once.players.find((p) => p.id === "own000anna"), { id: "own000anna", m: 5, name: "ANNA", col: 3 });
});

test("caps: the newest plays fit under 1000 matches; players under 200", () => {
  const plays = [];
  for (let i = 0; i < 30; i++) {
    plays.push({ uuid: "u" + i, gameRefId: 10, playDate: "2025-01-" + String(i + 1).padStart(2, "0") + " 10:00:00",
                 playerScores: [{ playerRefId: 1, score: i }, { playerRefId: 2, score: 1 }] });
  }
  const r = I.parseText(JSON.stringify(bgs({ plays })), "x.json");
  const full = [];
  for (let i = 0; i < 990; i++) full.push({ id: "mmmmmm" + i, m: 1, name: "X", seats: ["a", "b"] });
  const pl = I.plan(r, local({ matches: full }), { now: NOW });
  assert.equal(pl.matches.length, 10);
  assert.equal(pl.stats.full, 20);
  assert.equal(pl.stats.from, "2025-01-21");
  const many = [];
  for (let i = 0; i < 200; i++) many.push({ id: "pppppp" + i, m: 1, name: "P" + i, col: 0 });
  assert.equal(I.plan(r, local({ players: many }), { now: NOW }).players.length, 0);
});

test("not BG Stats, empty, broken and hostile files", async () => {
  assert.deepEqual(I.parseText("{}", "x.json"), { error: "bad" });
  assert.deepEqual(I.parseText("not json", "x.json"), { error: "bad" });
  assert.deepEqual(I.parseText("[1,2]", "x.json"), { error: "bad" });
  assert.deepEqual(I.parseText(JSON.stringify({ players: [], games: [], plays: [] }), "x.json"), { error: "empty" });
  // names are text only, capped; "__proto__" ids do no harm
  const evil = bgs({
    players: [{ id: "__proto__", name: "<img src=x onerror=alert(1)>" + "x".repeat(100) }, { id: 2, name: "B" }],
    plays: [{ uuid: "e", gameRefId: 10, playDate: "2026-01-01 10:00:00",
              playerScores: [{ playerRefId: "__proto__", score: 1e12 }, { playerRefId: 2, score: -3 }] }]
  });
  const r = I.parseText(JSON.stringify(evil), "x.json");
  assert.equal(r.plays.length, 1);
  assert.equal(r.plays[0].seats[0].name.length, 24);
  assert.deepEqual(r.plays[0].seats.map((s) => s.pts), [1000000, -3]);
  assert.deepEqual(await I.readBytes(new Uint8Array(I.MAX_FILE + 1), "big.json"), { error: "big" });
});

test("readBytes: plain bytes with a BOM and a ZIP holding the export", async () => {
  const bytes = new TextEncoder().encode("﻿" + TEXT);
  assert.equal((await I.readBytes(bytes, "a.bgsplay")).plays.length, 4);
  const zip = Z.write([{ name: "readme.txt", data: new TextEncoder().encode("hi") },
                       { name: "BGStatsExport.json", data: new TextEncoder().encode(TEXT) }]);
  assert.equal((await I.readBytes(zip, "backup.zip")).plays.length, 4);
  const bad = await I.readBytes(Z.write([{ name: "a.txt", data: new TextEncoder().encode("x") }]), "a.zip");
  assert.equal(bad.error, "bad");
});

test("every import string exists in English and Greek", () => {
  Object.keys(S.STRINGS.en).filter((k) => k.indexOf("imp.") === 0).forEach((k) => {
    assert.ok(S.STRINGS.el[k], k);
    assert.notEqual(S.STRINGS.el[k], S.STRINGS.en[k], k);
  });
});
