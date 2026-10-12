// Pure logic of Sticky Notes (stickies/core.js): normalising, the
// merge (sync slice "stickies"), the changes, the engine the shell
// runs (ring, fade at the vanish time, the Faded bin), quick times,
// tick-box lines and the desktop placement; plus the wiring of the
// shell host, the app and the shell.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "stickies/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const T0 = 1760000000000;
const DAY = 86400000;
const J = (x) => JSON.stringify(x);

function mk(id, over) {
  const fm = Object.assign({ text: T0, color: T0, ring: 0, vanish: 0, faded: 0 }, (over && over.fm) || {});
  return Object.assign({ id, text: "t " + id, color: "yellow", ring: null, vanish: null, faded: 0, ct: T0 }, over || {}, { fm });
}
const data = (notes, tombs) => ({ ver: 1, notes: notes || [], tombs: tombs || {} });

test("cleanText: line breaks kept, 1,000 characters, no control characters", () => {
  assert.equal(C.cleanText("a\r\nb\rc\u0007d  \n\n"), "a\nb\nc d");
  assert.equal(C.cleanText(null), "");
  const cut = C.cleanText("😊".repeat(1200));
  assert.equal(Array.from(cut).length, 1000);
  assert.ok(cut.endsWith("😊"));
});

test("normNote: junk dropped, unknown colour → yellow, unstamped note dropped", () => {
  assert.equal(C.normNote(null), null);
  assert.equal(C.normNote({ id: "a b", fm: { text: 1 } }), null);
  assert.equal(C.normNote({ id: "x", text: "hi" }), null, "no stamps");
  const n = C.normNote({ id: "x", text: "<b>hi</b>", color: "red", ring: { at: -1 }, vanish: { at: 0, onDone: false }, fm: { text: 5 } });
  assert.equal(n.text, "<b>hi</b>", "kept as text, never markup");
  assert.equal(n.color, "yellow");
  assert.equal(n.ring, null);
  assert.equal(n.vanish, null);
  assert.deepEqual(C.normNote({ id: "x", vanish: { onDone: true }, fm: { vanish: 2 } }).vanish, { at: 0, onDone: true });
});

test("merge: commutative, idempotent, per-field LWW, canonical", () => {
  const A = data([mk("a", { text: "A new", fm: { text: T0 + 5 } }), mk("b")]);
  const B = data([mk("a", { color: "pink", fm: { color: T0 + 3 } }), mk("c")], { b: T0 + 1 });
  const AB = C.merge(A, B), BA = C.merge(B, A);
  assert.equal(J(AB), J(BA), "commutative (byte for byte)");
  assert.equal(J(C.merge(AB, AB)), J(AB), "idempotent");
  assert.equal(J(C.merge(C.merge(A, B), A)), J(AB), "absorbs");
  const a = C.find(AB, "a");
  assert.equal(a.text, "A new", "text from A");
  assert.equal(a.color, "pink", "colour from B");
  assert.ok(!C.find(AB, "b"), "deleted on B");
  assert.deepEqual(AB.notes.map((n) => n.id), ["a", "c"], "sorted by id");
  assert.deepEqual(Object.keys(AB.notes[0]), ["id", "text", "color", "ring", "vanish", "faded", "ct", "fm"]);
  // equal stamps: the larger JSON wins on both sides
  const X = data([mk("q", { text: "aaa" })]), Y = data([mk("q", { text: "bbb" })]);
  assert.equal(C.find(C.merge(X, Y), "q").text, "bbb");
  assert.equal(C.find(C.merge(Y, X), "q").text, "bbb");
  // created: the earliest copy
  assert.equal(C.find(C.merge(data([mk("q", { ct: 9 })]), data([mk("q", { ct: 7 })])), "q").ct, 7);
  assert.deepEqual(C.merge(null, undefined), C.empty());
});

