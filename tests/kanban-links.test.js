// KB-LINK (Chris 2026-11-23, cards «Ναι, κλειδί + upsert», «Ναι» links):
// a card's key (a stable external key) and links live in their own
// field group e. Cleaning, per-field merge, and a mixed fleet with the
// 8.83.00 model (no group e) that converges without endless uploads.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const M = require(path.join(__dirname, "..", "kanban/model.js"));
const OLD = require(path.join(__dirname, "fixtures", "kanban-model-8.83.00.js"));

const NOW = Date.UTC(2026, 10, 23, 10, 0, 0);
const T0 = NOW - 3600e3;
function card(id, extra) { return Object.assign({ id, text: "Card " + id, notes: "", due: null, labels: [], subtasks: [], info: [], mtime: T0, pos: 0 }, extra || {}); }
function col(id, cards) { return { id, name: id, mtime: T0, om: T0, pos: 0, cards }; }
function st(cards) { return { ver: 5, om: T0, boardDeleted: {}, boards: [{ id: "b1", name: "B", archived: false, mtime: T0, om: T0, deleted: {}, labels: [], columns: [col("todo", cards), col("done", [])] }] }; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function canon(s) { return M.canonState(s, NOW); }
function k1(s) { return s.boards[0].columns[0].cards[0]; }
function edit(s, fn) { const x = clone(s); fn(k1(x)); return canon(x); }
const base = () => canon(st([card("k1")]));

test("key and links are cleaned: printable key ≤ 120, https or /path links, ≤ 10, no duplicates", () => {
  assert.equal(M.cleanKey("  rc-2026-11-27\u0001#3 "), "rc-2026-11-27 #3");
  assert.equal(M.cleanKey("x".repeat(121)), "");
  assert.deepEqual(M.cleanLinks([{ u: "https://useoros.online/a?b=1", t: " Αναφορά " }, { u: "/mnt/x/../y" }, { u: "javascript:alert(1)" }, { u: "ftp://x" },
                                 { u: "/internal/Claude/reports/2026-11.md" }, { u: "https://useoros.online/a?b=1" }, "nope", { u: "http://x/\"><img>" }]),
                   [{ u: "https://useoros.online/a?b=1", t: "Αναφορά" }, { u: "/internal/Claude/reports/2026-11.md" }]);
  assert.equal(M.cleanLinks(Array.from({ length: 12 }, (v, i) => ({ u: "https://e.x/" + i }))).length, 10);
  const s = canon(st([card("k", { key: " ", links: [{ u: "data:text/html,x" }] })]));
  assert.equal(k1(s).key, undefined);
  assert.equal(k1(s).links, undefined);
  assert.ok(M.GROUPS.indexOf("e") >= 0);
});

test("links here and a text edit elsewhere both stay; the newer links win", () => {
  const s0 = base();
  const A = edit(s0, (k) => { k.key = "rc-1"; k.links = [{ u: "https://a.example/r" }]; M.stampCard(k, ["e"], NOW - 1000); });
  const B = edit(s0, (k) => { k.text = "Renamed"; M.stampCard(k, ["t"], NOW - 500); });
  const m1 = M.mergeKanbanStates(clone(A), clone(B), NOW), m2 = M.mergeKanbanStates(clone(B), clone(A), NOW);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  assert.deepEqual([k1(m1).key, k1(m1).links, k1(m1).text], ["rc-1", [{ u: "https://a.example/r" }], "Renamed"]);
  const C = edit(A, (k) => { k.links = [{ u: "https://b.example/r" }]; M.stampCard(k, ["e"], NOW - 100); });
  assert.deepEqual(k1(M.mergeKanbanStates(clone(A), clone(C), NOW)).links, [{ u: "https://b.example/r" }]);
});

function settle(devices, remote) {
  let quiet = 0, rounds = 0, uploads = 0;
  while (quiet < devices.length && rounds < 40) {
    const d = devices[rounds % devices.length];
    rounds++;
    const merged = d.model.mergeKanbanStates(clone(d.local), clone(remote), NOW);
    d.local = merged;
    if (JSON.stringify(merged) !== JSON.stringify(remote)) { remote = merged; uploads++; quiet = 0; }
    else quiet++;
  }
  return { remote, uploads, settled: quiet >= devices.length };
}

test("mixed fleet: links here and a text edit on 8.83.00 converge, nothing lost", () => {
  const s0 = base();
  const neu = { model: M, local: edit(s0, (k) => { k.key = "rc-1"; k.links = [{ u: "https://a.example/r", t: "R" }]; M.stampCard(k, ["e"], NOW - 1000); }) };
  const old = { model: OLD, local: OLD.canonState(clone(edit(s0, (k) => { k.text = "Old text"; OLD.stampCard(k, ["t"], NOW - 500); })), NOW) };
  [[old, neu], [neu, old]].forEach((order) => {
    const devs = order.map((d) => ({ model: d.model, local: clone(d.local) }));
    const r = settle(devs, s0);
    assert.ok(r.settled, "no endless uploads");
    assert.ok(r.uploads <= 4, "a few uploads (" + r.uploads + ")");
    assert.equal(k1(r.remote).key, "rc-1");
    assert.deepEqual(k1(r.remote).links, [{ u: "https://a.example/r", t: "R" }]);
    assert.equal(k1(r.remote).text, "Old text");
    devs.forEach((d) => assert.equal(JSON.stringify(d.local), JSON.stringify(r.remote)));
  });
});

test("mixed fleet: an older device's later notes edit does not take the links away", () => {
  const s0 = edit(base(), (k) => { k.links = [{ u: "https://a.example/r" }]; M.stampCard(k, ["e"], NOW - 2000); });
  const neu = { model: M, local: clone(s0) };
  const old = { model: OLD, local: OLD.canonState(clone(edit(s0, (k) => { k.notes = "later"; OLD.stampCard(k, ["n"], NOW - 100); })), NOW) };
  const r = settle([old, neu], s0);
  assert.ok(r.settled);
  assert.deepEqual(k1(r.remote).links, [{ u: "https://a.example/r" }]);
  assert.equal(k1(r.remote).notes, "later");
});
