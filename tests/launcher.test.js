// Favourites (launcher.js): the pure model — normalize, pin, move,
// list — and the merge of the "launcher" slice (R26 / R27 + fuzz).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const L = require(path.join(__dirname, "..", "launcher.js"));
const J = (x) => JSON.stringify(x);

test("normalize: empty, junk and canonical order", () => {
  assert.deepEqual(L.normalize(null), { ver: 1, items: [] });
  assert.deepEqual(L.normalize({ items: "x" }), { ver: 1, items: [] });
  const n = L.normalize({ items: [
    { mtime: 5, dock: null, desk: 2, id: "notes", extra: 1 },
    { id: "Bad Id", desk: 1, mtime: 1 },
    { id: "calendar", desk: "1", dock: NaN, mtime: -3 },
    null,
  ] });
  assert.equal(J(n), J({ ver: 1, items: [
    { id: "calendar", desk: null, dock: null, mtime: 0 },
    { id: "notes", desk: 2, dock: null, mtime: 5 },
  ] }));
});

test("normalize: duplicate ids keep the newer item", () => {
  const n = L.normalize({ items: [
    { id: "notes", desk: 1, dock: null, mtime: 9 },
    { id: "notes", desk: null, dock: null, mtime: 10 },
  ] });
  assert.equal(n.items.length, 1);
  assert.equal(n.items[0].desk, null);
});

test("pin: appends at the end, unpin clears, no-op keeps mtime", () => {
  let d = L.normalize(null);
  d = L.pin(d, "notes", "desk", true, 100);
  d = L.pin(d, "calendar", "desk", true, 200);
  d = L.pin(d, "todo", "dock", true, 300);
  assert.deepEqual(L.list(d, "desk"), ["notes", "calendar"]);
  assert.deepEqual(L.list(d, "dock"), ["todo"]);
  assert.ok(L.isPinned(d, "todo"));
  assert.ok(!L.isPinned(d, "todo", "desk"));
  const same = L.pin(d, "notes", "desk", true, 999);
  assert.equal(J(same), J(d), "pinning twice changes nothing");
  d = L.pin(d, "notes", "desk", false, 400);
  assert.deepEqual(L.list(d, "desk"), ["calendar"]);
  assert.equal(d.items.find((i) => i.id === "notes").mtime, 400);
  assert.ok(!L.isPinned(d, "notes"));
});

test("pin: rejects bad ids and places, never mutates its input", () => {
  const d = L.pin(null, "notes", "desk", true, 1);
  const before = J(d);
  assert.equal(J(L.pin(d, "<img>", "desk", true, 2)), before);
  assert.equal(J(L.pin(d, "todo", "taskbar", true, 2)), before);
  L.pin(d, "todo", "desk", true, 3);
  L.move(d, "notes", "desk", 1, 3);
  assert.equal(J(d), before);
});

test("mtime always moves forward, even with a slow clock", () => {
  let d = L.pin(null, "notes", "desk", true, 5000);
  d = L.pin(d, "notes", "desk", false, 10);       // device clock behind
  assert.ok(d.items[0].mtime > 5000);
});

test("move: only the moved item changes", () => {
  let d = null;
  ["a", "b", "c", "d"].forEach((id, i) => { d = L.pin(d, id, "desk", true, 10 + i); });
  const before = d;
  d = L.move(d, "d", "desk", -1, 100);
  assert.deepEqual(L.list(d, "desk"), ["a", "b", "d", "c"]);
  const changed = d.items.filter((it, i) => J(it) !== J(before.items[i])).map((it) => it.id);
  assert.deepEqual(changed, ["d"]);
  d = L.move(d, "a", "desk", 1, 101);
  assert.deepEqual(L.list(d, "desk"), ["b", "a", "d", "c"]);
  d = L.move(d, "b", "desk", -1, 102);              // already first
  assert.deepEqual(L.list(d, "desk"), ["b", "a", "d", "c"]);
  d = L.move(d, "c", "desk", 1, 103);               // already last
  assert.deepEqual(L.list(d, "desk"), ["b", "a", "d", "c"]);
  d = L.move(d, "b", "desk", 1, 104);
  d = L.move(d, "b", "desk", 1, 105);
  d = L.move(d, "b", "desk", 1, 106);
  assert.deepEqual(L.list(d, "desk"), ["a", "d", "c", "b"]);
});

