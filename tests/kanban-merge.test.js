// Kanban sync model (kanban/model.js): per-field card merge, per-item
// subtasks/attachments, old whole-card data, canonical form and the
// properties the sync engine relies on (symmetry, idempotence, no
// endless re-uploads between versions).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const M = require(path.join(__dirname, "..", "kanban/model.js"));

const NOW = Date.UTC(2026, 9, 14, 10, 0, 0);
const T0 = NOW - 3600e3;

function card(id, extra) {
  return Object.assign({ id, text: "Card " + id, notes: "", due: null, labels: [], subtasks: [], info: [], mtime: T0, pos: 0 }, extra || {});
}
function board(cols, extra) {
  return Object.assign({ id: "b1", name: "B", archived: false, mtime: T0, om: T0, deleted: {}, labels: [], columns: cols }, extra || {});
}
function col(id, cards, extra) {
  return Object.assign({ id, name: id, mtime: T0, om: T0, pos: 0, cards }, extra || {});
}
function st(boards, extra) { return Object.assign({ ver: 5, om: T0, boardDeleted: {}, boards }, extra || {}); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function merge(a, b) { return M.mergeKanbanStates(clone(a), clone(b), NOW); }
function canon(s) { return M.canonState(s, NOW); }
function cardsOf(s) {
  const out = {};
  s.boards[0].columns.forEach((c) => c.cards.forEach((k) => { out[k.id] = Object.assign({ col: c.id }, k); }));
  return out;
}
function base() {
  return st([board([col("todo", [card("k1", { subtasks: [{ id: "s1", text: "one", completed: false }, { id: "s2", text: "two", completed: false }] })]), col("done", [])])]);
}
function edit(s, fn) { const x = clone(s); fn(x); return canon(x); }
function moveTo(s, cardId, colId, at) {
  const b = s.boards[0];
  let k = null;
  b.columns.forEach((c) => { c.cards = c.cards.filter((x) => { if (x.id === cardId) { k = x; return false; } return true; }); });
  M.stampCard(k, ["p"], at);
  b.columns.find((c) => c.id === colId).cards.unshift(k);
}

test("a move on one device and a text edit on the other both survive", () => {
  const s0 = canon(base());
  const A = edit(s0, (x) => moveTo(x, "k1", "done", NOW - 1000));
  const B = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; k.text = "Renamed"; M.stampCard(k, ["t"], NOW - 500); });
  const m1 = merge(A, B), m2 = merge(B, A);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2), "symmetric");
  const k = cardsOf(m1).k1;
  assert.equal(k.col, "done");
  assert.equal(k.text, "Renamed");
  assert.ok(M.fmValid(k));
  assert.equal(k.mtime, NOW - 499, "a new combination: newest + 1, so older devices adopt it");
  // idempotent: merging the result with either input changes nothing
  assert.equal(JSON.stringify(merge(m1, A)), JSON.stringify(m1));
  assert.equal(JSON.stringify(merge(m1, B)), JSON.stringify(m1));
  assert.equal(JSON.stringify(merge(m1, m1)), JSON.stringify(m1));
});

test("notes, due, labels and info are separate groups", () => {
  const s0 = canon(base());
  const A = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; k.notes = "N"; M.stampCard(k, ["n"], NOW - 900); k.labels = ["L1"]; M.stampCard(k, ["l"], NOW - 800); });
  const B = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; k.due = "2026-10-20"; M.stampCard(k, ["d"], NOW - 700); k.info = [{ id: "i1", label: "a", value: "b" }]; M.stampCard(k, ["x"], NOW - 600); });
  const k = cardsOf(merge(A, B)).k1;
  assert.equal(k.notes, "N");
  assert.deepEqual(k.labels, ["L1"]);
  assert.equal(k.due, "2026-10-20");
  assert.equal(k.info.length, 1);
});

test("same field on both devices: the newer edit wins", () => {
  const s0 = canon(base());
  const A = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; k.text = "A"; M.stampCard(k, ["t"], NOW - 900); });
  const B = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; k.text = "B"; M.stampCard(k, ["t"], NOW - 100); });
  assert.equal(cardsOf(merge(A, B)).k1.text, "B");
  assert.equal(cardsOf(merge(B, A)).k1.text, "B");
});

