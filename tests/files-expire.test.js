// Files › Delete itself (STRICT-5, slice "files-exp", files-core.js):
// per-item merge like Favourites, moves carry it, due paths, and the
// shell's sweep while Files is closed.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "files/files-core.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const P = "/internal/Documents/leak.pdf";

test("files-exp: set, cancel (a tomb), merge both ways the same, odd items dropped", () => {
  let s = C.expSet(C.normExps(null), P, 5000, 1000);
  assert.equal(C.expOf(s, P), 5000);
  const cancelled = C.expSet(s, P, 0, 2000);
  assert.equal(C.expOf(cancelled, P), 0);
  assert.deepEqual(C.mergeExps(s, cancelled), C.mergeExps(cancelled, s));
  assert.equal(C.expOf(C.mergeExps(s, cancelled), P), 0, "the newer cancel wins");
  const later = C.expSet(cancelled, P, 9000, 3000);
  assert.equal(C.expOf(C.mergeExps(cancelled, later), P), 9000);
  assert.deepEqual(C.normExps({ items: [{ p: P, m: 1 }, { p: "../x", e: 5, m: 1 }, { p: "/internal/a", e: "soon", m: 1 }] }).items, []);
});

test("files-exp: a move or rename carries it, a folder move carries what is inside", () => {
  let s = C.expSet(C.normExps(null), P, 5000, 1000);
  s = C.expMove(s, P, "/internal/Documents/old.pdf", 2000);
  assert.equal(C.expOf(s, P), 0);
  assert.equal(C.expOf(s, "/internal/Documents/old.pdf"), 5000);
  s = C.expMove(s, "/internal/Documents", "/internal/Archive", 3000);
  assert.equal(C.expOf(s, "/internal/Archive/old.pdf"), 5000);
  assert.deepEqual(C.expDue(s, 4999), []);
  assert.deepEqual(C.expDue(s, 5000), ["/internal/Archive/old.pdf"]);
});

test("files-exp: wiring in Files and the shell", () => {
  const F = read("files/files.js"), sh = read("shell.js");
  assert.match(F, /api\.registerSlice\("files-exp"/);
  assert.match(F, /expCommit\(CORE\.expMove\(exps, path, CORE\.trashItemDir\(id\)/, "it follows into the Trash");
  assert.match(F, /function favCarry\(from, to\) \{[^\n]*CORE\.expMove/);
  assert.match(sh, /function filesExpireSweep\(\)/);
  assert.match(sh, /if \(osResetting \|\| filesExpBusy \|\| appLive\("files"\)\) return;/);
});