test("merge: tombstones (delete wins ties, newer edit resurrects, pruning)", () => {
  const n = mk("a", { fm: { text: T0 + 10 } });
  assert.ok(!C.find(C.merge(data([n]), data([], { a: T0 + 10 })), "a"), "tie → deleted");
  const back = C.merge(data([n]), data([], { a: T0 + 9 }));
  assert.ok(C.find(back, "a"), "newer edit survives");
  assert.deepEqual(back.tombs, { a: T0 + 9 }, "the tomb stays: it still erases older writes");
  const late = C.merge(back, data([mk("a", { color: "pink", fm: { text: T0 + 1, color: T0 + 5 } })]));
  assert.equal(C.find(late, "a").color, "yellow", "a late copy older than the delete brings nothing back");
  // old tombs pruned against the newest stamp in the data
  const old = C.merge(data([mk("z", { fm: { text: T0 + 40 * DAY } })], { gone: T0 }), null);
  assert.deepEqual(old.tombs, {});
  const young = C.merge(data([mk("z", { fm: { text: T0 + 10 * DAY } })], { gone: T0 }), null);
  assert.deepEqual(young.tombs, { gone: T0 });
});

test("random merge fuzz: laws hold", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ids = ["a", "b", "c", "d"];
  const randNote = (id) => mk(id, {
    text: ["x", "y", "z"][Math.floor(rnd() * 3)],
    color: C.COLORS[Math.floor(rnd() * 6)],
    ring: rnd() < 0.5 ? { at: T0 + Math.floor(rnd() * 5) } : null,
    vanish: rnd() < 0.5 ? { at: T0 + Math.floor(rnd() * 5), onDone: rnd() < 0.5 } : null,
    faded: rnd() < 0.3 ? T0 + 2 : 0,
    fm: { text: T0 + Math.floor(rnd() * 4), color: T0 + Math.floor(rnd() * 4), ring: Math.floor(rnd() * 4),
          vanish: Math.floor(rnd() * 4), faded: Math.floor(rnd() * 4) }
  });
  const randData = () => {
    const notes = ids.filter(() => rnd() < 0.7).map(randNote), tombs = {};
    ids.forEach((id) => { if (rnd() < 0.2) tombs[id] = T0 + Math.floor(rnd() * 4); });
    return data(notes, tombs);
  };
  for (let i = 0; i < 2000; i++) {
    const A = randData(), B = randData(), D = randData();
    const AB = C.merge(A, B);
    assert.equal(J(AB), J(C.merge(B, A)), "commutative");
    assert.equal(J(C.merge(AB, AB)), J(AB), "idempotent");
    assert.equal(J(C.merge(C.merge(A, B), D)), J(C.merge(A, C.merge(B, D))), "associative");
  }
});

test("create, edit, colour, ring, vanish: stamps move only on a real change", () => {
  let r = C.create(C.empty(), { text: "Milk", color: "blue", id: "n1" }, T0);
  assert.equal(r.id, "n1");
  let d = r.data, n = C.find(d, "n1");
  assert.equal(n.text, "Milk");
  assert.equal(n.ct, T0);
  assert.equal(J(C.setText(d, "n1", "Milk", T0 + 5)), J(d), "same text: nothing stamped (R27)");
  d = C.setText(d, "n1", "Milk, eggs", T0 - 100);            // a clock behind still moves forward
  assert.equal(C.find(d, "n1").fm.text, T0 + 1);
  d = C.setColor(d, "n1", "green", T0 + 2);
  assert.equal(C.find(d, "n1").color, "green");
  d = C.setRing(d, "n1", T0 + 60000, T0 + 3);
  assert.deepEqual(C.find(d, "n1").ring, { at: T0 + 60000 });
  d = C.setVanish(d, "n1", { at: T0 + DAY, onDone: true }, T0 + 4);
  assert.deepEqual(C.find(d, "n1").vanish, { at: T0 + DAY, onDone: true });
  assert.equal(J(C.setText(d, "nope", "x", T0)), J(d), "unknown note: unchanged");
});

test("create: the 60-note limit counts notes on the desktop only", () => {
  let d = C.empty();
  for (let i = 0; i < C.MAX_NOTES; i++) d = C.create(d, { id: "n" + i }, T0 + i).data;
  assert.equal(C.create(d, {}, T0 + 100).full, true);
  d = C.fadeNow(d, "n0", T0 + 200);
  assert.ok(C.create(d, {}, T0 + 300).id, "a faded note frees a place");
});

