// Typing Tutor: layouts, course and the TYPING v1 slice (OROS_BIBLE.md Part I, R5/R17/R26).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../typing/core.js");
const K = require("../typing/layouts.js");
const CO = require("../typing/course.js");

const DAY = 864e5;
const T0 = new Date(2026, 9, 31, 12).getTime();
const run = (lay, extra) => Object.assign({ lay, chars: 200, errors: 4, ms: 60000, keys: { a: [10, 1, 3000] } }, extra);

function devA() {
  let d = C.setPrefs(C.empty(), { lay: "el", goal: 15 }, T0);
  d = C.record(d, run("el", { lesson: "h1" }), T0 + 1000, "aaa");
  d = C.record(d, run("el", { test: 1, chars: 300 }), T0 + 2000, "aaa");
  return d;
}
function devB() {
  let d = C.setPrefs(C.empty(), { hint: "on" }, T0 + 500);
  d = C.record(d, run("el", { lesson: "h1", chars: 150, errors: 0, ms: 30000 }), T0 + 1500, "bbb");
  d = C.record(d, run("en", { test: 1, chars: 400 }), T0 + DAY, "bbb");
  return d;
}

test("layouts: every character of a lesson can be typed, accents through the dead key", () => {
  assert.deepEqual(K.strokes("el", "ά"), [{ code: "Semicolon", shift: false }, { code: "KeyA", shift: false }]);
  assert.deepEqual(K.strokes("el", "ϊ"), [{ code: "Semicolon", shift: true }, { code: "KeyI", shift: false }]);
  assert.deepEqual(K.strokes("el", "Ά"), [{ code: "Semicolon", shift: false }, { code: "KeyA", shift: true }]);
  assert.deepEqual(K.strokes("el", "ς"), [{ code: "KeyW", shift: false }]);
  assert.deepEqual(K.strokes("de", "z"), [{ code: "KeyY", shift: false }]);
  assert.deepEqual(K.strokes("de", "ß"), [{ code: "Minus", shift: false }]);
  assert.equal(K.shiftFor("KeyA"), "ShiftRight");
  assert.equal(K.shiftFor("KeyJ"), "ShiftLeft");
  for (const lay of K.LAYOUT_IDS) {
    for (const l of CO.lessons(lay)) {
      for (const seed of [1, 7, 99]) {
        const text = CO.build(lay, l.id, seed);
        assert.ok(text.length > 60, `${lay} ${l.id} has text`);
        for (const ch of Array.from(text)) assert.ok(K.strokes(lay, ch), `${lay} ${l.id}: '${ch}' is typeable`);
      }
    }
  }
});

test("course: a lesson uses only the keys learned so far, the same seed gives the same text", () => {
  for (const lay of K.LAYOUT_IDS) {
    CO.lessons(lay).forEach((l, i) => {
      const ok = CO.allowed(lay, i);
      for (const ch of Array.from(CO.build(lay, l.id, 5))) assert.ok(ok[ch], `${lay} ${l.id}: '${ch}' learned`);
    });
    assert.equal(CO.build(lay, "t3", 42), CO.build(lay, "t3", 42));
    assert.ok(CO.testText(lay, 3, 50).split(" ").length === 50);
  }
  assert.equal(CO.label("el", "h1"), "φ ξ");
  assert.equal(CO.label("de", "t3"), "t z");
  // Greek gets the tonos on the home row, together with α
  assert.ok(CO.allowed("el", CO.indexOf("h4"))["ά"]);
  assert.ok(!CO.allowed("el", CO.indexOf("h4"))["Α"], "capitals wait for the Shift lesson");
  // lesson ids never change meaning (they are stored in the synced progress)
  assert.deepEqual(CO.lessons().map((l) => l.id).join(" "),
    "h1 h2 h3 h4 h5 h6 t1 t2 t3 t4 t5 t6 b1 b2 b3 b4 b5 b6 s1 s2 n1 n2 p1 f1");
});

test("layouts: a key press tells which system layout is on", () => {
  assert.equal(K.guess("KeyA", "α", false), "el");
  assert.equal(K.guess("KeyY", "z", false), "de");
  assert.equal(K.guess("KeyY", "y", false), "en");
  assert.equal(K.guess("KeyA", "a", false), "", "a is the same on en and de");
  assert.equal(K.guess("Digit1", "1", false), "");
});

test("scoring: wpm, accuracy and stars", () => {
  assert.equal(C.wpm(250, 60000), 50);
  assert.equal(C.accuracy(98, 2), 98);
  assert.equal(C.stars(25, 98), 3);
  assert.equal(C.stars(15, 95), 2);
  assert.equal(C.stars(5, 90), 1);
  assert.equal(C.stars(60, 89), 0);
});

