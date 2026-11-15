// Notes › Delete itself (STRICT-5, notes/expire.js + notes.js): the
// sweep deletes like Notes' Delete (tomb, sub-pages up, fresh structure
// clock), the field survives canon and merge, a conflict copy keeps it,
// and the shell sweeps while Notes is closed.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "notes/expire.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const NOW = 1_800_000_000_000, T0 = NOW - 86400000;
function data() {
  return {
    ver: 3, notebooks: [{ id: "nb1", name: "A", mtime: T0, pos: 1 }], labels: [], tombs: {},
    pages: [
      { id: "p1", nb: "nb1", parent: null, title: "Source", text: "M. 555", mtime: T0, pos: 1, labels: [], pinned: false, ct: T0, st: T0, exp: NOW - 1 },
      { id: "p2", nb: "nb1", parent: "p1", title: "Child", text: "x", mtime: T0, pos: 1, labels: [], pinned: false, ct: T0 - 5, st: T0 },
      { id: "p3", nb: "nb1", parent: null, title: "Keep", text: "y", mtime: T0, pos: 4, labels: [], pinned: false, ct: T0, st: T0, exp: NOW + 1000 }
    ]
  };
}

test("expire: a due page gets a tomb, its sub-pages move up with a fresh structure clock", () => {
  const d = data();
  assert.deepEqual(E.dueIds(d.pages, NOW), ["p1"]);
  assert.deepEqual(E.expire(d, NOW), ["p1"]);
  assert.equal(d.tombs.p1, NOW);
  assert.deepEqual(d.pages.map((p) => p.id), ["p2", "p3"]);
  const kid = d.pages[0];
  assert.deepEqual([kid.parent, kid.pos, kid.ct, kid.st, kid.mtime], [null, 5, T0 - 5, NOW, NOW]);
  assert.deepEqual(E.expire(d, NOW), [], "nothing else is due");
  assert.deepEqual(E.dueIds([{ id: "x", exp: "soon" }, { id: "y", exp: NaN }, null], NOW), []);
  assert.equal(E.mayHave('{"pages":[{"exp":1}]}'), true);
  assert.equal(E.mayHave('{"pages":[]}'), false);
  assert.deepEqual(E.left(NOW + 3 * 86400000 + 5, NOW), { n: 3, unit: "d" });
  assert.deepEqual(E.left(NOW + 2 * 3600000, NOW), { n: 2, unit: "h" });
  assert.deepEqual(E.left(NOW + 61000, NOW), { n: 2, unit: "m" });
  assert.deepEqual(E.CHOICES.map((c) => c.id), ["1h", "1d", "7d", "30d"]);
});

// The merge engine of notes.js, as tests/assistant-edits2.test.js loads it.
function blockOf(src, from, to) { const a = src.indexOf(from); const b = src.indexOf(to, a + from.length); return src.slice(a, b); }
const NS = read("notes/notes.js");
const NT = new Function(
  "var DATA_VER = 3, TOMB_PRUNE_DAYS = 30, DAY_MS = 864e5, SEED_NB_ID = 'nb-default';" +
  blockOf(NS, "  var H_MAX", "  function touchStruct") +
  blockOf(NS, "  // ---------- 7. Merge engine", "  function mergeNotesStates") +
  blockOf(NS, "  function mergeNotesStates", "\n  }\n") + "\n  }\n" +
  "return { canonNotes, mergeNotesStates };")();

test("notes: exp survives canon and merge, the newer structure decides, odd values go", () => {
  const a = NT.canonNotes(data());
  assert.equal(a.pages.find((p) => p.id === "p1").exp, NOW - 1);
  const odd = data(); odd.pages[0].exp = "tomorrow";
  assert.equal("exp" in NT.canonNotes(odd).pages.find((p) => p.id === "p1"), false);
  // another device cancelled it later (structure clock newer)
  const b = data(); delete b.pages[0].exp; b.pages[0].st = NOW; b.pages[0].mtime = NOW;
  const m = NT.mergeNotesStates(NT.canonNotes(data()), NT.canonNotes(b));
  assert.equal("exp" in m.pages.find((p) => p.id === "p1"), false);
  // and the other way round: set later wins over an old page without it
  const c = data(); delete c.pages[0].exp;
  const s = data(); s.pages[0].st = NOW; s.pages[0].mtime = NOW;
  assert.equal(NT.mergeNotesStates(NT.canonNotes(c), NT.canonNotes(s)).pages.find((p) => p.id === "p1").exp, NOW - 1);
});

test("notes: a conflict copy of a self-deleting page deletes itself too", () => {
  const x = data(), y = data();
  x.pages[0].text = "edit on phone"; x.pages[0].ct = NOW - 10; x.pages[0].mtime = NOW - 10; x.pages[0].h = [T0 - 99];
  y.pages[0].text = "edit on laptop"; y.pages[0].ct = NOW - 20; y.pages[0].mtime = NOW - 20; y.pages[0].h = [T0 - 98];
  const m = NT.mergeNotesStates(NT.canonNotes(x), NT.canonNotes(y));
  const copies = m.pages.filter((p) => p.cf);
  assert.ok(copies.length >= 1, "two different edits keep both texts");
  copies.forEach((p) => assert.equal(p.exp, NOW - 1));
});

test("notes and the shell sweep: wiring", () => {
  assert.match(NS, /sweepExpired\(\);\s+\/\/ STRICT-5/);
  assert.match(read("notes/index.html"), /<script src="expire\.js\?v=[^"]+"><\/script>\s*<script src="notes\.js/);
  const sh = read("shell.js");
  assert.match(sh, /function notesExpireSweep\(\)/);
  assert.match(sh, /if \(osResetting \|\| appLive\("notes"\)\) return;/);
});
