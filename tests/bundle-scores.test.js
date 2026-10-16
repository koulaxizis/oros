// The .orosscores file (Score Keeper, a record app): every match,
// round, template and player through the shared kit (recordpkg.js) and
// bundle.js; opening adds only what is missing, with its ids. The
// descriptor's shape checks and history.csv are compared with the
// app's own (scores.js sections 2–4, cut out as tests/scores.test.js
// does). Plus the app wiring (Save, Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "scores/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;

// scores.js sections 2–4 (no DOM)
const src = read("scores/scores.js");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
function app(lang) {
  return new Function(
    "var LANG = " + JSON.stringify(lang) + ";\n" +
    block("  var STORAGE_KEY", "  // ---------- 1.") +
    block("  var STRINGS", "  function $(") +
    block("  function cmpStr(", "  function newId(") +
    block("  // ---------- 2. Model", "  // ---------- 5. Storage") +
    "\nreturn { STRINGS, normMatch, normRound, normTpl, normPlayer, mergeScores, historyCsv };")();
}
const S = app("en"), SEL = app("el");
function fmtDate(ms) {
  const d = new Date(ms), p = (n) => (n < 10 ? "0" : "") + n;
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
}

function slice() {
  return {
    ver: 1,
    matches: [
      { id: "match0001", m: NOW - 900, c: NOW - 1000, name: "Xeri", tpl: "xeri", seats: ["Anna", "=Bob"], target: 51, low: 0, quick: [10, 20], done: NOW - 800 },
      { id: "match0002", m: NOW - 500, c: NOW - 600, name: "Prefa", tpl: "prefa", seats: ["Anna", "Chris", "Dora"], target: 0, low: 0, quick: [], done: 0 }
    ],
    rounds: [
      { id: "round0001", m: NOW - 990, g: "match0001", c: NOW - 990, s: [30, 12] },
      { id: "round0002", m: NOW - 980, g: "match0001", c: NOW - 980, s: [25, 40] },
      { id: "round0003", m: NOW - 590, g: "match0002", c: NOW - 590, s: [5, -3, 0] }
    ],
    tpls: [{ id: "tplown001", m: NOW - 700, name: "Uno", target: 500, low: 0, quick: [], seats: 4, base: "" }],
    players: [
      { id: "player001", m: NOW - 1000, name: "Anna", col: 0 },
      { id: "player002", m: NOW - 1000, name: "=Bob", col: 1 }
    ],
    tombs: { gone00001: NOW - 100, match0009: NOW - 50 }
  };
}

