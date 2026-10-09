// Pure logic of Battleship: placement rules (bounds, overlap, no
// touching), random fleets, shots (hit / sunk / win), the computer
// players (never repeat a square, finish a ship they found, win every
// game) and the records merge.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the pure functions are
// cut out of the source by name and evaluated on their own. A renamed
// function fails here loudly ("missing function …").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "battleship/battleship.js"), "utf8");

function cut(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}

const B = (() => {
  const parts = [cut("  var DATA_VER", "  // ---------- 1."), "function isInt(v) { return typeof v === \"number\" && isFinite(v) && Math.floor(v) === v; }"];
  ["cmpStr", "coord", "shipCells", "inBounds", "occupancy", "around", "fleetProblem", "anchorAt", "randomFleet",
   "fleetComplete", "seaView", "shotResult", "knownEmpty", "targetCells", "density", "aiPick",
   "normCell", "normRow", "joinCell", "joinRows", "mergeBattleship", "totals"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") +
    "\nreturn { N, FLEET, coord, shipCells, inBounds, occupancy, fleetProblem, anchorAt, randomFleet, fleetComplete," +
    " seaView, shotResult, aiPick, mergeBattleship, totals };")();
})();

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);

test("battleship: fleet 5/4/3/3/2 on a 10x10 sea, squares named A1–J10", () => {
  assert.equal(B.N, 10);
  assert.equal(J(B.FLEET), J([5, 4, 3, 3, 2]));
  assert.equal(B.coord(0), "A1");
  assert.equal(B.coord(9), "J1");
  assert.equal(B.coord(99), "J10");
  assert.equal(J(B.shipCells({ r: 2, c: 3, v: false }, 3)), J([23, 24, 25]));
  assert.equal(J(B.shipCells({ r: 2, c: 3, v: true }, 3)), J([23, 33, 43]));
});

test("battleship: placement validation (bounds, overlap, touching)", () => {
  const F = B.fleetProblem;
  assert.equal(F([null, null, null, null, null], false), "");
  assert.equal(F([{ r: 0, c: 5, v: false }, null, null, null, null], false), "");          // A..: columns 5–9
  assert.equal(F([{ r: 0, c: 6, v: false }, null, null, null, null], false), "bounds");
  assert.equal(F([{ r: 6, c: 0, v: true }, null, null, null, null], false), "bounds");
  assert.equal(F([{ r: 5, c: 0, v: true }, null, null, null, null], false), "");
  assert.equal(F([{ r: -1, c: 0, v: true }, null, null, null, null], false), "bounds");
  assert.equal(F([{ r: 0, c: 0, v: "x" }, null, null, null, null], false), "bounds");
  // crossing ships overlap
  assert.equal(F([{ r: 2, c: 0, v: false }, { r: 0, c: 2, v: true }, null, null, null], false), "overlap");
  // side by side: fine, unless ships may not touch
  const side = [{ r: 0, c: 0, v: false }, { r: 1, c: 0, v: false }, null, null, null];
  assert.equal(F(side, false), "");
  assert.equal(F(side, true), "touch");
  // corner contact counts as touching
  const corner = [{ r: 0, c: 0, v: false }, { r: 1, c: 5, v: false }, null, null, null];
  assert.equal(F(corner, false), "");
  assert.equal(F(corner, true), "touch");
  assert.equal(F([{ r: 0, c: 0, v: false }, { r: 2, c: 0, v: false }, null, null, null], true), "");
  // a tapped square becomes the top / left end, moved back to fit
  assert.equal(J(B.anchorAt(8, 5, false)), J({ r: 0, c: 5, v: false }));
  assert.equal(J(B.anchorAt(91, 4, true)), J({ r: 6, c: 1, v: true }));
  assert.equal(J(B.anchorAt(33, 3, false)), J({ r: 3, c: 3, v: false }));
});