test("ring: Done, Done with 'vanish when done', Snooze", () => {
  let d = C.create(C.empty(), { id: "r" }, T0).data;
  d = C.setRing(d, "r", T0 + 1000, T0 + 1);
  assert.equal(C.ringing(d, T0 + 999).length, 0);
  assert.deepEqual(C.ringing(d, T0 + 1000).map((n) => n.id), ["r"]);
  const done = C.ringDone(d, "r", T0 + 2000);
  assert.equal(C.find(done, "r").ring, null);
  assert.equal(C.find(done, "r").faded, 0);
  const snoozed = C.snooze(d, "r", T0 + 2000);
  assert.deepEqual(C.find(snoozed, "r").ring, { at: T0 + 2000 + C.SNOOZE_MS });
  d = C.setVanish(d, "r", { at: 0, onDone: true }, T0 + 3);
  const gone = C.ringDone(d, "r", T0 + 5000);
  assert.equal(C.find(gone, "r").faded, T0 + 5000);
  assert.equal(C.ringing(gone, T0 + 9000).length, 0, "a faded note never rings");
});

test("due: fade at the vanish time, the same bytes on two devices", () => {
  let d = C.create(C.empty(), { id: "v", text: "bye" }, T0).data;
  d = C.setVanish(d, "v", { at: T0 + 3600000, onDone: false }, T0 + 1);
  assert.deepEqual(C.due(d, T0 + 3599999).faded, []);
  const r1 = C.due(d, T0 + 3600000 + 5), r2 = C.due(d, T0 + 3600000 + 9999);   // two devices, two clocks
  assert.deepEqual(r1.faded, ["v"]);
  assert.equal(J(r1.data), J(r2.data), "identical bytes");
  assert.equal(C.find(r1.data, "v").faded, T0 + 3600000);
  assert.deepEqual(C.live(r1.data), []);
  assert.deepEqual(C.faded(r1.data).map((n) => n.id), ["v"]);
  // the bin keeps it 7 days, then a deterministic tomb
  const still = C.due(r1.data, T0 + 3600000 + C.BIN_MS - 1);
  assert.deepEqual(still.purged, []);
  const p1 = C.due(r1.data, T0 + 3600000 + C.BIN_MS), p2 = C.due(r1.data, T0 + 3600000 + C.BIN_MS + 777);
  assert.deepEqual(p1.purged, ["v"]);
  assert.equal(J(p1.data), J(p2.data));
  assert.ok(!C.find(p1.data, "v"));
  assert.equal(p1.data.tombs.v, T0 + 3600000 + C.BIN_MS);
  // nothing to do: the same data back
  assert.equal(J(C.due(p1.data, T0 + 10 * DAY).data), J(p1.data));
});

test("restore: back to the desktop without the vanish time; a past ring is cleared", () => {
  let d = C.create(C.empty(), { id: "v" }, T0).data;
  d = C.setRing(d, "v", T0 + 10, T0 + 1);
  d = C.setVanish(d, "v", { at: T0 + 20, onDone: false }, T0 + 2);
  d = C.due(d, T0 + 30).data;
  const back = C.restore(d, "v", T0 + 40);
  const n = C.find(back, "v");
  assert.equal(n.faded, 0);
  assert.equal(n.vanish, null);
  assert.equal(n.ring, null);
  assert.equal(J(C.due(back, T0 + 50).data), J(back), "does not fade again");
  // a restore on one device beats the fade written by another
  assert.equal(C.find(C.merge(back, d), "v").faded, 0);
});

test("remove + revive (Undo)", () => {
  let d = C.create(C.empty(), { id: "u", text: "keep" }, T0).data;
  const n = C.find(d, "u");
  const gone = C.remove(d, "u", T0 + 5);
  assert.ok(!C.find(gone, "u"));
  assert.equal(gone.tombs.u, T0 + 5);
  const back = C.revive(gone, n, T0 + 5);
  assert.equal(C.find(back, "u").text, "keep");
  // the revived copy beats the tomb on another device too
  assert.ok(C.find(C.merge(back, gone), "u"));
});

test("nextEvent: the earliest ring, fade or purge", () => {
  let d = C.create(C.empty(), { id: "a" }, T0).data;
  d = C.create(d, { id: "b" }, T0).data;
  assert.equal(C.nextEvent(d, T0), 0);
  d = C.setRing(d, "a", T0 + 500, T0);
  d = C.setVanish(d, "b", { at: T0 + 300, onDone: false }, T0);
  assert.equal(C.nextEvent(d, T0), T0 + 300);
  d = C.due(d, T0 + 400).data;
  assert.equal(C.nextEvent(d, T0 + 400), T0 + 500);
  assert.equal(C.nextEvent(d, T0 + 600), T0 + 300 + C.BIN_MS);
});