test("scores: round trip through bundle.js; the file has no tombs", async () => {
  const o = K.pack(D, slice(), { title: "Score Keeper", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-scores");
  assert.equal(o.generator, "orOS Score Keeper");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["matches", "players", "rounds", "tpls", "ver"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-scores");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-scores-package");
  assert.deepEqual(r.content.data.matches, slice().matches);
  assert.deepEqual(r.content.data.rounds, slice().rounds);
  assert.equal(r.content.data.tombs, undefined);
  // into a device with other data
  const other = S.mergeScores({
    matches: [{ id: "match0100", m: NOW - 50, c: NOW - 60, name: "Tavli", tpl: "tavli", seats: ["Eva", "Anna"], target: 5, low: 0, quick: [1], done: 0 }],
    rounds: [{ id: "round0100", m: NOW - 55, g: "match0100", c: NOW - 55, s: [1, 0] }],
    players: [{ id: "player100", m: 1, name: "anna", col: 3 }],
    tombs: {}
  }, {});
  const res = K.open(D, other, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 8, skipped: 0, updated: 0 });   // 2 matches, 3 rounds, 1 tpl, 2 players
  assert.deepEqual(res.next.matches.map((x) => x.id), ["match0100", "match0001", "match0002"]);
  assert.equal(res.next.players.find((p) => p.id === "player100").col, 3);
  // the app's merge keeps it as it is (canonical, nothing lost)
  const merged = S.mergeScores(res.next, res.next);
  assert.equal(merged.matches.length, 3);
  assert.equal(merged.rounds.length, 4);
  // and again: nothing
  const again = K.open(D, merged, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 8);
  assert.deepEqual(again.next, merged);
});

test("scores: a clash keeps the local record, a deleted match stays deleted, update takes newer", () => {
  const theirs = slice();
  theirs.matches[0].name = "Changed in the file"; theirs.matches[0].m = NOW - 1;
  theirs.matches.push({ id: "match0009", m: NOW - 1, c: NOW - 1, name: "deleted here", seats: ["A", "B"] });
  theirs.rounds.push({ id: "round0004", m: NOW - 2, g: "match0001", c: NOW - 2, s: [1, 1] });
  delete theirs.tombs;
  const mine = slice();
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["round0004"]);                       // a new round of a match here
  assert.equal(res.next.matches[0].name, "Xeri");                      // the local copy wins
  assert.ok(!res.next.matches.some((x) => x.id === "match0009"));       // deleted here stays deleted
  assert.deepEqual(res.next.tombs, mine.tombs);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["match0001"]);
  assert.equal(upd.next.matches[0].name, "Changed in the file");
  assert.equal(P.kindOf("round0004", res.next), "round");
  assert.equal(P.kindOf("match0001", res.next), "match");
  assert.equal(P.kindOf("tplown001", res.next), "tpl");
  assert.equal(P.kindOf("player001", res.next), "player");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("scores: tombs in the file are ignored and stamps are clamped", () => {
  const theirs = slice();
  theirs.matches[1].m = NOW + 365 * 864e5;
  const c = { kind: "oros-scores-package", ver: 1, data: theirs };   // a hand-made file WITH tombs
  const fresh = S.mergeScores({ tombs: { match0001: NOW - 5 } }, {});
  const res = K.open(D, fresh, c, { now: NOW });
  assert.ok(!res.next.matches.some((x) => x.id === "match0001"));       // deleted on this device
  assert.equal(res.next.matches.find((x) => x.id === "match0002").m, NOW + 5 * 60 * 1000);
  assert.deepEqual(res.next.tombs, { match0001: NOW - 5 });             // the file's tombs never arrive
  // the rounds of the match deleted here are dropped by the app's merge
  const merged = S.mergeScores(res.next, res.next);
  assert.deepEqual(merged.rounds.map((r) => r.id), ["round0003"]);
});

test("scores: the normaliser cuts hostile content down, the same as the app's", () => {
  const evil = {
    matches: [
      { id: "match0001", m: 5, name: "  <img src=x onerror=alert(1)>  ", seats: ["a\n\tb", "B", "C", "D", "E", "F", "G", "H", "I"],
        target: -1, low: "1", quick: [1, 1, 2.5, 3, 4, 5, 6], done: "yes", onclick: "x", __proto__: { polluted: 1 } },
      { id: "BAD ID", m: 1, name: "x", seats: ["a", "b"] },
      { id: "match0002", m: -1, name: "x", seats: ["a", "b"] },
      { id: "match0003", m: 1, name: "", seats: ["a", "b"] },
      { id: "match0004", m: 1, name: "solo", seats: ["a"] },
      "junk", null
    ],
    rounds: [
      { id: "round0001", m: 1, g: "match0001", s: [1e12, -5, "7", 2.5] },
      { id: "round0002", m: 1, g: "../x", s: [1] },
      { id: "round0003", m: 1, g: "match0001", s: [] }
    ],
    tpls: [{ id: "tpl000001", m: 1, name: "T", seats: 99, base: "constructor" }],
    players: [{ id: "player001", m: 1, name: "x".repeat(99), col: 42 }],
    tombs: { "bad id": 1, gone00001: 3 }
  };
  const n = D.norm(JSON.parse(JSON.stringify(evil)));
  assert.equal(n.matches.length, 1);
  const m = n.matches[0];
  assert.equal(m.name, "<img src=x onerror=alert(1)>");                 // text only: the app renders with textContent
  assert.deepEqual(m.seats, ["a b", "B", "C", "D", "E", "F", "G", "H"]);
  assert.deepEqual([m.target, m.low, m.done, m.onclick, m.polluted], [0, 0, 0, undefined, undefined]);
  assert.deepEqual(m.quick, [1, 3, 4, 5]);
  assert.deepEqual(n.rounds, [{ id: "round0001", m: 1, g: "match0001", c: 1, s: [0, -5, 0, 0] }]);
  assert.equal(n.tpls[0].seats, 8);
  assert.equal(n.tpls[0].base, "");
  assert.equal(n.players[0].name.length, 24);
  assert.equal(n.players[0].col, 0);
  assert.deepEqual(Object.keys(n.tombs), ["gone00001"]);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1]), null);
  // the same rules as scores.js
  const pairs = [["matches", "normMatch"], ["rounds", "normRound"], ["tpls", "normTpl"], ["players", "normPlayer"]];
  pairs.forEach(([k, f]) => {
    (evil[k].concat(slice()[k])).forEach((x) => {
      assert.deepEqual(P[f](JSON.parse(JSON.stringify(x))), S[f](JSON.parse(JSON.stringify(x))), k + " " + JSON.stringify(x));
    });
  });
  // too many rounds for one match: capped at the app's 500
  const many = { matches: [], rounds: [] };
  for (let i = 0; i < 520; i++) many.rounds.push({ id: "r" + String(100000 + i), m: 1, g: "match0001", s: [1] });
  assert.equal(D.norm(many).rounds.length, 500);
  // and a file that is not ours
  assert.throws(() => K.open(D, slice(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, slice(), { kind: "oros-scores-package", ver: 9, data: {} }), /newer/);
});

