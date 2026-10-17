// Flashcards: the FSRS-6 rewrite (flashcards/fsrs.js) against vectors
// made once with the reference implementation ts-fsrs 5.4.2 (MIT).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../flashcards/fsrs.js");
const V = require("./fixtures/flashcards-fsrs-vectors.json");

test("every answer gives the same state as ts-fsrs", () => {
  let n = 0;
  V.cases.forEach((c, ci) => {
    const P = F.params(c.cfg);
    let card = F.newCard(0);
    c.seq.forEach((x, i) => {
      card = F.next(card, x.t, x.g, P);
      const where = "case " + ci + " answer " + i;
      assert.equal(card.st, x.st, where + " state");
      assert.equal(card.due, x.due, where + " due");
      assert.equal(card.sd, x.sd, where + " days");
      assert.equal(card.step, x.step, where + " step");
      assert.equal(card.reps, x.reps, where + " reps");
      assert.equal(card.lapses, x.lapses, where + " lapses");
      assert.ok(Math.abs(card.s - x.s) < 1e-6, where + " stability " + card.s + " vs " + x.s);
      assert.ok(Math.abs(card.d - x.d) < 1e-6, where + " difficulty");
      n++;
    });
  });
  assert.ok(n > 500);
});

test("preview never orders the review intervals wrongly", () => {
  const P = F.params({});
  let card = F.newCard(0), t = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 6; i++) { t = Math.max(t + 60000, card.due); card = F.next(card, t, 3, P); }
  const p = F.preview(card, card.due + 3600000, P);
  assert.ok(p[2].sd <= p[3].sd && p[3].sd < p[4].sd);
  assert.equal(p[1].st, 3);
  assert.equal(p[1].lapses, card.lapses + 1);
});

test("recall probability falls with time", () => {
  const P = F.params({});
  const c = F.next(F.next(F.newCard(0), 1e12, 3, P), 1e12 + 600000, 3, P);
  const r1 = F.recall(c, c.last + F.DAY, P), r2 = F.recall(c, c.last + 30 * F.DAY, P);
  assert.ok(r1 > r2 && r1 <= 1 && r2 > 0);
  assert.equal(F.recall(F.newCard(0), 5, P), null);
});
