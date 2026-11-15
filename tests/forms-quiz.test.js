// Forms W5 (FORMS-5): quiz keys, scoring, the public copy, results.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../forms/engine.js");
const Q = require("../forms/quiz.js");
const RS = require("../forms/results.js");
const L = require("../forms/links.js");

const QUIZ = { id: "q1", title: "Quiz", set: { quiz: 1 }, qs: [
  { id: "a", t: "choice", label: "2+2", opts: [{ id: "x", label: "3" }, { id: "y", label: "4" }], key: "y", pts: 2 },
  { id: "b", t: "text", label: "Capital of Greece", key: ["Athens", "Αθήνα"] },
  { id: "c", t: "multi", label: "Primes", opts: [{ id: "p", label: "2" }, { id: "q", label: "3" }, { id: "r", label: "4" }], key: ["q", "p"] },
  { id: "d", t: "yesno", label: "Is the sky blue?", key: "yes" },
  { id: "e", t: "number", label: "7 × 6", key: "42" },
  { id: "pg", t: "page", label: "" },
  { id: "f", t: "yesno", label: "More?", key: "no", show: { q: "d", op: "eq", v: "no" } }
] };

test("engine keeps keys that fit and drops the rest; quiz settings in order", () => {
  const f = E.normForm(QUIZ);
  assert.equal(f.qs[0].key, "y");
  assert.equal(f.qs[0].pts, 2);
  assert.deepEqual(f.qs[2].key, ["p", "q"]);        // option order
  assert.equal(f.qs[4].key, 42);
  const bad = E.normForm({ id: "z", set: { quiz: 1, reveal: 1 }, qs: [
    { id: "a", t: "choice", label: "x", opts: [{ id: "x", label: "1" }], key: "nope", pts: 5 },
    { id: "b", t: "scale", label: "s", key: 3 },
    { id: "c", t: "multi", label: "m", opts: [{ id: "x", label: "1" }], key: [] },
    { id: "d", t: "text", label: "t", key: ["", "  "] },
    { id: "e", t: "number", label: "n", key: "abc" },
    { id: "g", t: "choice", label: "x", opts: [{ id: "x", label: "1" }], key: "x", pts: 1000 }] });
  assert.deepEqual(bad.qs.map((q) => q.key), [undefined, undefined, undefined, undefined, undefined, "x"]);
  assert.equal(bad.qs[0].pts, undefined);
  assert.equal(bad.qs[5].pts, 100);
  assert.deepEqual(bad.set, { quiz: 1 });             // reveal needs score
  assert.deepEqual(E.normForm({ id: "z", set: { score: 1 }, qs: [] }).set, {});   // score needs quiz
});

test("score: points of the questions asked; text without case or accents; multi exact", () => {
  const all = Q.score(QUIZ, { a: "y", b: " ΑΘΗΝΑ ", c: ["q", "p"], d: "yes", e: 42 });
  assert.deepEqual([all.pts, all.max, all.n], [6, 6, 5]);       // f was not shown
  const some = Q.score(QUIZ, { a: "x", b: "athens", c: ["p"], d: "no", e: "42" });
  assert.deepEqual([some.pts, some.max, some.n], [2, 7, 6]);    // f shown (d = no) but not answered, e string → number
  assert.deepEqual(some.items.map((i) => i.ok), [false, true, false, false, true, false]);
  assert.equal(Q.score(QUIZ, {}).pts, 0);
  assert.equal(Q.score({ id: "n", qs: QUIZ.qs }, {}), null);    // not a quiz
  assert.equal(Q.on(QUIZ), true);
  assert.equal(Q.on({ id: "n", set: { quiz: 1 }, qs: [{ id: "a", t: "text", label: "x" }] }), false);
});

test("pub: the right answers stay home unless the page shows the score", () => {
  const off = Q.pub(QUIZ);
  assert.ok(off.qs.every((q) => q.key === undefined && q.pts === undefined));
  assert.deepEqual(off.set, {});
  assert.ok(!JSON.stringify(off).includes("Athens"));
  const on = Q.pub(Object.assign({}, QUIZ, { set: { quiz: 1, score: 1, reveal: 1 } }));
  assert.equal(on.qs[0].key, "y");
  assert.deepEqual(on.set, { quiz: 1, score: 1, reveal: 1 });
  // share.js sends quiz.js's copy
  const share = fs.readFileSync(path.join(__dirname, "../forms/share.js"), "utf8");
  assert.ok(share.includes("Q.pub(rec)"));
});