test("subtasks merge per item: tick on one device, rename and add on the other", () => {
  const s0 = canon(base());
  const A = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; M.stampItem(k, "s", k.subtasks[0], NOW - 900); k.subtasks[0].completed = true; });
  const B = edit(s0, (x) => {
    const k = x.boards[0].columns[0].cards[0];
    k.subtasks[1].text = "TWO";
    M.stampItem(k, "s", k.subtasks[1], NOW - 800);
    const n = { id: "s3", text: "three", completed: false };
    k.subtasks.push(n);
    M.stampItem(k, "s", n, NOW - 700);
  });
  const k = cardsOf(merge(A, B)).k1;
  assert.deepEqual(k.subtasks.map((s) => [s.id, s.text, s.completed]), [["s1", "one", true], ["s2", "TWO", false], ["s3", "three", false]]);
  assert.equal(JSON.stringify(merge(A, B)), JSON.stringify(merge(B, A)));
});

test("a deleted subtask stays deleted (item tombstone), a later edit revives it", () => {
  const s0 = canon(base());
  const A = edit(s0, (x) => {
    const b = x.boards[0], k = b.columns[0].cards[0];
    k.subtasks = k.subtasks.filter((s) => s.id !== "s2");
    b.deleted[M.itemTomb("k1", "s2")] = M.stampCard(k, ["s"], NOW - 900);
  });
  const B = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; k.text = "B"; M.stampCard(k, ["t"], NOW - 800); });
  const k = cardsOf(merge(A, B)).k1;
  assert.deepEqual(k.subtasks.map((s) => s.id), ["s1"]);
  assert.equal(k.text, "B");
  const C = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; k.subtasks[1].text = "later"; M.stampItem(k, "s", k.subtasks[1], NOW - 100); });
  assert.deepEqual(cardsOf(merge(A, C)).k1.subtasks.map((s) => s.id), ["s1", "s2"]);
});

test("attachments merge per item like subtasks", () => {
  const s0 = canon(base());
  const A = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; const a = { id: "a1", name: "x.jpg", file: "f1.jpg", kind: "img", size: 10 }; k.att = [a]; M.stampItem(k, "a", a, NOW - 900); });
  const B = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; const a = { id: "a2", name: "y.pdf", file: "f2.pdf", kind: "pdf", size: 20 }; k.att = [a]; M.stampItem(k, "a", a, NOW - 800); });
  const k = cardsOf(merge(A, B)).k1;
  assert.deepEqual(k.att.map((a) => a.id).sort(), ["a1", "a2"]);
});

test("old whole-card data: the newer card wins whole, like before", () => {
  // Neither side has field stamps (an older version wrote both).
  const s0 = base();
  const A = clone(s0), B = clone(s0);
  A.boards[0].columns[0].cards[0].text = "old A"; A.boards[0].columns[0].cards[0].mtime = NOW - 900;
  const kb = B.boards[0].columns[0].cards.pop(); kb.mtime = NOW - 800; B.boards[0].columns[1].cards.push(kb);
  const m = merge(A, B);
  const k = cardsOf(m).k1;
  assert.equal(k.col, "done");
  assert.equal(k.text, "Card k1", "whole newer card");
  assert.equal(k.fm, undefined, "no stamps added: no transitional upload for untouched cards");
});

test("old device edited a stamped card: whole card counts as that edit", () => {
  const s0 = canon(base());
  // new device A stamped text
  const A = edit(s0, (x) => { const k = x.boards[0].columns[0].cards[0]; k.text = "A"; M.stampCard(k, ["t"], NOW - 900); });
  // old device took A's card, then moved it (touch: mtime only, fm kept but stale)
  const OLD = clone(A);
  const k = OLD.boards[0].columns[0].cards.pop(); k.mtime = NOW - 500; OLD.boards[0].columns[1].cards.push(k);
  assert.equal(M.fmValid(k), false);
  const m = merge(A, OLD);
  const r = cardsOf(m).k1;
  assert.equal(r.col, "done");
  assert.equal(r.text, "A");
  assert.equal(JSON.stringify(m), JSON.stringify(merge(OLD, A)));
});

test("mixed with an older card: new edits newer than the old card's mtime win per field", () => {
  const s0 = base();                                   // no stamps
  const OLD = clone(s0); OLD.boards[0].columns[0].cards[0].notes = "old notes"; OLD.boards[0].columns[0].cards[0].mtime = NOW - 800;
  const A = clone(s0); const k = A.boards[0].columns[0].cards[0]; k.text = "new text"; M.stampCard(k, ["t"], NOW - 500);
  const m = merge(OLD, A);
  const r = cardsOf(m).k1;
  assert.equal(r.text, "new text");
  assert.equal(r.notes, "old notes");
  assert.equal(JSON.stringify(m), JSON.stringify(merge(A, OLD)));
  // the old engine, given the merged card and its own copy, keeps the merged one (newer mtime)
  assert.ok(r.mtime > NOW - 800);
  assert.equal(JSON.stringify(merge(m, OLD)), JSON.stringify(m));
});

