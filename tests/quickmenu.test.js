// Desktop menu (quickmenu.js): the synced task list — merge, order,
// examples, tombstones and the {date}/{clipboard} text. Pure logic only.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../quickmenu.js");

const ids = (d) => Q.list(d).map((it) => it.id);
const task = (id, extra) => Object.assign({ id, k: "ask", n: "N " + id, p: "Text " + id, app: "", send: 0 }, extra || {});

test("a fresh device shows the three examples and stores nothing", () => {
  const d = Q.normalize(null);
  assert.deepEqual(d, { ver: 1, items: [] });
  assert.deepEqual(ids(d), ["d-brief", "d-today", "d-week"]);
  assert.equal(Q.list(d)[0].k, "brief");
});

test("put adds at the end, changes in place, and is a no-op without a change", () => {
  let d = Q.put(null, task("qa"), 1000);
  assert.deepEqual(ids(d), ["d-brief", "d-today", "d-week", "qa"]);
  const same = Q.put(d, task("qa"), 2000);
  assert.deepEqual(same, d);
  d = Q.put(d, task("qa", { p: "Other" }), 3000);
  assert.equal(Q.list(d)[3].p, "Other");
  assert.equal(d.items.find((x) => x.id === "qa").m, 3000);
});

test("an app item needs a valid app id; ask-only fields are dropped elsewhere", () => {
  assert.deepEqual(Q.put(null, { id: "qb", k: "app", app: "Bad Id" }, 1).items, []);
  const d = Q.put(null, { id: "qb", k: "app", app: "notes", p: "x", send: 1 }, 1);
  const it = d.items[0];
  assert.equal(it.app, "notes");
  assert.equal(it.p, "");
  assert.equal(it.send, 0);
});

test("removing an example stores a tombstone that wins the merge", () => {
  const d = Q.remove(null, "d-today", 500);
  assert.deepEqual(ids(d), ["d-brief", "d-week"]);
  const other = Q.normalize(null);
  assert.deepEqual(ids(Q.merge(other, d)), ["d-brief", "d-week"]);
  assert.deepEqual(ids(Q.merge(d, other)), ["d-brief", "d-week"]);
});

test("reset brings the examples back and keeps the user's own items", () => {
  let d = Q.put(null, task("qa"), 10);
  d = Q.remove(d, "d-brief", 20);
  d = Q.put(d, { id: "d-week", k: "ask", n: "Mine", p: "Mine too" }, 30);
  d = Q.reset(d, 40);
  assert.deepEqual(ids(d), ["d-brief", "d-today", "d-week", "qa"]);
  const wk = Q.list(d).find((x) => x.id === "d-week");
  assert.equal(wk.n, "");
  assert.equal(wk.p, "");
});

test("move changes one item's order key and keeps others untouched", () => {
  let d = Q.put(null, task("qa"), 10);
  const before = JSON.stringify(d.items.find((x) => x.id === "qa"));
  d = Q.move(d, "d-week", -1, 20);
  assert.deepEqual(ids(d), ["d-brief", "d-week", "d-today", "qa"]);
  assert.equal(JSON.stringify(d.items.find((x) => x.id === "qa")), before);
  assert.deepEqual(Q.move(d, "d-brief", -1, 30), d);   // already first
  d = Q.move(d, "d-brief", 1, 40);
  assert.deepEqual(ids(d), ["d-week", "d-brief", "d-today", "qa"]);
});

test("many moves between two items renumber instead of losing the order", () => {
  let d = Q.put(null, task("qa"), 1);
  d = Q.put(d, task("qb"), 2);
  for (let i = 0; i < 80; i++) d = Q.move(d, i % 2 ? "qa" : "qb", -1, 10 + i);
  const shown = ids(d);
  assert.equal(shown.length, 5);
  assert.equal(new Set(Q.list(d).map((x) => x.o)).size, 5);
});

test("merge is symmetric and idempotent; the newer change of an item wins", () => {
  const a = Q.put(Q.put(null, task("qa"), 10), task("qb"), 20);
  const b = Q.put(Q.put(null, task("qa", { p: "Newer" }), 30), task("qc"), 25);
  const ab = Q.merge(a, b), ba = Q.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(Q.merge(ab, ab), ab);
  assert.equal(Q.list(ab).find((x) => x.id === "qa").p, "Newer");
  assert.deepEqual(ids(ab).filter((x) => x[0] === "q"), ["qa", "qb", "qc"].filter((x) => ids(ab).includes(x)));
  assert.ok(ids(ab).includes("qb") && ids(ab).includes("qc"));
});

test("bad input is dropped, text is capped and control characters removed", () => {
  const d = Q.normalize({ items: [null, { id: "X" }, { id: "qa", k: "nope" },
    { id: "qz", k: "ask", n: "a\u0001b".padEnd(200, "n"), p: "p".repeat(5000), m: -4 }] });
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].n.length, Q.MAX_NAME);
  assert.ok(!/\u0001/.test(d.items[0].n));
  assert.equal(d.items[0].p.length, Q.MAX_TEXT);
  assert.equal(d.items[0].m, 0);
});

test("expand fills {date}, {clipboard} and {selection}; needsClip sees the clipboard", () => {
  assert.equal(Q.expand("On {date}: {clipboard} / {selection} {other}", { date: "Monday", clip: "copied", sel: "picked" }),
    "On Monday: copied / picked {other}");
  assert.equal(Q.expand("{clipboard}", {}), "");
  assert.equal(Q.needsClip("x {clipboard}"), true);
  assert.equal(Q.needsClip("x {date}"), false);
});

test("ids are short and valid", () => {
  const id = Q.newId(1760000000000, 0.5);
  assert.match(id, /^q[a-z0-9]+$/);
  assert.ok(id.length <= 48);
});

test("selected text: {selection} tasks, cleaning and the size cap", () => {
  assert.equal(Q.needsSel("Explain {selection}"), true);
  assert.equal(Q.needsSel("What do I have {date}?"), false);
  assert.deepEqual(Q.cleanSel("  \r\n a\u0001b\r\nc \n "), { text: "a b\nc", cut: false });
  const long = Q.cleanSel("x".repeat(Q.MAX_SEL + 5));
  assert.equal(long.text.length, Q.MAX_SEL);
  assert.equal(long.cut, true);
  const q = Q.expand("Explain:\n\n{selection}", { sel: long.text });
  assert.equal(q.length, "Explain:\n\n".length + Q.MAX_SEL);
  assert.ok(Q.expand("{selection}{selection}", { sel: long.text }).length <= Q.MAX_ASK);
});