test("results: right option marked, how many got it right, average, Score column", () => {
  const rows = [
    { id: "k.1", at: 1, a: { a: "y", b: "Athens", c: ["p", "q"], d: "yes", e: 42 } },
    { id: "k.2", at: 2, a: { a: "x", b: "Rome", d: "yes", e: 41 } }];
  const s = RS.summary(QUIZ, rows, { yes: "Yes", no: "No", otherName: "Other" });
  const a = s.find((x) => x.q === "a");
  assert.deepEqual(a.bars.map((b) => !!b.ok), [false, true]);
  assert.equal(a.right, 1);
  assert.equal(s.find((x) => x.q === "d").right, 2);
  assert.deepEqual(RS.quizAvg(QUIZ, rows), { avg: 3.5, max: 6, n: 2 });
  const tb = RS.table(QUIZ, rows, { yes: "Yes", no: "No", other: (x) => x, otherName: "Other", time: "Time", wait: "W", score: "Score" });
  assert.equal(tb[0][1], "Score");
  assert.deepEqual([tb[1][1], tb[2][1]], [6, 1]);
  assert.equal(RS.quizAvg({ id: "n", qs: [] }, rows), null);
});

test("Assistant draft of a quiz: answers by option text, points, quiz on", () => {
  const d = L.fromDraft({ title: "Capitals", quiz: true, questions: [
    { label: "France", type: "choice", options: ["Paris", "Lyon"], answer: "paris", points: 2 },
    { label: "Greece", type: "text", answer: ["Athens", "Αθήνα"] },
    { label: "Even", type: "multi", options: ["2", "3", "4"], answer: ["2", "4"] },
    { label: "Sky blue?", type: "yesno", answer: "Yes" },
    { label: "Not in options", type: "choice", options: ["A"], answer: "Z" }] });
  const f = E.normForm(Object.assign({ id: "z" }, d));
  assert.deepEqual(f.set, { quiz: 1 });
  assert.equal(f.qs[0].key, f.qs[0].opts[0].id);
  assert.equal(f.qs[0].pts, 2);
  assert.deepEqual(f.qs[2].key, [f.qs[2].opts[0].id, f.qs[2].opts[2].id]);
  assert.equal(f.qs[3].key, "yes");
  assert.equal(f.qs[4].key, undefined);
  // without quiz: true the answers are ignored
  assert.equal(L.fromDraft({ title: "x", questions: [{ label: "y", type: "yesno", answer: "yes" }] }).qs[0].key, undefined);
});

test("wiring: quiz.js before results.js and fill.js; strings EN, EL, DE", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "forms/index.html"), "utf8");
  assert.ok(html.indexOf("quiz.js") > 0 && html.indexOf("quiz.js") < html.indexOf("results.js"));
  const pub = fs.readFileSync(path.join(root, "forms/f/index.html"), "utf8");
  assert.ok(pub.indexOf("quiz.js") > 0 && pub.indexOf("quiz.js") < pub.indexOf("fill.js"));
  const app = fs.readFileSync(path.join(root, "forms/app.js"), "utf8");
  const fill = fs.readFileSync(path.join(root, "forms/f/fill.js"), "utf8");
  const de = fs.readFileSync(path.join(root, "i18n/de/forms.js"), "utf8");
  for (const k of ["set.quiz", "set.score", "set.scoreHint", "set.reveal", "qz.key", "qz.pts", "qz.accept", "qz.score", "qz.avg", "res.rightN"]) {
    assert.ok(app.split('"' + k + '"').length - 1 >= 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '"'), k + " in DE");
  }
  for (const k of ["p.score", "p.right", "p.wrong"]) {
    assert.ok(fill.split('"' + k + '"').length - 1 >= 2, k);
    assert.ok(de.includes('"' + k + '"'), k + " in DE");
  }
  const as = fs.readFileSync(path.join(root, "assistant/assistant.js"), "utf8");
  assert.ok(as.includes('"../forms/quiz.js", "../forms/results.js"'));
});
