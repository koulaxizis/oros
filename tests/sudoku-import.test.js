// Sudoku "Import puzzles" (sudoku/import.js): every text shape (one
// line of 81, many lines, 9×9 grids with rules, SadMan .sdk, Simple
// Sudoku .ss), the checks (conflicts, no solution, "has N solutions"),
// duplicates, the library join (symmetric, associative, idempotent),
// apply / undo with newer-stamped tombstones, and the app's merge
// carrying the library.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const I = require("../sudoku/import.js");

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);

// A well-known unique puzzle and its solution.
const P1 = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const S1 = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
// Another unique one (Project Euler grid 02 style, here as dots).
const P2 = "4.....8.5.3..........7......2.....6.....8.4......1.......6.3.7.5..2.....1.4......";

function asGrid(p, opts) {
  opts = opts || {};
  const rows = [];
  for (let r = 0; r < 9; r++) {
    let line = "";
    for (let c = 0; c < 9; c++) {
      const ch = p[r * 9 + c] === "0" ? (opts.blank || ".") : p[r * 9 + c];
      line += ch + (opts.bars && (c === 2 || c === 5) ? "|" : "");
    }
    rows.push(line);
    if (opts.rule && (r === 2 || r === 5)) rows.push(opts.rule);
  }
  return rows.join("\n");
}

test("sudoku import: one line, many lines, grids, .ss and .sdk", () => {
  // one line, 0 for blanks, with a trailing rating
  let r = I.analyze(P1 + "   rating 2.3", null);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].p, P1);
  assert.equal(r.items[0].st, "ok");
  // dots and dashes, spaces and bars ignored
  r = I.analyze(P2.replace(/\./g, "-").replace(/(.{9})/g, "$1 | "), null);
  assert.equal(r.items[0].p, P2.replace(/\./g, "0"));
  assert.equal(r.items[0].st, "ok");
  // many lines, CRLF, a blank line and a comment line
  r = I.analyze([P1, "", "# a comment", P2, P1].join("\r\n"), null);
  assert.equal(J(r.items.map((x) => x.st)), J(["ok", "ok", "dup"]));
  assert.equal(J(r.items.map((x) => x.at)), J([1, 4, 5]));
  // 9×9 grid with box rules (Simple Sudoku .ss)
  r = I.analyze(asGrid(P1, { bars: true, rule: "-----------" }), null);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].p, P1);
  r = I.analyze(asGrid(P1, { bars: true, rule: "---+---+---", blank: "0" }), null);
  assert.equal(r.items[0].p, P1);
  // spaced grid with "- - -" style rows and a title line (Project Euler)
  r = I.analyze("Grid 01\n" + asGrid(P1, { blank: "0" }).split("\n").map((l) => l.split("").join(" ")).join("\n") +
    "\nGrid 02\n" + asGrid(P2), null);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[1].p, P2.replace(/\./g, "0"));
  // a row of nine blanks written as dashes
  const p3 = "000000000" + P1.slice(9);
  r = I.analyze(asGrid(p3, { blank: "-" }), null);
  assert.equal(r.items[0].p, p3);
  // SadMan .sdk: metadata, [Puzzle], a [State] section that is ignored
  const sdk = "#AJohn\n#DFirst puzzle\n#B01-01-2020\n" + asGrid(P1);
  r = I.analyze(sdk, null);
  assert.equal(r.items[0].p, P1);
  assert.equal(r.items[0].nm, "First puzzle");
  const sdk2 = "[Puzzle]\n" + asGrid(P1) + "\n[State]\n" + asGrid(S1);
  r = I.analyze(sdk2, null);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].p, P1);
  // nothing usable
  assert.equal(I.analyze("hello world\n12 34", null).items.length, 0);
  assert.equal(I.analyze("", null).items.length, 0);
});

test("sudoku import: checks, solution counts, caps", () => {
  // two equal givens in a row
  const bad = "55" + P1.slice(2);
  assert.equal(I.check(bad).st, "conflict");
  // no solution (no clash among the givens, still impossible): row 0
  // needs a 9 in its last cell, but column 8 already has one
  const none = "12345678" + "0" + "000000009" + "0".repeat(63);
  assert.equal(I.check(none).st, "none");
  // not unique: take givens out of a unique puzzle
  const multi = "000000000" + P1.slice(9);
  const c = I.check(multi);
  assert.equal(c.st, "multi");
  assert.ok(c.n >= 2);
  // an empty grid: many solutions, the count stops at the limit
  const e = I.check("0".repeat(81));
  assert.equal(e.st, "multi");
  assert.equal(e.n, I.COUNT_LIMIT);
  assert.ok(e.cut);
  // the counter finds the solution
  assert.equal(I.countSolutions(P1, 2).sol, S1);
  // at most MAX_PUZZLES are read
  const many = [];
  for (let i = 0; i < I.MAX_PUZZLES + 20; i++) many.push(S1.slice(0, 80) + "0");
  const r = I.analyze(many.join("\n"), null);
  assert.equal(r.items.length, I.MAX_PUZZLES);
  assert.ok(r.counts.more);
  assert.equal(r.counts.dup, I.MAX_PUZZLES - 1);
});

