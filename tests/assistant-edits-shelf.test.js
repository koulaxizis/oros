// change_item adapter for Media Shelf: wired into a copy of
// assistant/edits.js, checked against the app's own mergeShelf.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const REPO = path.join(__dirname, "..");
const E = require(path.join(REPO, "assistant/edits.js"));

// The app's own merge, cut out of shelf.js the way tests/shelf.test.js does.
const ssrc = fs.readFileSync(path.join(REPO, "shelf/shelf.js"), "utf8");
function block(from, to) { const i = ssrc.indexOf(from), j = ssrc.indexOf(to, i); assert.ok(i >= 0 && j > i, from); return ssrc.slice(i, j); }
const S = new Function("crypto", "var LANG = 'en';\n" + block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  // BOOT MARKER") + block("  // ---------- 2. Model", "  // ---------- 5. Storage") +
  "\nreturn { mergeShelf, sessOf, progressOf, completions };")(webcrypto);

const NOW = new Date(2026, 9, 14, 12, 0).getTime();   // local 2026-10-14
const T0 = NOW - 86400000 * 5;
const I1 = "item000001", I2 = "item000002";
function item(id, m, over) {
  return Object.assign({ id, m, a: m, type: "book", title: "Title " + id, by: "", year: 0, size: 0, fmt: "p", plat: "",
    st: "want", prio: 0, rate: 0, fav: 0, tags: [], rev: "", src: "", col: 0 }, over || {});
}
function data() {
  return S.mergeShelf({ ver: 1, items: [
      item(I1, T0, { size: 300, st: "now" }),
      item(I2, T0, { type: "film", title: "Heat", rev: "great" })],
    sess: [{ id: "sess000001", m: T0, it: I1, k: "s", d: "2026-10-01" }, { id: "sess000002", m: T0 + 1, it: I1, k: "p", d: "2026-10-02", v: 120 }],
    goals: {}, tombs: {} }, null);
}
const ch = (args) => { const r = E.normArgs(Object.assign({ ref: "r1" }, args)); assert.ok(r.ok, r.err); return r; };
const canon = (d) => S.mergeShelf(d, d);
function run(d, target, c, now) {
  const p = E.plan("shelf", d, target, c, now);
  assert.ok(p.ok, p.err);
  const a = E.apply("shelf", d, target, c, now, p.before);
  assert.ok(a.ok, a.err);
  return { p, a };
}

test("shelf: wired, update + delete only", () => {
  assert.equal(E.storageKey("shelf"), "oros-shelf-data");
  assert.deepEqual(E.actionsFor("shelf"), ["update", "delete"]);
  assert.equal(E.plan("shelf", data(), { item: I1 }, ch({ action: "complete" }), NOW).ok, false);
});

test("shelf: status done logs the missing pages and a finish dated today; canonical and wins the merge", () => {
  const d = data();
  const { p, a } = run(d, { item: I1 }, ch({ action: "update", status: "done" }), NOW);
  assert.deepEqual(p.rows, [{ f: "status", b: "now", a: "done" }]);
  const it = a.data.items.find((x) => x.id === I1);
  assert.equal(it.st, "done");
  assert.ok(it.m > T0);
  const mine = a.data.sess.filter((s) => s.it === I1 && s.m === NOW);
  assert.deepEqual(mine.map((s) => s.k).sort(), ["d", "p"]);
  assert.ok(mine.every((s) => s.d === "2026-10-14"));
  assert.equal(mine.find((s) => s.k === "p").v, 300);
  assert.deepEqual(a.data, canon(a.data));                       // already in the app's canonical form
  const m = S.mergeShelf(d, a.data), m2 = S.mergeShelf(a.data, d);
  assert.deepEqual(m, m2);
  assert.equal(m.items.find((x) => x.id === I1).st, "done");
  assert.equal(S.progressOf(S.sessOf(m, I1)), 300);
  assert.equal(S.completions(S.sessOf(m, I1)).length, 1);
  assert.equal(d.items[0].st, "now");                            // input untouched
});

test("shelf: now logs a start, dropped a drop; done without size logs only the finish", () => {
  let a = run(data(), { item: I2 }, ch({ action: "update", status: "now" }), NOW).a;
  assert.deepEqual(a.data.sess.filter((s) => s.it === I2).map((s) => s.k), ["s"]);
  a = run(data(), { item: I1 }, ch({ action: "update", status: "dropped" }), NOW).a;
  assert.deepEqual(a.data.sess.filter((s) => s.m === NOW).map((s) => s.k), ["x"]);
  assert.equal(a.data.items.find((x) => x.id === I1).st, "drop");
  a = run(data(), { item: I2 }, ch({ action: "update", status: "done" }), NOW).a;
  assert.deepEqual(a.data.sess.filter((s) => s.it === I2).map((s) => s.k), ["d"]);
});