test("battleship: random fleets are complete and legal (both rules)", () => {
  for (let k = 0; k < 400; k++) {
    for (const nt of [false, true]) {
      const f = B.randomFleet(rnd, nt);
      assert.ok(B.fleetComplete(f));
      assert.equal(B.fleetProblem(f, nt), "", J(f));
      assert.equal(B.occupancy(f).filter((x) => x >= 0).length, 17);
    }
  }
});

test("battleship: shots report miss, hit, sunk and the win", () => {
  const f = [{ r: 0, c: 0, v: false }, { r: 2, c: 0, v: false }, { r: 4, c: 0, v: false }, { r: 6, c: 0, v: false }, { r: 8, c: 0, v: false }];
  let shots = [];
  assert.equal(J(B.shotResult(f, shots, 99)), J({ hit: false, sunk: -1, win: false }));
  assert.equal(J(B.shotResult(f, shots, 80)), J({ hit: true, sunk: -1, win: false }));
  shots = [80];
  assert.equal(J(B.shotResult(f, shots, 81)), J({ hit: true, sunk: 4, win: false }));   // the destroyer
  // all but one square of the fleet hit: the last one wins
  const all = [];
  f.forEach((s, k) => B.shipCells(s, B.FLEET[k]).forEach((q) => all.push(q)));
  const last = all.pop();
  const r = B.shotResult(f, all, last);
  assert.ok(r.hit && r.win && r.sunk === 4);
  const v = B.seaView(f, all.concat([last, 99]));
  assert.equal(v.afloat.length, 0);
  assert.equal(v.view[99], 1);
  assert.equal(v.view[0], 3);
  const v2 = B.seaView(f, [0, 1, 55]);
  assert.equal(J([v2.view[0], v2.view[1], v2.view[55], v2.view[2]]), J([2, 2, 1, 0]));
  assert.equal(J(v2.afloat), J([5, 4, 3, 3, 2]));
});

// Plays a whole game for the computer against a random fleet: returns
// the number of shots and checks every pick on the way.
function aiGame(level, nt, onShot) {
  const fleet = B.randomFleet(rnd, nt), shots = [];
  for (let n = 0; n < 100; n++) {
    const sv = B.seaView(fleet, shots);
    if (!sv.afloat.length) return { shots: shots.length, fleet };
    const q = B.aiPick(level, sv.view, sv.afloat, nt, rnd);
    assert.ok(Number.isInteger(q) && q >= 0 && q < 100, level + " picks a square");
    assert.ok(shots.indexOf(q) < 0, level + " never fires twice at " + q);
    if (onShot) onShot(sv, q, fleet, shots);
    shots.push(q);
  }
  const sv = B.seaView(fleet, shots);
  assert.equal(sv.afloat.length, 0, "every game ends within 100 shots");
  return { shots: shots.length, fleet };
}

test("battleship: the computer never repeats a square and always wins", () => {
  for (const lv of ["e", "m", "h"]) {
    for (const nt of [false, true]) {
      for (let k = 0; k < (lv === "h" ? 40 : 80); k++) aiGame(lv, nt);
    }
  }
});

test("battleship: Medium and Hard finish a ship they found", () => {
  // after a hit on a ship still afloat, the next shot is next to a hit
  const nextTo = (q, hits) => hits.some((h) => (Math.abs(h - q) === 10) || (Math.abs(h - q) === 1 && Math.floor(h / 10) === Math.floor(q / 10)));
  for (const lv of ["m", "h"]) {
    for (const nt of [false, true]) {
      for (let k = 0; k < 60; k++) {
        aiGame(lv, nt, (sv, q) => {
          const hits = [];
          sv.view.forEach((v, i) => { if (v === 2) hits.push(i); });
          if (hits.length) assert.ok(nextTo(q, hits), lv + " shoots next to an open hit (" + q + " vs " + J(hits) + ")");
        });
      }
    }
  }
  // a known line of two hits: Medium extends the line, not its side
  const f = [{ r: 4, c: 2, v: false }, { r: 0, c: 0, v: true }, { r: 9, c: 0, v: false }, { r: 9, c: 5, v: false }, { r: 0, c: 8, v: true }];
  const sv = B.seaView(f, [43, 44]);
  for (let k = 0; k < 50; k++) {
    const q = B.aiPick("m", sv.view, sv.afloat, false, rnd);
    assert.ok(q === 42 || q === 45, "line end " + q);
    const h = B.aiPick("h", sv.view, sv.afloat, false, rnd);
    assert.ok(h === 42 || h === 45, "hard line end " + h);
  }
});