test("merge is symmetric, idempotent and associative", () => {
  const a = devA(), b = devB();
  const c = C.record(C.empty(), run("de", { lesson: "h2" }), T0 + 3000, "ccc");
  const ab = C.serialize(C.merge(a, b));
  assert.equal(ab, C.serialize(C.merge(b, a)));
  assert.equal(C.serialize(C.merge(JSON.parse(ab), b)), ab);
  assert.equal(C.serialize(C.merge(a, a)), C.serialize(a));
  assert.equal(C.serialize(C.merge(C.merge(a, b), c)), C.serialize(C.merge(a, C.merge(b, c))));
});

test("progress takes the best of each device, practice on two devices adds up", () => {
  const m = C.merge(devA(), devB());
  const p = C.progress(m, "el", "h1");
  // A: 200 chars/min = 40 wpm, 98%; B: 150 chars in 30 s = 60 wpm, 100%
  assert.equal(p.w, 60);
  assert.equal(p.a, 100);
  assert.equal(p.s, 3);
  assert.equal(C.todayMs(m, T0), 60000 + 60000 + 30000);
  assert.equal(C.keyStats(m, "el").a.r, 30);
  assert.equal(m.set.hint, "on", "settings: the newer write wins");
  assert.equal(m.set.lay, "", "the newer settings row carries its own layout field");
  assert.equal(m.best["el|1"].w, 60);
  assert.equal(m.best["en|1"].w, 80);
});

test("reset drops older rows on every device, newer practice stays", () => {
  const a = devA();
  const reset = C.resetProgress(devB(), T0 + 5 * DAY);
  const after = C.record(reset, run("el", { lesson: "h2" }), T0 + 6 * DAY, "bbb");
  const m = C.merge(a, after);
  assert.equal(C.progress(m, "el", "h1"), null);
  assert.ok(C.progress(m, "el", "h2"));
  assert.deepEqual(Object.keys(m.best), []);
  assert.deepEqual(Object.keys(m.days).map((k) => k.split("|")[1]), ["bbb"]);
  // an old row does not lift a newer one through the max-merge
  const old = C.record(C.empty(), run("el", { lesson: "h2", chars: 1000, errors: 0 }), T0, "aaa");
  assert.equal(C.progress(C.merge(after, old), "el", "h2").w, C.progress(after, "el", "h2").w);
});

test("days keep the 400 newest dates, also inside the merge", () => {
  let d = C.empty();
  for (let i = 0; i < 410; i++) d = C.record(d, run("en"), T0 - i * DAY, "aaa");
  assert.equal(Object.keys(d.days).length, 400);
  const old = C.record(C.empty(), run("en"), T0 - 500 * DAY, "bbb");
  assert.equal(Object.keys(C.merge(d, old).days).length, 400);
  assert.deepEqual(C.merge(d, old).days, d.days);
});

test("streak counts days in a row up to today or yesterday", () => {
  let d = C.empty();
  [0, 1, 2, 4].forEach((i) => { d = C.record(d, run("en"), T0 - i * DAY, "aaa"); });
  assert.equal(C.streak(d, T0), 3);
  assert.equal(C.streak(d, T0 + DAY), 3);
  assert.equal(C.streak(d, T0 + 2 * DAY), 0);
});

test("broken input is dropped, never repaired", () => {
  const d = C.normalize({
    set: { m: "x", lay: "fr", goal: 999 },
    prog: { "el|h1": { s: 9, m: 5 }, "xx|h1": { s: 1, m: 5 }, "el|h2": { s: 1 } },
    days: { "2026|aaa": { ms: 1, m: 1 }, "20261031|AAA": { ms: 1, m: 1 } },
    keys: { "el|aaa": { m: 3, k: { ab: [1, 1, 1], a: [1, "x", 1], b: [1, 2, 3] } } },
    best: { "el|3": { w: 1, a: 1, t: 1, m: 1 } }
  });
  assert.deepEqual(d.set, { m: 0, lay: "", goal: 10, hint: "auto", err: "stop", kid: 0, fs: 2, rs: 0 });
  assert.deepEqual(d.prog, { "el|h1": { s: 0, w: 0, a: 0, m: 5 } });
  assert.deepEqual(d.days, {});
  assert.deepEqual(d.keys, { "el|aaa": { m: 3, k: { b: [1, 2, 3] } } });
  assert.deepEqual(d.best, {});
});

test("layouts: a Latin key on a Greek lesson does not fit the Greek layout", () => {
  assert.deepEqual(K.fits("KeyF", "f", false), ["en", "de"]);
  assert.deepEqual(K.fits("KeyF", "φ", false), ["el", "elp"]);
  assert.deepEqual(K.fits("Digit1", "1", false), ["el", "en", "de", "elp", "dv", "cm"]);
  assert.equal(C.wpm(100000, 1000), 400, "wpm is capped at 400");
});