test("shelf: title and note (the review) update, stamp newer, refusals", () => {
  const { p, a } = run(data(), { item: I2 }, ch({ action: "update", title: "Heat (1995)", note: "a\n\n\n\nb" }), NOW);
  assert.deepEqual(p.rows.map((r) => r.f), ["title", "note"]);
  const it = a.data.items.find((x) => x.id === I2);
  assert.equal(it.title, "Heat (1995)");
  assert.equal(it.rev, "a\n\nb");
  assert.equal(it.m, NOW);
  assert.equal(S.mergeShelf(data(), a.data).items.find((x) => x.id === I2).rev, "a\n\nb");
  // the stamp beats a future-dated old copy
  const fut = data(); fut.items[1].m = NOW + 5000;
  assert.equal(run(fut, { item: I2 }, ch({ action: "update", title: "X" }), NOW).a.data.items[1].m, NOW + 5001);
  assert.match(E.plan("shelf", data(), { item: I2 }, ch({ action: "update", date: "2026-10-20" }), NOW).err, /no date/);
  assert.match(E.plan("shelf", data(), { item: I2 }, ch({ action: "update", title: "Heat" }), NOW).err, /Nothing would change/);
  assert.match(E.plan("shelf", data(), { item: I1 }, ch({ action: "update", status: "now" }), NOW).err, /Nothing would change/);
  assert.match(E.plan("shelf", data(), { item: "item999999" }, ch({ action: "delete" }), NOW).err, /no longer/);
});

test("shelf: delete tombstones the item and its sessions; the tombstone wins the merge", () => {
  const d = data();
  const { p, a } = run(d, { item: I1 }, ch({ action: "delete" }), NOW);
  assert.equal(p.del, true);
  assert.ok(!a.data.items.some((x) => x.id === I1));
  assert.ok(!a.data.sess.some((s) => s.it === I1));
  assert.ok(a.data.tombs[I1] > T0 && a.data.tombs.sess000001 && a.data.tombs.sess000002);
  assert.deepEqual(Object.keys(a.data.tombs), Object.keys(a.data.tombs).sort());
  const m = S.mergeShelf(d, a.data);
  assert.ok(!m.items.some((x) => x.id === I1));
  assert.ok(!m.sess.some((s) => s.it === I1));
  // an already-deleted title is gone for search and change alike
  assert.equal(E.plan("shelf", a.data, { item: I1 }, ch({ action: "delete" }), NOW + 1).ok, false);
});

test("shelf: undo of a status change tombstones the logged sessions and wins over the applied copy", () => {
  const d = data();
  const { a } = run(d, { item: I1 }, ch({ action: "update", status: "done", note: "loved it" }), NOW);
  const u = E.undo("shelf", a.data, a.undo, NOW + 1000);
  assert.ok(u.ok, u.err);
  const it = u.data.items.find((x) => x.id === I1);
  assert.equal(it.st, "now"); assert.equal(it.rev, "");
  assert.ok(it.m > a.data.items.find((x) => x.id === I1).m);
  const m = S.mergeShelf(a.data, u.data);                       // the other device still has the done copy
  assert.equal(m.items.find((x) => x.id === I1).st, "now");
  assert.equal(S.completions(S.sessOf(m, I1)).length, 0);
  assert.equal(S.progressOf(S.sessOf(m, I1)), 120);
  assert.deepEqual(u.data, canon(u.data));
  // undo refuses once the title changed again
  const b = JSON.parse(JSON.stringify(a.data)); b.items.find((x) => x.id === I1).title = "Other";
  assert.match(E.undo("shelf", b, a.undo, NOW + 1000).err, /changed since/);
});

test("shelf: undo of a delete resurrects item and sessions past the tombstones", () => {
  const d = data();
  const { a } = run(d, { item: I1 }, ch({ action: "delete" }), NOW);
  const u = E.undo("shelf", a.data, a.undo, NOW + 1000);
  assert.ok(u.ok, u.err);
  const m = S.mergeShelf(a.data, u.data);
  assert.equal(m.items.find((x) => x.id === I1).st, "now");
  assert.equal(S.progressOf(S.sessOf(m, I1)), 120);
  assert.equal(E.undo("shelf", u.data, a.undo, NOW + 2000).ok, false);   // back already
});

test("shelf: a record changed after the plan is not changed (conflict)", () => {
  const d = data();
  const c = ch({ action: "update", status: "done" });
  const p = E.plan("shelf", d, { item: I1 }, c, NOW);
  const later = JSON.parse(JSON.stringify(d)); later.items[0].st = "drop"; later.items[0].m = NOW - 10;
  const r = E.apply("shelf", later, { item: I1 }, c, NOW, p.before);
  assert.equal(r.ok, false); assert.equal(r.conflict, true);
});