test("sudoku import: apply, undo with tombstones, re-import, solved", () => {
  const T0 = 1000;
  const res = I.analyze([P1, P2, "55" + P1.slice(2), "000000000" + P1.slice(9)].join("\n"), null);
  assert.equal(J(res.items.map((x) => x.st)), J(["ok", "ok", "conflict", "multi"]));
  const a = I.apply(null, res.items, T0);
  assert.equal(a.ids.length, 3);
  assert.equal(I.list(a.lib).length, 3);
  assert.ok(a.ids.every((id) => /^imp-[a-z0-9]+$/.test(id)));
  // stable ids: the same text again adds nothing
  const again = I.analyze([P1, P2].join("\n"), a.lib);
  assert.equal(J(again.items.map((x) => x.st)), J(["have", "have"]));
  assert.equal(I.apply(a.lib, again.items, T0 + 5).ids.length, 0);
  // undo: hidden by a newer stamp; the entries stay as tombstones
  const u = I.undo(a.lib, a.undo, T0 + 10);
  assert.equal(I.list(u).length, 0);
  assert.equal(Object.keys(u).length, 3);
  // a device that still has the import cannot bring it back
  assert.equal(I.list(I.mergeLib(u, a.lib)).length, 0);
  // undo stamped earlier than the import (clock skew) still hides it
  assert.equal(I.list(I.undo(a.lib, a.undo, T0 - 50)).length, 0);
  // a later import brings them back
  const b = I.apply(u, I.analyze(P1, u).items, T0 + 20);
  assert.equal(b.ids.length, 1);
  assert.equal(I.list(I.mergeLib(b.lib, u)).length, 1);
  // a solved puzzle: best time without hints, solved stamp
  const id = b.ids[0];
  let lib = I.solved(b.lib, id, 90000, false, T0 + 30);
  lib = I.solved(lib, id, 120000, false, T0 + 40);
  lib = I.solved(lib, id, 50000, true, T0 + 50);
  assert.equal(lib[id].t, 90000);
  assert.equal(lib[id].s, T0 + 50);
  // apply never touches the input
  const before = J(a.lib);
  I.apply(a.lib, I.analyze(P2, null).items, T0 + 60);
  I.undo(a.lib, a.undo, T0 + 61);
  assert.equal(J(a.lib), before);
});

test("sudoku import: the library merge is a join and drops bad entries", () => {
  const ps = [P1, P2.replace(/\./g, "0"), S1.slice(0, 80) + "0"];
  const st = () => {
    const m = {};
    for (let i = 0; i < rnd(4); i++) {
      const p = ps[rnd(3)], e = { p, b: 1 + rnd(4) * 10, x: rnd(3) * 10, s: rnd(3) * 7, t: rnd(3) * 1000 };
      if (rnd(2)) e.nm = ["a", "b", "Zed"][rnd(3)];
      m[I.idOf(p)] = e;
    }
    return m;
  };
  for (let i = 0; i < 3000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a);
    assert.equal(J(I.mergeLib(a, b)), J(I.mergeLib(b, a)));
    const m = I.mergeLib(a, b);
    assert.equal(J(I.mergeLib(m, m)), J(m));
    assert.equal(J(I.mergeLib(I.mergeLib(a, b), c)), J(I.mergeLib(a, I.mergeLib(b, c))));
    assert.equal(J(a), sa);
  }
  const id = I.idOf(P1);
  assert.equal(I.mergeLib({ [id]: { p: P2.replace(/\./g, "0"), b: 1 } }, null), null);   // id does not match
  assert.equal(I.mergeLib({ [id]: { p: P1, b: 0 } }, null), null);                        // never added
  assert.equal(I.mergeLib({ "imp-x y": { p: P1, b: 1 } }, null), null);
  assert.equal(I.mergeLib({ [id]: { p: "1".repeat(80), b: 1 } }, null), null);
  assert.equal(I.mergeLib([], null), null);
  const ok = I.mergeLib({ [id]: { p: P1, b: 5, nm: "<b>x</b>\u0000", t: -4, extra: 1 } }, null);
  assert.equal(J(ok), J({ [id]: { p: P1, nm: "<b>x</b>", b: 5, x: 0, s: 0, t: 0 } }));
});

test("sudoku: the app's merge carries the library (and leaves it out when empty)", () => {
  const SRC = fs.readFileSync(path.join(__dirname, "..", "sudoku/sudoku.js"), "utf8");
  const cut = (name) => { const i = SRC.indexOf("  function " + name + "("); return SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4); };
  const head = SRC.slice(SRC.indexOf("  var DATA_VER"), SRC.indexOf("  // ---------- 1."));
  const src = head + ["cmpStr", "normDay", "dayKeyOk", "dayBetter", "normCell", "normRow", "joinCell", "joinRows",
    "mergeSudoku", "libJoin"].map(cut).join("\n") + "\nreturn mergeSudoku;";
  const window = { OrosSudokuImport: I };
  const M = new Function("window", src)(window);
  assert.equal(J(M(null, null)), J({ ver: 1, br: 0, rows: {}, days: {} }));
  const lib = I.apply(null, I.analyze(P1, null).items, 77).lib;
  const m = M({ rows: {}, lib }, { rows: {}, br: 99 });
  assert.equal(J(m.lib), J(lib));                // a records reset keeps the imported puzzles
  assert.equal(J(M(m, m)), J(m));
  // without the module the library is carried, not dropped
  const M0 = new Function("window", src)({});
  assert.equal(J(M0({ rows: {}, lib }, null).lib), J(lib));
});