test("move: thousands of moves keep a correct order (renumbering)", () => {
  let d = null;
  const ids = ["a", "b", "c", "d", "e"];
  ids.forEach((id, i) => { d = L.pin(d, id, "desk", true, i + 1); });
  let ref = ids.slice();
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 3000; n++) {
    const id = ref[Math.floor(rnd() * ref.length)];
    const dir = rnd() < 0.5 ? -1 : 1;
    d = L.move(d, id, "desk", dir, 1000 + n);
    const i = ref.indexOf(id), j = i + dir;
    if (j >= 0 && j < ref.length) { ref.splice(i, 1); ref.splice(j, 0, id); }
    assert.deepEqual(L.list(d, "desk"), ref);
  }
});

test("moveTo: a drop at any index matches a list splice", () => {
  let base = null;
  const ids = ["a", "b", "c", "d", "e"];
  ids.forEach((id, i) => { base = L.pin(base, id, "dock", true, i + 1); });
  for (const id of ids) {
    for (let to = 0; to < ids.length; to++) {
      const ref = ids.slice();
      ref.splice(ref.indexOf(id), 1);
      ref.splice(to, 0, id);
      const d = L.moveTo(base, id, "dock", to, 100);
      assert.deepEqual(L.list(d, "dock"), ref, id + " -> " + to);
      const changed = d.items.filter((it, i) => J(it) !== J(base.items[i])).map((it) => it.id);
      assert.ok(changed.length <= 1 && (!changed.length || changed[0] === id), "only the dragged item changes");
    }
  }
  assert.equal(J(L.moveTo(base, "zz", "dock", 0, 1)), J(base), "unknown id: no change");
});

test("two devices: different apps pinned offline both survive", () => {
  const base = L.pin(null, "notes", "desk", true, 1);
  const a = L.pin(base, "calendar", "desk", true, 10);
  const b = L.pin(base, "todo", "desk", true, 11);
  const m = L.merge(a, b);
  assert.deepEqual(L.list(m, "desk"), ["notes", "calendar", "todo"]);
  assert.equal(J(m), J(L.merge(b, a)));
});

test("two devices: a removal is not undone by an older pin", () => {
  const base = L.pin(null, "notes", "desk", true, 1);
  const a = L.pin(base, "notes", "desk", false, 50);
  const b = L.move(L.pin(base, "todo", "desk", true, 20), "todo", "desk", -1, 30);
  const m = L.merge(a, b);
  assert.deepEqual(L.list(m, "desk"), ["todo"]);
});

test("two devices: reorders of different apps both apply", () => {
  let base = null;
  ["a", "b", "c", "d"].forEach((id, i) => { base = L.pin(base, id, "desk", true, i + 1); });
  const a = L.move(base, "a", "desk", 1, 10);       // b a c d
  const b = L.move(base, "d", "desk", -1, 11);      // a b d c
  assert.deepEqual(L.list(L.merge(a, b), "desk"), ["b", "a", "d", "c"]);
});

// ---------- merge fuzz ----------
function rndData(rnd) {
  const ids = ["notes", "todo", "calendar", "weather", "time", "mail"];
  const items = [];
  const n = Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    items.push({
      id: r < 0.03 ? "BAD id" : ids[Math.floor(rnd() * ids.length)],
      desk: rnd() < 0.4 ? null : Math.floor(rnd() * 4) + (rnd() < 0.3 ? 0.5 : 0),
      dock: rnd() < 0.6 ? null : Math.floor(rnd() * 4),
      mtime: Math.floor(rnd() * 5),                  // small range: many ties
    });
  }
  return rnd() < 0.05 ? null : { ver: 1, items };
}

test("merge fuzz: symmetric, idempotent, associative, canonical, no input mutated", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 20000; n++) {
    const a = rndData(rnd), b = rndData(rnd), c = rndData(rnd);
    const sa = J(a), sb = J(b);
    const ab = L.merge(a, b);
    assert.equal(J(ab), J(L.merge(b, a)), "symmetric");
    assert.equal(J(L.merge(ab, ab)), J(ab), "idempotent");
    assert.equal(J(L.merge(ab, a)), J(ab), "fixed point (a)");
    assert.equal(J(L.merge(ab, b)), J(ab), "fixed point (b)");
    assert.equal(J(L.merge(L.merge(a, b), c)), J(L.merge(a, L.merge(b, c))), "associative");
    assert.equal(J(L.normalize(ab)), J(ab), "canonical");
    assert.equal(J(a), sa, "a untouched");
    assert.equal(J(b), sb, "b untouched");
    // Every output item comes from an input.
    const all = L.normalize({ items: [].concat((a && a.items) || [], (b && b.items) || []) });
    ab.items.forEach((it) => {
      const src = []
        .concat((a && a.items) || [], (b && b.items) || [])
        .map((x) => L.normalize({ items: [x] }).items[0])
        .filter(Boolean);
      assert.ok(src.some((x) => J(x) === J(it)), "output item from an input");
    });
    assert.equal(ab.items.length, all.items.length);
  }
});