test("full stamp tie is broken like the old engine (whole card, no mixing)", () => {
  const s0 = base();
  const A = clone(s0), B = clone(s0);
  A.boards[0].columns[0].cards[0].text = "A"; A.boards[0].columns[0].cards[0].mtime = NOW - 100;
  B.boards[0].columns[0].cards[0].notes = "B"; B.boards[0].columns[0].cards[0].mtime = NOW - 100;
  const r = cardsOf(merge(A, B)).k1;
  const ka = JSON.stringify(A.boards[0].columns[0].cards[0]) + "|todo";
  const kb = JSON.stringify(B.boards[0].columns[0].cards[0]) + "|todo";
  if (ka >= kb) { assert.equal(r.text, "A"); assert.equal(r.notes, ""); }
  else { assert.equal(r.text, "Card k1"); assert.equal(r.notes, "B"); }
  assert.equal(r.fm, undefined);
});

test("canonical form keeps the old key order (no ping-pong with older devices)", () => {
  const s = base();
  const k = s.boards[0].columns[0].cards[0];
  M.stampCard(k, ["t"], NOW - 10);
  k.lane = "Team A"; k.cover = "#e06c75"; k.att = [{ m: 3, size: 1, kind: "img", file: "a.jpg", name: "a", id: "a1" }];
  s.boards[0].columns[0].wip = 3;
  s.boards[0].columns[0].auto = { top: true, done: true };
  const c = canon(s);
  const ck = c.boards[0].columns[0].cards[0];
  assert.deepEqual(Object.keys(ck), ["id", "text", "notes", "due", "labels", "subtasks", "info", "mtime", "pos", "att", "cover", "fm", "lane"]);
  assert.deepEqual(Object.keys(ck.att[0]), ["id", "name", "file", "kind", "size", "m"]);
  assert.deepEqual(Object.keys(ck.fm), Object.keys(ck.fm).slice().sort());
  assert.deepEqual(Object.keys(c.boards[0].columns[0]), ["id", "name", "mtime", "om", "pos", "cards", "auto", "wip"]);
  // What the old canonState did: known keys, then unknown keys sorted, nested objects untouched.
  function oldCanonOrder(obj, keys) {
    const out = {};
    keys.forEach((kk) => { if (obj[kk] !== undefined) out[kk] = obj[kk]; });
    Object.keys(obj).sort().forEach((kk) => { if (keys.indexOf(kk) === -1 && obj[kk] !== undefined) out[kk] = obj[kk]; });
    return out;
  }
  const again = clone(c);
  again.boards = again.boards.map((b) => {
    b.columns = b.columns.map((cc) => { cc.cards = cc.cards.map((x) => oldCanonOrder(x, ["id", "text", "notes", "due", "labels", "subtasks", "info", "mtime", "pos"])); return oldCanonOrder(cc, ["id", "name", "mtime", "om", "pos", "cards"]); });
    return oldCanonOrder(b, ["id", "name", "archived", "color", "mtime", "om", "pos", "deleted", "labels", "columns"]);
  });
  assert.equal(JSON.stringify(oldCanonOrder(again, ["ver", "om", "boardDeleted", "boards"])), JSON.stringify(c));
  assert.equal(c.ver, 5);
});

test("column WIP and rules ride with the column header (LWW), labels keep auto", () => {
  const s0 = canon(base());
  const A = edit(s0, (x) => { const c = x.boards[0].columns[1]; c.wip = 4; c.auto = { done: true }; c.mtime = NOW - 500; x.boards[0].labels.push({ id: "od", name: "Overdue", color: "#e06c75", auto: "overdue", mtime: NOW - 400, pos: 0 }); });
  const m = merge(s0, A);
  assert.equal(m.boards[0].columns[1].wip, 4);
  assert.deepEqual(m.boards[0].columns[1].auto, { done: true });
  assert.equal(m.boards[0].labels[0].auto, "overdue");
});