test("battleship: stronger levels need fewer shots on average", () => {
  const avg = (lv) => { let s = 0; for (let k = 0; k < 60; k++) s += aiGame(lv, false).shots; return s / 60; };
  const e = avg("e"), m = avg("m"), h = avg("h");
  assert.ok(m < e - 15, "medium " + m + " vs easy " + e);
  assert.ok(h < m, "hard " + h + " vs medium " + m);
});

test("battleship: records merge is a join and a reset drops older rows", () => {
  const MB = B.mergeBattleship;
  const cell = () => { const w = rnd(4), l = rnd(4) + (w ? 0 : 1); return { w, l, bs: w ? 17 + rnd(84) : 0 }; };
  const st = () => {
    const rows = {};
    for (let i = 0; i < rnd(4); i++) {
      const s = {};
      ["e", "m", "h"].forEach((k) => { if (rnd(2)) s[k] = cell(); });
      rows["d" + rnd(4)] = { b: rnd(3) * 100, s };
    }
    return { ver: 1, br: rnd(4) ? 0 : rnd(3) * 100, rows };
  };
  for (let i = 0; i < 5000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a), sb = J(b);
    assert.equal(J(MB(a, b)), J(MB(b, a)));
    const m = MB(a, b);
    assert.equal(J(MB(m, m)), J(m));
    assert.equal(J(MB(MB(a, b), c)), J(MB(a, MB(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
  }
  const x = { rows: { d: { b: 0, s: { h: { w: 2, l: 1, bs: 40 } } } } };
  const y = { rows: { d: { b: 0, s: { h: { w: 1, l: 3, bs: 35 } } } } };
  assert.equal(J(MB(x, y).rows.d.s.h), J({ w: 2, l: 3, bs: 35 }));
  assert.equal(J(MB(x, { rows: { d: { b: 0, s: { h: { w: 0, l: 5, bs: 0 } } } } }).rows.d.s.h), J({ w: 2, l: 5, bs: 40 }));
  // a newer epoch replaces the row; a reset drops older rows
  assert.equal(J(MB(x, { rows: { d: { b: 9, s: { e: { w: 0, l: 1, bs: 0 } } } } }).rows.d), J({ b: 9, s: { e: { w: 0, l: 1, bs: 0 } } }));
  assert.equal(J(MB(x, { br: 5, rows: {} }).rows), "{}");
  for (const bad of [{ w: 0, l: 0, bs: 0 }, { w: 1, l: 0, bs: 0 }, { w: 0, l: 1, bs: 30 }, { w: 1, l: 0, bs: 16 },
    { w: 1, l: 0, bs: 101 }, { w: -1, l: 2, bs: 0 }, { w: 1, l: 0 }, { w: 1.5, l: 0, bs: 20 }]) {
    assert.equal(J(MB({ rows: { d: { b: 0, s: { e: bad } } } }, null).rows), "{}", J(bad));
  }
  assert.equal(J(MB({ rows: { d: { b: -1, s: { e: { w: 1, l: 0, bs: 20 } } } } }, null).rows), "{}");
  // totals across devices: sums, and the fewest shots of any device
  const d = MB({ rows: { a: { b: 0, s: { m: { w: 2, l: 1, bs: 50 } } }, b: { b: 0, s: { m: { w: 1, l: 0, bs: 44 } } } } }, null);
  assert.equal(J(B.totals(d, "m")), J({ w: 3, l: 1, bs: 44 }));
  assert.equal(J(B.totals(d, "e")), J({ w: 0, l: 0, bs: 0 }));
});
