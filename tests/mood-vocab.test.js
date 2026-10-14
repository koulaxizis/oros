// Mood wave 30 (mood/vocab.js): own feelings and activities, their
// order, goals, year in pixels; plus the wiring in mood.js and the
// search provider reading the user's names.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const V = require(path.join(__dirname, "..", "mood/vocab.js"));
const P = require(path.join(__dirname, "..", "mood/search.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const BE = ["happy", "calm", "excited", "sad", "angry", "anxious", "tired", "stressed", "numb"];
const at = (y, m, d, h) => new Date(y, m - 1, d, h || 12).getTime();

test("normDef: ids, labels, icons and colours are cleaned", () => {
  assert.equal(V.normDef({ id: "bad id" }), null);
  assert.equal(V.normDef(null), null);
  const d = V.normDef({ id: "c-abcd1", mtime: 5, lab: "  Loved\n<b>  ", ic: "🥰", col: "#ABCDEF", hid: true, pos: true, junk: 1 });
  assert.deepEqual(d, { id: "c-abcd1", mtime: 5, lab: "Loved <b>", ic: "🥰", col: "#abcdef", hid: true, pos: true });
  assert.equal(V.normDef({ id: "happy", ic: "<img>" }).ic, undefined, "markup is never an icon");
  assert.equal(V.normDef({ id: "happy", col: "red" }).col, undefined);
  assert.equal(Array.from(V.normDef({ id: "happy", lab: "x".repeat(99) }).lab).length, V.LAB_MAX);
  assert.ok(V.isCustomId("c-mv8bi7fjxfmfo"));
  for (const b of ["chores", "calm", "cook", "caf", "c-", "c-ab", "x-abcd"]) assert.equal(V.isCustomId(b), false, b);
});

test("mergeVocab: commutative, idempotent, LWW per item, null when empty", () => {
  assert.equal(V.mergeVocab(null, null), null);
  assert.equal(V.mergeVocab({}, { emo: [] }), null);
  const A = { emo: [{ id: "calm", mtime: 10, lab: "Peaceful" }, { id: "c-aaaa1", mtime: 3, lab: "Loved", ic: "🥰" }],
              eo: { ids: ["calm", "happy"], m: 7 } };
  const B = { emo: [{ id: "calm", mtime: 12, hid: true }], act: [{ id: "c-bbbb1", mtime: 4, lab: "Swim" }],
              eo: { ids: ["happy", "calm"], m: 9 }, ao: { ids: ["c-bbbb1"], m: 4 } };
  const AB = V.mergeVocab(A, B), BA = V.mergeVocab(B, A);
  assert.deepEqual(AB, BA);
  assert.deepEqual(V.mergeVocab(AB, AB), AB);
  assert.deepEqual(V.mergeVocab(AB, A), AB);
  assert.deepEqual(AB.emo.map((d) => d.id), ["c-aaaa1", "calm"]);
  assert.deepEqual(AB.emo[1], { id: "calm", mtime: 12, hid: true }, "newer version wins whole");
  assert.deepEqual(AB.eo.ids, ["happy", "calm"]);
  // tie on the same stamp: same pick on both sides
  const t1 = { emo: [{ id: "calm", mtime: 5, lab: "A" }] }, t2 = { emo: [{ id: "calm", mtime: 5, lab: "B" }] };
  assert.deepEqual(V.mergeVocab(t1, t2), V.mergeVocab(t2, t1));
});

test("mergeVocab: an absent side never deletes (old devices drop the key)", () => {
  const A = { act: [{ id: "c-bbbb1", mtime: 4, lab: "Swim" }] };
  assert.deepEqual(V.mergeVocab(A, undefined), V.mergeVocab(A, {}));
  assert.equal(V.mergeVocab(A, undefined).act.length, 1);
});

test("mergeVocab: a factory reset (rs) removes everything older on every device", () => {
  const old = { emo: [{ id: "c-aaaa1", mtime: 3, lab: "Loved" }], eo: { ids: ["calm"], m: 5 } };
  const reset = { rs: 10 };
  const m = V.mergeVocab(old, reset);
  assert.deepEqual(m, { rs: 10 });
  assert.deepEqual(V.mergeVocab(reset, old), m);
  const after = V.mergeVocab(m, { act: [{ id: "c-cccc1", mtime: 11, lab: "Run" }] });
  assert.equal(after.act.length, 1, "made after the reset: kept");
});

test("orderIds: saved order first, then built-ins, then custom by id; moveId", () => {
  const defs = [{ id: "c-bbbb2" }, { id: "c-aaaa1" }, { id: "calm", lab: "x" }];
  assert.deepEqual(V.orderIds(BE, defs, null).slice(-3), ["numb", "c-aaaa1", "c-bbbb2"]);
  const o = V.orderIds(BE, defs, { ids: ["c-bbbb2", "sad", "ghost", "sad"], m: 1 });
  assert.deepEqual(o.slice(0, 3), ["c-bbbb2", "sad", "happy"]);
  assert.equal(o.length, BE.length + 2, "unknown ids dropped, nothing lost");
  assert.deepEqual(V.moveId(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(V.moveId(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(V.moveId(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
});

test("goals: normalised, merged with soft delete", () => {
  assert.equal(V.normGoal({ id: "g-1", act: "bad id" }), null);
  assert.deepEqual(V.normGoal({ id: "g-1", act: "move", n: 99, per: "w", mtime: 3 }), { id: "g-1", act: "move", n: 7, per: "w", mtime: 3 });
  assert.equal(V.normGoal({ id: "g-1", act: "move", n: 40, per: "m" }).n, 31);
  assert.equal(V.normGoal({ id: "g-1", act: "move", n: 0 }).n, 1);
  const a = [{ id: "g-1", act: "move", n: 3, per: "w", mtime: 5 }];
  const b = [{ id: "g-1", act: "move", n: 3, per: "w", mtime: 6, x: 1 }, { id: "g-2", act: "c-swim1", n: 2, per: "m", mtime: 1 }];
  const m = V.mergeGoals(a, b);
  assert.deepEqual(m, V.mergeGoals(b, a));
  assert.equal(m.find((g) => g.id === "g-1").x, 1, "the newer delete wins");
  assert.deepEqual(V.liveGoals(m).map((g) => g.id), ["g-2"]);
  assert.deepEqual(V.mergeGoals(m, a), m, "a stale copy never brings it back");
  assert.equal(V.mergeGoals(null, []), null);
});

test("periodOf: Monday weeks and calendar months, going back", () => {
  const wed = at(2026, 10, 14);                     // a Wednesday
  assert.deepEqual(V.periodOf("w", wed, 0), { from: "2026-10-12", to: "2026-10-18", days: 7 });
  assert.deepEqual(V.periodOf("w", wed, 1), { from: "2026-10-05", to: "2026-10-11", days: 7 });
  assert.deepEqual(V.periodOf("w", at(2026, 10, 18), 0).from, "2026-10-12", "Sunday belongs to the week before it");
  assert.deepEqual(V.periodOf("m", wed, 0), { from: "2026-10-01", to: "2026-10-31", days: 31 });
  assert.deepEqual(V.periodOf("m", at(2026, 3, 31), 1), { from: "2026-02-01", to: "2026-02-28", days: 28 });
  assert.deepEqual(V.periodOf("m", at(2026, 1, 15), 1).from, "2025-12-01");
});

test("goalProgress: distinct days marked, built-in yes or own activity", () => {
  const es = [
    { id: "1", ts: at(2026, 10, 12, 9), move: "yes" },
    { id: "2", ts: at(2026, 10, 12, 20), move: "yes" },          // same day: counts once
    { id: "3", ts: at(2026, 10, 13), move: "no" },
    { id: "4", ts: at(2026, 10, 14), move: "yes", acts: ["c-swim1"] },
    { id: "5", ts: at(2026, 10, 6), move: "yes" },
    { id: "6", ts: at(2026, 10, 7), move: "yes" },
    { id: "7", ts: at(2026, 10, 8), move: "yes" }
  ];
  const p = V.goalProgress(es, { id: "g-1", act: "move", n: 3, per: "w" }, at(2026, 10, 14), 2);
  assert.equal(p.done, 2);
  assert.equal(p.ok, false);
  assert.equal(p.pct, 67);
  assert.deepEqual(p.past, [3, 0]);
  assert.equal(p.met, 1);
  const s = V.goalProgress(es, { id: "g-2", act: "c-swim1", n: 1, per: "m" }, at(2026, 10, 14), 0);
  assert.equal(s.done, 1);
  assert.ok(s.ok);
  assert.equal(V.marks({ acts: ["c-swim1"] }, "c-swim1"), true);
  assert.equal(V.marks({ move: "no" }, "move"), false);
});

test("yearPixels: the strongest feeling per local day, only that year", () => {
  const es = [
    { ts: at(2026, 3, 1, 8), emotions: [{ k: "calm", i: 2 }, { k: "sad", i: 4 }] },
    { ts: at(2026, 3, 1, 20), emotions: [{ k: "happy", i: 4 }] },        // tie: the first met stays
    { ts: at(2026, 3, 2), emotions: [{ k: "c-loved1", i: 5 }] },
    { ts: at(2025, 12, 31), emotions: [{ k: "angry", i: 5 }] },
    { ts: "x", emotions: [{ k: "angry", i: 5 }] }
  ];
  const px = V.yearPixels(es, 2026);
  assert.deepEqual(px, { "2026-03-01": { k: "sad", i: 4 }, "2026-03-02": { k: "c-loved1", i: 5 } });
  assert.equal(V.daysIn(2024, 2), 29);
  assert.equal(V.daysIn(2026, 2), 28);
  assert.deepEqual(V.yearsWithData(es, 2026), [2025, 2026]);
});

test("normActs: own activity ids only, sorted, null when none", () => {
  assert.deepEqual(V.normActs(["c-bbbb1", "c-aaaa1", "c-bbbb1", "move", 7]), ["c-aaaa1", "c-bbbb1"]);
  assert.equal(V.normActs([]), null);
  assert.equal(V.normActs("x"), null);
});

test("search provider: the user's own names for feelings and activities", () => {
  const raw = {
    entries: [{ id: "e1", ts: 1, mtime: 1, emotions: [{ k: "calm", i: 3 }, { k: "c-loved1", i: 4 }], acts: ["c-swim1"], note: "" }],
    deleted: {}, cols: {},
    vocab: { emo: [{ id: "calm", mtime: 1, lab: "Peaceful" }, { id: "c-loved1", mtime: 1, lab: "Loved" }],
             act: [{ id: "c-swim1", mtime: 1, lab: "Swim" }] }
  };
  const hits = P.search({ readJSON: () => raw, lang: "en" });
  assert.equal(hits[0].title, "Peaceful, Loved");
  assert.ok(hits[0].text.includes("Swim"));
  const plain = P.search({ readJSON: () => ({ entries: raw.entries, deleted: {}, cols: {} }), lang: "el" });
  assert.equal(plain[0].title, "Ήρεμος", "unknown custom feelings are left out without the vocabulary");
});

test("wiring: vocab.js loads before mood.js; mood.js keeps old shapes", () => {
  const html = read("mood/index.html");
  assert.ok(html.indexOf("vocab.js") > 0 && html.indexOf("vocab.js") < html.indexOf("mood.js"));
  const js = read("mood/mood.js");
  assert.ok(/OPT_FIELDS = \{ acts: true \}/.test(js), "acts is an optional field");
  assert.ok(/V\.mergeVocab\(a\.vocab, b\.vocab\)/.test(js) && /V\.mergeGoals\(a\.goals, b\.goals\)/.test(js));
  assert.ok(/if \(cv\) out\.vocab = cv;/.test(js), "vocab only when non-empty");
});