test("fuzz: symmetric, idempotent and absorbing over random concurrent edits", () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const s0 = canon(base());
  function mutate(s, t, legacy) {
    const x = clone(s);
    const b = x.boards[0];
    const all = [];
    b.columns.forEach((c) => c.cards.forEach((k) => all.push(k)));
    const k = all[0];
    const op = pick(["text", "notes", "due", "move", "sub", "subdel", "subadd", "labels"]);
    if (legacy) {
      if (op === "move") { b.columns.forEach((c) => { c.cards = c.cards.filter((y) => y !== k); }); pick(b.columns).cards.push(k); }
      else k.text = "L" + Math.floor(rnd() * 100);
      k.mtime = t;                                     // old touch()
      return canon(x);
    }
    if (op === "text") { k.text = "T" + Math.floor(rnd() * 100); M.stampCard(k, ["t"], t); }
    if (op === "notes") { k.notes = "N" + Math.floor(rnd() * 100); M.stampCard(k, ["n"], t); }
    if (op === "due") { k.due = "2026-10-" + (10 + Math.floor(rnd() * 9)); M.stampCard(k, ["d"], t); }
    if (op === "labels") { k.labels = [pick(["a", "b", "c"])]; M.stampCard(k, ["l"], t); }
    if (op === "move") { moveTo(x, k.id, pick(["todo", "done"]), t); }
    if (op === "sub" && k.subtasks.length) { const s = pick(k.subtasks); s.completed = !s.completed; M.stampItem(k, "s", s, t); }
    if (op === "subdel" && k.subtasks.length) { const s = pick(k.subtasks); k.subtasks = k.subtasks.filter((y) => y !== s); b.deleted[M.itemTomb(k.id, s.id)] = M.stampCard(k, ["s"], t); }
    if (op === "subadd") { const s = { id: "n" + Math.floor(rnd() * 1e6), text: "x", completed: false }; k.subtasks.push(s); M.stampItem(k, "s", s, t); }
    return canon(x);
  }
  for (let i = 0; i < 400; i++) {
    let A = s0, B = s0;
    const n = 1 + Math.floor(rnd() * 4);
    for (let j = 0; j < n; j++) {
      A = mutate(A, T0 + 1000 + Math.floor(rnd() * 5000), rnd() < 0.15);
      B = mutate(B, T0 + 1000 + Math.floor(rnd() * 5000), rnd() < 0.15);
    }
    const ab = merge(A, B), ba = merge(B, A);
    assert.equal(JSON.stringify(ab), JSON.stringify(ba), "symmetric #" + i);
    assert.equal(JSON.stringify(merge(ab, ab)), JSON.stringify(ab), "idempotent #" + i);
    assert.equal(JSON.stringify(merge(ab, A)), JSON.stringify(ab), "absorbs A #" + i);
    assert.equal(JSON.stringify(merge(ab, B)), JSON.stringify(ab), "absorbs B #" + i);
    assert.equal(JSON.stringify(canon(ab)), JSON.stringify(ab), "canonical #" + i);
  }
});

test("mixed fleet (two new devices, one old) converges through the cloud, no endless uploads", () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const s0 = canon(base());
  for (let round = 0; round < 150; round++) {
    // each device edits its own copy offline
    const dev = [{ s: s0, old: false }, { s: s0, old: false }, { s: s0, old: true }];
    dev.forEach((d, i) => {
      const x = clone(d.s), k = x.boards[0].columns[0].cards[0];
      const t = T0 + 1000 + Math.floor(rnd() * 3000) + i;
      if (d.old) {
        if (rnd() < 0.5) k.text = "old" + round;
        else { x.boards[0].columns[0].cards = []; x.boards[0].columns[1].cards.push(k); }
        k.mtime = t;                                   // the old touch(): whole card
      } else if (rnd() < 0.4) { k.text = "new" + i; M.stampCard(k, ["t"], t); }
      else if (rnd() < 0.5) { moveTo(x, "k1", "done", t); }
      else { const s = k.subtasks[Math.floor(rnd() * k.subtasks.length)]; s.completed = !s.completed; M.stampItem(k, "s", s, t); }
      d.s = canon(x);
    });
    let cloud = null, uploads = 0;
    for (let pass = 0; pass < 12; pass++) {
      dev.forEach((d) => {
        const merged = cloud ? M.mergeKanbanStates(clone(d.s), clone(cloud), NOW, d.old) : d.s;
        d.s = merged;
        if (!cloud || JSON.stringify(merged) !== JSON.stringify(cloud)) { cloud = clone(merged); uploads++; }
      });
    }
    const final = JSON.stringify(cloud);
    dev.forEach((d) => assert.equal(JSON.stringify(d.s), final, "round " + round + " converged"));
    assert.ok(uploads <= 6, "round " + round + ": " + uploads + " uploads");
  }
});