test("scores: previews: history.csv is the app's Export CSV, rounds.csv has a formula guard", () => {
  const s = slice();
  ["en", "el"].forEach((lang) => {
    const pv = D.previews(D.strip(s), lang);
    const appCsv = (lang === "el" ? SEL : S).historyCsv(S.mergeScores(s, s), fmtDate);
    assert.equal(pv["history.csv"], appCsv, lang);
  });
  const pv = D.previews(D.strip(s), "en");
  assert.match(pv["history.csv"], /^﻿"Date","Game","Player","Total","Winner"\r\n/);
  assert.ok(pv["history.csv"].includes('"Xeri","\'=Bob",52,"no"'));
  const rows = pv["rounds.csv"].split("\r\n");
  assert.equal(rows[0], '﻿"Date","Game","Finished","Round","Player","Points"');
  assert.equal(rows.length, 1 + 2 + 2 + 3 + 1);                          // header, 2×2, 1×3, trailing
  assert.ok(rows[2].endsWith('"\'=Bob",12'));
  assert.ok(rows[7].endsWith(',"no",1,"Dora",0'));
  // the pack carries them under preview/
  const o = K.pack(D, s, { now: NOW });
  assert.deepEqual(o.preview.map((p) => p.name).sort(), ["history.csv", "rounds.csv"]);
});

test("scores: wiring (scripts, buttons, Open with, Undo, help, file types)", () => {
  const html = read("scores/index.html");
  ["../bundle.js?v=2.49.00", "../recordpkg.js?v=2.49.00", "package.js?v=2.49.00", "scores.js?v=2.49.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '"'), s));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf("package.js?") && html.indexOf("package.js?") < html.indexOf('src="scores.js'));
  ["oros-save", "oros-open", "oros-folder"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const js = read("scores/scores.js");
  assert.match(js, /RP\.ui\(SPK\.DESC,/);
  assert.match(js, /if \(tg && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /__orosTakeTarget\("scores"\)/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /if \(x\) tomb\(id, x\.m\);/);                     // Undo = tombstones, so they sync
  ["oros.save", "oros.open", "oros.folder"].forEach((k) => assert.ok(S.STRINGS.en[k] && S.STRINGS.el[k], k));
  assert.equal(S.STRINGS.en["oros.save"], "orOS file (.orosscores)");
  assert.equal(S.STRINGS.el["oros.folder"], "Αποσυμπιεσμένος φάκελος orOS…");
  for (const f of ["scores/help.en.txt", "scores/help.el.txt"]) assert.ok(read(f).includes(".orosscores"), f);
  assert.deepEqual(F.appsFor(".orosscores"), ["scores"]);
  assert.deepEqual(B.TYPES[".orosscores"], { app: "scores", mime: "application/x-oros-scores" });
});
