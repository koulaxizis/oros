// Publishing wave P4: the release plan (dates counted back from the
// release date), its Calendar rows (publish/feed.js) and the
// Assistant's "book" card (propose_entry → { asNew } in Publishing).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../publish/core.js");
const F = require("../publish/feed.js");
const A = require("../assistant/core.js");

let n = 0;
const id = () => "s" + (++n);

test("the plan is dated back from the release date", () => {
  const p = C.makePlan("2026-03-15", [], id);
  assert.deepEqual(p.map((s) => s.k), ["ms", "ed", "p1", "cov", "p2", "isbn", "p3", "print", "pres"]);
  assert.equal(p.find((s) => s.k === "print").d, "2026-02-22");
  assert.equal(p.find((s) => s.k === "pres").d, "2026-03-29");
  assert.equal(p.find((s) => s.k === "ms").d, "2025-11-15");     // across the year
  assert.ok(p.every((s) => s.done === 0 && /^s\d+$/.test(s.id)));
  assert.deepEqual(C.makePlan("", p, id), p);                    // no release date: nothing changes
});

test("re-dating keeps ids, done steps and own steps", () => {
  let p = C.makePlan("2026-03-15", [], id);
  const ms = p.find((s) => s.k === "ms");
  p = p.map((s) => s.k === "ms" ? Object.assign({}, s, { done: 1, d: "2025-11-20" }) : s);
  p.push({ id: "own1", k: "x", n: "Book fair", d: "2026-05-01", done: 0 });
  const q = C.makePlan("2026-04-15", p, id);
  assert.equal(q.find((s) => s.k === "ms").id, ms.id);
  assert.equal(q.find((s) => s.k === "ms").d, "2025-11-20");          // done: kept
  assert.equal(q.find((s) => s.k === "print").d, "2026-03-25");       // open: moved
  assert.deepEqual(q.find((s) => s.k === "x"), { id: "own1", k: "x", n: "Book fair", d: "2026-05-01", done: 0 });
  assert.equal(q.length, 10);
});

test("the plan is cleaned with the title and merges like any field", () => {
  const raw = { id: "t1", t: "A", rel: "2026-03-15", plan: [
    { id: "a", k: "p1", d: "2026-01-14", done: 1 }, { id: "a", k: "p2", d: "2026-01-29" },
    { id: "b", k: "nope", d: "x" }, { id: "c", k: "x" }, { id: "d", k: "x", n: "  Launch <b>party</b> ", d: "2026-03-20", done: true }, 5
  ] };
  const t = C.normalize(C.put(C.empty(), "titles", raw, 1)).titles[0];
  assert.deepEqual(t.plan, [
    { id: "a", k: "p1", d: "2026-01-14", done: 1 },
    { id: "d", k: "x", d: "2026-03-20", done: 0, n: "Launch <b>party</b>" }
  ]);
  const bare = C.normalize(C.put(C.empty(), "titles", { id: "t2", t: "B" }, 1)).titles[0];
  assert.equal("plan" in bare, false);
});

test("plan state: late steps and the next one", () => {
  const t = { plan: C.makePlan("2026-03-15", [], id) };
  t.plan[0].done = 1;
  const st = C.planState(t, "2026-01-20");
  assert.deepEqual(st.late.map((s) => s.k), ["ed", "p1"]);
  assert.equal(st.next.k, "cov");
  assert.equal(st.done, 1);
  assert.equal(st.total, 9);
});

test("Calendar rows: release dates and open steps, labelled", () => {
  let d = C.put(C.empty(), "titles", { id: "t1", t: "Night Sea", rel: "2026-03-15", plan: [
    { id: "a", k: "print", d: "2026-02-22" }, { id: "b", k: "p1", d: "2026-01-14", done: 1 }, { id: "c", k: "x", n: "Fair", d: "2026-03-15" }] }, 1);
  d = C.put(d, "titles", { id: "t2", t: "Old", st: "oop", rel: "2020-01-01" }, 2);
  d = C.put(d, "titles", { id: "t3", t: "Gone", rel: "2026-03-15" }, 3);
  d = C.remove(d, "titles", "t3", 4);
  const days = F.byDay(JSON.parse(C.serialize(d)));
  assert.deepEqual(Object.keys(days).sort(), ["2026-02-22", "2026-03-15"]);
  assert.deepEqual(days["2026-03-15"].map((r) => F.label(r, "en")).sort(), ["Fair · Night Sea", "Release: Night Sea"]);
  assert.equal(F.label(days["2026-02-22"][0], "el"), "Στο τυπογραφείο · Night Sea");
  assert.deepEqual(F.byDay(null), {});
  assert.deepEqual(F.byDay({ titles: "x" }), {});
});

test("Assistant book card → Publishing's new title with the plan", () => {
  assert.equal(A.ENTRY_KINDS.book, "publish");
  assert.ok(A.entryKinds().indexOf("book") >= 0);
  const e = A.normEntry({ kind: "book", title: "Night Sea", by: "Ann Writer", date: "2026-03-15", isbn: "978-618-5321-00-0" }, { from: "Assistant" });
  assert.equal(e.ok, true, e.err);
  assert.deepEqual(e.call.args, ["publish", { asNew: { t: "Night Sea", author: "Ann Writer", rel: "2026-03-15", plan: 1, isbn: "9786185321000", from: "Assistant" } }]);
  assert.equal(A.normEntry({ kind: "book" }).ok, false);
  assert.match(A.normEntry({ kind: "book", title: "X", isbn: "9786185321001" }).err, /check digit/);
  const noDate = A.normEntry({ kind: "book", title: "X" });
  assert.deepEqual(noDate.call.args[1].asNew, { t: "X" });
  assert.equal(A.normEntry({ kind: "book", title: "X" }, { has: (a) => a !== "publish" }).ok, false);
});