test("quick times", () => {
  const now = new Date(2026, 9, 12, 14, 30).getTime();
  assert.equal(C.pick("15m", now), now + 15 * 60000);
  assert.equal(C.pick("1h", now), now + 3600000);
  assert.equal(C.pick("evening", now), new Date(2026, 9, 12, 20, 0).getTime());
  assert.equal(C.pick("evening", new Date(2026, 9, 12, 21, 0).getTime()), new Date(2026, 9, 13, 20, 0).getTime());
  assert.equal(C.pick("morning", now), new Date(2026, 9, 13, 9, 0).getTime());
  assert.equal(C.pick("today", now), new Date(2026, 9, 12, 23, 59).getTime());
  assert.equal(C.pick("tomorrow", now), new Date(2026, 9, 13, 23, 59).getTime());
  assert.equal(C.pick("week", now), now + 7 * DAY);
  assert.equal(C.pick("nope", now), 0);
  assert.equal(C.toLocalInput(now), "2026-10-12T14:30");
  assert.equal(C.fromLocalInput("2026-10-12T14:30"), now);
  assert.equal(C.fromLocalInput("garbage"), 0);
  assert.equal(C.toLocalInput(0), "");
});

test("tick-box lines", () => {
  const t = "Shopping\n[ ] milk\n[x] bread\n  [ ]eggs";
  const ls = C.lines(t);
  assert.deepEqual(ls.map((l) => [l.box, l.done, l.text]), [[false, false, "Shopping"], [true, false, "milk"], [true, true, "bread"], [true, false, "eggs"]]);
  assert.equal(C.toggleLine(t, 1), "Shopping\n[x] milk\n[x] bread\n  [ ]eggs");
  assert.equal(C.toggleLine(t, 2), "Shopping\n[ ] milk\n[ ] bread\n  [ ]eggs");
  assert.equal(C.toggleLine(t, 0), t, "not a box");
  assert.equal(C.firstLine("\n\n[ ] milk"), "milk");
  assert.ok(C.matches({ text: "Τηλεφώνησε στον υδραυλικό" }, "υδραυλικο τηλεφωνησε"));
  assert.ok(!C.matches({ text: "abc" }, "abd"));
});

test("placement: free spots from the right, clamped boxes, tidy columns", () => {
  const W = 1200, H = 700;
  const p1 = C.place([], W, H, 200, 170);
  const b1 = C.box(Object.assign({ w: 200, h: 170 }, p1), W, H);
  assert.equal(b1.left, W - 16 - 200);
  assert.equal(b1.top, 16);
  const p2 = C.place([b1], W, H, 200, 170);
  const b2 = C.box(Object.assign({ w: 200, h: 170 }, p2), W, H);
  assert.ok(!C.overlaps(b1, b2));
  // a box never leaves the desktop, also after the window shrinks
  const b = C.box({ x: 0.95, y: 0.95, w: 200, h: 170 }, 800, 500);
  assert.ok(b.left + b.w <= 800 && b.top + b.h <= 500);
  assert.deepEqual(C.clampSize(10, 9999), { w: C.SIZE.minW, h: C.SIZE.maxH });
  assert.equal(C.normPos({ x: "a", y: 1 }), null);
  assert.deepEqual(C.normPos({ x: 2, y: -1, w: 200, h: 170 }), { x: 1, y: 0, w: 200, h: 170, z: 1, fold: false });
  const t = C.tidy(["a", "b", "c", "d", "e"], {}, W, H);
  const boxes = Object.keys(t).map((id) => C.box(Object.assign({ w: 200, h: 170 }, t[id]), W, H));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!C.overlaps(boxes[i], boxes[j]), i + " vs " + j);
});

test("toText: notes on the desktop, newest first", () => {
  let d = C.create(C.empty(), { id: "a", text: "first" }, T0).data;
  d = C.create(d, { id: "b", text: "second" }, T0 + 1).data;
  d = C.create(d, { id: "c", text: "gone" }, T0 + 2).data;
  d = C.fadeNow(d, "c", T0 + 3);
  assert.equal(C.toText(d), "second\n\n—\n\nfirst\n");
});
